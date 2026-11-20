const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("uris", {
  isDesktop: true,
  platform: process.platform,
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
});

contextBridge.exposeInMainWorld("keyauth", {
  config: () => ipcRenderer.invoke("keyauth:config"),
  saveConfig: (config) => ipcRenderer.invoke("keyauth:saveConfig", config),
  login: (license) => ipcRenderer.invoke("keyauth:login", license),
  check: (license, sessionid) => ipcRenderer.invoke("keyauth:check", license, sessionid),
  status: (license, sessionid) => ipcRenderer.invoke("keyauth:status", license, sessionid),
  openDashboard: () => ipcRenderer.invoke("keyauth:openDashboard"),
});

contextBridge.exposeInMainWorld("updater", {
  check: () => ipcRenderer.invoke("update:check"),
  info: () => ipcRenderer.invoke("update:info"),
});

contextBridge.exposeInMainWorld("bedrock", {
  detect: () => ipcRenderer.invoke("bedrock:detect"),
  install: () => ipcRenderer.invoke("bedrock:install"),
  launch: () => ipcRenderer.invoke("bedrock:launch"),
  openStore: () => ipcRenderer.invoke("bedrock:openStore"),
});

contextBridge.exposeInMainWorld("rpc", {
  config: () => ipcRenderer.invoke("rpc:config"),
  saveConfig: (config) => ipcRenderer.invoke("rpc:saveConfig", config),
  openPortal: () => ipcRenderer.invoke("rpc:openPortal"),
  stop: () => ipcRenderer.invoke("rpc:stop"),
});

contextBridge.exposeInMainWorld("mc", {
  info: () => ipcRenderer.invoke("mc:info"),
  versions: () => ipcRenderer.invoke("mc:versions"),
  installed: () => ipcRenderer.invoke("mc:installed"),
  install: (id) => ipcRenderer.invoke("mc:install", id),
  launch: (id, options) => ipcRenderer.invoke("mc:launch", id, options),
  setConfig: (next) => ipcRenderer.invoke("mc:setConfig", next),
  openFolder: () => ipcRenderer.invoke("mc:openFolder"),
  openSubfolder: (name) => ipcRenderer.invoke("mc:openSubfolder", name),
  installSkin: (fileName, username, uuid) => ipcRenderer.invoke("mc:installSkin", fileName, username, uuid),
  ensureJava: (id) => ipcRenderer.invoke("mc:ensureJava", id),
  openLauncher: () => ipcRenderer.invoke("mc:openLauncher"),
  diagnostics: () => ipcRenderer.invoke("mc:diagnostics"),
  updateParticles: (shape, color, wings, wingStyle) => ipcRenderer.invoke("mc:updateParticles", shape, color, wings, wingStyle),
  chooseDir: () => ipcRenderer.invoke("mc:chooseDir"),
  chooseJava: () => ipcRenderer.invoke("mc:chooseJava"),
  onProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("mc:progress", listener);
    return () => ipcRenderer.removeListener("mc:progress", listener);
  },
});
