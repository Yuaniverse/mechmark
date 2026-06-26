// ===== MechMark overlay preload (Phase 3) =====
// CommonJS (.cjs): preload scripts run in a CJS context even when the project
// is "type":"module". Exposes ONLY the curated overlay channel surface — never
// ipcRenderer or node primitives directly.
//
// Overlay windows are POOLED and reused across captures (see capture.js), so the
// shot is PUSHED to the renderer via 'overlay:arm' each time rather than pulled
// once at load. The renderer calls ready() after wiring its listeners.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayHost', {
  // renderer -> main: overlay UI loaded and listening; safe to arm it.
  ready() {
    ipcRenderer.send('overlay:ready');
  },
  // main -> renderer: arm this overlay with its screenshot for a new capture.
  //   payload = { dataUrl, width, height, scaleFactor }
  onArm(cb) {
    ipcRenderer.on('overlay:arm', (_e, shot) => cb(shot));
  },
  // main -> renderer: capture ended; reset visual state for reuse.
  onDisarm(cb) {
    ipcRenderer.on('overlay:disarm', () => cb());
  },
  // Commit a selection. rect = { x, y, w, h } in CSS/DIP px, relative to this
  // overlay/display top-left.
  commit(rect) {
    ipcRenderer.send('overlay:commit', { rect });
  },
  // Cancel the whole capture session.
  cancel() {
    ipcRenderer.send('overlay:cancel');
  },
});
