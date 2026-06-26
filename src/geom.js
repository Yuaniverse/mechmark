// ===== Geometry utilities (world-space, all in CSS px of the captured image) =====
// Points are plain {x, y}. Pure functions, no side effects.

export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s });
export const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function norm(a) {
  const l = len(a);
  return l < 1e-9 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}
// Left-hand perpendicular (rotate +90°).
export const perp = (a) => ({ x: -a.y, y: a.x });

export const angleOf = (a) => Math.atan2(a.y, a.x);
export const fromAngle = (ang, r = 1) => ({ x: Math.cos(ang) * r, y: Math.sin(ang) * r });

// Signed perpendicular distance from point p to the infinite line A->B.
// Positive = left side of A->B direction.
export function signedDistToLine(p, a, b) {
  const d = norm(sub(b, a));
  return cross(d, sub(p, a));
}

// Foot of perpendicular from p onto infinite line A->B.
export function projectToLine(p, a, b) {
  const ab = sub(b, a);
  const t = dot(sub(p, a), ab) / (dot(ab, ab) || 1);
  return add(a, scale(ab, t));
}

// Distance from p to the *segment* A-B.
export function distToSegment(p, a, b) {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return dist(p, add(a, scale(ab, t)));
}

// Intersection of infinite lines (p1->p2) and (p3->p4). Null if parallel.
export function lineIntersection(p1, p2, p3, p4) {
  const d1 = sub(p2, p1);
  const d2 = sub(p4, p3);
  const denom = cross(d1, d2);
  if (Math.abs(denom) < 1e-9) return null;
  const t = cross(sub(p3, p1), d2) / denom;
  return add(p1, scale(d1, t));
}

// Circumscribed circle through 3 points. Null if (near-)collinear.
export function circleFrom3Points(a, b, c) {
  const ax = a.x, ay = a.y, bx = b.x, by = b.y, cx = c.x, cy = c.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-6) return null;
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const center = { x: ux, y: uy };
  return { center, r: dist(center, a) };
}

// Unsigned angle between two vectors, 0..PI.
export function angleBetween(v1, v2) {
  const c = dot(norm(v1), norm(v2));
  return Math.acos(Math.max(-1, Math.min(1, c)));
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const TAU = Math.PI * 2;
export const degOf = (rad) => (rad * 180) / Math.PI;

// Apply orthogonal lock to endpoint B relative to A: snaps to pure H or V
// along whichever axis has the larger delta (PRD FR-DIM S2).
export function orthoSnap(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  return Math.abs(dx) >= Math.abs(dy) ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
}

// Snap endpoint B to the nearest `stepDeg`-degree increment around A, keeping
// the cursor distance. PowerPoint's Shift-line behaviour (15° steps → includes
// pure H/V "正交" at 0/90/180 and the 45° diagonals).
export function snapAngle(a, b, stepDeg = 15) {
  const d = sub(b, a), r = len(d);
  if (r < 1e-9) return { ...b };
  const step = (stepDeg * Math.PI) / 180;
  const ang = Math.round(angleOf(d) / step) * step;
  return { x: a.x + Math.cos(ang) * r, y: a.y + Math.sin(ang) * r };
}

// Axis-aligned bounding box helpers.
export function bboxOf(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
export function bboxContains(bb, p, pad = 0) {
  return p.x >= bb.minX - pad && p.x <= bb.maxX + pad && p.y >= bb.minY - pad && p.y <= bb.maxY + pad;
}
export function bboxIntersects(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
