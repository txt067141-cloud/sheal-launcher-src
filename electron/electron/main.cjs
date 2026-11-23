const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

/* ---------- Proteccion: verifica la integridad de los archivos del launcher ---------- */
const INTEGRITY = {
  "preload.cjs": "__PRELOAD_HASH__",
  "pwfauth.cjs": "__PWFAUTH_HASH__",
  "minecraft.cjs": "__MC_HASH__",
  "discord.cjs": "__DISCORD_HASH__",
};
function verifyIntegrity() {
  try {
    for (const [file, expected] of Object.entries(INTEGRITY)) {
      if (!expected || expected.startsWith("__")) continue; // no calculado (dev)
      const full = path.join(__dirname, file);
      const actual = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
      if (actual !== expected) {
        // Archivo modificado: abortar sin revelar detalles.
        app.quit();
        return false;
      }
    }
  } catch {
    app.quit();
    return false;
  }
  return true;
}
const INTEGRITY_OK = verifyIntegrity();

const { createMinecraft } = require("./minecraft.cjs");
const { createHelper } = require("./helper.cjs");
const { createPwfAuth } = require("./pwfauth.cjs");
const { createUpdater } = require("./updater.cjs");
const { createBedrock } = require("./bedrock.cjs");
const { createDiscord } = require("./discord.cjs");

/* Consola persistente: guarda TODO lo que pase en el proceso principal. */
const MAIN_LOG = path.join(app.getPath("userData"), "sheal-main.log");
try { fs.writeFileSync(MAIN_LOG, ""); } catch {}
function logLine(level, ...args) {
  const line = `[${new Date().toISOString()}] [${level}] ` + args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  try { fs.appendFileSync(MAIN_LOG, line + "\n"); } catch {}
  process.stdout.write(line + "\n");
}
console.log = (...a) => logLine("LOG", ...a);
console.warn = (...a) => logLine("WARN", ...a);
console.error = (...a) => logLine("ERROR", ...a);
process.on("uncaughtException", (e) => console.error("uncaughtException:", e.stack || e.message));
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", String(e)));

const DEV_URL = process.env.SHEAL_DEV_URL;
const ICON_PATH = path.join(__dirname, "..", "build", "icon.png");

app.setAppUserModelId("com.sheal.launcher");

// El launcher permite varias ventanas; no se usa bloqueo de instancia única.

/** @type {BrowserWindow | null} */
let mainWindow = null;

const bedrock = createBedrock({
  send: (payload) => mainWindow?.webContents.send("mc:progress", payload),
});

// Updater primero: createMinecraft lo necesita como parametro.
const updater = createUpdater({
  userData: app.getPath("userData"),
  send: (payload) => mainWindow?.webContents.send("mc:progress", payload),
});

const mc = createMinecraft({
  userData: app.getPath("userData"),
  appData: app.getPath("appData"),
  send: (payload) => mainWindow?.webContents.send("mc:progress", payload),
  updater,
});

const helper = createHelper({
  userData: app.getPath("userData"),
  gameDir: () => mc.minecraftDir(),
  send: (payload) => mainWindow?.webContents.send("mc:progress", payload),
});

const keyauth = createPwfAuth({
  userData: app.getPath("userData"),
  onSessionEnded: (info) => {
    try { console.log("[PWFAUTH_SESSION_ENDED]", JSON.stringify(info)); } catch {}
    try { app.quit(); } catch {}
  },
});
const discord = createDiscord({ userData: app.getPath("userData") });

let rpcWatch = null;
function watchGameAndStopRpc(pid) {
  if (rpcWatch) clearInterval(rpcWatch);
  if (!pid) return;
  rpcWatch = setInterval(() => {
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch {}
    if (!alive) {
      clearInterval(rpcWatch);
      rpcWatch = null;
      discord.stop();
    }
  }, 4000);
}

