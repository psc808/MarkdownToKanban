'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getTasks:                   ()           => ipcRenderer.invoke('tasks:get'),
  createTask:                 (fields)     => ipcRenderer.invoke('tasks:create', fields),
  updateTask:                 (id, changes)=> ipcRenderer.invoke('tasks:update', { id, changes }),
  deleteTask:                 (id)         => ipcRenderer.invoke('tasks:delete', id),
  getCurrentFile:             ()           => ipcRenderer.invoke('file:current'),
  hasFile:                    ()           => ipcRenderer.invoke('file:hasFile'),
  chooseFile:                 ()           => ipcRenderer.invoke('file:choose'),
  createFromTemplate:         ()           => ipcRenderer.invoke('file:createFromTemplate'),
  revealFile:                 ()           => ipcRenderer.invoke('file:reveal'),
  onFileChanged:              (cb)         => ipcRenderer.on('file:changed', (_, p) => cb(p)),
  getArchiveFile:             ()           => ipcRenderer.invoke('archive:current'),
  hasArchiveFile:             ()           => ipcRenderer.invoke('archive:hasFile'),
  chooseArchiveFile:          ()           => ipcRenderer.invoke('archive:choose'),
  createArchiveFromTemplate:  ()           => ipcRenderer.invoke('archive:createFromTemplate'),
});
