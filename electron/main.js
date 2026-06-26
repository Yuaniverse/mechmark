// ===== MechMark Electron shell (Phase 2) =====
// Wraps the Phase-1 web canvas in a desktop window, serving the unchanged
// ES-module engine over a custom privileged "app://" scheme (NOT file://).
import { app, BrowserWindow, protocol, globalShortcut, ipcMain, net } from 'electron';
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
function settingsPath() { return join(app.getPath('userData'), 'settings.json'); }
function loadSettings() {
  try {
    const s = JSON.parse(readFileSync(settingsPath(), 'utf8'));
    if (s && typeof s.captureHotkey === 'string' && s.captureHotkey) captureHotkey = s.captureHotkey;
  } catch { /* no settings file yet — use the default */ }
}
function saveSettings() {
  try { writeFileSync(settingsPath(), JSON.stringify({ captureHotkey }, null, 2)); }
  catch (err) { console.error('[mechmark] could not save settings:', err); }
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

let mainWindow = null;
function getMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  return null;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 600,
    title: 'MechMark',
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

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.loadURL('app://bundle/index.html');
  return mainWindow;
}

// ---- App lifecycle ----
app.whenReady().then(() => {
  loadSettings();
  registerAppProtocol();
  createMainWindow();

  // Global capture hotkey (PRD §4, FR-IO-1). Phase 3 implements the overlay.
  registerHotkey(captureHotkey);

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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // Windows: quit when all windows are closed.
  if (process.platform !== 'darwin') app.quit();
});
