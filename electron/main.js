// ===== MechMark Electron shell (Phase 2) =====
// Wraps the Phase-1 web canvas in a desktop window, serving the unchanged
// ES-module engine over a custom privileged "app://" scheme (NOT file://).
import { app, BrowserWindow, protocol, globalShortcut, ipcMain, net, Tray, Menu, nativeImage } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, normalize, sep } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Repo root is the parent of electron/. All app:// URLs resolve under here.
const ROOT = normalize(join(__dirname, '..'));

// ---- MIME map (must serve ES modules with text/javascript) ----
const MIME = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};
function mimeFor(p) {
  const dot = p.lastIndexOf('.');
  const ext = dot >= 0 ? p.slice(dot).toLowerCase() : '';
  return MIME[ext] || 'application/octet-stream';
}

// ---- Register the privileged scheme BEFORE app is ready ----
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

// Map an app://bundle/<path> URL to an absolute file path under ROOT.
// Returns null when the path escapes ROOT (traversal guard).
function resolveAppPath(urlStr) {
  const u = new URL(urlStr);
  // Host is "bundle"; pathname is the file path relative to ROOT.
  // Decode percent-encoding and strip the leading slash.
  let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  if (rel === '' ) rel = 'index.html';
  // Default a directory request to its index.html.
  if (rel.endsWith('/')) rel += 'index.html';

  const abs = normalize(join(ROOT, rel));
  // Traversal guard: the resolved path must stay within ROOT.
  const rootWithSep = ROOT.endsWith(sep) ? ROOT : ROOT + sep;
  if (abs !== ROOT && !abs.startsWith(rootWithSep)) return null;
  return abs;
}

function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    const abs = resolveAppPath(request.url);
    if (!abs) {
      return new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/plain' } });
    }
    try {
      // net.fetch over file:// streams the file efficiently; we set the MIME
      // ourselves so ES modules load with text/javascript.
      const res = await net.fetch(pathToFileURL(abs).toString());
      if (!res.ok) {
        return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
      }
      const headers = new Headers(res.headers);
      const ct = mimeFor(abs);
      headers.set('content-type', ct);
      // Restrictive CSP for HTML documents. Allows the app's own bundle, inline
      // styles (the engine uses them), and the Google Fonts CDN that index.html
      // pulls; blocks arbitrary remote script/connect/frame sources.
      if (ct === 'text/html') {
        headers.set(
          'Content-Security-Policy',
          [
            "default-src 'none'",
            "script-src 'self' app:",
            "style-src 'self' app: 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' app: https://fonts.gstatic.com",
            "img-src 'self' app: data: blob:",
            "connect-src 'self' app: https://fonts.googleapis.com https://fonts.gstatic.com",
            "base-uri 'none'",
            "object-src 'none'",
            "frame-src 'none'",
            "form-action 'none'",
          ].join('; '),
        );
      }
      return new Response(res.body, { status: 200, headers });
    } catch {
      return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
    }
  });
}

// ---- Capture entry point (Phase 3). Guarded so the app launches without it. ----
let captureModule = null;
async function loadCaptureModule() {
  if (captureModule) return captureModule;
  try {
    captureModule = await import('./capture.js');
  } catch {
    captureModule = null; // capture.js not built yet — capture is a no-op.
  }
  return captureModule;
}
async function triggerCapture() {
  const mod = await loadCaptureModule();
  if (mod && typeof mod.startCapture === 'function') {
    try { await mod.startCapture(getMainWindow()); }
    catch (err) { console.error('[mechmark] capture failed:', err); }
  } else {
    console.warn('[mechmark] capture requested but electron/capture.js is not available yet.');
  }
}

// Navigation hardening (Electron-security): deny all window.open / new-window
// and block any navigation away from the trusted app://bundle/ origin. Applied
// to every BrowserWindow we create (main here, overlays in capture.js).
function hardenNavigation(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://bundle/')) e.preventDefault();
  });
}

