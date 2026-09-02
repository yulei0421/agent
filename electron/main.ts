import { app, BrowserWindow, dialog, session } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createSidecarLaunchOptions, findAvailableLoopbackPort, startDesktopSidecar, type DesktopSidecar } from './sidecar.js';

const developmentUrl = process.env.ELECTRON_RENDERER_URL;
const DESKTOP_SESSION_HEADER = 'x-desktop-session-token';
const currentDirectory = __dirname;
let sidecar: DesktopSidecar | undefined;
let mainWindow: BrowserWindow | undefined;

function allowedUrl(url: string, origin: string): boolean {
  return url === origin || url.startsWith(`${origin}/`);
}

function installDesktopSessionHeader(origin: string, token: string): void {
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, [DESKTOP_SESSION_HEADER]: token } });
  });
}

function createWindow(origin: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#faf8f1',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(currentDirectory, 'preload.js')
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!allowedUrl(url, origin)) event.preventDefault();
  });
  window.once('ready-to-show', () => window.show());
  void window.loadURL(origin);
  return window;
}

async function openDesktopWindow(): Promise<void> {
  if (developmentUrl) {
    mainWindow = createWindow(developmentUrl);
    return;
  }
  const port = await findAvailableLoopbackPort();
  const rendererDir = join(process.resourcesPath, 'app.asar.unpacked', 'dist');
  const serverEntry = join(process.resourcesPath, 'app.asar.unpacked', 'dist-server', 'server', 'bootstrap.js');
  if (!existsSync(rendererDir) || !existsSync(serverEntry)) throw new Error('Desktop resources are missing; run desktop:build before packaging');
  const options = createSidecarLaunchOptions(port, rendererDir, serverEntry);
  sidecar = await startDesktopSidecar({
    ...options,
    executablePath: process.execPath,
    workingDirectory: app.getPath('userData')
  });
  installDesktopSessionHeader(sidecar.origin, sidecar.token);
  mainWindow = createWindow(sidecar.origin);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });
  app.whenReady().then(openDesktopWindow).catch((error: unknown) => {
    dialog.showErrorBox('DeepSeek Agent 启动失败', error instanceof Error ? error.message : '未知错误');
    app.quit();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void openDesktopWindow();
  });
  app.on('before-quit', () => {
    void sidecar?.stop();
  });
}
