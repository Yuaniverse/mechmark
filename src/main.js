// ===== Entry point: register tools, build chrome, wire interactions =====
import { register, toolList, tools } from './registry.js';
import { Scene } from './scene.js';
import { App } from './app.js';
import * as style from './style.js';
import { copyToClipboard, savePNG, loadImageInto } from './io.js';

// --- register tool modules ---
// Core (built first). Fan-out leaf tools are appended here as they land.
import selectMod from './tools/select.js';
import linearMod from './tools/linear.js';
import chainMod from './tools/chain.js';

const MODULES = [selectMod, linearMod, chainMod];
// Fan-out modules (angle, radius, diameter, leader, arrow, rect, ellipse, text)
// self-register on import; this stays in sync via dynamic discovery below.
async function loadOptional(paths) {
  for (const p of paths) {
    try { const m = await import(p); if (m.default) MODULES.push(m.default); }
    catch { /* not built yet */ }
  }
}

const RAIL_ORDER = ['select', 'linear', 'chain', 'angle', 'radius', 'diameter', 'leader', 'arrow', 'rect', 'ellipse', 'text', 'pen', 'highlighter', 'balloon'];

await loadOptional([
  './tools/angle.js', './tools/radius.js', './tools/diameter.js', './tools/leader.js',
  './tools/arrow.js', './tools/rect.js', './tools/ellipse.js', './tools/text.js',
  './tools/pen.js', './tools/highlighter.js', './tools/balloon.js',
]);
for (const m of MODULES) register(m);

// --- scene + app ---
const scene = new Scene();
const canvas = document.getElementById('canvas');
const wrap = document.getElementById('canvas-wrap');
const dropHint = document.getElementById('drop-hint');

let activeEditor = null;

const ui = {
  setCoords: (x, y) => { document.getElementById('coords').textContent = `x ${x} · y ${y}`; },
  setObjCount: (n) => {
    document.getElementById('objcount').textContent = `${n} 個物件`;
    dropHint.classList.toggle('hidden', n > 0 || !!scene.baseImage);
  },
  setZoom: (pct) => { document.getElementById('zoom-val').textContent = `${pct}%`; },
  onToolChange: (id) => {
    document.querySelectorAll('.tool-btn').forEach((b) => b.classList.toggle('active', b.dataset.tool === id));
    tools.get('linear').tool.chain = (id === 'chain'); // chain mode only while the 連續標尺 tool is active
    if (!app.selection.size) reflectStyleBar(null); // width display is tool-contextual
  },
  onSelectionChange: (objs) => { reflectStyleBar(objs[0]); },
  beginTextInput: (opts) => beginTextInput(opts),
  endTextInput: () => endTextInput(),
};

const app = new App(canvas, scene, ui);

// ===== Tool rail =====
const rail = document.getElementById('rail');
const railGroups = { 0: [], 1: [], 2: [], 3: [] };
for (const id of RAIL_ORDER) {
  const t = tools.get(id);
  if (!t) continue;
  (railGroups[t.group] || railGroups[3]).push(t);
}
let firstGroup = true;
function railButton(t) {
  const btn = document.createElement('button');
  btn.className = 'tool-btn' + (t.id === 'select' ? ' active' : '');
  btn.dataset.tool = t.id;
  btn.title = `${t.label}${t.hotkey ? ' (' + t.hotkey.toUpperCase() + ')' : ''}`;
  btn.innerHTML = `<svg width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><use href="#${t.icon}"></use></svg>` +
    (t.hotkey ? `<span class="tool-badge">${t.hotkey.toUpperCase()}</span>` : '');
  // While the inline editor is open, a rail click must not blur/commit it nor
  // switch tools mid-edit (consistent with hotkeys being ignored while editing).
  btn.addEventListener('mousedown', (e) => { if (activeEditor) e.preventDefault(); });
  btn.addEventListener('click', () => { if (activeEditor) return; app.setTool(t.id); });
  return btn;
}
// Group 0 (select) then divider, group 2 (dims) then divider, group 3 (marks)
const renderGroups = [railGroups[0], railGroups[2], railGroups[3]].filter((g) => g.length);
renderGroups.forEach((g, i) => {
  if (i > 0) { const d = document.createElement('div'); d.className = 'rail-div'; rail.appendChild(d); }
  g.forEach((t) => rail.appendChild(railButton(t)));
});

