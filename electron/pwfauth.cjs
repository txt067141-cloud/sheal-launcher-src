/**
 * Integracion con PWF Auth (alternativa a KeyAuth).
 * El SDK hace cifrado, heartbeat y kill switch por nosotros.
 * El App Secret va fijo aqui (dentro del codigo ofuscado del EXE).
 */
const fs = require("node:fs");
const path = require("node:path");

// App Secret de la aplicacion SHEAL en pwfauth (64 caracteres).
const APP_SECRET = "6f1c63cb25641404dbd8fd8431b00714f30f395092fdfc98a476099becb7c714";
const DASHBOARD = "https://pwfauth.com/dashboard";

function createPwfAuth({ userData, onSessionEnded }) {
  let client = null;
  let currentKey = null;
  let signedIn = false;

  async function getClient() {
    if (client) return client;
    const { PwfClient } = await import("pwfauth");
    client = new PwfClient(APP_SECRET);
    client.on("sessionEnded", (info) => {
      signedIn = false;
      try { if (onSessionEnded) onSessionEnded(info); } catch {}
    });
    return client;
  }

  /** Inicia sesion con una clave. Devuelve datos de licencia para la UI. */
  async function login(license) {
    const key = String(license || "").trim();
    if (!key) return { ok: false, message: "Escribe tu clave de acceso." };
    try {
      const c = await getClient();
      const result = await c.login(key);
      if (!result || result.success !== true) {
        return { ok: false, message: (result && result.message) || "Clave no válida.",
                 errorCode: result?.errorCode || null };
      }
      currentKey = key;
      signedIn = true;

      const lic = result.license || {};
      const app = result.data?.app || {};
      return {
        ok: true,
        username: lic.username || app.name || "ShealUser",
        sessionid: result.sessionid || "",
        license: key,
        message: result.message || "Clave válida",
        // Dias reales y fecha de expiracion segun pwfauth.
        daysRemaining: lic.isLifetime ? null : (lic.daysRemaining ?? null),
        expiresAt: lic.isLifetime ? null : (lic.expiresAt ? new Date(lic.expiresAt).getTime() : null),
        isLifetime: !!lic.isLifetime,
        subscription: lic.keyType || lic.status || "",
      };
    } catch (error) {
      return { ok: false, message: `No se pudo validar: ${error.message}` };
    }
  }

  /** Arranca el heartbeat (kill switch): cierra sesion si la clave expira/banea. */
  function startHeartbeat() {
    if (!client || !signedIn) return;
    try { client.startHeartbeat(); } catch {}
  }

  function stopHeartbeat() {
    if (!client) return;
    try { client.stopHeartbeat(); } catch {}
  }

  async function logout() {
    if (!client) return;
    try { await client.logout(); } catch {}
    signedIn = false;
    currentKey = null;
  }

  return { login, startHeartbeat, stopHeartbeat, logout, getClient, DASHBOARD, isSignedIn: () => signedIn };
}

module.exports = { createPwfAuth };
