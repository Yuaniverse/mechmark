// ===== Linear dimension — THE core engine (PRD §7 / FR-DIM) =====
// Reference implementation that every other dimension tool mirrors.
// Acceptance red line (FR-DIM-1): 3 clicks + type → finished dimension.
//   click A → click B → move to set offset → click to lock → type → Enter.
//
// Ortho lock (FR-DIM-2) chooses the dimension AXIS (horizontal/vertical),
// keeping the real measured-point positions, so extension lines come out
// unequal when the points differ in the cross-axis (FR-DIM-4) — correct CAD.

import { sub, add, scale, norm, perp, dot, dist, angleOf, distToSegment, mid } from '../geom.js';
import { drawDimensionLine, drawExtensionLine, measureLabel, arrowLen } from '../draw.js';
import * as style from '../style.js';

const GAP = 4, OVER = 7;

// Resolve the two endpoints that sit ON the dimension line.
function ends(o) {
  const { a, b, axis, level } = o;
  if (axis === 'horizontal') return { A: { x: a.x, y: level }, B: { x: b.x, y: level } };
  if (axis === 'vertical') return { A: { x: level, y: a.y }, B: { x: level, y: b.y } };
  const n = perp(norm(sub(b, a)));
  return { A: add(a, scale(n, level)), B: add(b, scale(n, level)) };
}

// Level (offset) from a cursor position, given the chosen axis.
function levelFrom(a, b, axis, cur) {
  if (axis === 'horizontal') return cur.y;
  if (axis === 'vertical') return cur.x;
  const n = perp(norm(sub(b, a)));
  return (cur.x - a.x) * n.x + (cur.y - a.y) * n.y; // signed perp distance
}

function chooseAxis(a, b, ortho) {
  if (!ortho) return 'aligned';
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'horizontal' : 'vertical';
}

// Shared renderer used by both committed objects and the live preview.
function render(ctx, o, env, { selected = false } = {}) {
  const { A, B } = ends(o);
  const col = o.style.color, lw = o.style.lineWidth, fs = o.style.textSize;
  // witness/extension lines
  drawExtensionLine(ctx, o.a, A, { color: col, width: lw, gap: GAP, overshoot: o.extOver?.a ?? OVER });
  drawExtensionLine(ctx, o.b, B, { color: col, width: lw, gap: GAP, overshoot: o.extOver?.b ?? OVER });
  // dimension line + arrows + number + degrade
  const r = drawDimensionLine(ctx, env, {
    a: A, b: B, text: o.text, color: col, lineWidth: lw, fontSize: fs,
    labelOverride: o.labelOverride || null, flip: !!o.arrowsInside,
  });
  o._labelPos = r.labelPos; // cache for hit-testing
}

export const type = {
  draw(ctx, o, env) { render(ctx, o, env, { selected: env.isSelected(o.id) }); },

  bounds(o) {
    const { A, B } = ends(o);
    const xs = [o.a.x, o.b.x, A.x, B.x], ys = [o.a.y, o.b.y, A.y, B.y];
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  },

  hitTest(o, p, env) {
    const tol = env.px(7);
    for (const h of type.handles(o, env)) if (dist(h, p) <= env.px(7)) return { part: 'handle', id: h.id };
    const { A, B } = ends(o);
    if (o._labelPos && dist(o._labelPos, p) <= env.px(14)) return { part: 'label' };
    if (distToSegment(p, A, B) <= tol) return { part: 'body' };
    if (distToSegment(p, o.a, A) <= tol || distToSegment(p, o.b, B) <= tol) return { part: 'body' };
    return null;
  },

  handles(o, env) {
    const { A, B } = ends(o);
    const dir = norm(sub(B, A));
    const eA = add(A, scale(norm(sub(A, o.a)), o.extOver?.a ?? OVER));
    const eB = add(B, scale(norm(sub(B, o.b)), o.extOver?.b ?? OVER));
    return [
      { id: 'a', x: o.a.x, y: o.a.y },
      { id: 'b', x: o.b.x, y: o.b.y },
      { id: 'mid', x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 },
      { id: 'extA', x: eA.x, y: eA.y },
      { id: 'extB', x: eB.x, y: eB.y },
      ...(o._labelPos ? [{ id: 'label', x: o._labelPos.x, y: o._labelPos.y }] : []),
    ];
  },

  moveHandle(o, id, p, env) {
    if (id === 'a') { o.a = { ...p }; if (o.axis !== 'aligned') o.axis = chooseAxis(o.a, o.b, true); }
    else if (id === 'b') { o.b = { ...p }; if (o.axis !== 'aligned') o.axis = chooseAxis(o.a, o.b, true); }
    else if (id === 'mid') { o.level = levelFrom(o.a, o.b, o.axis, p); }
    else if (id === 'label') { o.labelOverride = { ...p }; } // drag number freely (#1)
    else if (id === 'extA' || id === 'extB') {
      const { A, B } = ends(o);
      const base = id === 'extA' ? A : B, m = id === 'extA' ? o.a : o.b;
      // Overshoot = projection of the drag onto the outward witness direction
      // (base - measured point). Degenerate (dim line through the point) → 0.
      const dir = norm(sub(base, m));
      const over = dot(sub(p, base), dir);
      (o.extOver = o.extOver || {})[id === 'extA' ? 'a' : 'b'] = Math.max(0, over);
    }
  },

  // double-click a witness handle resets it to auto (FR-DIM-5)
  doubleClickHandle(o, id) {
    if (id === 'extA' && o.extOver) o.extOver.a = null;
    if (id === 'extB' && o.extOver) o.extOver.b = null;
  },

  translate(o, dx, dy) {
    o.a = { x: o.a.x + dx, y: o.a.y + dy };
    o.b = { x: o.b.x + dx, y: o.b.y + dy };
    if (o.axis === 'horizontal') o.level += dy;
    else if (o.axis === 'vertical') o.level += dx;
    if (o.labelOverride) o.labelOverride = { x: o.labelOverride.x + dx, y: o.labelOverride.y + dy };
  },

  editText(o) { return { get: () => o.text, set: (t) => { o.text = t; }, pos: () => o._labelPos }; },
  // toggle arrows back-to-back (outward) ↔ face-to-face (inward) — R key
  flipArrows(o) { o.arrowsInside = !o.arrowsInside; },
};

