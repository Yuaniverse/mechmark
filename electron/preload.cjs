// ===== MechMark renderer host bridge (Phase 2) =====
// Exposes a minimal, safe API to the page. Never expose ipcRenderer or node
// primitives directly — only the curated surface below.
// CommonJS (.cjs): preload scripts run in a CJS context even when the project
// is "type":"module".
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mechmarkHost', {
  isElectron: true,
  platform: process.platform,
  // main → renderer: a captured screenshot arrives as a PNG data: URL.
  onCapture(cb) {
    ipcRenderer.on('mechmark:capture', (_e, dataUrl) => cb(dataUrl));
  },
  // main → renderer: a capture attempt failed (e.g. no source matched a display).
  onCaptureError(cb) {
    ipcRenderer.on('mechmark:capture-error', (_e, message) => cb(message));
  },
  // renderer → main: optionally trigger a capture (same as the global hotkey).
  requestCapture() {
    ipcRenderer.send('mechmark:request-capture');
  },
  // Capture-hotkey customization. getHotkey() -> current accelerator string;
  // setHotkey(accel) -> { ok, hotkey } (ok:false if the combo is already taken).
  getHotkey() {
    return ipcRenderer.invoke('mechmark:get-hotkey');
  },
  setHotkey(accelerator) {
    return ipcRenderer.invoke('mechmark:set-hotkey', accelerator);
  },
  // Launch-at-login toggle. getStartOnBoot() -> boolean (current OS state);
  // setStartOnBoot(enabled) -> boolean (resulting state).
  getStartOnBoot() {
    return ipcRenderer.invoke('mechmark:get-start-on-boot');
  },
  setStartOnBoot(enabled) {
    return ipcRenderer.invoke('mechmark:set-start-on-boot', enabled);
  },
});