// ===== Style bar =====
// Line width is contextual: a selected object's own width, else the dimension
// width when a dimension tool is active, else the markup width (FR-STYLE-4).
function contextWidthValue(sel) {
  if (sel) return sel.style.lineWidth;
  const t = tools.get(app.activeToolId);
  if (t && t.id === 'highlighter') return style.current.hlWidth;
  return (t && t.isDimension) ? style.current.dimLineWidth : style.current.lineWidth;
}
// True when the style bar should target the highlighter's own remembered style
// (its tool is active with nothing selected, or a highlighter is selected).
function highlighterContext(sel) {
  if (sel) return sel.kind === 'highlighter';
  return tools.get(app.activeToolId)?.id === 'highlighter';
}

function reflectStyleBar(sel) {
  const s = sel ? sel.style : style.current;
  document.getElementById('val-lineWidth').textContent = contextWidthValue(sel);
  document.getElementById('val-textSize').textContent = (sel ? s.textSize : style.current.textSize);
  const activeColor = sel ? s.color : (highlighterContext(null) ? style.current.hlColor : style.current.color);
  document.querySelectorAll('.swatch').forEach((sw) => {
    const on = sw.dataset.color?.toLowerCase() === (activeColor || '').toLowerCase();
    sw.classList.toggle('active', on);
    if (on) sw.style.color = activeColor;
  });
  document.querySelectorAll('.seg-cell').forEach((c) => c.classList.toggle('active', c.dataset.linestyle === s.lineStyle));
  const curFill = (sel ? s.fillColor : style.current.fillColor) || 'none';
  document.querySelectorAll('.fillswatch').forEach((sw) => {
    const v = sw.dataset.fill;
    sw.classList.toggle('active', v === 'none' ? curFill === 'none' : v.toLowerCase() === String(curFill).toLowerCase());
  });
}

// apply a style key to current + any selection (FR-STYLE-2/3)
function applyStyle(key, value) {
  if (value !== undefined) style.set(key, value);
  const sel = app.selection;
  if (sel.size) {
    scene.commit();
    for (const id of sel) {
      const o = scene.byId(id);
      if (key === 'lineWidth') o.style.lineWidth = style.current.lineWidth;
      else o.style[key] = style.current[key];
    }
    app.requestRender();
  }
  reflectStyleBar([...sel].map((id) => scene.byId(id))[0]);
}

