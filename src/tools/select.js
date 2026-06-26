// ===== Select / move tool (PRD §6 V, §11 FR-GEN-2) =====
// Pick, translate, drag handles, marquee-select, double-click to edit text,
// live style override of the selection. Generic: drives every object type
// through the registry (typeFor → hitTest / handles / moveHandle / translate).

import { bboxOf, bboxIntersects } from '../geom.js';

let drag = null;     // { kind:'move'|'handle'|'marquee', ... }
let last = null;     // last world point
const reset = () => { drag = null; last = null; };

export const tool = {
  reset,

  onPointerDown(p, env, ev) {
    last = { ...p };
    const hit = env.hitTest(p);
    if (hit && hit.part === 'handle' && env.selection.has(hit.obj.id)) {
      drag = { kind: 'handle', obj: hit.obj, id: hit.id, committed: false };
      return;
    }
    if (hit) {
      if (ev.shiftKey) {
        if (env.selection.has(hit.obj.id)) {
          // Shift-click an already-selected object = DESELECT only; do not arm a
          // move-drag (else click jitter would drag the rest of the selection).
          env.selection.ids.delete(hit.obj.id); env.selection.set(env.selection.list());
          drag = null; return;
        }
        env.selection.add(hit.obj.id);
      } else if (!env.selection.has(hit.obj.id)) {
        env.selection.set([hit.obj.id]);
      }
      drag = { kind: 'move', committed: false };
      return;
    }
    if (!ev.shiftKey) env.selection.clear();
    drag = { kind: 'marquee', start: { ...p }, cur: { ...p } };
  },

  onPointerMove(p, env) {
    if (!drag) return;
    if (drag.kind === 'marquee') { drag.cur = { ...p }; return; }
    const dx = p.x - last.x, dy = p.y - last.y;
    last = { ...p };
    if (!drag.committed) { env.scene.commit(); drag.committed = true; }
    if (drag.kind === 'handle') {
      env.typeFor(drag.obj.kind).moveHandle?.(drag.obj, drag.id, p, env);
    } else {
      for (const id of env.selection.list()) {
        const o = env.scene.byId(id);
        env.typeFor(o.kind).translate?.(o, dx, dy);
      }
    }
  },

  onPointerUp(p, env) {
    if (drag?.kind === 'marquee') {
      const r = bboxOf([drag.start, drag.cur]);
      const ids = env.scene.objects.filter((o) => {
        const b = env.typeFor(o.kind)?.bounds?.(o);
        return b && bboxIntersects(b, r);
      }).map((o) => o.id);
      env.selection.set(ids);
    }
    reset();
  },

  onDoubleClick(p, env) {
    const hit = env.hitTest(p);
    if (!hit) return;
    const t = env.typeFor(hit.obj.kind);
    if (hit.part === 'handle') { t.doubleClickHandle?.(hit.obj, hit.id); env.requestRender(); return; }
    const ed = t.editText?.(hit.obj);
    if (!ed) return;
    env.scene.commit();
    env.beginTextInput({
      worldPos: ed.pos() || p, fontSize: hit.obj.style.textSize, color: hit.obj.style.color,
      anchor: hit.obj.kind === 'text' ? 'top' : 'center',
      multiline: hit.obj.kind === 'leader' || hit.obj.kind === 'text', initial: ed.get(),
      onCommit: (text) => {
        const t = text.trim();
        // Empty edits would orphan the object: a text mark renders nothing (just
        // a tiny invisible pad) and a balloon loses its number. Delete the empty
        // text; keep a balloon's prior number rather than blanking it.
        if (t === '' && hit.obj.kind === 'text') { env.scene.remove(hit.obj.id); env.requestRender(); return; }
        if (t === '' && hit.obj.kind === 'balloon') { env.requestRender(); return; }
        ed.set(text); env.requestRender();
      },
      onCancel: () => { env.requestRender(); },
    });
  },

  drawPreview(ctx, env) {
    if (drag?.kind === 'marquee') {
      const { start, cur } = drag;
      ctx.save();
      ctx.strokeStyle = env.accent; ctx.fillStyle = 'rgba(79,70,229,0.07)';
      ctx.lineWidth = env.px(1); ctx.setLineDash([env.px(4), env.px(3)]);
      const x = Math.min(start.x, cur.x), y = Math.min(start.y, cur.y);
      ctx.fillRect(x, y, Math.abs(cur.x - start.x), Math.abs(cur.y - start.y));
      ctx.strokeRect(x, y, Math.abs(cur.x - start.x), Math.abs(cur.y - start.y));
      ctx.restore();
    }
  },
};

export default { id: 'select', hotkey: 'v', icon: 'ic-select', label: '選取/移動', group: 0, tool };
