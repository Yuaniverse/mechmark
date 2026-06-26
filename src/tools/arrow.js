// ===== Arrow mark (PRD §9 FR-MARK-1) =====
// Drag to draw: pointer down at tail → drag → up at head. Reversible by
// dragging the head endpoint past the tail, or via type.reverse().

import { sub, add, scale, norm, dist, distToSegment, angleOf } from '../geom.js';
import { strokePath, drawIsoArrow, arrowLen } from '../draw.js';
import * as style from '../style.js';

function render(ctx, o) {
  const col = o.style.color, lw = o.style.lineWidth;
  const dash = style.dashFor(o.style.lineStyle, lw);
  const aL = arrowLen(lw), dir = norm(sub(o.b, o.a));
  // stop the shaft at the arrowhead base so the (thick) line never swallows the
  // sharp tip — keeps the point crisp at any line width (#2)
  const cut = Math.min(0.72 * aL, dist(o.a, o.b) * 0.5);
  strokePath(ctx, [o.a, add(o.b, scale(dir, -cut))], { color: col, width: lw, dash });
  drawIsoArrow(ctx, o.b, angleOf(dir), aL, col);
}

export const type = {
  draw(ctx, o) { render(ctx, o); },
  bounds(o) {
    return { minX: Math.min(o.a.x, o.b.x), minY: Math.min(o.a.y, o.b.y), maxX: Math.max(o.a.x, o.b.x), maxY: Math.max(o.a.y, o.b.y) };
  },
  hitTest(o, p, env) {
    for (const h of type.handles(o)) if (dist(h, p) <= env.px(7)) return { part: 'handle', id: h.id };
    if (distToSegment(p, o.a, o.b) <= env.px(7)) return { part: 'body' };
    return null;
  },
  handles(o) { return [{ id: 'a', x: o.a.x, y: o.a.y }, { id: 'b', x: o.b.x, y: o.b.y }]; },
  moveHandle(o, id, p) { o[id] = { x: p.x, y: p.y }; },
  translate(o, dx, dy) { o.a = { x: o.a.x + dx, y: o.a.y + dy }; o.b = { x: o.b.x + dx, y: o.b.y + dy }; },
  reverse(o) { const t = o.a; o.a = o.b; o.b = t; },
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
    const o = { kind: 'arrow', style: style.snapshot(false), a: st.a, b: st.b };
    reset();
    if (dist(o.a, o.b) >= env.px(4)) env.addObject(o);
  },
  onKeyDown(ev) { if (ev.key === 'Escape' && st) { reset(); return true; } return false; },
  drawPreview(ctx) { if (st && dist(st.a, st.b) > 0.5) render(ctx, { style: style.snapshot(false), a: st.a, b: st.b }); },
};

export default { id: 'arrow', hotkey: 'a', icon: 'ic-arrow', label: '箭頭', group: 3, isDimension: false, tool, type };