document.querySelectorAll('.stepper').forEach((st) => {
  const key = st.dataset.stepper;
  st.querySelectorAll('.step-btn').forEach((b) => b.addEventListener('click', () => {
    const dir = Number(b.dataset.step);
    if (key === 'lineWidth') {
      if (app.selection.size) {
        scene.commit();
        for (const id of app.selection) {
          const o = scene.byId(id);
          if (o.kind === 'highlighter') { const [lo, hi] = style.RANGE.hlWidth; o.style.lineWidth = Math.max(lo, Math.min(hi, o.style.lineWidth + dir)); }
          else o.style.lineWidth = Math.max(0.5, Math.min(8, o.style.lineWidth + dir * 0.5));
        }
        app.requestRender();
      } else {
        const t = tools.get(app.activeToolId);
        const widthKey = (t && t.id === 'highlighter') ? 'hlWidth' : (t && t.isDimension) ? 'dimLineWidth' : 'lineWidth';
        style.step(widthKey, dir);
      }
      reflectStyleBar(selectedObj());
    } else {
      style.step(key, dir);
      applyStyle(key);
    }
  }));
});
const selectedObj = () => [...app.selection].map((id) => scene.byId(id))[0] || null;
document.getElementById('swatches').addEventListener('click', (e) => {
  const sw = e.target.closest('.swatch'); if (!sw) return;
  if (sw.dataset.color === 'custom') { document.getElementById('custom-color').click(); return; }
  applyColor(sw.dataset.color);
});
document.getElementById('custom-color').addEventListener('input', (e) => applyColor(e.target.value));
// Colour edits target the highlighter's own remembered colour when in its
// context (tool active w/ nothing selected, or a highlighter selected);
// otherwise the shared current colour (FR-STYLE).
function applyColor(value) {
  if (highlighterContext(selectedObj())) {
    style.set('hlColor', value);
    if (app.selection.size) {
      scene.commit();
      for (const id of app.selection) { const o = scene.byId(id); if (o.kind === 'highlighter') o.style.color = value; }
      app.requestRender();
    }
    reflectStyleBar(selectedObj());
    return;
  }
  applyStyle('color', value);
}
document.getElementById('lineStyle').addEventListener('click', (e) => {
  const c = e.target.closest('.seg-cell'); if (!c) return;
  applyStyle('lineStyle', c.dataset.linestyle);
});
document.getElementById('fills').addEventListener('click', (e) => {
  const sw = e.target.closest('.fillswatch'); if (!sw) return;
  applyStyle('fillColor', sw.dataset.fill === 'none' ? null : sw.dataset.fill);
});
document.getElementById('specials').addEventListener('click', (e) => {
  const b = e.target.closest('.spec-btn'); if (!b) return;
  insertGlyph(b.dataset.glyph);
});
// While the inline editor is open, clicking style-bar controls must NOT blur it
// (which would commit/close the input). Prevent the focus change on mousedown;
// the click still fires (#7: special-char buttons while typing).
document.querySelector('.stylebar').addEventListener('mousedown', (e) => {
  if (activeEditor && e.target.closest('.spec-btn, .step-btn, .swatch, .seg-cell, .fillswatch')) e.preventDefault();
});
reflectStyleBar(null);
style.onChange(() => { if (!app.selection.size) reflectStyleBar(null); });

// ===== Right cluster =====
document.getElementById('btn-undo').addEventListener('click', () => { scene.undo(); app.requestRender(); });
document.getElementById('btn-clear').addEventListener('click', () => {
  if (!scene.objects.length) return;
  scene.commit();
  scene.remove(scene.objects.map((o) => o.id));
  app.selection.clear();
  app.requestRender();
});
document.getElementById('btn-new').addEventListener('click', () => {
  if (scene.objects.length && !confirm('開新檔會清空目前的圖片與所有標註，確定嗎？')) return;
  scene.commit();
  scene.remove(scene.objects.map((o) => o.id));
  scene.setImage(null, 0, 0);
  app.selection.clear();
  app.view = { zoom: 1, panX: 0, panY: 0 };
  app.ui.setZoom(100);
  document.getElementById('filename').textContent = '未命名截圖';
  dropHint.classList.remove('hidden');
  app.requestRender();
});
document.getElementById('btn-copy').addEventListener('click', async () => {
  try { await copyToClipboard(scene); flash('btn-copy', '已複製'); }
  catch { flash('btn-copy', '複製失敗', true); }
});
document.getElementById('btn-save').addEventListener('click', () => savePNG(scene, currentFilename()));
function flash(id, msg, bad) {
  const b = document.getElementById(id); const old = b.innerHTML;
  b.textContent = msg; if (bad) b.style.color = '#e5342b';
  setTimeout(() => { b.innerHTML = old; b.style.color = ''; }, 1100);
}

// ===== Status bar =====
const orthoPill = document.getElementById('ortho-pill');
orthoPill.addEventListener('click', toggleOrtho);
function toggleOrtho() {
  app.orthoLock = !app.orthoLock;
  document.getElementById('ortho-dot').classList.toggle('on', app.orthoLock);
  document.getElementById('ortho-text').textContent = `正交鎖定 ${app.orthoLock ? '開' : '關'}`;
}

