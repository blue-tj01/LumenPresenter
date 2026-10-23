// @ts-check
// What the desktop app adds to Lumen's pages: its folder picker, for the console's ＋ Folder button.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lumenDesktop', {
  pickFolder: () => ipcRenderer.invoke('lumen:pick-folder'), // a path, or '' if cancelled
});
