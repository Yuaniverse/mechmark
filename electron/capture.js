// ===== MechMark capture module (Phase 3) =====
// ESM — matches electron/main.js, which does `await import('./capture.js')`
// and calls `mod.startCapture(getMainWindow())`.
//
// Flow (PRD §4, FR-IO-1 / FR-IO-5):
//   1. Enumerate displays + grab a native-resolution screenshot of each via
//      desktopCapturer.
//   2. Spawn one frameless transparent fullscreen overlay BrowserWindow per
//      display, positioned at that display's DIP bounds.
//   3. Each overlay pulls its own screenshot + scaleFactor through the
//      'overlay:get-shot' invoke handler (keyed by the asking BrowserWindow).
//   4. On 'overlay:commit', crop the DEVICE-pixel nativeImage by the DIP rect
//      scaled by that display's scaleFactor, send the PNG to the main window,
//      tear down every overlay, refocus main.
//   5. On 'overlay:cancel', just tear down + refocus.
//
// Robust to multiple overlays open across monitors: a single in-flight session
// owns all overlays; the first commit/cancel wins and closes the rest.
import { BrowserWindow, desktopCapturer, ipcMain, screen, nativeImage } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Only one capture session may be live at a time.
let session = null;

/**
 * Per-overlay record. `shot` carries everything the overlay needs to render
 * and everything we need to crop correctly.
 *   shot.image       — nativeImage at DEVICE pixels (full display screenshot)
 *   shot.dataUrl     — PNG data URL of the above (handed to the renderer)
 *   shot.scaleFactor — display.scaleFactor (DIP -> device multiplier)
 *   shot.width/height— DIP (CSS) size of the display = bounds.width/height
 */

/** Map app:// URL for an overlay file under electron/. */
function overlayUrl() {
  return 'app://bundle/electron/overlay.html';
}

/**
 * Build the per-display shot record from a matched source. The effective
 * device-pixel scale is derived from the ACTUAL returned image size, NOT from
 * display.scaleFactor: desktopCapturer scales each thumbnail to fit the shared
 * box while preserving aspect, and Windows fractional scaling means
 * image.width !== round(bounds.width * scaleFactor) in general. Per-axis sx/sy
 * naturally handle upscaling, letterboxing, and fractional DPI.
 */
function makeShot(d, image) {
  const sz = image.getSize(); // device pixels (whatever the capturer returned)
  const sx = d.bounds.width > 0 ? sz.width / d.bounds.width : 1;
  const sy = d.bounds.height > 0 ? sz.height / d.bounds.height : 1;
  return {
    image,
    dataUrl: image.toDataURL(),
    scaleFactor: d.scaleFactor || 1, // kept only for the overlay px readout
    sx, // device-pixels-per-DIP, X axis (true crop scale)
    sy, // device-pixels-per-DIP, Y axis (true crop scale)
    width: d.bounds.width, // DIP
    height: d.bounds.height, // DIP
    bounds: d.bounds,
  };
}

/**
 * Enumerate displays and capture each at native (device-pixel) resolution.
 * Returns a Map<display.id(number), shot>.
 */
