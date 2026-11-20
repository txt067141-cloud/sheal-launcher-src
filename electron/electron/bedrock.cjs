/**
 * Gestion de Minecraft Bedrock Edition en Windows.
 * Bedrock se distribuye via Microsoft Store (no como .exe normal),
 * asi que lo detectamos por Appx y lo instalamos abriendo su pagina del Store.
 */
const { execFile } = require("node:child_process");
const path = require("node:path");

const STORE_ID = "9NBLGGH2JHXJ";                       // Minecraft (Bedrock)
const STORE_URL = `ms-windows-store://pdp/?productid=${STORE_ID}`;
const STORE_WEB = "https://www.microsoft.com/en-us/p/minecraft/9nblggh2jhxj";
const PFN = "Microsoft.MinecraftUWP_8wekyb3d8bbwe";   // Package Family Name

function run(tool, args, timeout = 15000) {
  return new Promise((resolve) => {
    try {
      execFile(tool, args, { windowsHide: true, timeout }, (error, stdout, stderr) => {
        resolve({ ok: !error, stdout: String(stdout || ""), stderr: String(stderr || "") });
      });
    } catch (e) {
      resolve({ ok: false, stdout: "", stderr: String(e.message || e) });
    }
  });
}

function createBedrock({ send } = {}) {
  function report(label, extra = {}) {
    try { if (send) send({ id: "bedrock", phase: "bedrock", label, ...extra }); } catch {}
  }

  /** Detecta si Bedrock esta instalado (Get-AppxPackage). */
  async function detect() {
    const ps = [
      "-NoProfile", "-NonInteractive",
      "-Command",
      `Get-AppxPackage -Name Microsoft.MinecraftUWP -ErrorAction SilentlyContinue | Select-Object -First 1 Name,Version,PackageFullName,InstallLocation | ConvertTo-Json -Compress`,
    ];
    const r = await run("powershell.exe", ps, 20000);
    if (!r.ok || !r.stdout.trim()) return { installed: false };
    try {
      const info = JSON.parse(r.stdout.trim());
      if (!info || !info.Name) return { installed: false };
      return {
        installed: true,
        version: info.Version || "",
        package: info.PackageFullName || "",
        location: info.InstallLocation || "",
      };
    } catch {
      return { installed: false, raw: r.stdout.slice(0, 200) };
    }
  }

  /** Abre la pagina del Microsoft Store para instalar Bedrock. */
  async function install() {
    report("Abriendo Microsoft Store para instalar Bedrock...");
    // Primero intentamos el protocolo del Store; si no, la pagina web.
    const r = await run("cmd.exe", ["/c", "start", "", `"${STORE_URL}"`], 10000);
    if (!r.ok) {
      const { shell } = require("electron");
      shell.openExternal(STORE_WEB).catch(() => {});
    }
    report("Microsoft Store abierto. Instala Minecraft desde ahi.");
    return { ok: true, message: "Se abrió el Microsoft Store. Instala Minecraft (Bedrock) desde ahí." };
  }

  /** Lanza Bedrock si esta instalado. */
  async function launch() {
    const info = await detect();
    if (!info.installed) {
      return { ok: false, message: "Bedrock no está instalado. Pulsa Instalar primero." };
    }
    report("Iniciando Minecraft Bedrock...");
    // shell:AppsFolder con el Package Family Name lanza la app UWP.
    const r = await run("explorer.exe", [`shell:AppsFolder\\${PFN}!App`], 10000);
    return {
      ok: r.ok || true, // explorer devuelve codigo raro incluso cuando lanza bien
      message: "Minecraft Bedrock iniciado.",
    };
  }

  /** Abre la pagina web de Bedrock como alternativa. */
  function openStoreWeb() {
    const { shell } = require("electron");
    shell.openExternal(STORE_WEB).catch(() => {});
  }

  return { detect, install, launch, openStoreWeb, STORE_ID, STORE_URL, STORE_WEB, PFN };
}

module.exports = { createBedrock };
