/**
 * SHEAL LAUNCHER - Gestor real de versiones de Minecraft.
 * Descarga el manifest de Mojang, instala versiones (cliente, librerías,
 * assets) y lanza el juego usando Java o el launcher oficial.
 *
 * Todo se hace en el proceso principal de Electron (sin problemas de CORS).
 */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const zlib = require("node:zlib");
const { spawn, spawnSync } = require("node:child_process");
const { Readable } = require("node:stream");
const { pipeline, finished } = require("node:stream/promises");
const crypto = require("node:crypto");

const MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const RESOURCES_URL = "https://resources.download.minecraft.net";
// Espejo alternativo (mismo contenido que Mojang, usado por launchers tipo TLauncher).
const MIRROR = "https://bmclapi2.bangbang93.com";
const MIRROR_MANIFEST = `${MIRROR}/mc/game/version_manifest_v2.json`;

/** UUID offline estable derivado del nombre (estilo OfflinePlayer). */
function offlineUuid(name) {
  const raw = "OfflinePlayer:" + name.toLowerCase();
  const hash = crypto.createHash("md5").update(raw).digest("hex");
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
}

/** Token JWT falso (sin firma verificable) para sesiones offline en MC moderno. */
function offlineToken(name) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "none", typ: "JWT" });
  const payload = b64({
    sub: offlineUuid(name),
    name,
    exp: now + 86400,
    iat: now,
    iss: "sheal-launcher",
  });
  return `${header}.${payload}.offline`;
}