async function captureDisplays() {
  const displays = screen.getAllDisplays();

  // desktopCapturer thumbnailSize must be large enough to hold the largest
  // display at its native (device-pixel) resolution, else the screenshot is
  // downscaled and the crop math loses fidelity. NOTE: a shared box only
  // guarantees NATIVE size for the largest display; smaller/different-aspect
  // displays come back upscaled or letterboxed. We therefore never assume the
  // returned image equals bounds*scaleFactor — the crop scale (sx/sy) is
  // derived from the actual returned image size in makeShot().
  let maxW = 0;
  let maxH = 0;
  for (const d of displays) {
    const sf = d.scaleFactor || 1;
    maxW = Math.max(maxW, Math.round(d.bounds.width * sf));
    maxH = Math.max(maxH, Math.round(d.bounds.height * sf));
  }

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: maxW, height: maxH },
  });

  const byDisplayId = new Map();
  const usedSources = new Set();

  // Primary match: source.display_id === String(display.id).
  for (const d of displays) {
    const src = sources.find(
      (s) => s.display_id && s.display_id === String(d.id) && !usedSources.has(s),
    );
    if (!src) continue;
    const image = src.thumbnail;
    if (!image) continue;
    usedSources.add(src);
    byDisplayId.set(d.id, makeShot(d, image));
  }

  // Fallback: display_id is frequently empty/unreliable on Windows GPU/driver
  // and remote-desktop configs. For any display still unmatched, pair it with a
  // remaining source. Special-case the common single-display setup (exactly one
  // display + one screen source) so it always pairs regardless of display_id.
  const unmatchedDisplays = displays.filter((d) => !byDisplayId.has(d.id));
  if (unmatchedDisplays.length > 0) {
    const remaining = sources.filter((s) => !usedSources.has(s) && s.thumbnail);

    if (unmatchedDisplays.length === 1 && remaining.length === 1) {
      const d = unmatchedDisplays[0];
      const src = remaining[0];
      usedSources.add(src);
      byDisplayId.set(d.id, makeShot(d, src.thumbnail));
    } else if (remaining.length > 0) {
      // Match each unmatched display to the remaining source whose thumbnail
      // aspect ratio is closest, then (tie-break) closest in pixel area. This
      // tracks desktopCapturer's source order well enough on the empty-id path.
      for (const d of unmatchedDisplays) {
        const targetAspect = d.bounds.width / Math.max(1, d.bounds.height);
        let best = null;
        let bestScore = Infinity;
        for (const s of remaining) {
          if (usedSources.has(s)) continue;
          const sz = s.thumbnail.getSize();
          const aspect = sz.width / Math.max(1, sz.height);
          const score = Math.abs(aspect - targetAspect);
          if (score < bestScore) { bestScore = score; best = s; }
        }
        if (best) {
          usedSources.add(best);
          byDisplayId.set(d.id, makeShot(d, best.thumbnail));
        }
      }
    }
  }

  return { displays, byDisplayId };
}

/** Tear down all overlays and refocus the main window. Idempotent. */
function endSession() {
  if (!session) return;
  const s = session;
  session = null; // clear first so late IPC is ignored

  for (const rec of s.overlays) {
    const w = rec.win;
    if (w && !w.isDestroyed()) {
      try { w.close(); } catch { /* ignore */ }
    }
  }

  const main = s.mainWindow;
  if (main && !main.isDestroyed()) {
    if (main.isMinimized()) main.restore();
    main.show();
    main.focus();
  }
}

/**
 * Commit a selection: DPI-correct crop, then deliver to the main window.
 * rect is in CSS/DIP px relative to the committing overlay's top-left.
 */
function commitSelection(rec, rect) {
  if (!session) return;
  const main = session.mainWindow;
  const shot = rec.shot;

  const imgSize = shot.image.getSize(); // device pixels

  // DIP -> device pixels. (FR-IO-5: the nativeImage is in DEVICE pixels; the
  // overlay rect is in DIP/CSS pixels.) Use the ACTUAL image-to-DIP ratio
  // (sx/sy, derived from the returned image in makeShot) instead of the
  // OS-reported scaleFactor, so the crop is correct under fractional Windows
  // scaling and for thumbnails that were upscaled/letterboxed by the capturer.
  const sx = shot.sx || shot.scaleFactor || 1;
  const sy = shot.sy || shot.scaleFactor || 1;
  // Round the edges, not offset+extent independently, so the right/bottom edge
  // stays put and the cropped size matches the overlay's px readout exactly.
  let dx = Math.round(rect.x * sx);
  let dy = Math.round(rect.y * sy);
  let dw = Math.round((rect.x + rect.w) * sx) - dx;
  let dh = Math.round((rect.y + rect.h) * sy) - dy;

  // Clamp to image bounds so crop() never throws on a 1px overshoot.
  if (dx < 0) { dw += dx; dx = 0; }
  if (dy < 0) { dh += dy; dy = 0; }
  if (dx + dw > imgSize.width) dw = imgSize.width - dx;
  if (dy + dh > imgSize.height) dh = imgSize.height - dy;

  if (dw <= 0 || dh <= 0) { endSession(); return; }

  const cropped = shot.image.crop({ x: dx, y: dy, width: dw, height: dh });
  const dataUrl = cropped.toDataURL();

  // Deliver before teardown so the renderer is guaranteed the message.
  if (main && !main.isDestroyed()) {
    main.webContents.send('mechmark:capture', dataUrl);
  }
  endSession();
}

