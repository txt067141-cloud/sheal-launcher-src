/**
 * Discord Rich Presence mediante IPC nativo (sin login OAuth).
 * Conecta con el cliente de Discord y envía SET_ACTIVITY.
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

  function sendActivity() {
    if (!socket || !activity) return;
    try {
      socket.write(encode(OP.FRAME, {
        cmd: "SET_ACTIVITY",
        args: { pid: process.pid, activity },
        nonce: `sheal-${++nonce}`,
      }));
    } catch {}
  }

  async function start(info) {
    const config = getConfig();
    if (!config.enabled) return { ok: false, message: "Rich Presence desactivado." };
    stop();

    activity = {
      details: `Minecraft ${info.version || "Java Edition"}`,
      state: `Jugando con SHEAL LAUNCHER · ${info.username || "Jugador"}`,
      startTimestamp: Date.now(),
      largeImageKey: "logo",
      largeImageText: "SHEAL LAUNCHER",
      smallImageKey: "minecraft",
      smallImageText: "Minecraft",
      buttons: [{ label: "Unirse al Discord", url: INVITE }],
      instance: false,
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
    return { ok: true };
  }

  function stop() {
    if (keepalive) {
      clearInterval(keepalive);
      keepalive = null;
    }
    if (socket) {
      try { socket.write(encode(OP.CLOSE, {})); } catch {}
      try { socket.end(); } catch {}
      socket = null;
    }
    activity = null;
  }

  return { getConfig, saveConfig, start, stop, DEV_PORTAL, INVITE };
}

module.exports = { createDiscord };