ipcMain.handle("rpc:config", () => discord.getConfig());
ipcMain.handle("rpc:saveConfig", (_event, config) => discord.saveConfig(config));
ipcMain.handle("rpc:openPortal", () => shell.openExternal(discord.DEV_PORTAL));
ipcMain.handle("rpc:stop", () => discord.stop());
ipcMain.handle("rpc:update", (_event, info) => discord.update(info || {}));

ipcMain.handle("keyauth:config", () => ({ name: "SHEAL", ownerid: "pwfauth" }));
ipcMain.handle("keyauth:saveConfig", () => ({}));
ipcMain.handle("keyauth:login", async (_event, license) => {
  const result = await keyauth.login(license);
  if (result.ok) keyauth.startHeartbeat();
  return result;
});
ipcMain.handle("keyauth:check", () => keyauth.isSignedIn());
ipcMain.handle("keyauth:status", () => ({ ok: keyauth.isSignedIn() }));
ipcMain.handle("mc:updateParticles", (_event, shape, color, wings, wingStyle) => mc.writeParticleConfig(shape, color, wings, wingStyle));
ipcMain.handle("keyauth:openDashboard", () => shell.openExternal(keyauth.DASHBOARD));
ipcMain.handle("update:check", () => updater.check());
ipcMain.handle("update:info", () => ({ version: updater.getVersion(), base: updater.getBase() }));
ipcMain.handle("bedrock:detect", () => bedrock.detect());
ipcMain.handle("bedrock:install", () => bedrock.install());
ipcMain.handle("bedrock:launch", () => bedrock.launch());
ipcMain.handle("bedrock:openStore", () => bedrock.openStoreWeb());

