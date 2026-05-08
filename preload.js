const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  checkEnv: () => ipcRenderer.invoke('env:check'),
  pickInput: () => ipcRenderer.invoke('dialog:openInput'),
  pickOutput: (suggested) => ipcRenderer.invoke('dialog:saveOutput', suggested),
  saveLog: () => ipcRenderer.invoke('dialog:saveLog'),
  probeMedia: (path) => ipcRenderer.invoke('media:probe', path),
  startCompress: (opts) => ipcRenderer.invoke('compress:start', opts),
  cancelCompress: (jobId) => ipcRenderer.invoke('compress:cancel', jobId),
  revealInFolder: (p) => ipcRenderer.invoke('shell:reveal', p),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  resolveAvailable: (p) => ipcRenderer.invoke('fs:resolveAvailable', p),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  setStatsEnabled: (on) => ipcRenderer.invoke('stats:setEnabled', on),
  copyFile: (p) => ipcRenderer.invoke('clipboard:copyFile', p),

  // For drag-drop support: in modern Electron the renderer can't read
  // file.path directly; webUtils.getPathForFile is the supported way to
  // resolve a dropped File to its filesystem path.
  pathForFile: (file) => webUtils.getPathForFile(file),

  // Build a dvc-media:// URL the renderer's <video> tag can load. The
  // protocol handler in main.js maps this to the underlying file:// URL.
  mediaUrl: (p) => {
    if (!p) return '';
    // encodeURI handles spaces and unicode; we manually re-encode '#' and
    // '?' since they have URL meaning even in path components.
    const encoded = encodeURI(p.replace(/\\/g, '/'))
      .replace(/#/g, '%23').replace(/\?/g, '%3F');
    return 'dvc-media:///' + encoded.replace(/^\//, '');
  },

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
  onEncoders: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('encoders', handler);
    return () => ipcRenderer.removeListener('encoders', handler);
  },
  onSystemTheme: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('theme:os', handler);
    return () => ipcRenderer.removeListener('theme:os', handler);
  },
});
