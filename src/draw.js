// ===== Shared rendering primitives (ISO engineering drawing language) =====
// All drawing happens in WORLD space: the renderer installs a transform
// (dpr*zoom) before calling tool/type draw(). So sizes here are in world px
// and scale with zoom — which is the correct CAD behaviour. For constant
// SCREEN-size UI (handles, hit tolerance) use env.px(n) = n / zoom.
//
// This module is the single source of truth for arrows, labels, extension
// lines and the small-size two-stage degrade (PRD FR-DIM-SMALL). Every
// dimension tool MUST use these so output stays visually consistent.

import { sub, add, scale, norm, perp, dist, angleOf, fromAngle } from './geom.js';

export const FONT = "'IBM Plex Sans', system-ui, sans-serif";

// Arrow length derived from line width (README: "arrow size is derived from
// line width, not set independently"). 1.4px dim line → ~12.5px arrow.
export function arrowLen(lineWidth) {
  return 9 + lineWidth * 2.5;
}

export function setFont(ctx, fontSize) {
  ctx.font = `${fontSize}px ${FONT}`;
}

export function measureLabel(ctx, text, fontSize) {
  setFont(ctx, fontSize);
  let w = 0;
  for (const line of String(text).split('\n')) w = Math.max(w, ctx.measureText(line).width);
  return w;
}

// Thin barbed ISO arrowhead. tip = point of the arrow, angle = direction the
// arrow points toward (radians). Proportions match the design marker.
export function drawIsoArrow(ctx, tip, angle, size, color) {
  const L = size, w = size * 0.352;
  ctx.save();
  ctx.translate(tip.x, tip.y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-L, -w);
  ctx.lineTo(-0.68 * L, 0);
  ctx.lineTo(-L, w);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

export function strokePath(ctx, pts, { color, width, dash = null } = {}) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  ctx.setLineDash(dash || []);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.restore();
}

// Extension/witness line: small gap off the measured point, overshoot past
// the dimension line (PRD FR-DIM-6). measured = the real geometry point,
// dimEnd = where the extension line meets the dimension line.
export function drawExtensionLine(ctx, measured, dimEnd, { color, width, gap = 4, overshoot = 7 } = {}) {
  const dir = norm(sub(dimEnd, measured));
  if (!isFinite(dir.x)) return;
  const start = add(measured, scale(dir, gap));
  const end = add(dimEnd, scale(dir, overshoot));
  strokePath(ctx, [start, end], { color, width });
}

// Upright, white-backed label. pos = center anchor point. angle = baseline
// rotation (radians); auto-flipped to stay upright/readable (FR-DIM-8).
// Supports multi-line. Returns the world-space oriented box for hit-testing.
export function drawLabel(ctx, { pos, text, angle = 0, fontSize, color, anchor = 'center', padX = 4, padY = 2 }) {
  let a = angle;
  if (a > Math.PI / 2 || a < -Math.PI / 2) a += Math.PI; // keep upright
  const lines = String(text).split('\n');
  setFont(ctx, fontSize);
  let w = 0;
  for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
  const lineH = fontSize * 1.25;
  const h = lineH * lines.length;
  ctx.save();
  ctx.translate(pos.x, pos.y);
  ctx.rotate(a);
  let ox = 0;
  if (anchor === 'start') ox = w / 2;
  else if (anchor === 'end') ox = -w / 2;
  ctx.translate(ox, 0);
  // white pad
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-w / 2 - padX, -h / 2 - padY, w + padX * 2, h + padY * 2);
  // text
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], 0, -h / 2 + lineH * (i + 0.5));
  }
  ctx.restore();
  return { center: pos, w: w + padX * 2, h: h + padY * 2, angle: a };
}

// Selection handle: constant screen size (uses env.px). 8px white square,
// 1.5px accent stroke (README spec).
export function drawHandle(ctx, env, p, { active = false } = {}) {
  const s = env.px(8);
  ctx.save();
  ctx.fillStyle = active ? env.accent : '#ffffff';
  ctx.strokeStyle = env.accent;
  ctx.lineWidth = env.px(1.5);
  ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
  ctx.strokeRect(p.x - s / 2, p.y - s / 2, s, s);
  ctx.restore();
}

// ===== Small-size two-stage degrade (PRD §7.3 / FR-DIM-SMALL) =====
// S = available span along the dim line between the two extension lines.
// need = textW + 2*arrowLen + padding.
//   'normal'   : arrows inside pointing outward, number centered.
//   'degrade1' : arrows flipped outside (point inward), number centered.
//   'degrade2' : arrows outside + number pulled out on a short leader.
export function computeDimStage(S, textW, aLen, pad = 6) {
  const need = textW + 2 * aLen + pad;
  if (S >= need) return 'normal';
  if (S >= textW) return 'degrade1';
  return 'degrade2';
}

// Draw a complete linear dimension line between a and b (these are the two
// points ON the dimension line, i.e. already offset to the dim position).
// Handles all three degrade stages. labelOverride lets the caller place the
// number manually (degrade-2 manual drag, FR-DIM-SMALL-2). Returns
// { stage, labelPos } so callers can store/hit-test the number.
export function drawDimensionLine(ctx, env, { a, b, text, color, lineWidth, fontSize, dash = null, labelOverride = null, flip = false }) {
  const aLen = arrowLen(lineWidth);
  const S = dist(a, b);
  const dir = norm(sub(b, a));
  const ang = angleOf(dir);
  const textW = text ? measureLabel(ctx, text, fontSize) : 0;
  const stage = computeDimStage(S, textW, aLen);
  const center = scale(add(a, b), 0.5);

  if (stage === 'normal') {
    strokePath(ctx, [a, b], { color, width: lineWidth, dash });
    if (flip) { // face-to-face: arrows point inward toward each other
      drawIsoArrow(ctx, a, ang, aLen, color);
      drawIsoArrow(ctx, b, angleOf(sub(a, b)), aLen, color);
    } else {    // back-to-back (default): arrows point outward toward the extension lines
      drawIsoArrow(ctx, a, angleOf(sub(a, b)), aLen, color);
      drawIsoArrow(ctx, b, ang, aLen, color);
    }
  }
  const ext = aLen * 1.2;
  const numGap = aLen * 0.3 + 4; // gap between the b-arrow and the number
  if (stage !== 'normal') {
    // Small dimension: arrows flip OUTSIDE the extension lines, pointing inward.
    const aOut = add(a, scale(dir, -ext));
    // In degrade-2 the number doesn't fit between the lines, so carry it beyond
    // the b end COLLINEAR with the dimension line (standard CAD) and run the
    // line just under the number so everything stays on one straight line.
    const bOut = (stage === 'degrade2' && !labelOverride)
      ? add(b, scale(dir, ext + numGap + textW + 2))
      : add(b, scale(dir, ext));
    strokePath(ctx, [aOut, bOut], { color, width: lineWidth, dash });
    drawIsoArrow(ctx, a, ang, aLen, color);                // at a, pointing inward (+dir)
    drawIsoArrow(ctx, b, angleOf(sub(a, b)), aLen, color); // at b, pointing inward (-dir)
  }

  let labelPos = labelOverride || center;
  if (!labelOverride && stage === 'degrade2') {
    // number centred just past the b end, aligned with the dimension line
    labelPos = add(b, scale(dir, ext + numGap + textW / 2));
  }
  if (text) drawLabel(ctx, { pos: labelPos, text, angle: ang, fontSize, color });
  return { stage, labelPos };
}