// ---- IPC handlers (installed once, guarded by `session`) ----
let ipcInstalled = false;
function installIpc() {
  if (ipcInstalled) return;
  ipcInstalled = true;

  // Overlay asks for its screenshot. Key by the asking BrowserWindow so each
  // overlay gets ITS display's shot + scaleFactor.
  ipcMain.handle('overlay:get-shot', (event) => {
    if (!session) return null;
    const win = BrowserWindow.fromWebContents(event.sender);
    const rec = session.overlays.find((r) => r.win === win);
    if (!rec) return null;
    const shot = rec.shot;
    return {
      dataUrl: shot.dataUrl,
      width: shot.width, // DIP
      height: shot.height, // DIP
      scaleFactor: shot.scaleFactor,
    };
  });

  ipcMain.on('overlay:commit', (event, payload) => {
    if (!session) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    const rec = session.overlays.find((r) => r.win === win);
    if (!rec || !payload || !payload.rect) { endSession(); return; }
    commitSelection(rec, payload.rect);
  });

  ipcMain.on('overlay:cancel', () => {
    if (!session) return;
    endSession();
  });
}

/**
 * Entry point invoked by electron/main.js.
 * @param {import('electron').BrowserWindow|null} mainWindow
 */
export async function startCapture(mainWindow) {
  // Re-entrancy guard: if a capture is already in progress, ignore.
  if (session) return;
  installIpc();

  const { displays, byDisplayId } = await captureDisplays();
  if (byDisplayId.size === 0) {
    console.warn('[mechmark] capture: no display screenshots available.');
    // Surface a user-visible error instead of failing silently (e.g. when
    // every source.display_id was empty AND the aspect fallback found nothing).
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send(
        'mechmark:capture-error',
        'Screen capture failed: no display could be matched to a capture source. ' +
          'This can happen on some GPU/driver or remote-desktop configurations.',
      );
    }
    return;
  }

  // Hide the main window so it is not part of the frozen capture surface and
  // does not steal the overlay's always-on-top z-order.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }

  session = { mainWindow, overlays: [] };

  for (const d of displays) {
    const shot = byDisplayId.get(d.id);
    if (!shot) continue;

    const win = new BrowserWindow({
      x: d.bounds.x,
      y: d.bounds.y,
      width: d.bounds.width,
      height: d.bounds.height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      enableLargerThanScreen: true,
      // Frameless transparent windows must not paint the OS background.
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        preload: join(__dirname, 'overlay-preload.cjs'),
      },
    });

    // Navigation hardening: deny window.open and block navigation away from the
    // trusted app://bundle/ origin (overlays run a preload with sandbox:false).
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith('app://bundle/')) e.preventDefault();
    });

    // Keep it pinned above everything (including fullscreen apps) on Windows.
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    const rec = { win, shot, display: d };
    session.overlays.push(rec);

    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return;
      // Exact placement (DIP bounds) — reassert in case the OS nudged it.
      win.setBounds(d.bounds);
      win.show();
      win.focus();
    });

    // If the OS closes an overlay out from under us, treat as cancel.
    win.on('closed', () => {
      if (session && session.overlays.some((r) => r.win === win)) {
        // Only auto-cancel if this wasn't part of an intentional teardown.
        // endSession() nulls `session`, so reaching here with a live session
        // means an unexpected close.
        endSession();
      }
    });

    win.loadURL(overlayUrl());
  }

  // Edge case: every source failed to produce a window.
  if (session.overlays.length === 0) {
    endSession();
    if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
  }
}
