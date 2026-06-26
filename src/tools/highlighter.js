// ===== Highlighter (freehand) — FR-MARK (added) =====
// Wide, translucent, multiply-blended freehand stroke — tints whatever is
// underneath (image/annotations) like a real highlighter. Colour from the
// current style (pick 黃 from the palette for the classic look); width is a
// multiple of the current line width so it reads as a broad marker.

import { dist, distToSegment, bboxOf } from '../geom.js';
import * as style from '../style.js';

const HL_ALPHA = 0.4;
// The highlighter keeps its own remembered colour + width (default 黃, 5).
function hlSnapshot() {
  const s = style.snapshot(false);
  s.color = style.current.hlColor;
  s.lineWidth = style.current.hlWidth;
  return s;
}

function strokeSmooth(ctx, pts) {
  ctx.beginPath();
  if (pts.length === 1) {
    ctx.arc(pts[0].x, pts[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
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
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = HL_ALPHA;
  ctx.strokeStyle = o.style.color;
  ctx.lineWidth = Math.max(2, o.style.lineWidth);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  strokeSmooth(ctx, pts);
  ctx.restore();
}

export const type = {
  draw(ctx, o) { render(ctx, o); },
  bounds(o) { return bboxOf(o.points); },
  hitTest(o, p, env) {
    const tol = env.px(4) + Math.max(2, o.style.lineWidth) / 2;
    const pts = o.points;
    if (pts.length === 1) return dist(pts[0], p) <= tol ? { part: 'body' } : null;
    for (let i = 0; i < pts.length - 1; i++) if (distToSegment(p, pts[i], pts[i + 1]) <= tol) return { part: 'body' };
    return null;
  },
  handles() { return []; },
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
    if (dist(last, p) >= 1.5) st.points.push({ ...p });
  },
  onPointerUp(p, env) {
    if (!st) return;
    const pts = st.points;
    reset();
    if (pts.length) env.addObject({ kind: 'highlighter', style: hlSnapshot(), points: pts });
  },
  onKeyDown(ev) { if (ev.key === 'Escape' && st) { reset(); return true; } return false; },
  drawPreview(ctx, env) { if (st) render(ctx, { style: hlSnapshot(), points: st.points }); },
};

export default { id: 'highlighter', hotkey: 'h', icon: 'ic-highlighter', label: '螢光筆', group: 3, isDimension: false, tool, type };
