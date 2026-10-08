const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("enough", {
  getState: () => ipcRenderer.invoke("enough:get-state"),
  emergencyBypass: (input) => ipcRenderer.invoke("enough:emergency-bypass", input),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("enough:state", listener);
    return () => ipcRenderer.removeListener("enough:state", listener);
  },
});
