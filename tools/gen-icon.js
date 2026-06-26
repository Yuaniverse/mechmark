// ===== MechMark icon generator =====
// Renders the app icon with an offscreen Chromium <canvas> (anti-aliased
// gradients, glow, rounded joins) — far higher quality than hand-rolled pixels —
// then emits every size the app needs:
//
//   electron/app-icon.png   256  — runtime window / taskbar icon (in the asar)
//   electron/tray-icon.png   32  — system-tray glyph (simplified, legible tiny)
//   build/icon.ico       multi   — electron-builder installer / exe icon
//   build/icon.png          512  — generic large icon
//
// Design: dark rounded tile + teal glow, a white screenshot crop-frame (corner
// brackets) wrapping a teal dimension double-arrow — "capture + measure".
//
// MUST run under Electron (needs a real canvas):  npx electron tools/gen-icon.js
import { app, BrowserWindow, nativeImage } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ---- The drawing code, run INSIDE the page (returns a PNG data URL) ----
// `kind` = 'app' (full icon) or 'tray' (simplified small glyph). Drawn in a
// 1024-unit space scaled to `size`.
const DRAW = `
(function (size, kind) {
  const k = size / 1024;
  const P = (v) => v * k;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const x = c.getContext('2d');

  // --- rounded tile clip ---
  const R = P(kind === 'tray' ? 200 : 224);
  x.beginPath();
  x.roundRect(0, 0, size, size, R);
  x.clip();

  // --- background gradient ---
  const bg = x.createLinearGradient(0, 0, 0, size);
  bg.addColorStop(0, '#17262f');
  bg.addColorStop(0.55, '#0e1922');
  bg.addColorStop(1, '#080f15');
  x.fillStyle = bg;
  x.fillRect(0, 0, size, size);

  // --- top sheen ---
  const sheen = x.createLinearGradient(0, 0, 0, size * 0.5);
  sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = sheen;
  x.fillRect(0, 0, size, size * 0.5);

  // --- teal glow behind the glyph ---
  const glow = x.createRadialGradient(P(512), P(470), P(40), P(512), P(470), P(420));
  glow.addColorStop(0, 'rgba(70,224,207,0.45)');
  glow.addColorStop(0.5, 'rgba(54,170,180,0.16)');
  glow.addColorStop(1, 'rgba(70,224,207,0)');
  x.fillStyle = glow;
  x.fillRect(0, 0, size, size);

  // --- inner hairline highlight on the tile edge ---
  x.lineWidth = Math.max(1, P(3));
  x.strokeStyle = 'rgba(255,255,255,0.08)';
  x.beginPath();
  x.roundRect(P(6), P(6), size - P(12), size - P(12), R - P(6));
  x.stroke();

  const teal = (ctx, x1, y1, x2, y2) => {
    const g = ctx.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0, '#5cf0dc');
    g.addColorStop(1, '#27aebf');
    return g;
  };

  if (kind === 'tray') {
    // Simplified, high-contrast target — legible at 16px.
    x.lineCap = 'round'; x.lineJoin = 'round';
    x.strokeStyle = teal(x, P(300), P(300), P(724), P(724));
    x.lineWidth = P(70);
    x.beginPath(); x.arc(P(512), P(512), P(250), 0, Math.PI * 2); x.stroke();
    x.strokeStyle = '#f4f9fb';
    x.lineWidth = P(70);
    x.beginPath();
    x.moveTo(P(512), P(150)); x.lineTo(P(512), P(874));
    x.moveTo(P(150), P(512)); x.lineTo(P(874), P(512));
    x.stroke();
    return c.toDataURL('image/png');
  }

  // ---- App icon glyph ----
  // White crop-frame corner brackets (with a soft drop shadow for depth).
  x.save();
  x.shadowColor = 'rgba(0,0,0,0.38)';
  x.shadowBlur = P(26);
  x.shadowOffsetY = P(10);
  x.lineCap = 'round'; x.lineJoin = 'round';
  x.strokeStyle = '#f4f9fb';
  x.lineWidth = P(40);
  const A = 250, B = 774, L = 116; // frame box [A,B], arm length L
  const bracket = (cx, cy, sx, sy) => {
    x.beginPath();
    x.moveTo(P(cx + sx * L), P(cy));
    x.lineTo(P(cx), P(cy));
    x.lineTo(P(cx), P(cy + sy * L));
    x.stroke();
  };
  bracket(A, A, +1, +1);
  bracket(B, A, -1, +1);
  bracket(A, B, +1, -1);
  bracket(B, B, -1, -1);
  x.restore();

  // Teal dimension double-arrow across the centre.
  const y = 512, x1 = 372, x2 = 652;
  x.strokeStyle = teal(x, P(x1), y, P(x2), y);
  x.fillStyle = teal(x, P(x1), y, P(x2), y);
  x.lineCap = 'round';
  x.lineWidth = P(30);
  const head = 58, hw = 40; // arrowhead length / half-width
  x.beginPath();
  x.moveTo(P(x1 + head), P(y));
  x.lineTo(P(x2 - head), P(y));
  x.stroke();
  const arrow = (tipX, dir) => {
    x.beginPath();
    x.moveTo(P(tipX), P(y));
    x.lineTo(P(tipX + dir * head), P(y - hw));
    x.lineTo(P(tipX + dir * head), P(y + hw));
    x.closePath();
    x.fill();
  };
  arrow(x1, +1);
  arrow(x2, -1);

  return c.toDataURL('image/png');
})
`;

