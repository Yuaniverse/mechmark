// ===== Current-style system (PRD §5 / FR-STYLE) =====
// One set of "current" visual attributes. New objects inherit a snapshot.
// Selecting objects can override per-object live; the style bar reflects the
// current values (and, when a selection exists, the selection's values).

import { clamp } from './geom.js';

const listeners = new Set();

export const current = {
  lineWidth: 2.5,    // markup default (PRD FR-STYLE: marks 2.5)
  dimLineWidth: 1.4, // dimension lines default thinner (FR-STYLE-4)
  textSize: 15,
  color: '#E5342B',  // stroke / line / border colour
  lineStyle: 'solid', // 'solid' | 'dashed'
  fillColor: null,    // shape fill: null = no fill (rect/ellipse only)
  fillAlpha: 1,       // fill opacity — opaque by default (PowerPoint-like)
  hlColor: '#FACC15', // highlighter default colour (yellow) — its own remembered style
  hlWidth: 5,         // highlighter default stroke width
};

export const RANGE = {
  lineWidth: [1, 8, 0.5],
  dimLineWidth: [0.5, 8, 0.5],
  textSize: [10, 28, 1],
  hlWidth: [2, 40, 1], // highlighter can be much wider than a pen
};

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach((fn) => fn(current)); }

export function set(key, value) {
  if (RANGE[key]) {
    const [lo, hi] = RANGE[key];
    value = clamp(value, lo, hi);
  }
  current[key] = value;
  emit();
}

export function step(key, dir) {
  const [lo, hi, stepBy] = RANGE[key];
  set(key, clamp(Math.round((current[key] + dir * stepBy) / stepBy) * stepBy, lo, hi));
}

// Dash pattern for a given style + line width (null = solid).
export function dashFor(lineStyle, width) {
  return lineStyle === 'dashed' ? [Math.max(4, width * 2.5), Math.max(3, width * 1.8)] : null;
}

// A fresh style snapshot for a newly created object. `isDimension` selects the
// thinner dimension line width.
export function snapshot(isDimension = false) {
  return {
    lineWidth: isDimension ? current.dimLineWidth : current.lineWidth,
    textSize: current.textSize,
    color: current.color,
    lineStyle: current.lineStyle,
    fillColor: current.fillColor,
    fillAlpha: current.fillAlpha,
  };
}

// rgba() string for a hex fill colour at the given alpha. null → no fill.
export function fillStyleFor(hex, alpha = current.fillAlpha) {
  if (!hex || hex === 'none') return null;
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
