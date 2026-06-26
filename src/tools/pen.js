// ===== Ballpoint pen (freehand) — FR-MARK (added) =====
// Pointer down → drag → up draws a smoothed freehand stroke. Solid, opaque,
// honours the current style (colour / line width / solid·dashed).

import { dist, distToSegment, bboxOf } from '../geom.js';
import * as style from '../style.js';

// Smoothed freehand: quadratic curves through the midpoints of consecutive
// points (cheap Catmull-Rom-ish smoothing). A single point renders as a dot.
function strokeSmooth(ctx, pts) {
  ctx.beginPath();
  if (pts.length === 1) {
    ctx.arc(pts[0].x, pts[0].y, Math.max(0.5, ctx.lineWidth / 2), 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle; ctx.fill();
    return;
  }
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  ctx.stroke();
}

function render(ctx, o) {
  const pts = o.points;
  if (!pts || !pts.length) return;
  ctx.save();
  ctx.strokeStyle = o.style.color;
  ctx.lineWidth = o.style.lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(style.dashFor(o.style.lineStyle, o.style.lineWidth) || []);
  strokeSmooth(ctx, pts);
  ctx.restore();
}

export const type = {
  draw(ctx, o) { render(ctx, o); },
  bounds(o) { return bboxOf(o.points); },
  hitTest(o, p, env) {
    const tol = env.px(6) + o.style.lineWidth / 2;
    const pts = o.points;
    if (pts.length === 1) return dist(pts[0], p) <= tol ? { part: 'body' } : null;
    for (let i = 0; i < pts.length - 1; i++) if (distToSegment(p, pts[i], pts[i + 1]) <= tol) return { part: 'body' };
    return null;
  },
  handles() { return []; }, // freehand: move/delete as a whole, no vertex editing
  translate(o, dx, dy) { o.points = o.points.map((q) => ({ x: q.x + dx, y: q.y + dy })); },
};

let st = null;
const reset = () => { st = null; };

export const tool = {
  reset,
  onPointerDown(p) { st = { points: [{ ...p }] }; },
  onPointerMove(p) {
    if (!st) return;
    const last = st.points[st.points.length - 1];
    if (dist(last, p) >= 1.2) st.points.push({ ...p }); // thin out near-duplicate samples
  },
  onPointerUp(p, env) {
    if (!st) return;
    const pts = st.points;
    reset();
    if (pts.length) env.addObject({ kind: 'pen', style: style.snapshot(false), points: pts });
  },
  onKeyDown(ev) { if (ev.key === 'Escape' && st) { reset(); return true; } return false; },
  drawPreview(ctx, env) { if (st) render(ctx, { style: style.snapshot(false), points: st.points }); },
};

export default { id: 'pen', hotkey: 'p', icon: 'ic-pen', label: '鋼珠筆', group: 3, isDimension: false, tool, type };
