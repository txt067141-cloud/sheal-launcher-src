// Endurece el codigo Electron: ofusca los .cjs e inyecta hashes anti-tamper en main.cjs.
// Trabaja sobre COPIAS en dist-electron/, nunca modifica electron/ (fuente intacta).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import JavaScriptObfuscator from "javascript-obfuscator";

const SRC = path.resolve("electron");
const OUT = path.resolve("dist-electron");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const f of fs.readdirSync(SRC)) {
  const full = path.join(SRC, f);
  if (fs.statSync(full).isFile()) fs.copyFileSync(full, path.join(OUT, f));
}

// Opciones seguras para el proceso principal: ofuscacion fuerte de nombres/strings
// pero sin dead-code-injection (puede romper require) ni control-flow agresivo.
const OPTS = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: "hexadecimal",
  log: false,
  numbersToExpressions: true,
  renameGlobals: false,
  rotateStringArray: true,
  selfDefending: false,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
  stringArray: true,
  stringArrayEncoding: ["base64"],
  stringArrayThreshold: 0.65,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
};

function obfuscate(file) {
  const full = path.join(OUT, file);
  if (!fs.existsSync(full)) return;
  const code = fs.readFileSync(full, "utf8");
  const result = JavaScriptObfuscator.obfuscate(code, OPTS);
  fs.writeFileSync(full, result.getObfuscatedCode(), "utf8");
}

// 1) Ofuscar todos los .cjs excepto main (main se ofusca al final).
for (const f of fs.readdirSync(OUT)) {
  if (f.endsWith(".cjs") && f !== "main.cjs") obfuscate(f);
}

// 2) Calcular hashes de los archivos ya ofuscados que main verifica.
function hash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(OUT, file))).digest("hex");
}
const hashes = {
  "__PRELOAD_HASH__": hash("preload.cjs"),
  "__PWFAUTH_HASH__": hash("pwfauth.cjs"),
  "__MC_HASH__": hash("minecraft.cjs"),
  "__DISCORD_HASH__": hash("discord.cjs"),
};

// 3) Inyectar hashes en main.cjs y ofuscarlo.
let main = fs.readFileSync(path.join(OUT, "main.cjs"), "utf8");
for (const [k, v] of Object.entries(hashes)) main = main.split(k).join(v);
fs.writeFileSync(path.join(OUT, "main.cjs"), main, "utf8");
obfuscate("main.cjs");

console.log("OK — codigo Electron ofuscado y protegido en dist-electron/");
