// ===== Angle dimension (PRD §9.5 FR-ANG) — two-line four-point =====
// S1..S4 click two lines (P1P2, P3P4) → intersection O. S5 move sets arc
// radius; the shown angle follows the cursor's sector (supplementary auto-
// switch, FR-ANG-5). S6 click locks → input pre-filled with the computed
// angle (1 dp) + '°'. Construction lines to O are solid (FR-ANG-3).

import { sub, add, scale, norm, dot, dist, angleOf, fromAngle, degOf, lineIntersection } from '../geom.js';
import { strokePath, drawIsoArrow, arrowLen, drawLabel, measureLabel } from '../draw.js';
import * as style from '../style.js';

// Recompute the live geometry of a committed/preview angle object.
function geom(o) {
  const O = lineIntersection(o.p1, o.p2, o.p3, o.p4);
  if (!O) return null;
  const d1 = norm(sub(o.p2, o.p1)), d2 = norm(sub(o.p4, o.p3));
  const rayA = scale(d1, o.sA), rayB = scale(d2, o.sB);
  const a1 = angleOf(rayA), a2 = angleOf(rayB);
  let delta = a2 - a1;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const angleDeg = Math.abs(degOf(delta));
  return { O, a1, delta, angleDeg, rayA, rayB };
}

function arcPolyline(O, r, a1, delta, n = 48) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(add(O, fromAngle(a1 + delta * (i / n), r)));
  return pts;
}

function constructionLines(o, O) {
  const lines = [];
  for (const [A, B] of [[o.p1, o.p2], [o.p3, o.p4]]) {
    const ab = sub(B, A); const t = dot(sub(O, A), ab) / (dot(ab, ab) || 1);
    if (t < 0) lines.push([A, O]); else if (t > 1) lines.push([B, O]);
  }
  return lines;
}

function render(ctx, o, env, { preview = false } = {}) {
  const g = geom(o); if (!g) return;
  const col = o.style.color, lw = o.style.lineWidth, fs = o.style.textSize;
  const r = o.radius;
  const poly = arcPolyline(g.O, r, g.a1, g.delta);
  const p1 = poly[0], p2 = poly[poly.length - 1];
  // Extension lines from the vertex O out to each arc end along the two rays,
  // so the arc is always tied to the angle — never a floating arc, even at a
  // large radius (fixes the disconnected-arc bug).
  const gap = env.px(6), over = env.px(7);
  for (const end of [p1, p2]) {
    const d = norm(sub(end, g.O));
    strokePath(ctx, [add(g.O, scale(d, gap)), add(end, scale(d, over))], { color: col, width: lw });
  }
  // arc
  strokePath(ctx, poly, { color: col, width: lw });
  // arrows sit ON the arc ends (tangent from the adjacent sample so they hug it)
  if (o.arrowsInside) { // face-to-face along the arc
    drawIsoArrow(ctx, p1, angleOf(sub(poly[1], p1)), arrowLen(lw), col);
    drawIsoArrow(ctx, p2, angleOf(sub(poly[poly.length - 2], p2)), arrowLen(lw), col);
  } else {              // back-to-back (default)
    drawIsoArrow(ctx, p1, angleOf(sub(p1, poly[1])), arrowLen(lw), col);
    drawIsoArrow(ctx, p2, angleOf(sub(p2, poly[poly.length - 2])), arrowLen(lw), col);
  }
  // label just outside the arc midpoint
  const midAng = g.a1 + g.delta / 2;
  const text = o.text || `${g.angleDeg.toFixed(1)}°`;
  const off = r + fs * 0.9 + measureLabel(ctx, text, fs) * 0; // outside the arc
  o._labelPos = add(g.O, fromAngle(midAng, off));
  drawLabel(ctx, { pos: o._labelPos, text, fontSize: fs, color: col });
}

