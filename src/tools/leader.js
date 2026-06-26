// ===== Bent leader callout (PRD §9.6 FR-LEADER) =====
// S1 arrow tip → S2 elbow → S3 move (shoulder ALWAYS horizontal, dir/length by
// cursor.x) → S4 click locks → type text (Shift+Enter newline). 4 actions.

import { sub, add, scale, norm, dist, distToSegment, angleOf } from '../geom.js';
import { strokePath, drawIsoArrow, arrowLen, drawLabel } from '../draw.js';
import * as style from '../style.js';

function render(ctx, o, env) {
  const col = o.style.color, lw = o.style.lineWidth, fs = o.style.textSize;
  // stop the sloped segment at the arrowhead base so the tip stays sharp (#2)
  const aL = arrowLen(lw), dt = norm(sub(o.elbow, o.tip));
  const cut = Math.min(0.72 * aL, dist(o.tip, o.elbow) * 0.5);
  strokePath(ctx, [add(o.tip, scale(dt, cut)), o.elbow, o.shoulderEnd], { color: col, width: lw });
  drawIsoArrow(ctx, o.tip, angleOf(sub(o.tip, o.elbow)), aL, col);
  if (o.text) {
    const right = o.shoulderEnd.x >= o.elbow.x;
    const anchor = right ? 'start' : 'end';
    const pos = { x: o.shoulderEnd.x + (right ? env.px(4) : -env.px(4)), y: o.shoulderEnd.y };
    o._labelPos = drawLeaderLabel(ctx, { pos, text: o.text, fontSize: fs, color: col, anchor });
  }
}

// Leader text hangs off the shoulder end, on an opaque white pad (#4).
function drawLeaderLabel(ctx, { pos, text, fontSize, color, anchor }) {
  ctx.save();
  ctx.font = `${fontSize}px 'IBM Plex Sans', system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const lines = String(text).split('\n');
  const lineH = fontSize * 1.25;
  let maxW = 0;
  for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width);
  const h = lines.length * lineH, pad = 3;
  const left = anchor === 'end' ? pos.x - maxW : pos.x;
  const y0 = pos.y - (lines.length - 1) * lineH / 2;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(left - pad, pos.y - h / 2 - pad, maxW + pad * 2, h + pad * 2);
  ctx.fillStyle = color;
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], left, y0 + i * lineH);
  ctx.restore();
  return { center: { x: left + maxW / 2, y: pos.y }, w: maxW + pad * 2, h: h + pad * 2 };
}

export const type = {
  draw(ctx, o, env) { render(ctx, o, env); },
  bounds(o) {
    const xs = [o.tip.x, o.elbow.x, o.shoulderEnd.x], ys = [o.tip.y, o.elbow.y, o.shoulderEnd.y];
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  },
  hitTest(o, p, env) {
    for (const h of type.handles(o)) if (dist(h, p) <= env.px(7)) return { part: 'handle', id: h.id };
    if (o._labelPos && dist(o._labelPos.center, p) <= Math.max(env.px(10), o._labelPos.w / 2)) return { part: 'label' };
    if (distToSegment(p, o.tip, o.elbow) <= env.px(7) || distToSegment(p, o.elbow, o.shoulderEnd) <= env.px(7)) return { part: 'body' };
    return null;
  },
  handles(o) {
    return [{ id: 'tip', x: o.tip.x, y: o.tip.y }, { id: 'elbow', x: o.elbow.x, y: o.elbow.y }, { id: 'shoulder', x: o.shoulderEnd.x, y: o.shoulderEnd.y }];
  },
  moveHandle(o, id, p) {
    if (id === 'tip') o.tip = { ...p };
    else if (id === 'elbow') { o.elbow = { ...p }; o.shoulderEnd = { x: o.shoulderEnd.x, y: o.elbow.y }; } // keep shoulder horizontal
    else if (id === 'shoulder') o.shoulderEnd = { x: p.x, y: o.elbow.y }; // always horizontal
  },
  translate(o, dx, dy) {
    o.tip = { x: o.tip.x + dx, y: o.tip.y + dy };
    o.elbow = { x: o.elbow.x + dx, y: o.elbow.y + dy };
    o.shoulderEnd = { x: o.shoulderEnd.x + dx, y: o.shoulderEnd.y + dy };
  },
  editText(o) { return { get: () => o.text, set: (t) => { o.text = t; }, pos: () => o.shoulderEnd }; },
};

let st = null;
const reset = () => { st = null; };

function makeObj(s) {
  return { kind: 'leader', style: style.snapshot(true), tip: { ...s.tip }, elbow: { ...s.elbow }, shoulderEnd: { ...s.shoulderEnd }, text: '' };
}

export const tool = {
  reset,
  onPointerDown(p, env) {
    if (!st) { st = { stage: 1, tip: { ...p } }; return; }
    if (st.stage === 1) { st.elbow = { ...p }; st.shoulderEnd = { x: p.x, y: p.y }; st.stage = 2; return; }
    if (st.stage === 2) {
      st.shoulderEnd = { x: p.x, y: st.elbow.y };
      const obj = makeObj(st);
      st.stage = 3;
      env.beginTextInput({
        worldPos: obj.shoulderEnd, fontSize: obj.style.textSize, color: obj.style.color, multiline: true, initial: '',
        onCommit: (text) => { env.addObject({ ...obj, text }); reset(); },
        onCancel: () => { env.addObject({ ...obj, text: '' }); reset(); },
      });
    }
  },
  onPointerMove(p) {
    if (!st) return;
    if (st.stage === 1) st._preview = { ...p };
    else if (st.stage === 2) st.shoulderEnd = { x: p.x, y: st.elbow.y };
  },
  onKeyDown(ev) { if (ev.key === 'Escape' && st && st.stage < 3) { reset(); return true; } return false; },
  drawPreview(ctx, env) {
    if (!st) return;
    if (st.stage === 1 && st._preview) {
      strokePath(ctx, [st.tip, st._preview], { color: style.current.color, width: style.current.dimLineWidth });
      drawIsoArrow(ctx, st.tip, angleOf(sub(st.tip, st._preview)), arrowLen(style.current.dimLineWidth), style.current.color);
    } else if (st.stage === 2) {
      render(ctx, makeObj(st), env);
    }
  },
};

export default { id: 'leader', hotkey: 'l', icon: 'ic-leader', label: '引線註解', group: 2, isDimension: true, tool, type };
