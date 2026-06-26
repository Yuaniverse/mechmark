// ===== Document model (PRD §11 FR-GEN) =====
// Ordered object list (z = draw order; later-drawn on top). Undo via snapshots
// of the object list. Each object: { id, kind, style, ...geometry }.

let _id = 1;
export const nextId = () => `o${_id++}`;

export class Scene {
  constructor() {
    this.objects = [];
    this.baseImage = null;   // HTMLImage/Canvas of the captured screenshot
    this.imageSize = null;   // { w, h } in world px
    this._undo = [];
    this._redo = [];
    this._onChange = new Set();
  }

  onChange(fn) { this._onChange.add(fn); return () => this._onChange.delete(fn); }
  _emit() { this._onChange.forEach((fn) => fn(this)); }

  // Snapshot = object list (serialised) + base image (by reference) + its size,
  // so undo/redo also restores the captured screenshot — not just annotations.
  _snapshot() { return { objs: JSON.stringify(this.objects), image: this.baseImage, size: this.imageSize }; }
  _restore(snap) {
    this.objects = JSON.parse(snap.objs);
    this.baseImage = snap.image;
    this.imageSize = snap.size;
    this._emit();
  }

  // Capture a snapshot for undo BEFORE a mutation.
  commit() {
    this._undo.push(this._snapshot());
    if (this._undo.length > 200) this._undo.shift();
    this._redo.length = 0;
  }

  add(obj) {
    if (!obj.id) obj.id = nextId();
    this.objects.push(obj);
    this._emit();
    return obj;
  }

  remove(ids) {
    const set = new Set(Array.isArray(ids) ? ids : [ids]);
    this.objects = this.objects.filter((o) => !set.has(o.id));
    this._emit();
  }

  byId(id) { return this.objects.find((o) => o.id === id); }

  undo() {
    if (!this._undo.length) return;
    this._redo.push(this._snapshot());
    this._restore(this._undo.pop());
  }

  redo() {
    if (!this._redo.length) return;
    this._undo.push(this._snapshot());
    this._restore(this._redo.pop());
  }

  setImage(img, w, h) {
    this.baseImage = img;
    this.imageSize = { w, h };
    this._emit();
  }
}
