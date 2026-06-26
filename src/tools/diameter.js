// ===== Diameter dimension (PRD §8 FR-CIRC, §8.3) — three-point circle fit =====
// Same fit as radius; S4 move sets the diameter-line angle → click locks →
// number auto-prefixed 'Ø'. Double-arrow line through the centre.

import { sub, add, scale, norm, dist, angleOf, fromAngle, circleFrom3Points } from '../geom.js';
import { strokePath, drawIsoArrow, arrowLen, drawLabel, measureLabel, computeDimStage } from '../draw.js';
import * as style from '../style.js';

function fit(o) { return circleFrom3Points(o.p1, o.p2, o.p3); }

// Tether a displaced number back to the dimension. `anchor` is a point on the
// VISIBLE geometry (the nearer arrow tip), never the invisible fitted circle —
// so the leader can't float free after the label is dragged. Always drawn.
function leaderTo(ctx, anchor, labelPos, textW, col, lw) {
  const d = norm(sub(labelPos, anchor));
  if (!isFinite(d.x)) return;
  const stop = add(labelPos, scale(d, -(textW / 2 + 5)));
  if (dist(stop, anchor) > 2) strokePath(ctx, [anchor, stop], { color: col, width: lw });
}

function render(ctx, o, env, { ghost = false } = {}) {
  const c = fit(o);
  if (!c) return;
  const col = o.style.color, lw = o.style.lineWidth, fs = o.style.textSize, aLen = arrowLen(lw);
  if (ghost) {
    ctx.save(); ctx.strokeStyle = col; ctx.globalAlpha = 0.28; ctx.lineWidth = env.px(1);
    ctx.setLineDash([env.px(4), env.px(4)]);
    ctx.beginPath(); ctx.arc(c.center.x, c.center.y, c.r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  const dir = fromAngle(o.angle, 1);
  const e1 = add(c.center, scale(dir, -c.r)), e2 = add(c.center, scale(dir, c.r));
  const textW = o.text ? measureLabel(ctx, o.text, fs) : 0;
  const stage = computeDimStage(2 * c.r, textW, aLen);
  const fitsInside = stage === 'normal';
  const outside = !!o.labelPos || !fitsInside;   // small circle → number auto-outside (#2)
  if (fitsInside) {
    strokePath(ctx, [e1, e2], { color: col, width: lw });
    if (o.arrowsInside) { // face-to-face: point inward toward the centre
      drawIsoArrow(ctx, e1, o.angle, aLen, col);
      drawIsoArrow(ctx, e2, angleOf(sub(e1, e2)), aLen, col);
    } else {              // back-to-back (default): point outward to the circle
      drawIsoArrow(ctx, e1, angleOf(sub(e1, e2)), aLen, col);
      drawIsoArrow(ctx, e2, o.angle, aLen, col);
    }
  } else {
    const o1 = add(e1, scale(dir, -aLen * 1.3)), o2 = add(e2, scale(dir, aLen * 1.3));
    strokePath(ctx, [o1, o2], { color: col, width: lw });
    if (o.arrowsInside) { // honour the R flip even on the small-circle degrade path
      drawIsoArrow(ctx, e1, angleOf(sub(e1, e2)), aLen, col);
      drawIsoArrow(ctx, e2, o.angle, aLen, col);
    } else {
      drawIsoArrow(ctx, e1, o.angle, aLen, col);
      drawIsoArrow(ctx, e2, angleOf(sub(e1, e2)), aLen, col);
    }
  }
  // label: dragged position, else centre (fits) or collinear just outside (small)
  const labelPos = o.labelPos
    || (fitsInside ? { ...c.center }
                   : add(c.center, fromAngle(o.angle, c.r + aLen * 1.3 + textW / 2 + 8)));
  o._labelPos = labelPos;
  if (outside) {
    const tip = dist(e1, labelPos) <= dist(e2, labelPos) ? e1 : e2;
    leaderTo(ctx, tip, labelPos, textW, col, lw);
    drawLabel(ctx, { pos: labelPos, text: o.text || 'Ø', angle: 0, fontSize: fs, color: col });
  } else {
    drawLabel(ctx, { pos: labelPos, text: o.text || 'Ø', angle: o.angle, fontSize: fs, color: col });
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
    if (c) { const e = add(c.center, fromAngle(o.angle, c.r)); hs.push({ id: 'end', x: e.x, y: e.y }); }
    if (o._labelPos) hs.push({ id: 'label', x: o._labelPos.x, y: o._labelPos.y });
    return hs;
  },
  moveHandle(o, id, p) {
    if (id === 'end') { const c = fit(o); if (c) o.angle = angleOf(sub(p, c.center)); }
    else if (id === 'label') {
      // Dragging the number also swings the diameter line so the arrows point
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
  flipArrows(o) { o.arrowsInside = !o.arrowsInside; },
};

let st = null;
const reset = () => { st = null; };

export const tool = {
  reset,
  onPointerDown(p, env) {
    if (!st) { st = { pts: [{ ...p }] }; return; }
    if (st.pts.length < 3) {
      const pts = [...st.pts, { ...p }];
      if (pts.length === 3 && !circleFrom3Points(pts[0], pts[1], pts[2])) return;
      st.pts = pts;
      if (pts.length === 3) st.angle = 0;
      return;
    }
    const obj = { kind: 'diameter', style: style.snapshot(true), p1: st.pts[0], p2: st.pts[1], p3: st.pts[2], angle: st.angle, text: 'Ø' };
    reset();
    env.beginTextInput({
      worldPos: circleFrom3Points(obj.p1, obj.p2, obj.p3).center,
      fontSize: obj.style.textSize, color: obj.style.color, multiline: false, initial: 'Ø', caret: 'end',
      onCommit: (text) => env.addObject({ ...obj, text }),
      onCancel: () => env.addObject({ ...obj, text: 'Ø' }),
    });
  },
  onPointerMove(p) {
    if (!st) return;
    if (st.pts.length === 3) { const c = circleFrom3Points(st.pts[0], st.pts[1], st.pts[2]); if (c) st.angle = angleOf(sub(p, c.center)); }
  },
  onKeyDown(ev) { if (ev.key === 'Escape' && st) { reset(); return true; } return false; },
  drawPreview(ctx, env) {
    if (!st) return;
    if (st.pts.length === 3) render(ctx, { style: style.snapshot(true), p1: st.pts[0], p2: st.pts[1], p3: st.pts[2], angle: st.angle, text: 'Ø' }, env, { ghost: true });
    else { ctx.save(); ctx.fillStyle = style.current.color; for (const pt of st.pts) { ctx.beginPath(); ctx.arc(pt.x, pt.y, env.px(3), 0, Math.PI * 2); ctx.fill(); } ctx.restore(); }
  },
};

export default { id: 'diameter', icon: 'ic-diameter', label: '直徑', group: 2, isDimension: true, tool, type };
