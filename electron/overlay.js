// ===== MechMark overlay UI (Phase 3) =====
// Talks ONLY through window.overlayHost (injected by overlay-preload.cjs).
// Renders the display's frozen screenshot dimmed, lets the user rubber-band a
// rectangle (bright inside the selection), shows a live px readout, commits on
// mouseup, cancels on Esc / right-click.
//
// All geometry here is in CSS/DIP px relative to this overlay's top-left, which
// is exactly what the main process expects in 'overlay:commit'. The DIP ->
// device-pixel scaling for the actual crop happens in the main process using
// the scaleFactor we were handed.
(() => {
  'use strict';

  const $shot = document.getElementById('shot');
  const $sel = document.getElementById('sel');
  const $readout = document.getElementById('readout');
  const $top = document.getElementById('scrim-top');
  const $bottom = document.getElementById('scrim-bottom');
  const $left = document.getElementById('scrim-left');
  const $right = document.getElementById('scrim-right');

  const host = window.overlayHost;

  let scaleFactor = 1;
  let dragging = false;
  let committed = false; // guard against double-commit / commit-after-cancel
  let startX = 0;
  let startY = 0;
  let curRect = { x: 0, y: 0, w: 0, h: 0 };

  // Full scrim covers everything until a selection exists.
  function resetScrim() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    $top.style.left = '0'; $top.style.top = '0';
    $top.style.width = W + 'px'; $top.style.height = H + 'px';
    $bottom.style.display = 'none';
    $left.style.display = 'none';
    $right.style.display = 'none';
  }

  // Carve the four scrim panels around the selection rect so the inside is
  // bright (undimmed) and the outside stays dimmed.
  function layoutScrim(r) {
    const W = window.innerWidth;
    const H = window.innerHeight;

    $top.style.display = 'block';
    $bottom.style.display = 'block';
    $left.style.display = 'block';
    $right.style.display = 'block';

    // Top band: full width, from 0 to r.y
    $top.style.left = '0px'; $top.style.top = '0px';
    $top.style.width = W + 'px'; $top.style.height = r.y + 'px';

    // Bottom band: full width, from r.y+r.h to bottom
    $bottom.style.left = '0px'; $bottom.style.top = (r.y + r.h) + 'px';
    $bottom.style.width = W + 'px'; $bottom.style.height = Math.max(0, H - (r.y + r.h)) + 'px';

    // Left band: only across the selection's vertical span
    $left.style.left = '0px'; $left.style.top = r.y + 'px';
    $left.style.width = r.x + 'px'; $left.style.height = r.h + 'px';

    // Right band: only across the selection's vertical span
    $right.style.left = (r.x + r.w) + 'px'; $right.style.top = r.y + 'px';
    $right.style.width = Math.max(0, W - (r.x + r.w)) + 'px'; $right.style.height = r.h + 'px';
  }

  function drawSelection(r) {
    $sel.style.display = 'block';
    $sel.style.left = r.x + 'px';
    $sel.style.top = r.y + 'px';
    $sel.style.width = r.w + 'px';
    $sel.style.height = r.h + 'px';
    layoutScrim(r);

    // Readout shows device-pixel size (what actually gets cropped), which is
    // what an engineer cares about. CSS size = r.w x r.h; device = * scaleFactor.
    const dw = Math.round(r.w * scaleFactor);
    const dh = Math.round(r.h * scaleFactor);
    $readout.style.display = 'block';
    $readout.textContent = `${dw} x ${dh} px`;

    // Position the readout just below the selection, clamped on-screen.
    let rx = r.x;
    let ry = r.y + r.h + 6;
    if (ry + 24 > window.innerHeight) ry = Math.max(0, r.y - 24); // flip above
    const maxX = window.innerWidth - $readout.offsetWidth - 4;
    if (rx > maxX) rx = Math.max(0, maxX);
    $readout.style.left = rx + 'px';
    $readout.style.top = ry + 'px';
  }

  function normRect(x0, y0, x1, y1) {
    const x = Math.min(x0, x1);
    const y = Math.min(y0, y1);
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    return { x, y, w, h };
  }

  function cancel() {
    if (committed) return;
    committed = true;
    host && host.cancel();
  }

  function commit(r) {
    if (committed) return;
    committed = true;
    host && host.commit(r);
  }

  // ---- Pointer handling ----
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // only left-drag starts a selection
    e.preventDefault();
    dragging = true;
    committed = false;
    document.body.classList.add('dragging');
    startX = e.clientX;
    startY = e.clientY;
    curRect = { x: startX, y: startY, w: 0, h: 0 };
    drawSelection(curRect);
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    curRect = normRect(startX, startY, e.clientX, e.clientY);
    drawSelection(curRect);
  });

  window.addEventListener('mouseup', (e) => {
    if (!dragging || e.button !== 0) return;
    dragging = false;
    curRect = normRect(startX, startY, e.clientX, e.clientY);
    // Non-trivial selection required (avoid stray clicks committing a 0-area).
    if (curRect.w >= 3 && curRect.h >= 3) {
      commit(curRect);
    } else {
      // Treat a click with no real drag as "keep selecting" — reset to scrim.
      $sel.style.display = 'none';
      $readout.style.display = 'none';
      resetScrim();
    }
  });

  // Esc cancels.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });

  // Right-click cancels (and never shows the OS context menu).
  window.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); });

  window.addEventListener('resize', () => {
    if (dragging || $sel.style.display === 'block') return;
    resetScrim();
  });

  // ---- Boot: pull this overlay's screenshot from main ----
  (async () => {
    try {
      const shot = host ? await host.getShot() : null;
      if (!shot) { cancel(); return; }
      scaleFactor = shot.scaleFactor || 1;
      $shot.src = shot.dataUrl;
      resetScrim();
    } catch (err) {
      // If we can't get the screenshot, bail out cleanly.
      cancel();
    }
  })();
})();
