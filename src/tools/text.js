// ===== Free text (PRD §9 FR-MARK-4) =====
// Click to place, then type. The click point is the TOP-CENTRE of the text:
// text is horizontally centred on the click and flows downward from it (#3).
// Opaque white pad keeps it legible over busy screenshots.

import { measureLabel, FONT } from '../draw.js';
import * as style from '../style.js';

const LH = 1.25;

function metrics(o) {
  const c = metrics._cv || (metrics._cv = document.createElement('canvas').getContext('2d'));
  const lines = String(o.text).split('\n');
  c.font = `${o.style.textSize}px ${FONT}`;
  let w = 0; for (const l of lines) w = Math.max(w, c.measureText(l).width);
  return { w, h: lines.length * o.style.textSize * LH, lines };
}

function render(ctx, o) {
  const fs = o.style.textSize;
  const { w, h, lines } = metrics(o);
  const pad = 3;
  ctx.save();
  ctx.font = `${fs}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(o.x - w / 2 - pad, o.y - pad, w + pad * 2, h + pad * 2);
  ctx.fillStyle = o.style.color;
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], o.x, o.y + i * fs * LH);
  ctx.restore();
}

export const type = {
  draw(ctx, o) { render(ctx, o); },
  bounds(o) { const m = metrics(o); return { minX: o.x - m.w / 2, minY: o.y, maxX: o.x + m.w / 2, maxY: o.y + m.h }; },
  hitTest(o, p, env) {
    const h = type.handles(o)[0];
    if (Math.hypot(h.x - p.x, h.y - p.y) <= env.px(7)) return { part: 'handle', id: 'pos' };
    const b = type.bounds(o), pad = env.px(4);
    if (p.x >= b.minX - pad && p.x <= b.maxX + pad && p.y >= b.minY - pad && p.y <= b.maxY + pad) return { part: 'body' };
    return null;
  },
  handles(o) { return [{ id: 'pos', x: o.x, y: o.y }]; }, // top-centre
  moveHandle(o, id, p) { o.x = p.x; o.y = p.y; },
  translate(o, dx, dy) { o.x += dx; o.y += dy; },
  editText(o) { return { get: () => o.text, set: (t) => { o.text = t; }, pos: () => ({ x: o.x, y: o.y }) }; },
};

let st = null;
const reset = () => { st = null; };

export const tool = {
  reset,
  onPointerDown(p, env) {
    if (st) return;
    st = { ...p };
    const pos = { ...p };
    env.beginTextInput({
      worldPos: pos, anchor: 'top', fontSize: style.current.textSize, color: style.current.color, multiline: true, initial: '',
      onCommit: (t) => { if (t.trim()) env.addObject({ kind: 'text', style: style.snapshot(false), x: pos.x, y: pos.y, text: t }); reset(); },
      onCancel: () => reset(),
    });
  },
  onKeyDown(ev) { if (ev.key === 'Escape' && st) { reset(); return true; } return false; },
  drawPreview() {},
};

export default { id: 'text', hotkey: 't', icon: 'ic-text', label: '文字', group: 3, isDimension: false, tool, type };
