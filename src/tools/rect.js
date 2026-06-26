// ===== Rectangle mark (PRD §9 FR-MARK-2) =====
// Drag a bounding box. Solid/dashed via style.dashFor. Outline only.

import { dist, distToSegment } from '../geom.js';
import * as style from '../style.js';

// Normalized {x,y,w,h} with positive w/h.
function norm(o) {
  return { x: Math.min(o.x, o.x + o.w), y: Math.min(o.y, o.y + o.h), w: Math.abs(o.w), h: Math.abs(o.h) };
}
function corners(o) {
  const n = norm(o);
  return [
    { id: 'nw', x: n.x, y: n.y },
    { id: 'ne', x: n.x + n.w, y: n.y },
    { id: 'se', x: n.x + n.w, y: n.y + n.h },
    { id: 'sw', x: n.x, y: n.y + n.h },
  ];
}
function edges(o) {
  const c = corners(o);
  return [[c[0], c[1]], [c[1], c[2]], [c[2], c[3]], [c[3], c[0]]];
}

function render(ctx, o) {
  const n = norm(o), lw = o.style.lineWidth;
  ctx.save();
  const fill = style.fillStyleFor(o.style.fillColor, o.style.fillAlpha);
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(n.x, n.y, n.w, n.h); }
  ctx.strokeStyle = o.style.color;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'miter';
  ctx.setLineDash(style.dashFor(o.style.lineStyle, lw) || []);
  ctx.strokeRect(n.x, n.y, n.w, n.h);
  ctx.restore();
}

export const type = {
  draw(ctx, o) { render(ctx, o); },
  bounds(o) { const n = norm(o); return { minX: n.x, minY: n.y, maxX: n.x + n.w, maxY: n.y + n.h }; },
  hitTest(o, p, env) {
    for (const h of corners(o)) if (dist(h, p) <= env.px(7)) return { part: 'handle', id: h.id };
    for (const [a, b] of edges(o)) if (distToSegment(p, a, b) <= env.px(7)) return { part: 'body' };
    const n = norm(o);
    if (p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h) return { part: 'body' };
    return null;
  },
  handles(o) { return corners(o); },
  moveHandle(o, id, p) {
    const opp = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }[id];
    const fixed = corners(o).find((c) => c.id === opp);
    o.x = fixed.x; o.y = fixed.y; o.w = p.x - fixed.x; o.h = p.y - fixed.y;
  },
  translate(o, dx, dy) { o.x += dx; o.y += dy; },
};

let st = null;
const reset = () => { st = null; };

export const tool = {
  reset,
  onPointerDown(p) { st = { a: { ...p }, b: { ...p } }; },
  onPointerMove(p) { if (st) st.b = { ...p }; },
  onPointerUp(p, env) {
    if (!st) return;
    st.b = { ...p };
    const o = { kind: 'rect', style: style.snapshot(false), x: st.a.x, y: st.a.y, w: st.b.x - st.a.x, h: st.b.y - st.a.y };
    reset();
    if (Math.abs(o.w) >= env.px(3) && Math.abs(o.h) >= env.px(3)) env.addObject(o);
  },
  onKeyDown(ev) { if (ev.key === 'Escape' && st) { reset(); return true; } return false; },
  drawPreview(ctx) {
    if (!st) return;
    render(ctx, { style: style.snapshot(false), x: st.a.x, y: st.a.y, w: st.b.x - st.a.x, h: st.b.y - st.a.y });
  },
};

export default { id: 'rect', hotkey: 'r', icon: 'ic-rect', label: '矩形', group: 3, isDimension: false, tool, type };
