/**
 * Puente con SHEAL-Helper.exe (C# + CmlLib.Core).
 * El helper descarga e inicia Minecraft en segundo plano y escribe su
 * progreso en un log; aquí lo leemos y lo reenviamos al renderer.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

function createHelper({ userData, gameDir, send }) {
  const logPath = path.join(userData, "sheal-helper.log");

  function helperPath() {
    const candidates = [
      path.join(process.resourcesPath || "", "helper", "SHEAL-Helper.exe"),
      path.join(__dirname, "..", "helper", "SHEAL-Helper.exe"),
    ];
    return candidates.find((p) => fs.existsSync(p)) || null;
  }

  function available() {
    return !!helperPath();
  }

  function run(args, onLine) {
    return new Promise((resolve, reject) => {
      const exe = helperPath();
      if (!exe) return reject(new Error("SHEAL-Helper.exe no encontrado"));
      try { fs.writeFileSync(logPath, ""); } catch {}

      let child;
      try {
        child = spawn(exe, [...args, logPath, gameDir()], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
      } catch (error) {
        return reject(error);
      }
      child.unref();

      let processed = 0;
      let finished = false;
      let timer = null;
      let timeout = null;

      const finish = (error) => {
        if (finished) return;
        finished = true;
        if (timer) clearInterval(timer);
        if (timeout) clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };

      timer = setInterval(() => {
        let lines = [];
        try {
          lines = fs.readFileSync(logPath, "utf8").split(/\r?\n/).filter(Boolean);
        } catch {}
        for (; processed < lines.length; processed++) {
          const line = lines[processed];
          try {
            onLine(line);
          } catch (error) {
            finish(error);
            return;
          }
          if (line.startsWith("DONE") || line.startsWith("ERROR")) {
            finish();
            return;
          }
        }
      }, 180);

      // Límite de seguridad (20 min).
      timeout = setTimeout(() => {
        finish(new Error("La descarga tardó demasiado. Revisa tu conexión."));
      }, 20 * 60 * 1000);
    });
  }

  async function install(id) {
    return run(["--sheal-install", id], (line) => {
      if (line.startsWith("PROGRESS ")) {
        send({ id, phase: "helper", label: `Descargando ${id}...`, percent: Number(line.split(" ")[1]) || 0 });
      } else if (line.startsWith("ERROR ")) {
        send({ id, phase: "helper", label: line.slice(6), percent: 0, fatal: true });
        throw new Error(line.slice(6));
      }
    });
  }

  async function play(id, options = {}) {
    let pid = null;
    await run(["--sheal-play", id, options.username || "ShealPlayer"], (line) => {
      if (line.startsWith("PROGRESS ")) {
        send({ id, phase: "helper", label: `Descargando ${id}...`, percent: Number(line.split(" ")[1]) || 0 });
      } else if (line.startsWith("GAME_PID ")) {
        pid = Number(line.split(" ")[1]) || null;
      } else if (line.startsWith("ERROR ")) {
        send({ id: "error", phase: "error", label: line.slice(6), percent: 0, fatal: true });
        throw new Error(line.slice(6));
      }
    });
    return { ok: true, mode: "cml", pid, message: `Minecraft ${id} iniciado` };
  }

  return { available, install, play, helperPath };
}

module.exports = { createHelper };
