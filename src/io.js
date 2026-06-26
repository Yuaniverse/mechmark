// ===== Import / export (PRD §10 FR-IO) =====
import { typeFor } from './registry.js';

// Render the annotated document to an offscreen canvas (no grid, no handles).
// Output covers the base image, or the annotation content bounds when there's
// no captured image.
export function renderToCanvas(scene, { scale = 2, pad = 24 } = {}) {
  let w, h, ox = 0, oy = 0;
  if (scene.baseImage) {
    w = scene.imageSize.w; h = scene.imageSize.h;
  } else {
    let bb = null;
    for (const o of scene.objects) {
      const b = typeFor(o.kind)?.bounds?.(o);
      if (!b) continue;
      bb = bb ? { minX: Math.min(bb.minX, b.minX), minY: Math.min(bb.minY, b.minY), maxX: Math.max(bb.maxX, b.maxX), maxY: Math.max(bb.maxY, b.maxY) } : { ...b };
    }
    if (!bb) { bb = { minX: 0, minY: 0, maxX: 400, maxY: 300 }; }
    ox = pad - bb.minX; oy = pad - bb.minY;
    w = (bb.maxX - bb.minX) + pad * 2; h = (bb.maxY - bb.minY) + pad * 2;
  }
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(w * scale); cv.height = Math.ceil(h * scale);
  const ctx = cv.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, ox * scale, oy * scale);
  if (!scene.baseImage) { ctx.fillStyle = '#ffffff'; ctx.fillRect(-ox, -oy, w, h); }
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
