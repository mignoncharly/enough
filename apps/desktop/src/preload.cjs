const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("enough", {
  getState: () => ipcRenderer.invoke("enough:get-state"),
  login: (credentials) => ipcRenderer.invoke("enough:login", credentials),
  loginWithToken: (credentials) => ipcRenderer.invoke("enough:login-token", credentials),
  logout: () => ipcRenderer.invoke("enough:logout"),
  sync: () => ipcRenderer.invoke("enough:sync"),
  setProduct: (productId) => ipcRenderer.invoke("enough:set-product", productId),
  setMode: (mode) => ipcRenderer.invoke("enough:set-mode", mode),
  setPaused: (paused) => ipcRenderer.invoke("enough:set-paused", paused),
  setProtection: (enabled) => ipcRenderer.invoke("enough:set-protection", enabled),
  setTracking: (enabled) => ipcRenderer.invoke("enough:set-tracking", enabled),
  setAutoStart: (enabled) => ipcRenderer.invoke("enough:set-autostart", enabled),
  setGracePeriod: (seconds) => ipcRenderer.invoke("enough:set-grace", seconds),
  setLocalClassification: (toolKey, classification) =>
    ipcRenderer.invoke("enough:set-local-classification", toolKey, classification),
  emergencyBypass: (input) => ipcRenderer.invoke("enough:emergency-bypass", input),
  update: () => ipcRenderer.invoke("enough:update"),
  dismissLock: () => ipcRenderer.invoke("enough:dismiss-lock"),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("enough:state", listener);
    return () => ipcRenderer.removeListener("enough:state", listener);
  },
});
