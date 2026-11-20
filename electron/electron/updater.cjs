/**
 * Sistema de auto-update de contenido (skins, alas, mod, versions, configuracion).
 * Consulta un manifest remoto en GitHub raw y descarga los archivos cambiados
 * a userData/updates/, que tienen prioridad sobre los archivos del app.asar.
 *
 * El EXE en si no se reemplaza: solo se actualiza el CONTENIDO. Para cambios
 * de codigo Electron hay que generar un EXE nuevo.
 */
const fs = require("node:fs");
const path = require("node:path");

// URL base del contenido. CAMBIAR por tu repo de GitHub (raw).
// Ejemplo: https://raw.githubusercontent.com/TU_USUARIO/TU_REPO/main/content
const DEFAULT_BASE = "https://raw.githubusercontent.com/txt067141-cloud/sheal-content/main/content";
const VERSION_FILE = "sheal-content-version.json";
const MANIFEST = "manifest.json";

function createUpdater({ userData, send }) {
  const manifestPath = path.join(userData, MANIFEST);
  const versionPath = path.join(userData, VERSION_FILE);
  const updatesDir = path.join(userData, "updates");
  let baseUrl = DEFAULT_BASE;

  function report(label, extra = {}) {
    try { if (send) send({ id: "update", phase: "update", label, ...extra }); } catch {}
  }

  function getBase() {
    // 1) Archivo de configuracion editable sin recompilar (si existe).
    try {
      const urlFile = path.join(userData, "sheal-content-url.txt");
      const custom = fs.readFileSync(urlFile, "utf8").trim();
      if (custom.startsWith("http")) return custom.replace(/\/$/, "");
    } catch {}
    // 2) URL guardada.
    try {
      const v = JSON.parse(fs.readFileSync(versionPath, "utf8"));
      if (v.baseUrl) return v.baseUrl;
    } catch {}
    return DEFAULT_BASE;
  }

  function getVersion() {
    try { return JSON.parse(fs.readFileSync(versionPath, "utf8")).version || "0"; } catch { return "0"; }
  }

  function setBase(url) {
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(versionPath, "utf8")); } catch {}
    saved.baseUrl = url;
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(versionPath, JSON.stringify(saved, null, 2));
    baseUrl = url;
  }

  /** Ruta local de un archivo actualizado (o null si no existe). */
  function localPath(rel) {
    const p = path.join(updatesDir, rel);
    return fs.existsSync(p) ? p : null;
  }

  async function fetchJson(url, timeout = 15000) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeout);
    try {
      const r = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "SHEAL-Updater/2.0" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  async function download(url, dest) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 30000);
    try {
      const r = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "SHEAL-Updater/2.0" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      return buf.length;
    } finally { clearTimeout(t); }
  }

  /**
   * Busca actualizaciones. Devuelve { ok, version, changed, message }.
   * No instala nada: solo descarga a updatesDir.
   */
  async function check() {
    const base = getBase();
    report("Buscando actualizaciones...");
    let manifest;
    try {
      manifest = await fetchJson(`${base}/${MANIFEST}`);
    } catch (e) {
      return { ok: false, message: `No se pudo consultar actualizaciones: ${e.message}`, offline: true };
    }
    if (!manifest || typeof manifest.version !== "string") {
      return { ok: false, message: "Manifest invalido" };
    }
    const current = getVersion();
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    let changed = 0, bytes = 0;

    // Si la version cambio, descargamos todos los archivos del manifest.
    if (manifest.version !== current || files.length) {
      for (const rel of files) {
        const safe = String(rel).replace(/\\/g, "/").replace(/^\/+/, "");
        const dest = path.join(updatesDir, safe);
        try {
          bytes += await download(`${base}/${safe}`, dest);
          changed++;
        } catch (e) {
          report(`Error al descargar ${safe}: ${e.message}`);
        }
      }
    }

    // Guardamos la version local (y la base).
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(versionPath, "utf8")); } catch {}
    saved.version = manifest.version;
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(versionPath, JSON.stringify(saved, null, 2));

    report(changed ? `Actualizado: ${changed} archivo(s)` : "Sin cambios");
    return { ok: true, version: manifest.version, changed, bytes, message: manifest.message || "" };
  }

  return {
    check, localPath, getVersion, getBase, setBase,
    updatesDir, DEFAULT_BASE,
  };
}

module.exports = { createUpdater };
