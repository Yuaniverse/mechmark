// ===== MechMark overlay preload (Phase 3) =====
// CommonJS (.cjs): preload scripts run in a CJS context even when the project
// is "type":"module". Exposes ONLY the curated overlay channel surface — never
// ipcRenderer or node primitives directly.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayHost', {
  // Pull this overlay's screenshot + DIP size + scaleFactor from main.
  //   -> { dataUrl, width, height, scaleFactor }
  getShot() {
    return ipcRenderer.invoke('overlay:get-shot');
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
