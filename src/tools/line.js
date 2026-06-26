// ===== Straight line mark =====
// PowerPoint-style: drag from start to end. Hold Shift while dragging (or while
// dragging an endpoint) to constrain to 15° increments — pure H/V "正交" plus
// the 45° diagonals. A line is an arrow without the arrowhead.

import { dist, distToSegment, snapAngle } from '../geom.js';
import { strokePath } from '../draw.js';
import * as style from '../style.js';

function render(ctx, o) {
  const dash = style.dashFor(o.style.lineStyle, o.style.lineWidth);
  strokePath(ctx, [o.a, o.b], { color: o.style.color, width: o.style.lineWidth, dash });
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
  moveHandle(o, id, p, env) {
    // Shift constrains the dragged endpoint relative to the fixed one (#1).
    const fixed = id === 'a' ? o.b : o.a;
    o[id] = env?.shiftDown ? snapAngle(fixed, p) : { x: p.x, y: p.y };
  },
  translate(o, dx, dy) { o.a = { x: o.a.x + dx, y: o.a.y + dy }; o.b = { x: o.b.x + dx, y: o.b.y + dy }; },
};

let st = null;
const reset = () => { st = null; };

const endPoint = (env, p) => (env.shiftDown ? snapAngle(st.a, p) : { ...p });

export const tool = {
  reset,
  onPointerDown(p) { st = { a: { ...p }, b: { ...p } }; },
  onPointerMove(p, env) { if (st) st.b = endPoint(env, p); },
  onPointerUp(p, env) {
    if (!st) return;
    st.b = endPoint(env, p);
    const o = { kind: 'line', style: style.snapshot(false), a: st.a, b: st.b };
    reset();
    if (dist(o.a, o.b) >= env.px(4)) env.addObject(o);
  },
  onKeyDown(ev) { if (ev.key === 'Escape' && st) { reset(); return true; } return false; },
  drawPreview(ctx) { if (st && dist(st.a, st.b) > 0.5) render(ctx, { style: style.snapshot(false), a: st.a, b: st.b }); },
};

export default { id: 'line', hotkey: 'i', icon: 'ic-line', label: '直線', group: 3, isDimension: false, tool, type };
