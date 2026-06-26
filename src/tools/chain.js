// ===== Continuous (chain) linear dimension (#4) =====
// A thin wrapper around the linear-dimension engine: it reuses the exact same
// state machine and object kind ('linear'), but while THIS tool is active the
// linear tool's `chain` flag is on (set in main.js onToolChange). After each
// segment commits, the next dimension auto-continues from the previous endpoint
// at the same axis/level, until Esc.

import { tool as linearTool } from './linear.js';

export const tool = {
  reset: () => linearTool.reset(),
  onPointerDown: (p, env, ev) => linearTool.onPointerDown(p, env, ev),
  onPointerMove: (p, env, ev) => linearTool.onPointerMove(p, env, ev),
  onKeyDown: (ev, env) => linearTool.onKeyDown(ev, env),
  drawPreview: (ctx, env) => linearTool.drawPreview(ctx, env),
};

// No `type`: chain creates ordinary kind:'linear' objects, served by linear's type.
export default { id: 'chain', icon: 'ic-chain', label: '連續標尺', group: 2, isDimension: true, tool };
