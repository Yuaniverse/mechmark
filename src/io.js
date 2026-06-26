// ===== Import / export (PRD §10 FR-IO) =====
import { typeFor } from './registry.js';

// Render the annotated document to an offscreen canvas (no grid, no handles).
// Output covers the base image AND any annotations — the canvas extends beyond
// the captured screenshot to include elements placed outside it. When there's
// no captured image, output covers the annotation content bounds.
export function renderToCanvas(scene, { scale = 2, pad = 24 } = {}) {
  // Union of all annotation bounds (world space).
  let bb = null;
  for (const o of scene.objects) {
    const b = typeFor(o.kind)?.bounds?.(o);
    if (!b) continue;
    bb = bb ? { minX: Math.min(bb.minX, b.minX), minY: Math.min(bb.minY, b.minY), maxX: Math.max(bb.maxX, b.maxX), maxY: Math.max(bb.maxY, b.maxY) } : { ...b };
  }

  let minX, minY, maxX, maxY;
  if (scene.baseImage) {
    // Start from the image rect, then grow to include any out-of-image
    // annotation, padding only the extended region.
    minX = 0; minY = 0; maxX = scene.imageSize.w; maxY = scene.imageSize.h;
    if (bb) {
      minX = Math.min(minX, bb.minX - pad); minY = Math.min(minY, bb.minY - pad);
      maxX = Math.max(maxX, bb.maxX + pad); maxY = Math.max(maxY, bb.maxY + pad);
    }
  } else {
    if (!bb) bb = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
    minX = bb.minX - pad; minY = bb.minY - pad; maxX = bb.maxX + pad; maxY = bb.maxY + pad;
  }

  const w = maxX - minX, h = maxY - minY, ox = -minX, oy = -minY;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(w * scale); cv.height = Math.ceil(h * scale);
  const ctx = cv.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, ox * scale, oy * scale);
  // White backdrop covers the whole output (incl. any margin outside the image).
  ctx.fillStyle = '#ffffff'; ctx.fillRect(minX, minY, w, h);
  if (scene.baseImage) ctx.drawImage(scene.baseImage, 0, 0, scene.imageSize.w, scene.imageSize.h);

  const env = {
    px: (n) => n, accent: '#4f46e5', isSelected: () => false, typeFor,
    style: null, zoom: 1, ctx,
  };
  for (const o of scene.objects) typeFor(o.kind)?.draw?.(ctx, o, env);
  return cv;
}

export async function copyToClipboard(scene) {
  const cv = renderToCanvas(scene);
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  if (navigator.clipboard && window.ClipboardItem) {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  }
  throw new Error('Clipboard image API unavailable');
}

export function savePNG(scene, filename = 'mechmark.png') {
  const cv = renderToCanvas(scene);
  cv.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
}

// Load an image File/Blob into the scene as the base capture.
export function loadImageInto(scene, blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { scene.setImage(img, img.naturalWidth, img.naturalHeight); resolve(img); };
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}