// ===== Zoom =====
document.getElementById('zoom-in').addEventListener('click', () => app.setZoom(app.view.zoom * 1.2));
document.getElementById('zoom-out').addEventListener('click', () => app.setZoom(app.view.zoom / 1.2));

// ===== Inline text editor =====
function beginTextInput({ worldPos, fontSize, color, multiline, initial, onCommit, onCancel, prefill, caret, anchor, env }) {
  endTextInput();
  const el = document.getElementById(multiline ? 'inline-textarea' : 'inline-input');
  const screen = (env || app.env).toScreen(worldPos);
  el.hidden = false;
  el.value = initial ?? prefill ?? '';
  el.style.left = screen.x + 'px';
  el.style.top = screen.y + 'px';
  // 'top' (free text): editor top-centre sits at the click, text grows downward
  // and is centre-aligned — matches where the committed text renders (#3).
  el.style.transform = anchor === 'top' ? 'translate(-50%, 0)' : 'translate(-50%,-50%)';
  el.style.textAlign = anchor === 'top' ? 'center' : 'left';
  el.style.font = `${(fontSize || 15) * app.view.zoom}px 'IBM Plex Sans', sans-serif`;
  el.style.color = color || '#E5342B';
  el.style.minWidth = '2ch';
  if (multiline) autosize(el);
  activeEditor = { el, onCommit, onCancel, done: false };
  setTimeout(() => {
    el.focus();
    // 'end' keeps a prefix (e.g. Ø / R) and places the caret after it
    if (caret === 'end') el.setSelectionRange(el.value.length, el.value.length);
    else el.select();
  }, 0);
}
function endTextInput() {
  if (activeEditor) { activeEditor.el.hidden = true; activeEditor = null; }
}
function commitEditor() {
  if (!activeEditor || activeEditor.done) return;
  activeEditor.done = true;
  const { el, onCommit } = activeEditor;
  const v = el.value; endTextInput(); onCommit?.(v);
}
function cancelEditor() {
  if (!activeEditor || activeEditor.done) return;
  activeEditor.done = true;
  const { onCancel } = activeEditor; endTextInput(); onCancel?.();
}
function autosize(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
function insertGlyph(g) {
  if (!activeEditor) return;
  const el = activeEditor.el;
  const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, s) + g + el.value.slice(e);
  el.selectionStart = el.selectionEnd = s + g.length;
  el.focus();
}
for (const el of [document.getElementById('inline-input'), document.getElementById('inline-textarea')]) {
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !(e.shiftKey && el.tagName === 'TEXTAREA')) { e.preventDefault(); commitEditor(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEditor(); }
    if (el.tagName === 'TEXTAREA') setTimeout(() => autosize(el), 0);
  });
  el.addEventListener('blur', () => commitEditor());
}

// ===== Copy / paste / duplicate annotation objects (FR-GEN) =====
// Internal object clipboard (separate from the OS clipboard used for images).
let objClipboard = [];
let pasteCount = 0;
function copySelection() {
  const objs = [...app.selection].map((id) => scene.byId(id)).filter(Boolean);
  if (!objs.length) return false;
  objClipboard = objs.map((o) => JSON.parse(JSON.stringify(o)));
  pasteCount = 0;
  return true;
}
function pasteClipboard() {
  if (!objClipboard.length) return;
  pasteCount += 1;
  const off = 16 * pasteCount; // each successive paste steps further (world px)
  scene.commit();
  const ids = [];
  for (const src of objClipboard) {
    const o = JSON.parse(JSON.stringify(src));
    delete o.id;          // scene.add() assigns a fresh id
    delete o._labelPos;   // transient render cache — recomputed on draw
    app.env.typeFor(o.kind)?.translate?.(o, off, off);
    ids.push(scene.add(o).id);
  }
  app.setTool('select');
  app.env.selection.set(ids);
  app.requestRender();
}

