// ===== Circle/Ellipse mark (PRD §9 FR-MARK-3) =====
// Drag a bounding box: pointer down → drag → up. The two opposite corners
// define the box; center = box center, (rx, ry) = half extents. Holding Shift
// during the drag forces a true circle (rx === ry, using the larger extent).
// Honors solid/dashed via style.dashFor. No fill — outline only.

import { dist } from '../geom.js';
import { strokePath } from '../draw.js';
import * as style from '../style.js';

// Closest point on an axis-aligned ellipse outline (approx, by sampling) is
// overkill; we use the standard implicit-distance estimate which is accurate
// enough for hit-testing within a screen-px tolerance.
function distToEllipseOutline(o, p) {
  const dx = p.x - o.cx, dy = p.y - o.cy;
  const rx = Math.max(1e-6, Math.abs(o.rx)), ry = Math.max(1e-6, Math.abs(o.ry));
  // Gradient-corrected algebraic distance: |F| / |∇F|, F = (dx/rx)^2+(dy/ry)^2-1.
  const F = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) - 1;
  const gx = (2 * dx) / (rx * rx), gy = (2 * dy) / (ry * ry);
  const g = Math.hypot(gx, gy) || 1e-6;
  return Math.abs(F) / g;
}

function corners(o) {
  return [
    { id: 'nw', x: o.cx - o.rx, y: o.cy - o.ry },
    { id: 'ne', x: o.cx + o.rx, y: o.cy - o.ry },
    { id: 'se', x: o.cx + o.rx, y: o.cy + o.ry },
    { id: 'sw', x: o.cx - o.rx, y: o.cy + o.ry },
  ];
}

function strokeEllipse(ctx, o, env) {
  const col = o.style.color, lw = o.style.lineWidth;
  const dash = style.dashFor(o.style.lineStyle, lw);
  const rx = Math.abs(o.rx), ry = Math.abs(o.ry);
  ctx.save();
  ctx.strokeStyle = col;
  ctx.lineWidth = lw;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  ctx.setLineDash(dash || []);
  ctx.beginPath();
  ctx.ellipse(o.cx, o.cy, rx, ry, 0, 0, Math.PI * 2);
  const fill = style.fillStyleFor(o.style.fillColor, o.style.fillAlpha);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  ctx.stroke();
  ctx.restore();
}

export const type = {
  draw(ctx, o, env) { strokeEllipse(ctx, o, env); },

  bounds(o) {
    const rx = Math.abs(o.rx), ry = Math.abs(o.ry);
    return { minX: o.cx - rx, minY: o.cy - ry, maxX: o.cx + rx, maxY: o.cy + ry };
  },

  hitTest(o, p, env) {
    for (const h of type.handles(o, env)) if (dist(h, p) <= env.px(7)) return { part: 'handle', id: h.id };
    if (distToEllipseOutline(o, p) <= env.px(7)) return { part: 'body' };
    // filled shapes are selectable by clicking inside
    if (o.style.fillColor) {
      const dx = (p.x - o.cx) / Math.max(1e-6, Math.abs(o.rx)), dy = (p.y - o.cy) / Math.max(1e-6, Math.abs(o.ry));
      if (dx * dx + dy * dy <= 1) return { part: 'body' };
    }
    return null;
  },

  handles(o, env) { return corners(o); },

  // Resize by dragging a corner: the dragged corner follows the pointer, the
  // opposite corner stays fixed; center and half-extents recompute.
  moveHandle(o, id, p, env) {
    const opp = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }[id];
    const c = corners(o);
    const fixed = c.find((h) => h.id === opp);
    let nx = p.x, ny = p.y;
    o.cx = (fixed.x + nx) / 2;
    o.cy = (fixed.y + ny) / 2;
    o.rx = Math.abs(nx - fixed.x) / 2;
    o.ry = Math.abs(ny - fixed.y) / 2;
    if (env && env.shiftDown) { const r = Math.max(o.rx, o.ry); o.rx = r; o.ry = r; }
  },

  translate(o, dx, dy) { o.cx += dx; o.cy += dy; },
};

// ---- creation state machine (drag bounding box) ----
let st = null;
const reset = () => { st = null; };

function makeObj(a, b, shift) {
  let rx = Math.abs(b.x - a.x) / 2;
  let ry = Math.abs(b.y - a.y) / 2;
  if (shift) { const r = Math.max(rx, ry); rx = r; ry = r; }
  return {
    kind: 'ellipse', style: style.snapshot(false),
    cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, rx, ry,
  };
}

export const tool = {
  reset,
  onPointerDown(p, env) { st = { a: { ...p }, b: { ...p } }; },
  onPointerMove(p, env) { if (st) st.b = { ...p }; },
  onPointerUp(p, env) {
    if (!st) return;
    st.b = { ...p };
    const o = makeObj(st.a, st.b, env.shiftDown);
    reset();
    if (o.rx >= env.px(2) || o.ry >= env.px(2)) env.addObject(o);
  },
  onKeyDown(ev, env) {
    if (ev.key === 'Escape' && st) { reset(); return true; }
    return false;
  },
  drawPreview(ctx, env) {
    if (!st) return;
    const o = makeObj(st.a, st.b, env.shiftDown);
    strokeEllipse(ctx, o, env);
  },
};

export default {
  id: 'ellipse', hotkey: 'c', icon: 'ic-circle', label: '圓/橢圓', group: 3, isDimension: false,
  tool, type,
};
