// ===== Balloon / item callout (球標 — BOM ballooning) =====
// A circle with an item number, optionally with a leader arrow to the part.
// Create by DRAGGING from the part to where the balloon sits → balloon WITH an
// arrow; or a plain CLICK (no drag) → a bare numbered balloon, no arrow.
// Press R on a selected balloon to toggle its arrow. The number auto-fills the
// smallest unused positive integer (so deleting a middle balloon frees that
// number for the next one); it stays manually editable.

import { sub, add, scale, norm, dist, angleOf, distToSegment, bboxOf } from '../geom.js';
import { drawIsoArrow, arrowLen, measureLabel, setFont, strokePath } from '../draw.js';
import * as style from '../style.js';

// Balloon radius hugs the number (min keeps single digits round).
function radiusFor(ctx, o) {
  const fs = o.style.textSize;
  const tw = o.text ? measureLabel(ctx, String(o.text), fs) : 0;
  return Math.max(fs * 0.95, tw / 2 + fs * 0.5);
}
// ctx-free estimate for bounds/hit-test (measureLabel needs a ctx).
const radiusEstimate = (o) => o.style.textSize * 1.25 + (String(o.text || '').length > 2 ? o.style.textSize * 0.4 : 0);

// Smallest positive integer not already used by a balloon's (pure-integer)
// number. Deleting a balloon frees its number; non-numeric labels don't count.
function nextNumber(scene) {
  const used = new Set();
  for (const o of scene.objects) {
    if (o.kind !== 'balloon') continue;
    const txt = String(o.text ?? '').trim();
    const n = Number(txt);
    if (txt !== '' && Number.isInteger(n) && n > 0) used.add(n);
  }
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

function render(ctx, o, env, { ghost = false } = {}) {
  const col = o.style.color, lw = o.style.lineWidth, fs = o.style.textSize;
  const c = o.center;
  const r = radiusFor(ctx, o);
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.55;
  // Leader from the balloon edge to the target, arrow at the target.
  if (o.arrow && o.target) {
    const d = norm(sub(o.target, c));
    if (isFinite(d.x) && dist(o.target, c) > r + 1) {
      strokePath(ctx, [add(c, scale(d, r)), o.target], { color: col, width: lw });
      drawIsoArrow(ctx, o.target, angleOf(sub(o.target, c)), arrowLen(lw), col);
    }
  }
  // Balloon: white fill so the number reads over the screenshot, coloured ring.
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = col;
  ctx.setLineDash([]);
  ctx.stroke();
  // Item number.
  setFont(ctx, fs);
  ctx.fillStyle = col;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(o.text ?? '1'), c.x, c.y + fs * 0.04);
  ctx.restore();
}

export const type = {
  draw(ctx, o, env) { render(ctx, o, env); },
  bounds(o) {
    const r = radiusEstimate(o), c = o.center;
    const pts = [{ x: c.x - r, y: c.y - r }, { x: c.x + r, y: c.y + r }];
    if (o.arrow && o.target) pts.push(o.target);
    return bboxOf(pts);
  },
  hitTest(o, p, env) {
    for (const h of type.handles(o)) if (dist(h, p) <= env.px(7)) return { part: 'handle', id: h.id };
    if (dist(p, o.center) <= radiusEstimate(o) + env.px(2)) return { part: 'body' };
    if (o.arrow && o.target && distToSegment(p, o.center, o.target) <= env.px(6)) return { part: 'body' };
    return null;
  },
  handles(o) {
    const hs = [{ id: 'center', x: o.center.x, y: o.center.y }];
    if (o.arrow && o.target) hs.push({ id: 'target', x: o.target.x, y: o.target.y });
    return hs;
  },
  moveHandle(o, id, p) {
    if (id === 'center') o.center = { ...p };
    else if (id === 'target') o.target = { ...p };
  },
  translate(o, dx, dy) {
    o.center = { x: o.center.x + dx, y: o.center.y + dy };
    if (o.target) o.target = { x: o.target.x + dx, y: o.target.y + dy };
  },
  editText(o) { return { get: () => String(o.text ?? ''), set: (t) => { o.text = t; }, pos: () => o.center }; },
  // R key in select mode: add/remove the leader arrow.
  toggleArrow(o) {
    o.arrow = !o.arrow;
    if (o.arrow && (!o.target || dist(o.target, o.center) < 8)) {
      o.target = { x: o.center.x - 50, y: o.center.y + 40 };
    }
  },
};

const DRAG_MIN = 6; // world px: below this, a press is treated as a plain click
let st = null;
const reset = () => { st = null; };

export const tool = {
  reset,
  onPointerDown(p) { st = { down: { ...p }, cur: { ...p }, moved: false }; },
  onPointerMove(p) {
    if (!st) return;
    st.cur = { ...p };
    if (dist(st.down, p) > DRAG_MIN) st.moved = true;
  },
  onPointerUp(p, env) {
    if (!st) return;
    const arrow = st.moved && dist(st.down, p) > DRAG_MIN;
    // Drag: balloon at the release point, arrow back to the press point (the
    // part). Click: bare balloon at the click, no arrow.
    const center = { ...p };
    const target = arrow ? { ...st.down } : null;
    reset();
    const num = String(nextNumber(env.scene));
    const base = { kind: 'balloon', style: style.snapshot(false), center, target, arrow };
    env.beginTextInput({
      worldPos: { ...center }, fontSize: base.style.textSize, color: base.style.color,
      multiline: false, initial: num, caret: 'end',
      onCommit: (text) => env.addObject({ ...base, text: text.trim() || num }),
      onCancel: () => env.addObject({ ...base, text: num }),
    });
  },
  onKeyDown(ev) { if (ev.key === 'Escape' && st) { reset(); return true; } return false; },
  drawPreview(ctx, env) {
    if (!st) return;
    const arrow = st.moved && dist(st.down, st.cur) > DRAG_MIN;
    render(ctx, { style: style.snapshot(false), center: st.cur, target: arrow ? st.down : null, arrow, text: String(nextNumber(env.scene)) }, env, { ghost: true });
  },
};

export default { id: 'balloon', hotkey: 'b', icon: 'ic-balloon', label: '球標', group: 3, isDimension: false, tool, type };
