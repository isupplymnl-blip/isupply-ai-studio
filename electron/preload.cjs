'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studio', {
  /** Returns the saved config object (e.g. { geminiApiKey: '...' }) */
  getConfig: () => ipcRenderer.invoke('get-config'),

  /** Save the API key and (re)start the server */
  saveApiKey: (key) => ipcRenderer.invoke('save-api-key', key),

  /** Listen for prefill-key messages from the main process */
  onPrefillKey: (cb) => ipcRenderer.on('prefill-key', (_e, key) => cb(key)),
});