// ===== Keyboard (global) =====
const hotkeys = new Map();
for (const t of toolList()) if (t.hotkey) hotkeys.set(t.hotkey, t.id);
document.addEventListener('keydown', (e) => {
  if (activeEditor) return; // editor owns the keyboard
  if (e.key === 'F8') { e.preventDefault(); toggleOrtho(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault(); e.shiftKey ? scene.redo() : scene.undo(); app.requestRender(); return;
  }
  // Copy / paste / duplicate objects. Image paste stays on the OS 'paste' event
  // below; Ctrl+V here only fires when the internal object clipboard is non-empty.
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    const ck = e.key.toLowerCase();
    if (ck === 'c' && app.selection.size) { if (copySelection()) e.preventDefault(); return; }
    if (ck === 'v' && objClipboard.length) { e.preventDefault(); pasteClipboard(); return; }
    if (ck === 'd' && app.selection.size) { e.preventDefault(); if (copySelection()) pasteClipboard(); return; }
  }
  // Only delete via keyboard in select mode — otherwise Backspace mid-creation
  // (e.g. between dimension clicks) would silently destroy a prior selection.
  if ((e.key === 'Delete' || e.key === 'Backspace') && app.activeToolId === 'select') { app.deleteSelection(); return; }
  if (app.onKeyDown(e)) return; // active tool consumed (Esc etc.)
  const k = e.key.toLowerCase();
  // R flips the selected object's arrows in select mode (FR-MARK-1): dimensions
  // toggle back-to-back ↔ face-to-face, arrow marks reverse head/tail. Else → Rect tool.
  if (k === 'r' && app.activeToolId === 'select' && app.selection.size) {
    const sel = [...app.selection].map((id) => scene.byId(id)).filter(Boolean);
    const act = sel.filter((o) => { const t = app.env.typeFor(o.kind); return t && (t.flipArrows || t.reverse || t.toggleArrow); });
    if (act.length) {
      scene.commit();
      for (const o of act) { const t = app.env.typeFor(o.kind); (t.flipArrows || t.reverse || t.toggleArrow)(o); }
      app.requestRender(); return;
    }
  }
  if (!e.ctrlKey && !e.metaKey && !e.altKey && hotkeys.has(k)) { app.setTool(hotkeys.get(k)); }
});
document.addEventListener('keyup', (e) => app.onKeyUp(e));

// ===== Paste / drag-drop image (FR-IO-2) =====
window.addEventListener('paste', async (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) { await loadImageInto(scene, item.getAsFile()); afterImage(); }
});
wrap.addEventListener('dragover', (e) => { e.preventDefault(); wrap.classList.add('drag-over'); });
wrap.addEventListener('dragleave', () => wrap.classList.remove('drag-over'));
wrap.addEventListener('drop', async (e) => {
  e.preventDefault(); wrap.classList.remove('drag-over');
  const f = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
  if (f) { await loadImageInto(scene, f); afterImage(); }
});
function afterImage() {
  dropHint.classList.add('hidden');
  document.getElementById('filename').textContent = `snip_${new Date().toISOString().slice(0, 10)}.png`;
  // fit image into view
  const s = scene.imageSize, W = canvas.clientWidth, H = canvas.clientHeight;
  const z = Math.min(1, (W - 80) / s.w, (H - 80) / s.h);
  app.view.zoom = z;
  app.view.panX = (W - s.w * z) / 2;
  app.view.panY = (H - s.h * z) / 2;
  app.ui.setZoom(Math.round(z * 100));
  app.requestRender();
}
function currentFilename() {
  const f = document.getElementById('filename').textContent;
  return /\.png$/i.test(f) ? f : 'mechmark.png';
}

// start on select
app.setTool('select');
ui.setObjCount(0);

