import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('desktop', Object.freeze({
  isDesktop: true,
  platform: process.platform
}));
