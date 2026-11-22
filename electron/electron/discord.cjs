/**
 * Discord Rich Presence mejorado mediante IPC nativo.
 * Muestra: servidor, version, nombre de jugador y estado del juego.
 * Se actualiza en tiempo real con update().
 */
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");

const INVITE = "https://discord.gg/k3hCrN7Ef";
const DEV_PORTAL = "https://discord.com/developers/applications";
const DEFAULT_CONFIG = { clientId: "1572634976946622636", enabled: true };

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

function encode(op, object) {
  const payload = Buffer.from(JSON.stringify(object), "utf8");
  const header = Buffer.alloc(8);
  header.writeUInt32LE(op, 0);
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function createDiscord({ userData }) {
  const configPath = path.join(userData, "sheal-discord.json");
  let socket = null;
  let keepalive = null;
  let activity = null;
  let nonce = 0;
  let startedAt = Date.now();
  let logWatcher = null;
  let lastLogSize = 0;
  let current = { version: "Java Edition", username: "Jugador", server: null, mode: "singleplayer" };

  function getConfig() {
    try {
      const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
      return { ...DEFAULT_CONFIG, ...saved };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  function saveConfig(config) {
    const clientId = String(config.clientId || "").trim();
    if (clientId && !/^\d{17,20}$/.test(clientId)) {
      throw new Error("El Application ID de Discord debe ser un número de 17-20 dígitos.");
    }
    const next = { clientId: clientId || DEFAULT_CONFIG.clientId, enabled: config.enabled !== false };
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(next, null, 2));
    return next;
  }

  function connectToPipe(index = 0) {
    return new Promise((resolve, reject) => {
      const socket = net.connect(`\\\\.\\pipe\\discord-ipc-${index}`, () => resolve(socket));
      socket.once("error", (error) => {
        if (index < 9) connectToPipe(index + 1).then(resolve, reject);
        else reject(error);
      });
    });
  }

  function buildActivity() {
    const server = current.server;
    const inServer = !!server;
    const details = inServer ? `En ${server}` : `Minecraft ${current.version}`;
    const state = inServer
      ? `${current.username} · ${current.version}`
      : `Jugando con SHEAL LAUNCHER · ${current.username}`;
    return {
      details,
      state,
      startTimestamp: startedAt,
      largeImageKey: inServer ? "server" : "logo",
      largeImageText: inServer ? `Servidor: ${server}` : "SHEAL LAUNCHER",
      smallImageKey: "minecraft",
      smallImageText: `Minecraft ${current.version}`,
      buttons: [{ label: "Unirse al Discord", url: INVITE }],
      instance: false,
    };
  }

  function sendActivity() {
    if (!socket) return;
    activity = buildActivity();
    try {
      socket.write(encode(OP.FRAME, {
        cmd: "SET_ACTIVITY",
        args: { pid: process.pid, activity },
        nonce: `sheal-${++nonce}`,
      }));
    } catch {}
  }

  /** Extrae el nombre legible de un servidor a partir de una IP/puerto. */
  function serverName(address) {
    if (!address) return null;
    const host = String(address).split(":")[0].trim();
    if (!host) return null;
    // IPs de Minecraft conocidas -> nombre amigable
    const known = {
      "play.hypixel.net": "Hypixel", "hypixel.net": "Hypixel", "mc.hypixel.net": "Hypixel",
      "play.cubecraft.net": "CubeCraft", "cubecraft.net": "CubeCraft",
      "play.Universocraft.com": "UniversoCraft", "universocraft.com": "UniversoCraft",
      "play.pixelmonrealms.com": "Pixelmon Realms",
    };
    return known[host.toLowerCase()] || host;
  }

  /** Vigila el log del juego para detectar conexiones a servidores. */
  function watchGameLog(logPath) {
    if (!logPath || !fs.existsSync(logPath)) return;
    try { lastLogSize = fs.statSync(logPath).size; } catch { return; }
    if (logWatcher) clearInterval(logWatcher);
    logWatcher = setInterval(() => {
      try {
        const stat = fs.statSync(logPath);
        if (stat.size < lastLogSize) lastLogSize = 0; // rotacion de log
        if (stat.size === lastLogSize) return;
        const text = fs.readFileSync(logPath, "utf8");
        lastLogSize = stat.size;
        // Patrones de conexion de Minecraft
        const patterns = [
          /Connecting to ([^\s:]+(?::\d+)?)/g,
          /Connected to ([^\s:]+(?::\d+)?)/g,
          /\[Server thread\/INFO\]:.*?([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?/gi,
        ];
        let found = null;
        for (const re of patterns) {
          const m = re.exec(text);
          if (m) { found = m[1]; break; }
        }
        if (found) {
          const name = serverName(found);
          if (name && name !== current.server) {
            current.server = name;
            current.mode = "server";
            sendActivity();
          }
        }
      } catch {}
    }, 3000);
  }

  async function start(info) {
    const config = getConfig();
    if (!config.enabled) return { ok: false, message: "Rich Presence desactivado." };
    stop();
    startedAt = Date.now();
    current = {
      version: info.version || "Java Edition",
      username: info.username || "Jugador",
      server: info.server || null,
      mode: info.server ? "server" : "singleplayer",
      logPath: info.logPath || null,
    };

    try {
      socket = await connectToPipe();
    } catch (error) {
      return { ok: false, message: "Discord no está abierto." };
    }

    socket.on("data", (data) => {
      let offset = 0;
      while (offset + 8 <= data.length) {
        const op = data.readUInt32LE(offset);
        const length = data.readUInt32LE(offset + 4);
        const raw = data.subarray(offset + 8, offset + 8 + length).toString("utf8");
        offset += 8 + length;
        if (op === OP.PING) {
          try { socket.write(encode(OP.PONG, JSON.parse(raw))); } catch {}
        }
      }
    });
    socket.on("error", () => stop());
    socket.on("close", () => stop());

    socket.write(encode(OP.HANDSHAKE, { v: 1, client_id: config.clientId }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    sendActivity();
    keepalive = setInterval(sendActivity, 15000);
    if (current.logPath) watchGameLog(current.logPath);
    return { ok: true };
  }

  /** Actualiza servidor/version/usuario en caliente. */
  function update(info) {
    if (info.version) current.version = info.version;
    if (info.username) current.username = info.username;
    if (info.server !== undefined) current.server = serverName(info.server);
    if (info.mode) current.mode = info.mode;
    sendActivity();
    return { ...current };
  }

  function stop() {
    if (keepalive) { clearInterval(keepalive); keepalive = null; }
    if (logWatcher) { clearInterval(logWatcher); logWatcher = null; }
    if (socket) {
      try { socket.write(encode(OP.CLOSE, {})); } catch {}
      try { socket.end(); } catch {}
      socket = null;
    }
    activity = null;
  }

  return { getConfig, saveConfig, start, update, stop, DEV_PORTAL, INVITE, serverName };
}

module.exports = { createDiscord };