function dataUrlToPng(dataUrl) {
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

// ---- Minimal ICO writer: container of PNG-encoded images (Vista+) ----
function buildIco(images /* [{size, png}] */) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const blobs = [];
  images.forEach((img, i) => {
    const b = i * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, b + 0); // width (0 == 256)
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, b + 1); // height
    dir.writeUInt8(0, b + 2);  // palette
    dir.writeUInt8(0, b + 3);  // reserved
    dir.writeUInt16LE(1, b + 4);   // color planes
    dir.writeUInt16LE(32, b + 6);  // bits per pixel
    dir.writeUInt32LE(img.png.length, b + 8);  // size of PNG data
    dir.writeUInt32LE(offset, b + 12);         // offset
    offset += img.png.length;
    blobs.push(img.png);
  });
  return Buffer.concat([header, dir, ...blobs]);
}

async function render(win, kind, size) {
  const dataUrl = await win.webContents.executeJavaScript(`(${DRAW})(${size}, ${JSON.stringify(kind)})`);
  return nativeImage.createFromDataURL(dataUrl);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 64, height: 64, show: false,
    webPreferences: { offscreen: false },
  });
  await win.loadURL('data:text/html,<!doctype html><meta charset=utf-8><body></body>');

  // Master app icon at 1024, then downscale to every target size.
  const master = await render(win, 'app', 1024);
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoImages = icoSizes.map((s) => ({
    size: s,
    png: master.resize({ width: s, height: s, quality: 'best' }).toPNG(),
  }));

  mkdirSync(join(ROOT, 'build'), { recursive: true });
  writeFileSync(join(ROOT, 'build', 'icon.ico'), buildIco(icoImages));
  writeFileSync(join(ROOT, 'build', 'icon.png'), master.resize({ width: 512, height: 512, quality: 'best' }).toPNG());
  writeFileSync(join(ROOT, 'electron', 'app-icon.png'), master.resize({ width: 256, height: 256, quality: 'best' }).toPNG());

  // Tray glyph rendered from its own simplified design (legible tiny).
  const trayMaster = await render(win, 'tray', 256);
  writeFileSync(join(ROOT, 'electron', 'tray-icon.png'), trayMaster.resize({ width: 32, height: 32, quality: 'best' }).toPNG());

  console.log('icons written: build/icon.ico, build/icon.png, electron/app-icon.png, electron/tray-icon.png');
  win.destroy();
  app.quit();
}).catch((err) => {
  console.error('icon generation failed:', err);
  app.exit(1);
});