// ---- Capture hotkey (persisted, user-customizable; PRD §4) ----
const DEFAULT_HOTKEY = 'Control+Shift+2';
let captureHotkey = DEFAULT_HOTKEY;
let startOnBoot = false; // launch MechMark at login (minimized to tray)
function settingsPath() { return join(app.getPath('userData'), 'settings.json'); }
function loadSettings() {
  try {
    const s = JSON.parse(readFileSync(settingsPath(), 'utf8'));
    if (s && typeof s.captureHotkey === 'string' && s.captureHotkey) captureHotkey = s.captureHotkey;
    if (s && typeof s.startOnBoot === 'boolean') startOnBoot = s.startOnBoot;
  } catch { /* no settings file yet — use the default */ }
}
function saveSettings() {
  try { writeFileSync(settingsPath(), JSON.stringify({ captureHotkey, startOnBoot }, null, 2)); }
  catch (err) { console.error('[mechmark] could not save settings:', err); }
}

// The `--hidden` arg makes the boot launch start straight into the tray.
// IMPORTANT (Windows): the SAME path+args must be passed to BOTH
// setLoginItemSettings and getLoginItemSettings, otherwise getLoginItemSettings
// can't match the registry entry and openAtLogin always reads back false —
// which made the toggle look like it did nothing.
const LOGIN_ITEM_OPTS = { path: process.execPath, args: ['--hidden'] };
// Register/unregister the OS "launch at login" entry to match `startOnBoot`.
// Only writes the registry for the PACKAGED app — in a dev run process.execPath
// is electron.exe, and a login entry pointing there would launch a broken shell.
function applyLoginItem() {
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin: startOnBoot, ...LOGIN_ITEM_OPTS });
  } catch (err) {
    console.error('[mechmark] could not set login item:', err);
  }
}
// The OS is the source of truth for the UI when packaged; fall back to the
// persisted intent in dev (where we don't touch the registry).
function isStartOnBootEnabled() {
  if (!app.isPackaged) return startOnBoot;
  try { return app.getLoginItemSettings(LOGIN_ITEM_OPTS).openAtLogin; }
  catch { return startOnBoot; }
}
// Register `accel` as the sole capture hotkey. Returns false if the OS/another
// app already owns it (registration is rejected).
function registerHotkey(accel) {
  // register() THROWS on a malformed accelerator. Without this guard the throw
  // escapes the IPC handler after unregisterAll() has already cleared the old
  // hotkey, leaving the app with no capture shortcut until restart.
  try {
    globalShortcut.unregisterAll();
    const ok = globalShortcut.register(accel, () => { triggerCapture(); });
    if (!ok) console.warn(`[mechmark] capture hotkey ${accel} could not be registered (already in use).`);
    return ok;
  } catch (err) {
    console.error(`[mechmark] invalid capture hotkey ${accel}:`, err.message);
    return false;
  }
}

const APP_ICON = join(__dirname, 'app-icon.png');  // window / taskbar (256px)
const TRAY_ICON = join(__dirname, 'tray-icon.png'); // system tray (32px)

let mainWindow = null;
let tray = null;
// Set true only by the tray "Quit" action (or app.quit). While false, closing
// the main window HIDES it to the tray instead of quitting the app.
let isQuitting = false;
let trayHintShown = false; // show the "minimized to tray" balloon only once
function getMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  return null;
}

