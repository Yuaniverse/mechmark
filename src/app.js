// ===== Engine: render loop, view transform, input dispatch, selection =====
// Tools and object-types draw in WORLD space; the engine installs the
// transform. The `env` object passed to every tool/type method is the full
// contract surface (documented in CONTRACT.md).

import { tools, typeFor, toolList } from './registry.js';
import { drawHandle } from './draw.js';
import * as style from './style.js';
import { clamp } from './geom.js';

export class App {
  constructor(canvas, scene, ui) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scene = scene;
    this.ui = ui; // { setCoords, setObjCount, setZoom, beginTextInput, endTextInput, onSelectionChange }
    this.view = { zoom: 1, panX: 0, panY: 0 };
    this.dpr = window.devicePixelRatio || 1;

    this.activeToolId = 'select';
    this.tool = null;
    this.selection = new Set();
    this.orthoLock = true;
    this.shiftDown = false;
    this._dirty = true;
    this._space = false;
    this._panning = null;
    this.cursor = { x: 0, y: 0 }; // last world cursor

    this._raf = 0;
    this.env = this._makeEnv();
    this._bind();
    scene.onChange(() => {
      // Drop selection ids that no longer exist (undo/redo/remove restore a
      // different object list); else later style/handle ops deref undefined.
      if (this._reconcileSelection()) {
        this.ui.onSelectionChange?.([...this.selection].map((id) => scene.byId(id)).filter(Boolean));
      }
      this.requestRender();
      this.ui.setObjCount?.(scene.objects.length);
    });
    this._resize();
  }

  // ---- env contract ----
  _makeEnv() {
    const self = this;
    return {
      get ctx() { return self.ctx; },
      scene: self.scene,
      style,
      get zoom() { return self.view.zoom; },
      get view() { return self.view; },
      accent: '#4f46e5',
      px: (n) => n / self.view.zoom,
      get orthoLock() {
        // Shift temporarily inverts (PRD FR-DIM-2).
        return self.shiftDown ? !self.orthoLock : self.orthoLock;
      },
      get shiftDown() { return self.shiftDown; },
      toScreen: (w) => ({ x: w.x * self.view.zoom + self.view.panX, y: w.y * self.view.zoom + self.view.panY }),
      toWorld: (s) => ({ x: (s.x - self.view.panX) / self.view.zoom, y: (s.y - self.view.panY) / self.view.zoom }),
      requestRender: () => self.requestRender(),
      isSelected: (id) => self.selection.has(id),
      selection: {
        get ids() { return self.selection; },
        list: () => [...self.selection],
        has: (id) => self.selection.has(id),
        set: (ids) => { self.selection = new Set(ids); self._selChanged(); },
        add: (id) => { self.selection.add(id); self._selChanged(); },
        clear: () => { self.selection.clear(); self._selChanged(); },
      },
      // create a finished object (with undo).
      addObject: (obj) => { self.scene.commit(); self.scene.add(obj); self.requestRender(); return obj; },
      // open the inline text/number editor at a world position.
      beginTextInput: (opts) => self.ui.beginTextInput?.({ ...opts, env: self.env }),
      endTextInput: () => self.ui.endTextInput?.(),
      typeFor,
      hitTest: (world, opts) => self.hitTest(world, opts),
      setTool: (id) => self.setTool(id),
    };
  }

  _selChanged() {
    this.requestRender();
    this.ui.onSelectionChange?.([...this.selection].map((id) => this.scene.byId(id)).filter(Boolean));
  }

  // Remove selection ids whose objects are gone. Returns true if it changed.
  _reconcileSelection() {
    if (!this.selection.size) return false;
    let changed = false;
    for (const id of [...this.selection]) if (!this.scene.byId(id)) { this.selection.delete(id); changed = true; }
    return changed;
  }

  setTool(id) {
    if (!tools.has(id)) return;
    this.tool?.reset?.();
    this.activeToolId = id;
    this.tool = tools.get(id).tool;
    this.tool.reset?.();
    this.ui.onToolChange?.(id);
    document.getElementById('canvas-wrap').classList.toggle('tool-select', id === 'select');
    this.requestRender();
  }

  // ---- view ----
  setZoom(z, centerScreen) {
    const c = centerScreen || { x: this.canvas.clientWidth / 2, y: this.canvas.clientHeight / 2 };
    const before = this.env.toWorld(c);
    this.view.zoom = clamp(z, 0.1, 8);
    const after = this.env.toWorld(c);
    this.view.panX += (after.x - before.x) * this.view.zoom;
    this.view.panY += (after.y - before.y) * this.view.zoom;
    this.ui.setZoom?.(Math.round(this.view.zoom * 100));
    this.requestRender();
  }

  // ---- hit testing: top-most object first ----
  hitTest(world, { handlesOnly = false } = {}) {
    for (let i = this.scene.objects.length - 1; i >= 0; i--) {
      const obj = this.scene.objects[i];
      const t = typeFor(obj.kind);
      if (!t?.hitTest) continue;
      const hit = t.hitTest(obj, world, this.env);
      if (hit) return { obj, ...hit };
    }
    return null;
  }

  // Render on demand: schedule a single frame; idle when nothing changes.
  requestRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._render(); });
  }

  _resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.requestRender();
  }

  _render() {
    const ctx = this.ctx;
    const { zoom, panX, panY } = this.view;
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    // clear (device space)
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fbfbfc';
    ctx.fillRect(0, 0, W, H);

    // world transform
    ctx.setTransform(this.dpr * zoom, 0, 0, this.dpr * zoom, this.dpr * panX, this.dpr * panY);
    this._drawGrid(ctx, W, H);

    // base image
    if (this.scene.baseImage) {
      ctx.drawImage(this.scene.baseImage, 0, 0, this.scene.imageSize.w, this.scene.imageSize.h);
    }

    // objects
    for (const obj of this.scene.objects) {
      const t = typeFor(obj.kind);
      t?.draw?.(ctx, obj, this.env);
    }

    // selection handles
    for (const id of this.selection) {
      const obj = this.scene.byId(id);
      const t = obj && typeFor(obj.kind);
      const handles = t?.handles?.(obj, this.env) || [];
      for (const h of handles) drawHandle(ctx, this.env, h, { active: h.active });
    }

    // active tool preview
    this.tool?.drawPreview?.(ctx, this.env);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  _drawGrid(ctx, W, H) {
    const { zoom } = this.view;
    const step = 40;
    const tl = this.env.toWorld({ x: 0, y: 0 });
    const br = this.env.toWorld({ x: W, y: H });
    ctx.save();
    ctx.strokeStyle = 'rgba(17,24,39,0.05)';
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) { ctx.moveTo(x, tl.y); ctx.lineTo(x, br.y); }
    for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step) { ctx.moveTo(tl.x, y); ctx.lineTo(br.x, y); }
    ctx.stroke();
    ctx.restore();
  }

  // ---- input ----
  _bind() {
    const c = this.canvas;
    const wpt = (ev) => {
      const r = c.getBoundingClientRect();
      return this.env.toWorld({ x: ev.clientX - r.left, y: ev.clientY - r.top });
    };

    c.addEventListener('pointerdown', (ev) => {
      c.setPointerCapture(ev.pointerId);
      const world = wpt(ev);
      if (this._space || ev.button === 1) { this._panning = { x: ev.clientX, y: ev.clientY, panX: this.view.panX, panY: this.view.panY }; return; }
      if (ev.button !== 0) return;
      this.tool?.onPointerDown?.(world, this.env, ev);
      this.requestRender();
    });

    c.addEventListener('pointermove', (ev) => {
      const world = wpt(ev);
      this.cursor = world;
      this.ui.setCoords?.(Math.round(world.x), Math.round(world.y));
      if (this._panning) {
        this.view.panX = this._panning.panX + (ev.clientX - this._panning.x);
        this.view.panY = this._panning.panY + (ev.clientY - this._panning.y);
        this.requestRender();
        return;
      }
      this.tool?.onPointerMove?.(world, this.env, ev);
      this.requestRender();
    });

    const endPan = () => { this._panning = null; };
    c.addEventListener('pointerup', (ev) => {
      if (this._panning) { endPan(); return; }
      if (ev.button !== 0) return;
      this.tool?.onPointerUp?.(wpt(ev), this.env, ev);
      this.requestRender();
    });
    c.addEventListener('pointercancel', endPan);

    c.addEventListener('dblclick', (ev) => {
      this.tool?.onDoubleClick?.(wpt(ev), this.env, ev);
      this.requestRender();
    });

    c.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const r = c.getBoundingClientRect();
      const center = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      const factor = Math.exp(-ev.deltaY * 0.0015);
      this.setZoom(this.view.zoom * factor, center);
    }, { passive: false });

    window.addEventListener('resize', () => this._resize());
    new ResizeObserver(() => this._resize()).observe(c);
  }

  // keyboard handled at document level by main.js, which calls these:
  onKeyDown(ev) {
    if (ev.key === 'Shift') this.shiftDown = true;
    if (ev.code === 'Space') { this._space = true; }
    // let the active tool consume first (Esc/Enter inside state machines)
    if (this.tool?.onKeyDown?.(ev, this.env)) { this.requestRender(); return true; }
    return false;
  }
  onKeyUp(ev) {
    if (ev.key === 'Shift') this.shiftDown = false;
    if (ev.code === 'Space') this._space = false;
  }

  deleteSelection() {
    if (!this.selection.size) return;
    this.scene.commit();
    this.scene.remove([...this.selection]);
    this.selection.clear();
    this._selChanged();
  }
}