// ---- creation state machine ----
let st = null;
const reset = () => { st = null; };
// Continue from a finished segment: next dimension starts at prevB, sharing the
// axis & dimension-line level → chain dimensioning (#4). Set when tool.chain.
const seedChain = (prevB, obj) => { st = { stage: 'chain', a: { ...prevB }, axis: obj.axis, level: obj.level }; };

function openInput(env, obj, onDone) {
  const { A, B } = ends(obj);
  env.beginTextInput({
    worldPos: mid(A, B), fontSize: obj.style.textSize, color: obj.style.color, multiline: false, initial: '',
    onCommit: (text) => { env.addObject({ ...obj, text }); onDone(); },
    onCancel: () => { env.addObject({ ...obj, text: '' }); onDone(); }, // S4 Esc = empty (FR-DIM-3)
  });
}

export const tool = {
  reset,
  chain: false, // continuous-dimension mode (toggled from the status bar)
  onPointerDown(p, env) {
    if (!st) { st = { stage: 1, a: { ...p } }; return; }
    if (st.stage === 'chain') {
      st.b = { ...p };
      const obj = makeObj(st);
      st.stage = 3;
      openInput(env, obj, () => seedChain(obj.b, obj)); // keep chaining until Esc
      return;
    }
    if (st.stage === 1) {
      st.b = { ...p };
      st.axis = chooseAxis(st.a, st.b, env.orthoLock);
      st.level = levelFrom(st.a, st.b, st.axis, p);
      st.stage = 2;
      return;
    }
    if (st.stage === 2) {
      st.level = levelFrom(st.a, st.b, st.axis, p);
      const obj = makeObj(st); // lock → open inline number input (FR-DIM-1)
      st.stage = 3;
      openInput(env, obj, () => { tool.chain ? seedChain(obj.b, obj) : reset(); });
    }
  },
  onPointerMove(p, env) {
    if (!st) return;
    if (st.stage === 1) st._preview = { ...p };
    else if (st.stage === 2) st.level = levelFrom(st.a, st.b, st.axis, p);
    else if (st.stage === 'chain') st.b = { ...p };
  },
  onKeyDown(ev) {
    if (ev.key === 'Escape' && st) { reset(); return true; } // cancel / break the chain
    return false;
  },
  drawPreview(ctx, env) {
    if (!st) return;
    if (st.stage === 1 && st._preview) {
      const b = st._preview;
      ctx.save();
      ctx.strokeStyle = style.current.color; ctx.globalAlpha = 0.6;
      ctx.lineWidth = env.px(1); ctx.setLineDash([env.px(4), env.px(4)]);
      ctx.beginPath(); ctx.moveTo(st.a.x, st.a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.restore();
    } else if ((st.stage === 2 || st.stage === 'chain') && st.b) {
      render(ctx, makeObj(st), env);
    }
  },
};

function makeObj(st) {
  return {
    kind: 'linear', style: style.snapshot(true),
    a: { ...st.a }, b: { ...st.b }, axis: st.axis, level: st.level,
    text: '', extOver: null, labelOverride: null,
  };
}

export default {
  id: 'linear', hotkey: 'd', icon: 'ic-linear', label: '線性標尺', group: 2, isDimension: true,
  tool, type,
};
