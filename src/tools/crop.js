// ===== Crop tool (裁切) =====
// Drag a rectangle over the base image to crop it to that region. The cut-away
// part of the image is dimmed during the drag. On release the base image is
// replaced by the cropped bitmap and every annotation is shifted so it stays
// aligned. The cropped content keeps its on-screen position (pan is adjusted),
// and the whole operation is a single undo step.

function normRect(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

let st = null;
const reset = () => { st = null; };

function doCrop(env, r) {
  const scene = env.scene;
  if (!scene.baseImage) return; // nothing to crop without a captured image
  const { w: iw, h: ih } = scene.imageSize;
  // Clamp the crop rect to the image; round to whole device pixels.
  const x = Math.round(Math.max(0, Math.min(iw, r.x)));
  const y = Math.round(Math.max(0, Math.min(ih, r.y)));
  const x2 = Math.round(Math.max(0, Math.min(iw, r.x + r.w)));
  const y2 = Math.round(Math.max(0, Math.min(ih, r.y + r.h)));
  const cw = x2 - x, ch = y2 - y;
  if (cw < 2 || ch < 2) return;

  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  cv.getContext('2d').drawImage(scene.baseImage, x, y, cw, ch, 0, 0, cw, ch);

  scene.commit(); // snapshot original image + object positions for undo
  for (const o of scene.objects) env.typeFor(o.kind)?.translate?.(o, -x, -y);
  scene.setImage(cv, cw, ch);
  // The old world point (x, y) is now the origin — shift pan so the kept region
  // doesn't jump on screen.
  env.view.panX += x * env.zoom;
  env.view.panY += y * env.zoom;
  env.requestRender();
  env.setTool?.('select');
}

export const tool = {
  reset,
  onPointerDown(p) { st = { a: { ...p }, b: { ...p } }; },
  onPointerMove(p) { if (st) st.b = { ...p }; },
  onPointerUp(p, env) {
    if (!st) return;
    st.b = { ...p };
    const r = normRect(st.a, st.b);
    reset();
    if (r.w >= env.px(5) && r.h >= env.px(5)) doCrop(env, r);
  },
  onKeyDown(ev) { if (ev.key === 'Escape' && st) { reset(); return true; } return false; },
  drawPreview(ctx, env) {
    if (!st) return;
    const r = normRect(st.a, st.b);
    if (r.w < 1 && r.h < 1) return; // nothing dragged yet — don't dim the image
    ctx.save();
    // Dim the portion of the image that will be cut away (interior stays bright).
    if (env.scene.baseImage) {
      const { w, h } = env.scene.imageSize;
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = 'rgba(15,23,42,0.45)';
      ctx.fill('evenodd');
    }
    ctx.strokeStyle = env.accent;
    ctx.lineWidth = env.px(1.5);
    ctx.setLineDash([env.px(5), env.px(4)]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  },
};

export default { id: 'crop', hotkey: 'x', icon: 'ic-crop', label: '裁切', group: 0, isDimension: false, tool };
