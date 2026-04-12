'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studio', {
  /** Returns the saved config object */
  getConfig: () => ipcRenderer.invoke('get-config'),

  /** Save provider + API key and (re)start the server */
  saveConfig: (data) => ipcRenderer.invoke('save-config', data),

  /** Listen for prefill-config messages from the main process */
  onPrefillConfig: (cb) => ipcRenderer.on('prefill-config', (_e, config) => cb(config)),
});