function createWindow() {
  if (!INTEGRITY_OK) return;
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    roundedCorners: true,
    backgroundColor: "#0a0710",
    title: "SHEAL LAUNCHER",
    show: false,
    autoHideMenuBar: true,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      devTools: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    // Buscar actualizaciones de contenido al abrir (silencioso, no bloquea).
    setTimeout(() => { updater.check().catch(() => {}); }, 1200);
  });

  if (DEV_URL) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Bloquear DevTools y combinaciones de inspeccion.
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const k = input.key.toLowerCase();
    const ctrl = input.control || input.meta;
    const shift = input.shift;
    // F12, Ctrl+Shift+I / J / C, Ctrl+U (ver codigo), Ctrl+Shift+K
    if (input.key === "F12" || (ctrl && shift && ["i", "j", "c", "k"].includes(k))
        || (ctrl && k === "u")) {
      event.preventDefault();
      return;
    }
    if (input.key === "F11") {
      mainWindow?.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    }
  });
  mainWindow.webContents.on("devtools-opened", () => {
    try { mainWindow?.webContents.closeDevTools(); } catch {}
  });
  mainWindow.webContents.on("context-menu", (event) => event.preventDefault());

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/* ---------- Minecraft: versiones, descargas y lanzamiento ---------- */
ipcMain.handle("mc:info", () => mc.info());
ipcMain.handle("mc:versions", () => mc.fetchVersions());
ipcMain.handle("mc:installed", () => mc.installed());
ipcMain.handle("mc:install", async (_event, id) => {
  if (helper.available()) return helper.install(id);
  return mc.install(id);
});
ipcMain.handle("mc:launch", async (_event, id, options) => {
  // La descarga la hace el helper (CmlLib), pero el arranque usa el
  // lanzamiento propio con los argumentos corregidos (main class antes
  // de --username) y con stderr redirigido a sheal-game.log.
  const result = await mc.launch(id, options || {});
  if (result?.ok) {
    const gameLog = path.join(app.getPath("appData"), ".minecraft", "logs", "sheal-game.log");
    discord.start({
      version: id,
      username: options?.username || "Jugador",
      server: options?.server || null,
      logPath: gameLog,
    })
      .then((rpc) => {
        if (rpc?.ok) watchGameAndStopRpc(result.pid);
      })
      .catch(() => undefined);
  }
  return result;
});
ipcMain.handle("mc:setConfig", async (_event, next) => mc.setConfig(next));
ipcMain.handle("mc:openFolder", async () => {
  const target = mc.minecraftDir();
  // Crea las carpetas del juego y abre la carpeta real en el Explorador.
  for (const folder of ["", "mods", "resourcepacks", "shaderpacks", "skins"]) {
    try { fs.mkdirSync(path.join(target, folder), { recursive: true }); } catch {}
  }
  const result = await shell.openPath(target);
  return { path: target, result };
});
ipcMain.handle("mc:openSubfolder", async (_event, name) => {
  const allowed = ["mods", "shaderpacks", "resourcepacks", "saves", "skins", "schematics"];
  if (!allowed.includes(name)) throw new Error("Carpeta no permitida");
  const target = path.join(mc.minecraftDir(), name);
  try { fs.mkdirSync(target, { recursive: true }); } catch {}
  const result = await shell.openPath(target);
  return { path: target, opened: result === "", result };
});
ipcMain.handle("mc:editBuilds", async () => {
  // Abre (o crea) el archivo de construcciones personalizadas en el Bloc de notas.
  const target = path.join(mc.minecraftDir(), "sheal-builds.json");
  const template = "{\n" +
    '  "palette": { "#": "stone", "o": "oak_planks", "g": "glass", ".": "air" },\n' +
    '  "builds": [\n' +
    "    {\n" +
    '      "name": "Mi Casa",\n' +
    '      "layers": [\n' +
    '        ["###", "###", "###"],\n' +
    '        ["#o#", "o.o", "#g#"],\n' +
    '        ["###", "###", "###"]\n' +
    "      ]\n" +
    "    }\n" +
    "  ]\n" +
    "}\n";
  try { if (!fs.existsSync(target)) fs.writeFileSync(target, template, "utf8"); } catch {}
  const { spawn } = require("node:child_process");
  try { spawn("notepad.exe", [target], { detached: true, windowsHide: false }).unref(); } catch {}
  return { path: target };
});
ipcMain.handle("mc:installSkin", async (_event, fileName, username, uuid) => mc.installSkin(fileName, username, uuid));
ipcMain.handle("mc:ensureJava", async (_event, id) => {
  // El helper C# (CmlLib.Core) gestiona Java por su cuenta.
  if (helper.available()) return { path: "Gestionado por SHEAL-Helper", version: "CmlLib.Core" };
  return mc.ensureJava(id);
});
ipcMain.handle("mc:openLauncher", () => mc.openLauncher());
ipcMain.handle("mc:diagnostics", () => {
  const read = (file, limit = 12000) => {
    try {
      const text = fs.readFileSync(file, "utf8");
      return text.length > limit ? "...(recortado)...\n" + text.slice(-limit) : text;
    } catch (e) {
      return "(sin contenido: " + e.message + ")";
    }
  };
  const userData = app.getPath("userData");
  const gameDir = mc.minecraftDir();
  let versions = [];
  try { versions = fs.readdirSync(path.join(gameDir, "versions")).filter((n) => fs.existsSync(path.join(gameDir, "versions", n, n + ".jar"))); } catch {}
  return {
    mainLog: read(MAIN_LOG),
    helperLog: read(path.join(userData, "sheal-helper.log")),
    gameLog: read(path.join(gameDir, "logs", "sheal-game.log")),
    info: {
      userData,
      gameDir,
      helper: helper.helperPath() || "NO ENCONTRADO",
      java: mc.info().java || "NO DETECTADO",
      versions,
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
    },
  };
});
ipcMain.handle("mc:chooseDir", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Carpeta de Minecraft (.minecraft)",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return mc.setConfig({ minecraftDir: result.filePaths[0] }).minecraftDir;
});
ipcMain.handle("mc:chooseJava", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Selecciona javaw.exe / java.exe",
    filters: [{ name: "Java", extensions: ["exe"] }],
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return mc.setConfig({ javaPath: result.filePaths[0] }).javaPath;
});

ipcMain.on("window:minimize", () => mainWindow?.minimize());
ipcMain.on("window:maximize", () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on("window:close", () => app.quit());

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
