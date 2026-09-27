import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  protocol,
  session,
  webContents,
  Tray,
  nativeImage,
  shell,
  clipboard,
} from 'electron';
import { configureNimiElectronAppHostProfile } from '@nimiplatform/kit/shell/electron/host-profile';

declare const __NIMI_ELECTRON_PRODUCTION__: boolean;

// Bind user data, session data and temp to the Host profile Nimi Desktop
// prepared under the selected data root, before any session or window and
// before the rest of Kit loads: a module that failed to load first would
// leave Electron on its default paths in the OS user's profile.
try {
  configureNimiElectronAppHostProfile(app);
} catch (error) {
  process.stderr.write(
    `[nimi-app-host-profile] ${error instanceof Error ? error.message : String(error)}\n`,
  );
  app.exit(78);
  throw error;
}

const {
  isAllowedElectronRendererUrl,
  registerNimiElectronAppAssetProtocolScheme,
  registerNimiElectronAppBridge,
} = await import('@nimiplatform/kit/shell/electron/main');
const { createPolyAgentHost } = await import('./business.js');

const APP_ID = 'nimi.polyagent';
const NATIVE_BUNDLE_IDENTIFIER = 'ai.nimi.apps.nimi.polyagent';
const IS_PRODUCTION_BUNDLE =
  typeof __NIMI_ELECTRON_PRODUCTION__ !== 'undefined' && __NIMI_ELECTRON_PRODUCTION__;
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(currentDir, '..');
const preloadPath = path.join(currentDir, 'preload.cjs');
const productionRendererUrl = pathToFileURL(path.join(appRoot, 'dist', 'index.html')).toString();
const developmentRendererUrl = readDevelopmentRendererUrl();
const rendererUrl = developmentRendererUrl || productionRendererUrl;
const allowedRendererUrls = [rendererUrl];
let resettingRenderer = false;
let quitting = false;
let tray: Tray | undefined;
let clipboardTimer: ReturnType<typeof setTimeout> | undefined;
const business = createPolyAgentHost(
  () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      window.show();
      window.focus();
    } else void createMainWindow();
  },
  (url) => shell.openExternal(url),
  (token) => {
    if (clipboardTimer) clearTimeout(clipboardTimer);
    clipboard.writeText(token);
    clipboardTimer = setTimeout(() => {
      if (clipboard.readText() === token) clipboard.clear();
    }, 60000);
  },
);

app.setName('PolyAgent');
app.setAppUserModelId(NATIVE_BUNDLE_IDENTIFIER);
Menu.setApplicationMenu(
  Menu.buildFromTemplate([
    {
      label: 'PolyAgent',
      submenu: [
        {
          label: '显示 PolyAgent',
          click: () => {
            const window = BrowserWindow.getAllWindows()[0];
            if (window) {
              window.show();
              window.focus();
            } else void createMainWindow();
          },
        },
        {
          label: '停止策略',
          click: () => {
            void business.stop();
          },
        },
        { type: 'separator' },
        {
          label: '退出并停止 PolyAgent',
          click: () => {
            void business.stop().finally(() => app.quit());
          },
        },
      ],
    },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]),
);
registerNimiElectronAppAssetProtocolScheme(protocol);

void app.whenReady().then(async () => {
  registerNimiElectronAppBridge({
    appId: APP_ID,
    allowedRendererUrls,
    assetMediaPlatform: { protocol, webRequest: session.defaultSession.webRequest, webContents },
    ipcMain,
    appCommandHandlers: business.handlers,
    onSessionReady: business.bind,
    onSessionInvalidated: () => {
      business.invalidate();
      resetAccountScopedRenderer();
    },
  });
  const icon = nativeImage.createFromPath(
    path.join(appRoot, developmentRendererUrl ? 'public/app-icon.png' : 'dist/app-icon.png'),
  );
  if (!icon.isEmpty()) {
    tray = new Tray(icon.resize({ width: 18, height: 18 }));
    tray.setToolTip('PolyAgent · 自动策略');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: '打开 PolyAgent',
          click: () => {
            const w = BrowserWindow.getAllWindows()[0];
            if (w) {
              w.show();
              w.focus();
            } else void createMainWindow();
          },
        },
        {
          label: '停止策略',
          click: () => {
            void business.stop();
          },
        },
        {
          label: '退出并停止',
          click: () => {
            void business.stop().finally(() => app.quit());
          },
        },
      ]),
    );
  }
  await createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
  });
});

app.on('window-all-closed', () => {});
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void business.shutdown().then(
    () => {
      business.invalidate();
      app.quit();
    },
    () => {
      quitting = false;
    },
  );
});

// A revoked/account-changed scope must not leave renderer timers or queued
// promises alive to use the rebound Host. This does not run on normal renewal.
function resetAccountScopedRenderer(): void {
  const windows = BrowserWindow.getAllWindows();
  if (quitting || windows.length === 0) return;
  resettingRenderer = true;
  try {
    for (const window of windows) window.destroy();
    void createMainWindow().catch((error: unknown) => {
      process.stderr.write(
        `[nimi-app-session-reset] ${error instanceof Error ? error.message : String(error)}\n`,
      );
    });
  } finally {
    resettingRenderer = false;
  }
}

async function createMainWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 360,
    minHeight: 560,
    title: 'PolyAgent',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.on('close', (event) => {
    if (!quitting && !resettingRenderer && tray) {
      event.preventDefault();
      window.hide();
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedElectronRendererUrl(url, allowedRendererUrls)) event.preventDefault();
  });
  try {
    await window.loadURL(rendererUrl);
  } catch (error) {
    if (!window.isDestroyed()) throw error;
  }
}

function readDevelopmentRendererUrl(): string {
  const flag = '--nimi-dev-renderer-url';
  const prefix = '--nimi-dev-renderer-url=';
  const hasDevelopmentRendererArgument = process.argv.some(
    (value) => value === flag || value.startsWith(prefix),
  );
  if (IS_PRODUCTION_BUNDLE && hasDevelopmentRendererArgument) {
    throw new Error('The production Electron bundle rejects --nimi-dev-renderer-url.');
  }
  if (process.argv.includes(flag)) throw new Error('Nimi development renderer URL is missing.');
  const values = process.argv.filter((value) => value.startsWith(prefix));
  if (values.length === 0) return '';
  if (values.length !== 1) throw new Error('Nimi development renderer URL must be singular.');
  const selected = values[0];
  if (!selected) throw new Error('Nimi development renderer URL is missing.');
  const raw = selected.slice(prefix.length);
  const parsed = new URL(raw);
  if (
    parsed.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname.toLowerCase()) ||
    !parsed.port ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname !== '/' && parsed.pathname !== '') ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Nimi development renderer URL must be exact loopback.');
  }
  return parsed.origin;
}
