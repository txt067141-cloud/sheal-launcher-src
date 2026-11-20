/**
 * Integración con KeyAuth v1.3 (keyauth.cc).
 * Flujo: init -> license. Devuelve sessionid y datos del usuario.
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const API_URL = "https://keyauth.win/api/1.3/";
const DASHBOARD = "https://keyauth.cc/app/";

// Aplicación vinculada (va fija en el launcher).
const DEFAULT_CONFIG = { name: "SHAEL", ownerid: "yZFSMH6Y8I", ver: "1.0" };

function createKeyAuth({ userData }) {
  const configPath = path.join(userData, "sheal-keyauth.json");

  function getConfig() {
    try {
      const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (saved?.name && saved?.ownerid) return { ...DEFAULT_CONFIG, ...saved };
    } catch {}
    return { ...DEFAULT_CONFIG };
  }

  function saveConfig(config) {
    const name = String(config.name || "").trim();
    const ownerid = String(config.ownerid || "").trim();
    if (!name) throw new Error("Escribe el nombre de la aplicación de KeyAuth.");
    if (ownerid.length !== 10) throw new Error("El OwnerID debe tener exactamente 10 caracteres.");
    const next = { name, ownerid, ver: String(config.ver || DEFAULT_CONFIG.ver) };
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(next, null, 2));
    return next;
  }

  function hwid() {
    const raw = [os.hostname(), os.cpus()[0]?.model || "", String(os.totalmem()), process.platform].join("|");
    return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 40);
  }

  async function request(params) {
    const query = new URLSearchParams(params).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${API_URL}?${query}`, {
        method: "GET",
        headers: { "User-Agent": "SHEAL-LAUNCHER/2.0.1", Accept: "application/json" },
        signal: controller.signal,
      });
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        return { success: false, message: text.slice(0, 200) || "Respuesta inválida de KeyAuth" };
      }
    } catch (error) {
      if (error.name === "AbortError") return { success: false, message: "KeyAuth no respondió (tiempo agotado)." };
      return { success: false, message: `Error de conexión: ${error.message}` };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function init() {
    const config = getConfig();
    const result = await request({
      type: "init",
      ver: config.ver,
      name: config.name,
      ownerid: config.ownerid,
    });
    if (result.success === true) return { ok: true, sessionid: result.sessionid };
    return { ok: false, message: result.message || "No se pudo inicializar KeyAuth." };
  }

  /** Convierte el campo de expiracion de KeyAuth a epoch ms (o null si no aplica). */
  function parseExpiry(info) {
    // KeyAuth puede devolver la expiracion en distintos campos. Los probamos todos.
    const candidates = [
      info.expiry, info.expires, info.expire, info.expiryDate, info.dateEnd,
      info.subscriptionExpiry, info.expiresAt, info.expiration, info.validUntil,
      info.expiry_date, info.keyExpiry,
    ];
    for (const raw0 of candidates) {
      if (raw0 == null || raw0 === "" || raw0 === "0") continue;
      const raw = (typeof raw0 === "object" && raw0 !== null)
        ? (raw0.date ?? raw0.time ?? raw0.value ?? raw0.seconds ?? raw0.timestamp)
        : raw0;
      if (raw == null || raw === "" || /never|never expire|lifetime|none|no expire|unlimited/i.test(String(raw))) continue;
      let ms = null;
      if (typeof raw === "number" || /^\d+$/.test(String(raw))) {
        const n = Number(raw);
        ms = n > 1e11 ? n : n * 1000;
      } else {
        const s = String(raw).trim().replace("T", " ").replace("Z", "");
        let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
        if (m) {
          const [, mo, d, y, hh = "0", mm = "0", ss = "0"] = m;
          ms = new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss)).getTime();
        } else {
          m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
          if (m) {
            const [, y, mo, d, hh = "0", mm = "0", ss = "0"] = m;
            ms = new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss)).getTime();
          } else ms = Date.parse(s);
        }
      }
      if (Number.isFinite(ms) && ms > Date.now() && ms < Date.now() + 10 * 365 * 86400000) return ms;
    }

    // Algunas apps guardan la duracion en dias en "subscription" (ej. "30", "30 Days").
    const sub = info.subscription;
    if (sub != null) {
      const dm = String(sub).match(/(\d+)\s*(day|dias?|d)/i);
      if (dm) {
        const days = Number(dm[1]);
        if (days > 0 && days < 36500) return Date.now() + days * 86400000;
      }
    }
    return null;
  }

  async function login(license) {
    const config = getConfig();
    const key = String(license || "").trim();
    if (!key) return { ok: false, message: "Escribe tu clave de acceso." };

    const session = await init();
    if (!session.ok) return { ok: false, message: session.message };

    const result = await request({
      type: "license",
      key,
      sessionid: session.sessionid,
      name: config.name,
      ownerid: config.ownerid,
      hwid: hwid(),
      code: "",
    });

    if (result.success === true) {
      const info = result.info || {};
      // Log de diagnostico: nos dice exactamente que campos devuelve KeyAuth
      // (para afinar el contador de dias). Se guarda en sheal-main.log.
      try { console.log("[KEYAUTH_INFO]", JSON.stringify(info)); } catch {}
      return {
        ok: true,
        username: info.username || info.ownerName || "ShealUser",
        sessionid: session.sessionid,
        subscription: info.subscription || "",
        expiry: parseExpiry(info),
        // Info completa de KeyAuth para diagnosticar y mostrar los dias reales.
        keyInfo: info,
        message: result.message || "Clave válida",
      };
    }
    return { ok: false, message: result.message || "Clave no válida." };
  }

  async function check(license, sessionid) {
    if (!license || !sessionid) return false;
    const result = await request({ type: "checksession", sessionid, name: getConfig().name, ownerid: getConfig().ownerid });
    return result.success === true;
  }

  /** Consulta el estado actual de la clave (valida + dias restantes segun KeyAuth). */
  async function status(license, sessionid) {
    if (!license || !sessionid) return { ok: false };
    const cfg = getConfig();
    // checksession confirma que la sesion/clave sigue activa en el panel.
    const sessionCheck = await request({
      type: "checksession", sessionid, name: cfg.name, ownerid: cfg.ownerid,
    });
    if (sessionCheck.success !== true) return { ok: false, reason: sessionCheck.message || "Clave inactiva" };
    return { ok: true, daysLeft: sessionCheck.daysLeft ?? sessionCheck.subscription ?? null };
  }

  return { getConfig, saveConfig, login, check, status, init, hwid, DASHBOARD };
}

module.exports = { createKeyAuth };
