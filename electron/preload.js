// @ts-check
// What the desktop app adds to Lumen's pages: its folder picker, for the console's ＋ Folder button, and the
// displays, for choosing where the audience output and stage display go in the first-run setup.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lumenDesktop', {
  pickFolder: () => ipcRenderer.invoke('lumen:pick-folder'), // a path, or '' if cancelled
  displays: () => ipcRenderer.invoke('lumen:displays'), // {displays: [{id, name}], chosen: {output, stage}}
  setScreen: (name, id) => ipcRenderer.invoke('lumen:set-screen', name, id), // name 'output' or 'stage'; id or null
  identifyScreens: () => ipcRenderer.invoke('lumen:identify-screens'),
});