// Bring the main window back from the tray (restoring/creating as needed).
function showMainWindow() {
  let win = getMainWindow();
  if (!win) win = createMainWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// System-tray icon + context menu. The window's close button hides to here.
function createTray() {
  if (tray) return;
  let image = nativeImage.createFromPath(TRAY_ICON);
  if (image.isEmpty()) image = nativeImage.createEmpty();
  tray = new Tray(image);
  tray.setToolTip('MechMark');
  const menu = Menu.buildFromTemplate([
    { label: '顯示 MechMark', click: () => showMainWindow() },
    { label: '截圖', click: () => triggerCapture() },
    { type: 'separator' },
    {
      label: '結束',
      click: () => { isQuitting = true; app.quit(); },
    },
  ]);
  tray.setContextMenu(menu);
  // Single/double click on the tray icon restores the window.
  tray.on('click', () => showMainWindow());
  tray.on('double-click', () => showMainWindow());
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 600,
    title: 'MechMark',
    icon: APP_ICON,
    backgroundColor: '#0e1116',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs ipcRenderer; safe with contextIsolation
      preload: join(__dirname, 'preload.cjs'),
    },
  });

  hardenNavigation(mainWindow);

  // Surface a broken app:// load instead of leaving a silent blank window.
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[mechmark] failed to load ${url}: ${desc} (${code})`);
  });
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[mechmark] main window loaded app://bundle/index.html');
  });

  // When launched at login (`--hidden`), stay in the tray instead of popping the
  // window. A manual launch (no flag) shows the window as usual.
  const startHidden = process.argv.includes('--hidden');
  mainWindow.once('ready-to-show', () => { if (!startHidden) mainWindow.show(); });

  // Close button (X) hides to the system tray instead of quitting, unless a real
  // quit was requested (tray "Quit" / app.quit). PRD-friendly: the global capture
  // hotkey keeps working while the app lives in the tray.
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      // One-time hint so the user knows the app is still running in the tray
      // (and not actually closed) the first time they hit X.
      if (!trayHintShown && tray && !tray.isDestroyed()) {
        trayHintShown = true;
        try {
          tray.displayBalloon({
            title: 'MechMark 仍在執行',
            content: '已縮小到系統匣，截圖熱鍵持續有效。點工作列圖示可開啟視窗，右鍵可結束。',
          });
        } catch { /* balloons are Windows-only / best-effort */ }
      }
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.loadURL('app://bundle/index.html');
  return mainWindow;
}

// ---- App lifecycle ----
// Single-instance: with the app living in the tray, a second launch should just
// surface the existing window rather than start a duplicate process.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
}

app.whenReady().then(() => {
  loadSettings();
  // Reconcile the OS login entry with the persisted intent on every launch.
  // saveSettings() is the source of truth for what the user wants; the registry
  // can drift (manual removal via Windows Settings/Task Manager, reinstall to a
  // new path). No-op in dev (applyLoginItem guards on app.isPackaged).
  applyLoginItem();
  registerAppProtocol();
  createMainWindow();
  createTray();

  // Global capture hotkey (PRD §4, FR-IO-1). Phase 3 implements the overlay.
  registerHotkey(captureHotkey);

  // Prewarm the capture pipeline so the FIRST hotkey press isn't a cold start
  // (dynamic import of capture.js + first overlay-window/ capturer init). Done
  // after the main window has loaded so it never competes with first paint.
  mainWindow.webContents.once('did-finish-load', () => {
    loadCaptureModule().then((mod) => {
      if (mod && typeof mod.prewarmCapture === 'function') {
        try { mod.prewarmCapture(); } catch { /* best-effort */ }
      }
    });
  });

  // Renderer-initiated capture (preload: mechmarkHost.requestCapture()).
  ipcMain.on('mechmark:request-capture', () => { triggerCapture(); });

  // Hotkey customization from the renderer.
  ipcMain.handle('mechmark:get-hotkey', () => captureHotkey);
  ipcMain.handle('mechmark:set-hotkey', (_e, accel) => {
    if (typeof accel !== 'string' || !accel.trim()) return { ok: false, hotkey: captureHotkey };
    const prev = captureHotkey;
    if (registerHotkey(accel)) {
      captureHotkey = accel;
      saveSettings();
      return { ok: true, hotkey: accel };
    }
    registerHotkey(prev); // restore the working one
    return { ok: false, hotkey: prev };
  });

  // Launch-at-login customization from the renderer.
  ipcMain.handle('mechmark:get-start-on-boot', () => isStartOnBootEnabled());
  ipcMain.handle('mechmark:set-start-on-boot', (_e, enabled) => {
    startOnBoot = !!enabled;
    applyLoginItem();
    saveSettings();
    return isStartOnBootEnabled();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

// Any path that actually quits the app (tray Quit, OS shutdown, etc.) must flip
// the flag so the main window's close handler stops hiding and lets it close.
app.on('before-quit', () => { isQuitting = true; });

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// NOTE: we intentionally do NOT quit on window-all-closed. The app lives in the
// system tray after the window is closed; quitting happens only via tray "Quit".
// (The window's close handler hides instead of closing, so this normally won't
// even fire — but if it does, keep the app alive.)
