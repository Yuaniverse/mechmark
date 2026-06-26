# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MechMark is a Windows desktop annotation tool for mechanical engineers. Engineers take screenshots of CAD drawings and annotate them with engineering-grade dimension markings (linear, angular, radius/diameter) before pasting into reports or email. The core differentiation is producing ISO-correct dimension annotations in one gesture, not four steps.

The codebase is implemented in two layers:
1. **Phase 1 — web canvas engine** (`src/`, `index.html`): pure ES-module, no bundler, runs standalone in a browser for rapid iteration.
2. **Phase 2 — Electron shell** (`electron/`): wraps the unchanged canvas engine in a desktop window, adds global hotkey capture, system tray, and a custom `app://` protocol.

## Commands

```bash
# Run as a web app in the browser (Phase 1 dev — fastest iteration)
npm run dev        # serves on http://localhost:5174

# Run as the Electron desktop app (Phase 2)
npm run app        # electron .

# Build a distributable Windows installer / portable exe
npm run dist       # electron-builder --win
```

No test runner or linter is configured. There is no build step for the web layer — ES modules are served directly from `src/`.

## Architecture

### Source layout

```
src/
  main.js        — Entry point: registers tools, builds toolbar, wires all UI events
  app.js         — App class: render loop, view transform (zoom/pan), pointer/keyboard dispatch
  scene.js       — Document model: ordered object list + base image + undo/redo via snapshots
  registry.js    — Tool and type registry: every annotation module registers one descriptor here
  draw.js        — Shared rendering primitives: ISO arrows, extension lines, labels, degrade logic
  style.js       — Current-style singleton (lineWidth, color, textSize, etc.) + per-object snapshot
  geom.js        — Pure geometry utilities (sub, add, norm, perp, distToSegment, circleFrom3Points…)
  io.js          — Export: renderToCanvas → copyToClipboard / savePNG; loadImageInto scene

  tools/
    select.js    — Selection, drag, handle editing, box-select
    linear.js    — Linear dimension (reference implementation for all dimension tools)
    chain.js     — Continuous/chain dimension mode (shares linear.js logic)
    angle.js     — Angle dimension (4-point two-line)
    radius.js    — Radius annotation (3-point circle fit → R label)
    diameter.js  — Diameter annotation (3-point circle fit → Ø label)
    leader.js    — Callout leader (arrow → elbow → horizontal shoulder → text)
    arrow.js     — Simple arrow mark
    rect.js      — Rectangle mark
    ellipse.js   — Ellipse/circle mark
    text.js      — Free text
    pen.js       — Freehand pen
    highlighter.js — Highlighter (separate color/width from main style)
    balloon.js   — Part number balloon (Phase 2 item)

electron/
  main.js        — Electron main process: app:// protocol, BrowserWindow, system tray, global hotkey, settings
  preload.cjs    — Exposes mechmarkHost bridge (IPC, isElectron flag, capture callbacks)
  capture.js     — Screenshot capture overlay (Phase 3: separate overlay window + desktopCapturer)
  overlay.html/js/overlay-preload.cjs — Fullscreen dim + drag-select overlay for capture

tools/
  devserver.js   — Minimal Node http server for Phase 1 dev; not part of the Electron app
```

### Core contracts

**Tool descriptor** (registered via `registry.js`):
```js
{
  id, hotkey, icon, label,
  group,          // 0=select, 2=dimensions, 3=marks
  isDimension,    // true → uses dimLineWidth instead of lineWidth
  tool,           // creation state machine (onPointerDown/Move/Up, onKeyDown, drawPreview, reset)
  type,           // existing-object behaviour (draw, hitTest, handles, moveHandle, translate, editText, …)
  kinds?,         // extra object kinds this type handler serves
}
```

**env object** (passed to every tool/type method):
- `ctx` — Canvas 2D context (world-space transform already installed by App)
- `scene` — the Scene instance
- `style` — style module
- `zoom`, `view` — current view state
- `px(n)` — convert n screen px to world px (use for constant-size UI like handles)
- `orthoLock` — true when ortho is on (Shift temporarily inverts)
- `toScreen(worldPt)` / `toWorld(screenPt)` — coordinate conversion
- `addObject(obj)` — commit + add with undo
- `beginTextInput(opts)` / `endTextInput()` — open/close the inline editor overlay
- `selection` — { ids, list, has, set, add, clear }
- `hitTest(world, opts)` — top-most object under a world point
- `typeFor(kind)` — look up a type handler by kind string

**Object shape**: `{ id, kind, style: {lineWidth, textSize, color, lineStyle, fillColor, fillAlpha}, ...geometry }`

### Rendering model

All drawing is in **world space**. `App._render()` installs `transform = dpr * zoom` on the canvas context before calling `type.draw()` / `tool.drawPreview()`. Sizes in `draw.js` are therefore world px that scale with zoom — correct CAD behaviour. For screen-constant UI (handles, hit tolerances) use `env.px(n) = n / zoom`.

### Undo/redo

`scene.commit()` must be called **before** any mutation. It pushes a JSON snapshot of the whole object list. `scene.undo()` pops the last snapshot and restores. The undo stack is capped at 200.

### Two-stage small-dimension degrade (FR-DIM-SMALL)

`draw.js` `computeDimStage(S, textW, aLen)` decides: normal → degrade-1 (arrows flip outside) → degrade-2 (arrows outside + number pulled on leader). All dimension tools use `drawDimensionLine()` from `draw.js` so the degrade logic is centralised. Changing style (lineWidth, textSize) triggers an immediate re-render which re-evaluates the stage.

### Electron shell specifics

The app:// scheme serves the repo root over a privileged custom protocol so ES modules load correctly in Electron (file:// won't work with `type: "module"`). The main process registers `app://bundle/` → repo root. CSP is set on HTML responses. The preload (`preload.cjs`) uses `contextBridge` to expose `window.mechmarkHost` to the renderer. Closing the window hides to the system tray; only "Quit" from the tray menu actually exits. The capture hotkey (`electron/capture.js`) is a separate phase — the current code stubs it with a dynamic import guard so the app runs without it.

## Adding a new tool

1. Create `src/tools/<name>.js` exporting `{ id, hotkey, icon, label, group, tool, type }` as `default`.
2. Add `<symbol id="ic-<name>" …>` to the SVG sprite in `index.html`.
3. Add the `id` to `RAIL_ORDER` in `src/main.js`.
4. The module is auto-loaded by `loadOptional()` — no other registration needed.

The `linear.js` tool is the canonical reference; copy its structure for new dimension tools.
