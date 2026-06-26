// ===== Radius dimension (PRD §8 FR-CIRC, §8.2) — three-point circle fit =====
// S1,S2,S3 click circle points → circumscribed circle. S4 move sets the leader
// angle → click locks → number auto-prefixed 'R'. Fit points stay draggable.

import { sub, add, scale, norm, dist, angleOf, fromAngle, circleFrom3Points } from '../geom.js';
import { strokePath, drawIsoArrow, arrowLen, drawLabel, measureLabel } from '../draw.js';
import * as style from '../style.js';

function fit(o) { return circleFrom3Points(o.p1, o.p2, o.p3); }

// Tether a displaced number back to the dimension. `anchor` is a point on the
// VISIBLE geometry (the arrow tip at the arc), never the invisible fitted
// circle — so the leader can't float free after the label is dragged.
function leaderTo(ctx, anchor, labelPos, textW, col, lw) {
  const d = norm(sub(labelPos, anchor));
  if (!isFinite(d.x)) return;
  const stop = add(labelPos, scale(d, -(textW / 2 + 5)));
  if (dist(stop, anchor) > 2) strokePath(ctx, [anchor, stop], { color: col, width: lw });
}

function render(ctx, o, env, { ghost = false } = {}) {
  const c = fit(o);
  if (!c) return;
  const col = o.style.color, lw = o.style.lineWidth, fs = o.style.textSize, aL = arrowLen(lw);
  if (ghost) { // faint construction circle during creation only (FR-CIRC-3)
    ctx.save(); ctx.strokeStyle = col; ctx.globalAlpha = 0.28; ctx.lineWidth = env.px(1);
    ctx.setLineDash([env.px(4), env.px(4)]);
    ctx.beginPath(); ctx.arc(c.center.x, c.center.y, c.r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  const arc = add(c.center, fromAngle(o.angle, c.r));
  const textW = o.text ? measureLabel(ctx, o.text, fs) : 0;
  const fits = c.r > textW + aL * 1.5;        // does the number fit inside, along the radius?
  const outside = !!o.labelPos || !fits;      // small circle → auto-place outside (#2)
  // radius line (extend a little past the arc when small) + single arrow at the arc
  strokePath(ctx, [c.center, add(c.center, fromAngle(o.angle, fits ? c.r : c.r + aL * 1.4))], { color: col, width: lw });
  drawIsoArrow(ctx, arc, o.angle, aL, col);
  // label: dragged position, else inside (fits) or collinear just outside (small)
  const labelPos = o.labelPos
    || (fits ? add(c.center, fromAngle(o.angle, c.r * 0.55))
             : add(c.center, fromAngle(o.angle, c.r + aL * 1.4 + textW / 2 + 6)));
  o._labelPos = labelPos;
  if (outside) {
    leaderTo(ctx, arc, labelPos, textW, col, lw);
    drawLabel(ctx, { pos: labelPos, text: o.text || 'R', angle: 0, fontSize: fs, color: col });
  } else {
    drawLabel(ctx, { pos: labelPos, text: o.text || 'R', angle: o.angle, fontSize: fs, color: col });
  }
}

export const type = {
  draw(ctx, o, env) { render(ctx, o, env); },
  bounds(o) { const c = fit(o); if (!c) return { minX: o.p1.x, minY: o.p1.y, maxX: o.p1.x, maxY: o.p1.y }; return { minX: c.center.x - c.r, minY: c.center.y - c.r, maxX: c.center.x + c.r, maxY: c.center.y + c.r }; },
  hitTest(o, p, env) {
    for (const h of type.handles(o)) if (dist(h, p) <= env.px(7)) return { part: 'handle', id: h.id };
    if (o._labelPos && dist(o._labelPos, p) <= env.px(14)) return { part: 'label' };
    const c = fit(o);
    if (c && Math.abs(dist(p, c.center) - c.r) <= env.px(7)) return { part: 'body' };
    return null;
  },
  handles(o) {
    const c = fit(o);
    const hs = [{ id: 'p1', x: o.p1.x, y: o.p1.y }, { id: 'p2', x: o.p2.x, y: o.p2.y }, { id: 'p3', x: o.p3.x, y: o.p3.y }];
    if (c) { const arc = add(c.center, fromAngle(o.angle, c.r)); hs.push({ id: 'arc', x: arc.x, y: arc.y }); }
    if (o._labelPos) hs.push({ id: 'label', x: o._labelPos.x, y: o._labelPos.y });
    return hs;
  },
  moveHandle(o, id, p) {
    if (id === 'arc') { const c = fit(o); if (c) o.angle = angleOf(sub(p, c.center)); }
    else if (id === 'label') {
      // Dragging the number also swings the radius line so the arrow points
      // straight at it (no dogleg) — the leader stays collinear with the dim.
      o.labelPos = { ...p };
      const c = fit(o); if (c) o.angle = angleOf(sub(p, c.center));
    }
    else o[id] = { ...p };
  },
  translate(o, dx, dy) {
    for (const k of ['p1', 'p2', 'p3']) o[k] = { x: o[k].x + dx, y: o[k].y + dy };
    if (o.labelPos) o.labelPos = { x: o.labelPos.x + dx, y: o.labelPos.y + dy };
  },
  editText(o) { return { get: () => o.text, set: (t) => { o.text = t; }, pos: () => o._labelPos }; },
};

let st = null;
const reset = () => { st = null; };

export const tool = {
  reset,
  onPointerDown(p, env) {
    if (!st) { st = { pts: [{ ...p }] }; return; }
    if (st.pts.length < 3) {
      const pts = [...st.pts, { ...p }];
      if (pts.length === 3 && !circleFrom3Points(pts[0], pts[1], pts[2])) return; // reject collinear (FR-CIRC-2)
      st.pts = pts;
      if (pts.length === 3) st.angle = 0;
      return;
    }
    // S4 lock
    const obj = { kind: 'radius', style: style.snapshot(true), p1: st.pts[0], p2: st.pts[1], p3: st.pts[2], angle: st.angle, text: 'R' };
    reset();
    env.beginTextInput({
      worldPos: add(circleFrom3Points(obj.p1, obj.p2, obj.p3).center, fromAngle(obj.angle, 1)),
      fontSize: obj.style.textSize, color: obj.style.color, multiline: false, initial: 'R', caret: 'end',
      onCommit: (text) => env.addObject({ ...obj, text }),
      onCancel: () => env.addObject({ ...obj, text: 'R' }),
    });
  },
  onPointerMove(p) {
    if (!st) return;
    st._preview = { ...p };
    if (st.pts.length === 3) { const c = circleFrom3Points(st.pts[0], st.pts[1], st.pts[2]); if (c) st.angle = angleOf(sub(p, c.center)); }
  },
  onKeyDown(ev) { if (ev.key === 'Escape' && st) { reset(); return true; } return false; },
  drawPreview(ctx, env) {
    if (!st) return;
    if (st.pts.length === 3) render(ctx, { style: style.snapshot(true), p1: st.pts[0], p2: st.pts[1], p3: st.pts[2], angle: st.angle, text: 'R' }, env, { ghost: true });
    else { // show collected points
      ctx.save(); ctx.fillStyle = style.current.color;
      for (const pt of st.pts) { ctx.beginPath(); ctx.arc(pt.x, pt.y, env.px(3), 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
  },
};

export default { id: 'radius', icon: 'ic-radius', label: '半徑', group: 2, isDimension: true, tool, type };
