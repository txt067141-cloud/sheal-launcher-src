// Ofusca el bundle JS de Vite para dificultar la lectura/copia del codigo fuente.
import fs from "node:fs";
import path from "node:path";
import JavaScriptObfuscator from "javascript-obfuscator";

const dist = path.resolve("dist");
const assets = path.join(dist, "assets");

if (!fs.existsSync(assets)) {
  console.error("No se encontro dist/assets. Ejecuta vite build primero.");
  process.exit(1);
}

const files = fs.readdirSync(assets).filter((f) => f.endsWith(".js"));
let total = 0;

for (const file of files) {
  const full = path.join(assets, file);
  const code = fs.readFileSync(full, "utf8");
  const result = JavaScriptObfuscator.obfuscate(code, {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.5,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.3,
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
    splitStringsChunkLength: 8,
    stringArray: true,
    stringArrayEncoding: ["base64"],
    stringArrayThreshold: 0.75,
    transformObjectKeys: true,
    unicodeEscapeSequence: true,
  });
  fs.writeFileSync(full, result.getObfuscatedCode(), "utf8");
  total++;
  console.log(`Ofuscado: ${file}`);
}

console.log(`OK — ${total} archivo(s) ofuscado(s).`);