export const type = {
  draw(ctx, o, env) { render(ctx, o, env); },
  bounds(o) {
    const g = geom(o); const pts = [o.p1, o.p2, o.p3, o.p4];
    if (g) pts.push(add(g.O, fromAngle(g.a1, o.radius)), add(g.O, fromAngle(g.a1 + g.delta, o.radius)));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  },
  hitTest(o, p, env) {
    for (const h of type.handles(o, env)) if (dist(h, p) <= env.px(7)) return { part: 'handle', id: h.id };
    if (o._labelPos && dist(o._labelPos, p) <= env.px(14)) return { part: 'label' };
    const g = geom(o);
    if (g && Math.abs(dist(p, g.O) - o.radius) <= env.px(8)) {
      // only on the arc sector
      let a = angleOf(sub(p, g.O)) - g.a1; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI;
      if (Math.sign(a) === Math.sign(g.delta) && Math.abs(a) <= Math.abs(g.delta)) return { part: 'body' };
    }
    return null;
  },
  handles(o) {
    const g = geom(o);
    const hs = [{ id: 'p1', x: o.p1.x, y: o.p1.y }, { id: 'p2', x: o.p2.x, y: o.p2.y }, { id: 'p3', x: o.p3.x, y: o.p3.y }, { id: 'p4', x: o.p4.x, y: o.p4.y }];
    if (g) { const m = add(g.O, fromAngle(g.a1 + g.delta / 2, o.radius)); hs.push({ id: 'arc', x: m.x, y: m.y }); }
    return hs;
  },
  moveHandle(o, id, p) {
    if (id === 'arc') { const g = geom(o); if (g) o.radius = Math.max(8, dist(p, g.O)); return; }
    // Moving an endpoint can reverse a ray across the vertex. Re-pick the sector
    // signs so the angle stays on the same visual side (else it flips to its
    // supplement and mis-measures).
    const before = geom(o);
    const ref = before ? add(before.O, fromAngle(before.a1 + before.delta / 2, o.radius)) : null;
    o[id] = { ...p };
    if (ref) {
      const O = lineIntersection(o.p1, o.p2, o.p3, o.p4);
      if (O) {
        const d1 = norm(sub(o.p2, o.p1)), d2 = norm(sub(o.p4, o.p3));
        o.sA = dot(sub(ref, O), d1) >= 0 ? 1 : -1;
        o.sB = dot(sub(ref, O), d2) >= 0 ? 1 : -1;
      }
    }
  },
  translate(o, dx, dy) { for (const k of ['p1', 'p2', 'p3', 'p4']) o[k] = { x: o[k].x + dx, y: o[k].y + dy }; },
  editText(o) { return { get: () => o.text, set: (t) => { o.text = t; }, pos: () => o._labelPos }; },
  flipArrows(o) { o.arrowsInside = !o.arrowsInside; },
};

let st = null;
const reset = () => { st = null; };

// build a transient object for preview/commit from collected points + cursor
function build(st, cur) {
  const O = lineIntersection(st.pts[0], st.pts[1], st.pts[2], st.pts[3]);
  if (!O) return null;
  const d1 = norm(sub(st.pts[1], st.pts[0])), d2 = norm(sub(st.pts[3], st.pts[2]));
  const sA = dot(sub(cur, O), d1) >= 0 ? 1 : -1;
  const sB = dot(sub(cur, O), d2) >= 0 ? 1 : -1;
  return { kind: 'angle', style: style.snapshot(true), p1: st.pts[0], p2: st.pts[1], p3: st.pts[2], p4: st.pts[3], sA, sB, radius: Math.max(8, dist(cur, O)), text: '' };
}

export const tool = {
  reset,
  onPointerDown(p, env) {
    if (!st) { st = { pts: [{ ...p }] }; return; }
    if (st.pts.length < 4) {
      const pts = [...st.pts, { ...p }];
      if (pts.length === 4 && !lineIntersection(pts[0], pts[1], pts[2], pts[3])) return; // parallel reject (FR-ANG-2)
      st.pts = pts;
      return;
    }
    // S6 lock
    const obj = build(st, p);
    if (!obj) return;
    const g = geom(obj);
    reset();
    env.beginTextInput({
      worldPos: g ? add(g.O, fromAngle(g.a1 + g.delta / 2, obj.radius + obj.style.textSize)) : p,
      fontSize: obj.style.textSize, color: obj.style.color, multiline: false,
      initial: `${g.angleDeg.toFixed(1)}°`,
      onCommit: (text) => env.addObject({ ...obj, text }),
      onCancel: () => env.addObject({ ...obj, text: `${g.angleDeg.toFixed(1)}°` }),
    });
  },
  onPointerMove(p) { if (st) st._cur = { ...p }; },
  onKeyDown(ev) { if (ev.key === 'Escape' && st) { reset(); return true; } return false; },
  drawPreview(ctx, env) {
    if (!st) return;
    if (st.pts.length === 4 && st._cur) {
      const obj = build(st, st._cur); if (obj) render(ctx, obj, env, { preview: true });
    } else {
      ctx.save(); ctx.strokeStyle = style.current.color; ctx.globalAlpha = 0.6; ctx.lineWidth = env.px(1);
      if (st.pts.length >= 2) strokePath(ctx, [st.pts[0], st.pts[1]], { color: style.current.color, width: env.px(1) });
      if (st.pts.length >= 3 && st._cur) strokePath(ctx, [st.pts[2], st._cur], { color: style.current.color, width: env.px(1) });
      ctx.fillStyle = style.current.color;
      for (const pt of st.pts) { ctx.beginPath(); ctx.arc(pt.x, pt.y, env.px(3), 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
  },
};

export default { id: 'angle', hotkey: 'g', icon: 'ic-angle', label: '角度標尺', group: 2, isDimension: true, tool, type };