function createMinecraft({ userData, appData, send, updater }) {
  // Prioridad: archivos descargados por el updater > app.asar.
  const updated = (rel) => (updater && updater.localPath(rel)) || null;
  const configPath = path.join(userData, "sheal-launcher-config.json");

  function loadConfig() {
    try {
      return JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch {
      return {};
    }
  }
  function saveConfig(next) {
    const current = loadConfig();
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ ...current, ...next }, null, 2));
    return { ...current, ...next };
  }

  function minecraftDir() {
    return loadConfig().minecraftDir || path.join(appData, ".minecraft");
  }
  function dirs() {
    const root = minecraftDir();
    return {
      root,
      versions: path.join(root, "versions"),
      libraries: path.join(root, "libraries"),
      assets: path.join(root, "assets"),
      indexes: path.join(root, "assets", "indexes"),
      objects: path.join(root, "assets", "objects"),
      natives: path.join(root, "versions"),
    };
  }
  const report = (payload) => send && send(payload);

  /* ---------------------- Java / Launcher ---------------------- */

  function parseJavaMajor(text) {
    const match = String(text || "").match(/(?:version\s+")?(\d+)(?:\.(\d+))?/);
    if (!match) return 0;
    let major = parseInt(match[1], 10);
    if (major === 1) major = parseInt(match[2] || "0", 10);
    return major;
  }

  function javaVersionText(exe) {
    try {
      const r = spawnSync(exe, ["-version"], { encoding: "utf8", windowsHide: true });
      return ((r.stderr || r.stdout || "").split("\n")[0] || "").trim();
    } catch {
      return "";
    }
  }

  /** Java mínimo según la versión de Minecraft (26.x y 1.20.5+ necesitan 21). */
  function javaRequired(id) {
    const match = String(id || "").match(/^(\d+)\.(\d+)/);
    if (match) {
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      // Versiones 26.x traen un runtime Java 25 y usan opciones JVM nuevas.
      if (major >= 26) return 25;
      if (major === 1 && minor <= 12) return 8;
      if (major === 1 && minor <= 20 && !/^1\.20\.[5-9]/.test(id)) return 17;
    }
    return 21;
  }

  function jreUrlFor(major) {
    return `https://api.adoptium.net/v3/binary/latest/${major}/ga/windows/x64/${major >= 17 ? "jdk" : "jre"}/hotspot/normal/eclipse`;
  }

  function mojangRuntimeKey(major) {
    if (major >= 25) return "java-runtime-epsilon";
    if (major >= 21) return "java-runtime-delta";
    if (major >= 17) return "java-runtime-beta";
    return "jre-legacy";
  }

  function findJava(minMajor = 0) {
    const cfg = loadConfig().javaPath;
    const candidates = [];
    if (cfg) candidates.push(cfg);
    if (process.env.JAVA_HOME) candidates.push(path.join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "javaw.exe" : "java"));
    candidates.push("javaw", "java");

    // Java incluido en el runtime de Minecraft / TLauncher
    const runtimeRoots = [path.join(minecraftDir(), "runtime"), path.join(appData, ".minecraft", "runtime")];
    for (const root of runtimeRoots) {
      try {
        const found = [];
        const walk = (dir, depth) => {
          if (depth > 6 || found.length > 6) return;
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full, depth + 1);
            else if (/^javaw?\.exe$/i.test(entry.name)) found.push(full);
          }
        };
        if (fs.existsSync(root)) walk(root, 0);
        candidates.unshift(...found);
      } catch {}
    }

    // Java instalado en Program Files
    const pf = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean);
    for (const base of pf) {
      for (const vendor of ["Eclipse Adoptium", "Microsoft", "Oracle", "Java"]) {
        const vendorDir = path.join(base, vendor);
        try {
          if (!fs.existsSync(vendorDir)) continue;
          for (const jdk of fs.readdirSync(vendorDir)) {
            const exe = path.join(vendorDir, jdk, "bin", "javaw.exe");
            if (fs.existsSync(exe)) candidates.unshift(exe);
          }
        } catch {}
      }
    }

    const seen = new Set();
    for (const c of candidates) {
      if (!c || seen.has(c)) continue;
      seen.add(c);
      try {
        if (c !== "javaw" && c !== "java" && !fs.existsSync(c)) continue;
        const r = spawnSync(c, ["-version"], { encoding: "utf8", windowsHide: true });
        if (r.status !== 0) continue;
        const version = ((r.stderr || r.stdout || "").split("\n")[0] || "").trim();
        const major = parseJavaMajor(version);
        if (major >= minMajor) return { path: c, version, major };
      } catch {}
    }
    return null;
  }

  function findLauncher() {
    const cfg = loadConfig().launcherPath;
    const candidates = [
      cfg,
      path.join(minecraftDir(), "MinecraftLauncher.exe"),
      path.join(minecraftDir(), "TLauncher.exe"),
      path.join(appData, ".minecraft", "TLauncher.exe"),
      path.join(process.env.PROGRAMFILES || "", "Minecraft Launcher", "MinecraftLauncher.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "", "Minecraft Launcher", "MinecraftLauncher.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Minecraft Launcher", "MinecraftLauncher.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Minecraft", "Minecraft.exe"),
    ].filter(Boolean);
    return candidates.find((p) => fs.existsSync(p)) || null;
  }

  /** Abre (y crea si hace falta) una carpeta del juego en el Explorador. */
  function openSubfolder(name) {
    const allowed = ["mods", "shaderpacks", "resourcepacks", "saves", "skins"];
    if (!allowed.includes(name)) throw new Error("Carpeta no permitida");
    const target = path.join(minecraftDir(), name);
    fs.mkdirSync(target, { recursive: true });
    const result = spawnSync("explorer.exe", [target], { windowsHide: true });
    return { path: target, opened: result.status === 0 };
  }

  /** Busca el PNG de una skin dentro de la app (dist o public). */
  function skinSource(fileName) {
    const appRoot = path.join(__dirname, "..");
    const fromUpdate = updated(path.join("skins", fileName).replace(/\\/g, "/"));
    const candidates = [
      ...(fromUpdate ? [fromUpdate] : []),
      path.join(appRoot, "dist", "skins", fileName),
      path.join(appRoot, "public", "skins", fileName),
      path.join(process.resourcesPath || "", "skins", fileName),
    ];
    return candidates.find((p) => fs.existsSync(p)) || null;
  }

  /* ---------- ZIP mínimo (sin dependencias) para el pack de skin ---------- */
  function crc32(buffer) {
    let crc = 0xffffffff;
    for (let i = 0; i < buffer.length; i++) {
      let c = (crc ^ buffer[i]) & 0xff;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
      crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function makeZip(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const entry of entries) {
      const name = Buffer.from(entry.name, "utf8");
      const data = entry.data;
      const crc = crc32(data);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0, 6);
      local.writeUInt16LE(0, 8); // store
      local.writeUInt16LE(0, 10);
      local.writeUInt16LE(0, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);
      localParts.push(local, name, data);

      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(0, 8);
      central.writeUInt16LE(0, 10);
      central.writeUInt16LE(0, 12);
      central.writeUInt16LE(0, 14);
      central.writeUInt32LE(crc, 16);
      central.writeUInt32LE(data.length, 20);
      central.writeUInt32LE(data.length, 24);
      central.writeUInt16LE(name.length, 28);
      central.writeUInt16LE(0, 30);
      central.writeUInt16LE(0, 32);
      central.writeUInt16LE(0, 34);
      central.writeUInt16LE(0, 36);
      central.writeUInt32LE(0, 38);
      central.writeUInt32LE(offset, 42);
      centralParts.push(central, name);
      offset += local.length + name.length + data.length;
    }
    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);
    return Buffer.concat([...localParts, ...centralParts, end]);
  }

  /**
   * Inyecta la skin SOLO en este cliente mediante un pack de recursos:
   * sobrescribe las texturas por defecto del jugador (wide y slim).
   * Nadie más lo ve: es una textura local en tu pantalla.
   */
  function injectSkinLocal(fileName) {
    const source = skinSource(fileName);
    if (!source) throw new Error("No se encontró el archivo de la skin");
    const png = fs.readFileSync(source);
    const modelNames = ["steve", "alex", "ari", "efe", "kai", "makena", "noor", "sunny", "zuri"];
    const entries = [
      {
        name: "pack.mcmeta",
        data: Buffer.from(
          JSON.stringify({
            pack: {
              pack_format: 89,
              supported_formats: { min_inclusive: 15, max_inclusive: 97 },
              min_format: 15,
              max_format: 97,
              description: "SHEAL Skin (solo local)",
            },
          }),
        ),
      },
    ];
    for (const model of ["wide", "slim"]) {
      for (const name of modelNames) {
        entries.push({ name: `assets/minecraft/textures/entity/player/${model}/${name}.png`, data: png });
      }
    }
    // Rutas antiguas (por si alguna versión las sigue usando).
    for (const name of ["steve", "alex"]) {
      entries.push({ name: `assets/minecraft/textures/entity/${name}.png`, data: png });
    }

    const packDir = path.join(minecraftDir(), "resourcepacks");
    fs.mkdirSync(packDir, { recursive: true });
    const zipPath = path.join(packDir, "sheal_skin.zip");
    fs.writeFileSync(zipPath, makeZip(entries));

    const optionsPath = path.join(minecraftDir(), "options.txt");
    let text = fs.existsSync(optionsPath) ? fs.readFileSync(optionsPath, "utf8") : "";
    const line = text.split(/\r?\n/).find((l) => l.startsWith("resourcePacks:"));
    if (line) {
      let list = [];
      try {
        list = JSON.parse(line.slice("resourcePacks:".length).trim());
      } catch {
        list = ["vanilla"];
      }
      list = list.filter((item) => item !== "file/sheal_skin.zip");
      list.push("file/sheal_skin.zip");
      text = text.replace(line, `resourcePacks:${JSON.stringify(list)}`);
    } else {
      text += (text && !text.endsWith("\n") ? "\n" : "") + 'resourcePacks:["file/sheal_skin.zip"]\n';
    }
    const incompatibleLine = text.split(/\r?\n/).find((l) => l.startsWith("incompatibleResourcePacks:"));
    if (incompatibleLine) {
      let bad = [];
      try {
        bad = JSON.parse(incompatibleLine.slice("incompatibleResourcePacks:".length).trim());
      } catch {
        bad = [];
      }
      bad = bad.filter((item) => !String(item).includes("sheal_skin"));
      text = text.replace(incompatibleLine, `incompatibleResourcePacks:${JSON.stringify(bad)}`);
    }
    fs.writeFileSync(optionsPath, text);
    return { zip: zipPath };
  }

  /** Copia la skin elegida a la carpeta de skins del juego y la deja activa. */
  function installSkin(fileName, username, uuid) {
    if (!/^[\w.-]+\.png$/i.test(String(fileName || ""))) throw new Error("Nombre de skin no válido");
    const source = skinSource(fileName);
    if (!source) throw new Error("No se encontró el archivo de la skin");
    const injected = injectSkinLocal(fileName);

    const skinsDir = path.join(minecraftDir(), "skins");
    fs.mkdirSync(skinsDir, { recursive: true });
    fs.copyFileSync(source, path.join(skinsDir, fileName));
    if (uuid) fs.copyFileSync(source, path.join(skinsDir, `${uuid}.png`));
    if (username) fs.copyFileSync(source, path.join(skinsDir, `${username}.png`));
    fs.writeFileSync(
      path.join(minecraftDir(), "sheal-skin.json"),
      JSON.stringify({ file: fileName, uuid, username, installedAt: Date.now() }, null, 2),
    );
    return { path: path.join(skinsDir, fileName), resourcePack: injected.zip };
  }

  function applyStoredSkin() {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(minecraftDir(), "sheal-skin.json"), "utf8"));
      if (cfg?.file) installSkin(cfg.file, cfg.username, cfg.uuid);
    } catch {
      /* no hay skin guardada todavía */
    }
  }


  /* ---------- Java automático para los amigos ---------- */
  const JRE_URL = "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse";

  /** Extrae todos los archivos de un ZIP (store o deflate). */
  function unzipAll(buffer, destDir) {
    let eocd = -1;
    for (let i = buffer.length - 22; i >= 0; i--) {
      if (buffer.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("El archivo de Java descargado no es válido.");
    const count = buffer.readUInt16LE(eocd + 10);
    let pos = buffer.readUInt32LE(eocd + 16);
    const root = path.resolve(destDir);
    fs.mkdirSync(root, { recursive: true });
    for (let i = 0; i < count; i++) {
      if (pos + 46 > buffer.length || buffer.readUInt32LE(pos) !== 0x02014b50) break;
      const method = buffer.readUInt16LE(pos + 10);
      const compSize = buffer.readUInt32LE(pos + 20);
      const nameLen = buffer.readUInt16LE(pos + 28);
      const extraLen = buffer.readUInt16LE(pos + 30);
      const commentLen = buffer.readUInt16LE(pos + 32);
      const localOff = buffer.readUInt32LE(pos + 42);
      const name = buffer.toString("utf8", pos + 46, pos + 46 + nameLen);
      pos += 46 + nameLen + extraLen + commentLen;
      if (!name || name.endsWith("/")) continue;
      if (localOff + 30 > buffer.length) continue;
      const lNameLen = buffer.readUInt16LE(localOff + 26);
      const lExtraLen = buffer.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const compressed = buffer.subarray(start, start + compSize);
      let content;
      try {
        content = method === 0 ? compressed : method === 8 ? zlib.inflateRawSync(compressed) : null;
      } catch {
        content = null;
      }
      if (!content) continue;
      const target = path.resolve(root, name);
      if (!target.startsWith(root)) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  }

  function findJavaExe(dir, depth = 0) {
    if (depth > 5 || !fs.existsSync(dir)) return null;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findJavaExe(full, depth + 1);
        if (found) return found;
      } else if (/^javaw?\.exe$/i.test(entry.name)) {
        return full;
      }
    }
    return null;
  }

  /** Descarga el JRE 21 desde Adoptium (un solo ZIP). */
  async function ensureJavaFromAdoptium(required) {
    report({ id: "java", phase: "java", label: `Descargando Java ${required} (primera vez)...`, percent: 4 });
    const runtimeDir = path.join(userData, "runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    const zipPath = path.join(runtimeDir, "temurin-jre21.zip");
    const response = await fetch(jreUrlFor(required));
    if (!response.ok) throw new Error(`Adoptium HTTP ${response.status}`);

    const total = Number(response.headers.get("content-length") || 0);
    let done = 0;
    const writer = fs.createWriteStream(zipPath);
    for await (const chunk of Readable.fromWeb(response.body)) {
      writer.write(chunk);
      done += chunk.length;
      if (total) {
        report({
          id: "java",
          phase: "java",
          label: `Descargando Java 21 (${Math.round((done / total) * 100)}%)...`,
          percent: 4 + Math.round((done / total) * 72),
        });
      }
    }
    writer.end();
    await finished(writer);

    report({ id: "java", phase: "java", label: "Instalando Java 21...", percent: 80 });
    const javaHome = path.join(runtimeDir, "jre21");
    unzipAll(fs.readFileSync(zipPath), javaHome);
    try { fs.unlinkSync(zipPath); } catch {}
    const exe = findJavaExe(javaHome);
    if (!exe) throw new Error("No se encontró javaw.exe tras instalar Java.");
    saveConfig({ javaPath: exe });
    report({ id: "java", phase: "java", label: "Java 21 instalado", percent: 100 });
    return { path: exe, version: `Eclipse Temurin Java ${required}`, major: required };
  }

  /** Descarga el runtime Java 21 de Mojang (el mismo que usa TLauncher). */
  async function ensureJavaFromMojang(required) {
    const key = mojangRuntimeKey(required);
    report({ id: "java", phase: "java", label: `Descargando Java ${required} desde Mojang/TLauncher...`, percent: 5 });
    const config = await getJsonSafe("https://rescl.tlauncher.org/b/jvm/java_configuration.json");
    const entry = config?.["windows-x64"]?.[key]?.[0];
    if (!entry?.manifest?.url) throw new Error("No se obtuvo el manifest de Java 21.");
    const manifest = await getJsonSafe(entry.manifest.url);
    const files = Object.entries(manifest.files || {}).filter(([, meta]) => meta?.type === "file" && meta?.downloads?.raw?.url);
    const runtimeDir = path.join(userData, "runtime", "java21-mojang");
    fs.mkdirSync(runtimeDir, { recursive: true });

    let done = 0;
    const queue = [...files];
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        while (queue.length) {
          const item = queue.shift();
          if (!item) return;
          const [name, meta] = item;
          const target = path.join(runtimeDir, name);
          const resolved = path.resolve(target);
          if (!resolved.startsWith(path.resolve(runtimeDir))) return;
          try {
            await downloadSafe(meta.downloads.raw.url, target);
          } catch {}
          done++;
          report({
            id: "java",
            phase: "java",
            label: `Descargando Java ${required} desde Mojang/TLauncher (${done}/${files.length})...`,
            percent: 5 + Math.round((done / Math.max(1, files.length)) * 90),
          });
        }
      }),
    );
    const exe = findJavaExe(runtimeDir);
    if (!exe) throw new Error("No se encontró javaw.exe en el runtime de Mojang.");
    saveConfig({ javaPath: exe });
    report({ id: "java", phase: "java", label: "Java 21 instalado", percent: 100 });
    return { path: exe, version: `Mojang/TLauncher Java ${required} (${entry.version?.name || required})`, major: required };
  }

  /** Escribe la configuración de partículas y alas que lee el mod dentro del juego. */
  function writeParticleConfig(shape, color, wings, wingStyle) {
    const safeShape = ["dust", "heart", "flame", "portal", "endrod", "spark", "enchant", "note", "aura"].includes(shape) ? shape : "dust";
    const safeColor = /^#[0-9a-f]{6}$/i.test(color || "") ? color.toLowerCase() : "#a855f7";
    const safeStyle = ["angel", "phoenix", "butterfly", "fairy", "bat", "dragon"].includes(wingStyle) ? wingStyle : "angel";
    const target = path.join(minecraftDir(), "sheal-particles.json");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ shape: safeShape, color: safeColor, wings: wings === true, wingStyle: safeStyle }, null, 2));
    return target;
  }

  /** Prepara Fabric Loader + mod de partículas para la versión 26.3. */
  async function ensureFabric() {
    const fabricDir = path.join(userData, "fabric");
    fs.mkdirSync(fabricDir, { recursive: true });
    const modsDir = path.join(minecraftDir(), "mods");
    fs.mkdirSync(modsDir, { recursive: true });

    report({ id: "fabric", phase: "fabric", label: "Preparando partículas (Fabric)...", percent: 1 });
    const profile = await getJsonSafe("https://meta.fabricmc.net/v2/versions/loader/26.3/0.20.1/profile/json");
    const libs = [];
    for (const lib of profile.libraries || []) {
      const [group, artifact, version] = String(lib.name || "").split(":");
      if (!group || !artifact || !version || !lib.url) continue;
      const mavenPath = group.replace(/\./g, "/") + "/" + artifact + "/" + version;
      const jarName = `${artifact}-${version}.jar`;
      const jarPath = path.join(
        minecraftDir(), "libraries",
        group.replace(/\./g, path.sep), artifact, version, jarName,
      );
      const jarUrl = String(lib.url).replace(/\/?$/, "/") + mavenPath + "/" + jarName;
      // Descartamos archivos corruptos de intentos anteriores (HTML, etc.).
      try {
        if (fs.existsSync(jarPath) && fs.readFileSync(jarPath).subarray(0, 2).toString() !== "PK") {
          fs.unlinkSync(jarPath);
        }
      } catch {}
      try {
        await downloadSafe(jarUrl, jarPath);
        libs.push(jarPath);
      } catch {}
    }

    // Fabric API (necesario para el evento de tick del mod).
    const apiPath = path.join(modsDir, "fabric-api.jar");
    try {
      await downloadSafe(
        "https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/0.166.2+26.3/fabric-api-0.166.2+26.3.jar",
        apiPath,
      );
    } catch {}

    // Copiamos el mod de partículas incluido en la app (o la version actualizada).
    const appRoot = path.join(__dirname, "..");
    const modSource = [
      updated("mods/sheal-particles.jar"),
      path.join(appRoot, "dist", "mods", "sheal-particles.jar"),
      path.join(appRoot, "public", "mods", "sheal-particles.jar"),
    ].find((file) => file && fs.existsSync(file));
    if (modSource) {
      try { fs.copyFileSync(modSource, path.join(modsDir, "sheal-particles.jar")); } catch {}
    }
    // Copiamos tambien el mod de construcciones.
    const buildSource = [
      updated("mods/sheal-build.jar"),
      path.join(appRoot, "dist", "mods", "sheal-build.jar"),
      path.join(appRoot, "public", "mods", "sheal-build.jar"),
    ].find((file) => file && fs.existsSync(file));
    if (buildSource) {
      try { fs.copyFileSync(buildSource, path.join(modsDir, "sheal-build.jar")); } catch {}
    }
    report({ id: "fabric", phase: "fabric", label: "Mods listos", percent: 100 });
    return { libs, mainClass: profile.mainClass || "net.fabricmc.loader.impl.launch.knot.KnotClient", jvm: profile.arguments?.jvm || [] };
  }

  /** Devuelve Java instalado o lo descarga (Adoptium → Mojang/TLauncher). */
  async function ensureJava(id) {
    const required = javaRequired(id);
    const existing = findJava(required);
    if (existing) return existing;
    const cfg = loadConfig();
    if (cfg.javaPath && fs.existsSync(cfg.javaPath)) {
      const version = javaVersionText(cfg.javaPath);
      if (parseJavaMajor(version) >= required) return { path: cfg.javaPath, version };
    }

    let lastError = null;
    try {
      return await ensureJavaFromAdoptium(required);
    } catch (error) {
      lastError = error;
    }
    try {
      return await ensureJavaFromMojang(required);
    } catch (error) {
      lastError = error;
    }
    throw new Error(`No se pudo instalar Java ${required}: ${lastError?.message || "error desconocido"}`);
  }

  /** Abre TLauncher (si está instalado) para descargar versiones desde allí. */
  function openLauncher() {
    const exe = findLauncher();
    if (exe) {
      const child = spawn(exe, [], { detached: true, stdio: "ignore", windowsHide: true });
      child.unref();
      return { opened: true, path: exe };
    }
    return { opened: false, url: "https://tlauncher.org/en/install/" };
  }

  function launchWithLauncher(id, launcher) {
    const child = spawn(launcher, [`minecraft://?launch=${encodeURIComponent(id)}`], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return { ok: true, mode: "launcher", message: `Abriendo Minecraft Launcher con ${id}` };
  }

  function info() {
    const d = dirs();
    for (const key of ["root", "versions", "libraries", "assets", "indexes", "objects", "mods", "skins"]) {
      if (key === "mods") fs.mkdirSync(path.join(d.root, "mods"), { recursive: true });
      else if (key === "skins") fs.mkdirSync(path.join(d.root, "skins"), { recursive: true });
      else fs.mkdirSync(d[key], { recursive: true });
    }
    return {
      ...d,
      platform: process.platform,
      java: findJava(),
      launcher: findLauncher(),
      config: loadConfig(),
    };
  }

  /* ---------------------- Descargas ---------------------- */

  async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
    return res.json();
  }

  async function download(url, dest) {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  }

  /** Convierte una URL de Mojang a su equivalente en el espejo. */
  function toMirror(url) {
    if (!url) return null;
    if (url.includes("piston-meta.mojang.com")) return url.replace("https://piston-meta.mojang.com", MIRROR);
    if (url.includes("piston-data.mojang.com")) return url.replace("https://piston-data.mojang.com", MIRROR);
    if (url.includes("libraries.minecraft.net")) return url.replace("https://libraries.minecraft.net", `${MIRROR}/maven`);
    if (url.includes("resources.download.minecraft.net")) return url.replace("https://resources.download.minecraft.net", `${MIRROR}/assets`);
    return null;
  }

  async function getJsonSafe(url) {
    try {
      return await getJson(url);
    } catch (error) {
      const mirror = toMirror(url);
      if (mirror) return await getJson(mirror);
      throw error;
    }
  }

  async function downloadSafe(url, dest) {
    try {
      await download(url, dest);
    } catch (error) {
      const mirror = toMirror(url);
      if (!mirror) throw error;
      try {
        await download(mirror, dest);
      } catch {
        throw error;
      }
    }
  }

  let manifestCache = null;
  let manifestTime = 0;

  /** Lista de versiones incluida en la app (fallback sin internet). */
  function localVersions() {
    const candidates = [
      path.join(__dirname, "..", "dist", "versions.json"),
      path.join(__dirname, "..", "public", "versions.json"),
      path.join(process.resourcesPath || "", "versions.json"),
    ];
    for (const file of candidates) {
      try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {}
    }
    return null;
  }

  async function fetchVersions() {
    if (manifestCache && Date.now() - manifestTime < 5 * 60 * 1000) return manifestCache;
    try {
      let data;
      try {
        data = await getJson(MANIFEST_URL);
      } catch {
        data = await getJson(MIRROR_MANIFEST);
      }
      manifestCache = {
        latest: data.latest,
        versions: data.versions.map((v) => ({
          id: v.id,
          type: v.type,
          url: v.url,
          time: v.time,
          releaseTime: v.releaseTime,
          sha1: v.sha1,
        })),
      };
      manifestTime = Date.now();
      return manifestCache;
    } catch (error) {
      // Sin conexión con Mojang: usamos la lista incluida en la app.
      const local = localVersions();
      if (local?.versions?.length) {
        manifestCache = { latest: local.latest || {}, versions: local.versions };
        manifestTime = Date.now();
        return manifestCache;
      }
      throw error;
    }
  }

  function installed() {
    const d = dirs();
    try {
      return fs
        .readdirSync(d.versions, { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(d.versions, e.name, `${e.name}.jar`)))
        .map((e) => e.name);
    } catch {
      return [];
    }
  }

  function libAllowed(lib) {
    if (!lib.rules) return true;
    let allowed = false;
    for (const rule of lib.rules) {
      const osOk = !rule.os || (rule.os.name === "windows" && (!rule.os.arch || rule.os.arch === "x64"));
      if (rule.action === "allow" && osOk) allowed = true;
      if (rule.action === "disallow" && osOk) allowed = false;
    }
    return allowed;
  }

  /** Extrae los .dll de los jars natives (ZIP simple, sin dependencias). */
  function unzipDlls(buffer, destDir) {
    let eocd = -1;
    for (let i = buffer.length - 22; i >= 0; i--) {
      if (buffer.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return;
    const count = buffer.readUInt16LE(eocd + 10);
    let pos = buffer.readUInt32LE(eocd + 16);
    const root = path.resolve(destDir);
    fs.mkdirSync(root, { recursive: true });
    for (let i = 0; i < count; i++) {
      if (pos + 46 > buffer.length || buffer.readUInt32LE(pos) !== 0x02014b50) break;
      const method = buffer.readUInt16LE(pos + 10);
      const compSize = buffer.readUInt32LE(pos + 20);
      const nameLen = buffer.readUInt16LE(pos + 28);
      const extraLen = buffer.readUInt16LE(pos + 30);
      const commentLen = buffer.readUInt16LE(pos + 32);
      const localOff = buffer.readUInt32LE(pos + 42);
      const name = buffer.toString("utf8", pos + 46, pos + 46 + nameLen);
      pos += 46 + nameLen + extraLen + commentLen;
      if (!name.toLowerCase().endsWith(".dll")) continue;
      if (localOff + 30 > buffer.length) continue;
      const lNameLen = buffer.readUInt16LE(localOff + 26);
      const lExtraLen = buffer.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const compressed = buffer.subarray(start, start + compSize);
      let content;
      try {
        content = method === 0 ? compressed : method === 8 ? zlib.inflateRawSync(compressed) : null;
      } catch {
        content = null;
      }
      if (!content) continue;
      const target = path.resolve(root, path.basename(name));
      if (!target.startsWith(root)) continue;
      fs.writeFileSync(target, content);
    }
  }

  async function install(id) {
    const d = dirs();
    report({ id, phase: "manifest", label: "Buscando versión...", percent: 2 });
    const manifest = await fetchVersions();
    const entry = manifest.versions.find((v) => v.id === id);
    if (!entry) throw new Error(`Versión ${id} no encontrada`);

    report({ id, phase: "json", label: "Descargando información de la versión...", percent: 6 });
    const version = await getJsonSafe(entry.url);
    const versionDir = path.join(d.versions, id);
    fs.mkdirSync(versionDir, { recursive: true });
    fs.writeFileSync(path.join(versionDir, `${id}.json`), JSON.stringify(version, null, 2));

    report({ id, phase: "client", label: "Descargando cliente (client.jar)...", percent: 12 });
    await downloadSafe(version.downloads.client.url, path.join(versionDir, `${id}.jar`));

    // Librerías
    const libraries = (version.libraries || []).filter(libAllowed);
    const nativeJars = [];
    let done = 0;
    for (const lib of libraries) {
      const dl = lib.downloads || {};
      if (dl.artifact && dl.artifact.path) {
        await downloadSafe(dl.artifact.url, path.join(d.libraries, dl.artifact.path));
      }
      const natives = dl.classifiers?.["natives-windows"] || dl.classifiers?.["natives-windows-arm64"];
      if (natives && natives.path) {
        const dest = path.join(d.libraries, natives.path);
        await downloadSafe(natives.url, dest);
        nativeJars.push(dest);
      }
      done++;
      report({
        id,
        phase: "libraries",
        label: `Descargando librerías (${done}/${libraries.length})...`,
        percent: 12 + Math.round((done / Math.max(1, libraries.length)) * 28),
      });
    }

    // Natives
    const nativesDir = path.join(versionDir, `natives-${id}`);
    fs.mkdirSync(nativesDir, { recursive: true });
    for (const jar of nativeJars) {
      try {
        unzipDlls(await fsp.readFile(jar), nativesDir);
      } catch {}
    }

    // Assets
    if (version.assetIndex) {
      report({ id, phase: "assets", label: "Descargando índice de recursos...", percent: 42 });
      const indexPath = path.join(d.indexes, `${version.assetIndex.id}.json`);
      await downloadSafe(version.assetIndex.url, indexPath);
      const index = JSON.parse(await fsp.readFile(indexPath, "utf8"));
      const objects = Object.values(index.objects || []);
      let objectsDone = 0;
      const queue = [...objects];
      const workers = Array.from({ length: 8 }, async () => {
        while (queue.length) {
          const obj = queue.shift();
          if (!obj || !obj.hash) continue;
          const dest = path.join(d.objects, obj.hash.slice(0, 2), obj.hash);
          try {
            await downloadSafe(`${RESOURCES_URL}/${obj.hash.slice(0, 2)}/${obj.hash}`, dest);
          } catch {}
          objectsDone++;
          report({
            id,
            phase: "assets",
            label: `Descargando recursos (${objectsDone}/${objects.length})...`,
            percent: 42 + Math.round((objectsDone / Math.max(1, objects.length)) * 55),
          });
        }
      });
      await Promise.all(workers);
    }

    report({ id, phase: "done", label: "¡Versión instalada!", percent: 100 });
    return { ok: true, id, path: versionDir };
  }

  /* ---------------------- Lanzamiento ---------------------- */

  function buildClasspath(version, id) {
    const d = dirs();
    const cp = [path.join(d.versions, id, `${id}.jar`)];
    for (const lib of version.libraries || []) {
      if (!libAllowed(lib)) continue;
      const artifact = lib.downloads?.artifact;
      if (artifact?.path) cp.push(path.join(d.libraries, artifact.path));
    }
    return cp.filter((p) => fs.existsSync(p)).join(path.delimiter);
  }

  /** Comprueba que estén todos los archivos de la versión; devuelve los que faltan. */
  function verifyInstall(id, version) {
    const d = dirs();
    const missing = [];
    const clientJar = path.join(d.versions, id, `${id}.jar`);
    if (!fs.existsSync(clientJar) || fs.statSync(clientJar).size === 0) missing.push("client.jar");
    for (const lib of version.libraries || []) {
      if (!libAllowed(lib)) continue;
      const artifact = lib.downloads?.artifact;
      if (artifact?.path && !fs.existsSync(path.join(d.libraries, artifact.path))) {
        missing.push(artifact.path);
      }
    }
    if (version.assetIndex?.id) {
      const index = path.join(d.indexes, `${version.assetIndex.id}.json`);
      if (!fs.existsSync(index) || fs.statSync(index).size === 0) missing.push("asset index");
    }
    return missing;
  }

  /** Coloca los DLL nativos que algunos equipos no tienen (Vulkan loader). */
  function deployNativeLibs(nativesDir) {
    for (const subfolder of ["java", "lwjgl", "netty", "jna"]) {
      try { fs.mkdirSync(path.join(nativesDir, subfolder), { recursive: true }); } catch {}
    }
    const appRoot = path.join(__dirname, "..");
    const candidates = [
      path.join(appRoot, "dist", "native", "vulkan-1.dll"),
      path.join(appRoot, "public", "native", "vulkan-1.dll"),
      path.join(process.resourcesPath || "", "native", "vulkan-1.dll"),
    ];
    const dll = candidates.find((file) => fs.existsSync(file));
    if (!dll) return;
    const targets = [
      path.join(nativesDir, "vulkan-1.dll"),
      path.join(nativesDir, "java", "vulkan-1.dll"),
      path.join(nativesDir, "lwjgl", "vulkan-1.dll"),
    ];
    for (const target of targets) {
      try { fs.copyFileSync(dll, target); } catch {}
    }
  }

  function argRulesAllowed(rules) {
    if (!rules || !rules.length) return true;
    // Features como "is_demo_user" o "has_quick_plays_support" no se usan:
    // añadir esos argumentos (--demo, --quickPlay...) rompe el arranque.
    if (rules.some((rule) => rule.features)) return false;
    const osMatch = (os) => !os || (os.name === "windows" && (!os.arch || os.arch === "x64"));
    if (rules.every((rule) => rule.action === "disallow")) {
      return !rules.some((rule) => rule.action === "disallow" && osMatch(rule.os));
    }
    let allowed = false;
    for (const rule of rules) {
      if (rule.action === "allow" && osMatch(rule.os)) allowed = true;
      if (rule.action === "disallow" && osMatch(rule.os)) allowed = false;
    }
    return allowed;
  }

  async function launch(id, options = {}) {
    const d = dirs();
    applyStoredSkin();
    const versionPath = path.join(d.versions, id, `${id}.json`);
    if (!fs.existsSync(versionPath)) throw new Error(`La versión ${id} no está instalada. Descárgala primero.`);
    const version = JSON.parse(fs.readFileSync(versionPath, "utf8"));

    // Reparación automática: si falta algún archivo, se vuelve a descargar.
    const missing = verifyInstall(id, version);
    if (missing.length) {
      report({ id, phase: "repair", label: `Reparando instalación (${missing.length} archivos)...`, percent: 1 });
      await install(id);
    }

    const launcher = findLauncher();
    let java = null;

    if (options.mode === "launcher") {
      if (!launcher) throw new Error("No se encontró Minecraft Launcher.");
      return launchWithLauncher(id, launcher);
    }

    // Asegura Java: si no está, se descarga e instala automáticamente.
    try {
      java = await ensureJava(id);
    } catch (error) {
      if (launcher) {
        const opened = openLauncher();
        const detail = `No se pudo instalar Java 21 (${error.message}). Se abrió TLauncher: descarga e inicia la versión ${id} desde allí.`;
        report({ id: "error", phase: "error", label: detail, percent: 0, fatal: true });
        return { ok: false, mode: "launcher", message: detail, opened };
      }
      throw error;
    }
    if (!java) throw new Error("No se pudo preparar Java para iniciar Minecraft.");

    let fabric = null;
    // Fabric siempre se prepara en 26.3: asi las auras y los emotes funcionan
    // sin depender de que el usuario recuerde activar el toggle de particulas.
    if (id === "26.3") {
      try {
        writeParticleConfig(options.particleShape, options.particleColor, options.wings, options.wingStyle);
        fabric = await ensureFabric();
      } catch (error) {
        report({ id: "fabric", phase: "fabric", label: `No se pudieron preparar las partículas: ${error.message}`, percent: 0, fatal: true });
      }
    }

    const baseCp = buildClasspath(version, id);
    if (!baseCp) throw new Error("No se encontraron librerías. Vuelve a instalar la versión.");
    const cp = fabric ? [...fabric.libs, baseCp].join(path.delimiter) : baseCp;

    // Modo OFFLINE: jugar sin cuenta premium. Se genera una identidad local
    // estable (UUID derivado del nombre) y un token tipo JWT falso que Minecraft
    // acepta para sesiones "msa" sin contactar con los servidores de Mojang.
    const premium = Boolean(options.accessToken && options.uuid);
    const offline = options.offline === true;
    const username = premium ? options.username : (options.username || "ShealPlayer");
    const safeName = String(username).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 16) || "ShealPlayer";
    const uuid = premium
      ? options.uuid
      : offline
        ? offlineUuid(safeName)
        : "00000000-0000-0000-0000-" + Math.random().toString(16).slice(2, 14).padEnd(12, "0");
    const token = premium
      ? options.accessToken
      : offline
        ? offlineToken(safeName)
        : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const nativesDir = path.join(d.versions, id, `natives-${id}`);
    deployNativeLibs(nativesDir);
    const assetIndexId = version.assetIndex?.id || id;
    const placeholders = {
      natives_directory: nativesDir,
      classpath: cp,
      launcher_name: "SHEAL",
      launcher_version: "2.0.1",
      library_directory: d.libraries,
      game_directory: d.root,
      assets_root: d.assets,
      assets_index_name: assetIndexId,
      auth_player_name: username,
      auth_uuid: uuid,
      auth_access_token: token,
      clientid: "-",
      auth_xuid: "-",
      user_type: (premium || offline) ? "msa" : "legacy",
      version_name: id,
      version_type: version.type === "snapshot" ? "snapshot" : "release",
      resolution_width: "1280",
      resolution_height: "720",
    };
    const substitute = (value) =>
      String(value).replace(/\$\{(\w+)\}/g, (_all, key) => (key in placeholders ? placeholders[key] : ""));
    const argumentValues = (entries) => {
      const result = [];
      for (const item of entries || []) {
        if (typeof item === "string") {
          result.push(substitute(item));
          continue;
        }
        if (!item || (item.rules && !argRulesAllowed(item.rules))) continue;
        const value = item.value;
        if (Array.isArray(value)) result.push(...value.map(substitute));
        else if (typeof value !== "undefined") result.push(substitute(value));
      }
      return result;
    };

    const ram = options.ram || Math.min(2048, Math.max(1024, Math.floor((os.totalmem() / 1048576) * 0.25)));
    let args;
    if (version.arguments?.jvm && version.arguments?.game) {
      // Versiones modernas: usamos los argumentos oficiales del JSON.
      // El classpath y la clase principal DEBEN ir justo antes de los
      // argumentos del juego; si no, Java lee --username como opción JVM.
      const javaMajor = java.major || parseJavaMajor(java.version);
      const jvmValues = argumentValues(version.arguments.jvm).filter((value) => {
        if (value === "-cp" || value === cp) return false;
        // Opciones solo soportadas por Java 22+; con Java antiguo rompen el JVM.
        if (javaMajor && javaMajor < 22) {
          if (value.startsWith("--enable-native-access") || value.startsWith("-XX:StackShadowPages")) return false;
        }
        return true;
      });
      args = [
        `-Xms512M`,
        `-Xmx${ram}M`,
        "-XX:+UseG1GC",
        ...(fabric ? fabric.jvm : []),
        ...jvmValues,
        "-cp",
        cp,
        fabric ? fabric.mainClass : version.mainClass || "net.minecraft.client.main.Main",
        ...argumentValues(version.arguments.game),
      ];
    } else {
      // Versiones antiguas sin bloque "arguments".
      args = [
        `-Xms512M`,
        `-Xmx${ram}M`,
        "-XX:+UseG1GC",
        `-Djava.library.path=${nativesDir}`,
        "-cp",
        cp,
        version.mainClass || "net.minecraft.client.main.Main",
        "--username", username,
        "--version", id,
        "--gameDir", d.root,
        "--assetsDir", d.assets,
        "--assetIndex", assetIndexId,
        "--uuid", uuid,
        "--accessToken", token,
        "--userType", (premium || offline) ? "msa" : "legacy",
        "--versionType", placeholders.version_type,
      ];
    }
    if (options.fullscreen) args.push("--fullscreen");

    if (options.dryRun) return { ok: true, mode: "dry", args, java: java.path };

    // Guardamos la salida de Java en un log para poder diagnosticar errores.
    let javaLog = null;
    let logPath = null;
    try {
      const logsDir = path.join(d.root, "logs");
      fs.mkdirSync(logsDir, { recursive: true });
      logPath = path.join(logsDir, "sheal-game.log");
      javaLog = fs.openSync(logPath, "w");
    } catch {}
    const startedAt = Date.now();
    const child = spawn(java.path, args, {
      cwd: d.root,
      detached: true,
      stdio: ["ignore", javaLog || "ignore", javaLog || "ignore"],
      windowsHide: true,
    });

    // Si Java se cierra enseguida, mostramos el error en el launcher.
    const watch = setTimeout(() => {
      child.removeAllListeners("exit");
    }, 10000);
    child.on("error", (error) => {
      clearTimeout(watch);
      report({ id: "error", phase: "error", label: `No se pudo ejecutar Java: ${error.message}`, percent: 0, fatal: true });
    });
    child.on("exit", (code) => {
      clearTimeout(watch);
      if (Date.now() - startedAt > 10000) return;
      let detail = "";
      if (logPath) {
        try { detail = fs.readFileSync(logPath, "utf8").slice(-2500); } catch {}
      }
      const lower = detail.toLowerCase();
      let message = detail.trim() || `Minecraft se cerró al iniciar (código ${code}).`;
      if (lower.includes("no context is current") || lower.includes("gl30c") || lower.includes("failed to create opengl context")) {
        message =
          "ERROR DE GRÁFICOS (OpenAL/OpenGL): esa PC no soporta OpenGL 3+ o no tiene aceleración 3D.\n" +
          "Si es una máquina virtual: activa 'Aceleración 3D' en la configuración de pantalla, " +
          "sube la memoria de vídeo a 128 MB e instala las Guest Additions.\n" +
          "Si es una PC real: actualiza los controladores de la tarjeta gráfica.\n\n" +
          "Detalle técnico:\n" + detail.trim();
      }
      report({ id: "error", phase: "error", label: message, percent: 0, fatal: true });
    });
    child.unref();
    return { ok: true, mode: "java", pid: child.pid, java: java.path, message: `Iniciando Minecraft ${id} con Java` };
  }

  async function setConfig(next) {
    return saveConfig(next);
  }
  async function openFolder() {
    const target = minecraftDir();
    fs.mkdirSync(target, { recursive: true });
    const r = spawnSync("explorer.exe", [target], { windowsHide: true });
    return r.status === 0;
  }

  return { info, fetchVersions, installed, install, launch, setConfig, openFolder, openSubfolder, installSkin, applyStoredSkin, ensureJava, openLauncher, writeParticleConfig, minecraftDir };
}

module.exports = { createMinecraft };