// expose for debugging / Electron host integration
window.mechmark = { app, scene, style };

// Electron host bridge: accept captured images (Phase 2/3).
function dataUrlToBlob(src) {
  // Decode a data: URL without fetch(): the Electron shell's CSP (connect-src)
  // blocks fetching data: URLs, which would make captured images silently fail.
  const comma = src.indexOf(',');
  const meta = src.slice(5, comma);
  const mime = meta.split(';')[0] || 'image/png';
  const payload = src.slice(comma + 1);
  if (/;base64/i.test(meta)) {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(payload)], { type: mime });
}
window.mechmark.loadImage = async (src) => {
  let blob = src;
  if (typeof src === 'string') {
    blob = src.startsWith('data:') ? dataUrlToBlob(src) : await (await fetch(src)).blob();
  }
  await loadImageInto(scene, blob);
  afterImage();
};
window.mechmarkHost?.onCapture?.((dataUrl) => {
  window.mechmark.loadImage(dataUrl).catch((err) => console.error('[mechmark] load capture failed:', err));
});
window.mechmarkHost?.onCaptureError?.((msg) => { console.error('[mechmark] capture error:', msg); alert(msg); });

// ===== Capture-hotkey recorder (Electron only) =====
// Maps a KeyboardEvent to an Electron accelerator string, or null if it isn't a
// usable global hotkey (needs a Ctrl/Alt/Cmd modifier, or be a function key).
function toAccelerator(e) {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null;
  const parts = [];
  if (e.ctrlKey) parts.push('Control');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Super');
  let key = e.key;
  const map = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Return', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete' };
  if (map[key]) key = map[key];
  else if (key.length === 1) key = key.toUpperCase();
  else if (!/^F\d{1,2}$/.test(key)) return null; // unsupported special key
  const hasModifier = e.ctrlKey || e.altKey || e.metaKey;
  if (!hasModifier && !/^F\d{1,2}$/.test(key)) return null; // avoid stealing plain keys
  return parts.concat(key).join('+');
}
function prettyAccel(a) {
  return (a || '').replace('Control', 'Ctrl').replace('Super', 'Win').split('+').join(' + ');
}
async function setupHotkeyUI() {
  const ortho = document.getElementById('ortho-pill');
  if (!ortho) return;
  let current = (await window.mechmarkHost.getHotkey()) || 'Control+Shift+2';
  let recording = false;
  const pill = document.createElement('button');
  pill.className = 'ortho-pill hotkey-pill';
  pill.title = '點一下，然後按下新的組合鍵來設定截圖快捷鍵';
  pill.innerHTML = '<span class="ortho-text">截圖快捷鍵</span><span class="ortho-key" id="hk-label"></span>';
  ortho.insertAdjacentElement('afterend', pill);
  const label = pill.querySelector('#hk-label');
  const show = (txt) => { label.textContent = txt; };
  show(prettyAccel(current));

  pill.addEventListener('click', () => {
    recording = !recording;
    pill.classList.toggle('recording', recording);
    show(recording ? '按組合鍵…' : prettyAccel(current));
  });

  window.addEventListener('keydown', async (e) => {
    if (!recording || activeEditor) return;
    if (e.key === 'Escape') { recording = false; pill.classList.remove('recording'); show(prettyAccel(current)); e.preventDefault(); e.stopPropagation(); return; }
    const accel = toAccelerator(e);
    if (!accel) return; // wait for a complete, valid combo
    e.preventDefault(); e.stopPropagation();
    recording = false; pill.classList.remove('recording');
    const res = await window.mechmarkHost.setHotkey(accel);
    if (res && res.ok) { current = res.hotkey; show(prettyAccel(current)); }
    else { show(prettyAccel(current) + '（被佔用）'); setTimeout(() => show(prettyAccel(current)), 1400); }
  }, true); // capture phase: intercept before the tool/keyboard handlers
}
if (window.mechmarkHost?.isElectron) setupHotkeyUI();
