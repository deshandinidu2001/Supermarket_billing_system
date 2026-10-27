import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld(
  'recovery',
  Object.freeze({
    authenticate: (username: string, password: string) =>
      ipcRenderer.invoke('pos:recovery-auth', { username, password }),
  }),
);
