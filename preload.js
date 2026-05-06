const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  checkEnv: () => ipcRenderer.invoke('env:check'),
  pickInput: () => ipcRenderer.invoke('dialog:openInput'),
  pickOutput: (suggested) => ipcRenderer.invoke('dialog:saveOutput', suggested),
  startCompress: (opts) => ipcRenderer.invoke('compress:start', opts),
  cancelCompress: () => ipcRenderer.invoke('compress:cancel'),
  revealInFolder: (p) => ipcRenderer.invoke('shell:reveal', p),
  onProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('progress', handler);
    return () => ipcRenderer.removeListener('progress', handler);
  },
  onStats: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('stats', handler);
    return () => ipcRenderer.removeListener('stats', handler);
  },
});
