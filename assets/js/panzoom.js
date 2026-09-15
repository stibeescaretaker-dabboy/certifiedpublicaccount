/* =====================================================================
   Pan & zoom engine + drifting floaters.
   World geometry must match the constants documented in style.css.
   ===================================================================== */
(function () {
  'use strict';
  var ROOT = (document.body.getAttribute('data-root') || '/').replace(/\/?$/, '/');
  var WORLD_W = 24000, COL_X = 10000, COL_Y = 6000, COL_W = 4000;
  var MIN_S = 0.04, MAX_S = 4;

  var world = document.getElementById('world');
  var column = document.getElementById('column');
  var floatersEl = document.getElementById('floaters');
  var vw = window.innerWidth, vh = window.innerHeight;
  var colH = 24000, worldH = 60000;
  var tx = 0, ty = 0, s = 1;
  var lastTouchT = 0;
  var normalMode = false; /* normal mode: zoom locked so only the black column shows */

  /* ---- pin the document to the top ---- */
  /* the world is 60000px tall; mobile browsers scroll that document natively
     (rubber-band etc.) and restore the old offset on reload, landing mid-page.
     The app never scrolls natively, so any scroll offset is unwanted. */
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);
  window.addEventListener('scroll', function () {
    if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
  });

  function measure() {
    colH = column.offsetHeight;
    worldH = colH + 12000;
    world.style.height = worldH + 'px';
  }
  function minS() { /* normal mode never zooms out past the column covering the screen */
    return normalMode ? Math.max(vw / COL_W, vh / colH) : MIN_S;
  }
  function clamp() { /* keep the column reachable; bounds may invert when zoomed in */
    var keep = 120 * Math.min(1, 0.35 / s); /* deadzone shrinks at high zoom, letting zoom anchor to the cursor at the edges */
    var loX = keep - (COL_X + COL_W) * s, hiX = vw - keep - COL_X * s;
    var loY = keep - (COL_Y + colH) * s, hiY = vh - keep - COL_Y * s;
    if (normalMode) { /* lock the view to the black column: its edges may never enter the viewport */
      loX = Math.max(loX, vw - (COL_X + COL_W) * s);
      hiX = Math.min(hiX, -COL_X * s);
      loY = Math.max(loY, vh - (COL_Y + colH) * s);
      hiY = Math.min(hiY, -COL_Y * s);
    }
    tx = Math.min(Math.max(tx, Math.min(loX, hiX)), Math.max(loX, hiX));
    ty = Math.min(Math.max(ty, Math.min(loY, hiY)), Math.max(loY, hiY));
  }
  function apply() {
    world.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')';
    /* keep the toggle hit-halo a constant SCREEN size: expose 1/s so CSS can
       grow the halo in world px as you zoom out (otherwise it shrinks with the
       world and buttons become hard to click when zoomed out) */
    if (s !== hitSLast) { hitSLast = s; document.documentElement.style.setProperty('--hs', String(Math.min(2.5, 1 / s))); } /* capped: max 2.5x so the halo isn't enormous at max zoom-out */
  }
  var hitSLast = 0;
  /* ---- fluid panning: coalesce pan/zoom style writes to one per frame ----
     phones fire pointermove faster than the screen refreshes; writing the
     transform for every event wastes work and reads as sluggish. Both move
     paths call scheduleApply() and the transform lands once per frame. */
  var rafPending = false;
  function scheduleApply() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () { rafPending = false; clamp(); apply(); });
  }
  /* ---- momentum glide: a drag release keeps gliding, decaying to a stop ----
     pan-yanked-to-a-stop feels clunky; a short inertial glide feels native. */
  var momentumId = 0, velX = 0, velY = 0, lastMoveT = 0, pinched = false, postPinchDist = 0;
  function startMomentum() {
    if (overlayOpen) return;
    if (pinched) return;                      /* a pinch is a zoom, not a flick: no glide */
    if (Math.abs(velX) + Math.abs(velY) < 2) return; /* slow release: stop in place */
    momentumId++;
    /* cap the release speed so a fast flick can't rocket the view */
    var cap = 40, ax = Math.max(-cap, Math.min(cap, velX)), ay = Math.max(-cap, Math.min(cap, velY));
    /* movement assist (axis lock) governs the glide too: one axis only,
       the one the gesture committed to (or the dominant velocity direction) */
    if (axisBox && axisBox.checked) {
      var ax2 = axis || (Math.abs(ax) >= Math.abs(ay) ? 'x' : 'y');
      if (ax2 === 'x') ay = 0; else ax = 0;
    }
    var id = momentumId, decay = 0.90;
    (function step() {
      if (id !== momentumId) return;         /* any new touch/zoom cancels the glide */
      tx += ax; ty += ay; clamp(); apply();
      ax *= decay; ay *= decay;
      if (Math.abs(ax) + Math.abs(ay) > 0.3) requestAnimationFrame(step);
    })();
  }
  function initialView() {
    if (normalMode) {
      /* locked zoom on: start maxed zoomed out, column top flush with the top of the page */
      s = minS();
      tx = vw * 0.5 - (COL_X + COL_W * 0.5) * s;   /* column centered horizontally */
      ty = -COL_Y * s;                              /* column top at the viewport top */
      clamp(); apply();
      return;
    }
    /* free mode: start zoomed in on the "Click/tap and drag" text */
    var el = document.querySelector('.howto');
    /* measure the words themselves at scale 1 — offsetWidth spans the whole
       header column, which framed the text off-center and half off-screen */
    world.style.transform = 'none';
    var rng = document.createRange();
    rng.selectNodeContents(el);
    var b = rng.getBoundingClientRect();
    var wr = world.getBoundingClientRect();
    var wx = b.left - wr.left + b.width * 0.5;
    var wy = b.top - wr.top + b.height * 0.5;
    /* 3 extra scroll-wheel ticks of zoom: each tick is ~exp(0.16) = 1.174x */
    s = Math.min(Math.max((vw / (b.width + 700)) * Math.exp(0.16 * 3), MIN_S), 2.5);
    tx = vw * 0.5 - wx * s;
    ty = vh * 0.5 - wy * s;
    clamp(); apply();
  }
  function zoomAt(cx, cy, f) {
    var ns = Math.min(MAX_S, Math.max(minS(), s * f));
    if (ns === s) return;
    tx = cx - (cx - tx) * (ns / s);
    ty = cy - (cy - ty) * (ns / s);
    s = ns; clamp(); apply();
  }
  function dist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy) || 1; }

  /* ---- virtual fist cursors (touch): one closed fist per finger ---- */
  /* during a pinch each finger gets its own cursor; on release the open fist
     lingers in place, fading out over 3s, then is removed */
  var cursors = new Map(); /* pointerId -> { el, timer } */
  function vcurShow(id, x, y, ui) {
    var c = cursors.get(id);
    if (!c) {
      var el = document.createElement('img');
      el.className = 'virtual-cursor';
      el.alt = '';
      el.draggable = false;
      el.src = ROOT + 'assets/images/cursor-closed.png';
      document.body.appendChild(el);
      c = { el: el, timer: 0, ui: false };
      cursors.set(id, c);
    }
    clearTimeout(c.timer);
    /* fingers over hand-ui controls (toggles, bio) get the click fist */
    c.ui = !!ui;
    c.el.src = ROOT + 'assets/images/' + (c.ui ? 'click%20fist.png' : 'cursor-closed.png');
    c.el.style.left = x + 'px';
    c.el.style.top = y + 'px';
    c.el.classList.remove('fade');
    c.el.classList.add('show');
  }
  function vcurMove(id, x, y) {
    var c = cursors.get(id);
    if (c) { c.el.style.left = x + 'px'; c.el.style.top = y + 'px'; }
  }
  function vcurRelease(id, x, y) {
    var c = cursors.get(id);
    if (!c) return;
    /* click fist (over UI controls) fades in place; the grab fist opens first */
    if (!c.ui) c.el.src = ROOT + 'assets/images/cursor-open.png';
    c.el.style.left = x + 'px';
    c.el.style.top = y + 'px';
    c.el.classList.remove('show');
    c.el.classList.add('fade');
    c.timer = setTimeout(function () {
      if (c.el.parentNode) c.el.parentNode.removeChild(c.el);
      cursors.delete(id);
    }, 3100);
  }

  /* ---- hand cursors for UI controls (toggles, buttons) ---- */
  /* convention: add class "hand-ui" to any interactive control — hovering it
     shows the pointer fist, pressing it shows the click fist. !important keeps
     child elements (e.g. the checkbox) from falling back to the OS default. */
  (function () {
    var base = ROOT + 'assets/images/';
    var st = document.createElement('style');
    st.textContent =
      '.hand-ui, .hand-ui * { cursor: url("' + base + 'pointer fist.png") 12 4, pointer !important; }' +
      '.hand-ui:active, .hand-ui:active * { cursor: url("' + base + 'click fist.png") 12 4, pointer !important; }';
    document.head.appendChild(st);
  })();

  /* ---- movement assist (axis lock) ---- */
  var axisBox = document.getElementById('axis-lock');
  var axis = null; /* committed per-gesture: 'x', 'y', or null until movement starts */

  /* ---- normal mode: lock zoom so only the black column is visible ---- */
  var normalBox = document.getElementById('normal-mode');
  if (normalBox) normalBox.addEventListener('change', function () {
    normalMode = normalBox.checked;
    stopTween();
    if (normalMode) {
      if (s < minS()) zoomAt(vw / 2, vh / 2, minS() / s); /* turning it ON: pull in to the fit scale */
      else { clamp(); apply(); }
    } else {
      /* turning it OFF (untoggle): zoom out a little, clamped to the unlocked min */
      zoomAt(vw / 2, vh / 2, 0.85);
    }
  });
  if (normalBox) normalMode = normalBox.checked; /* honor the checked default from the markup */

  /* ---- large text: re-render the whole site 2 font sizes bigger ---- */
  var largeBox = document.getElementById('large-text');
  if (largeBox) largeBox.addEventListener('change', function () {
    document.documentElement.classList.toggle('large-text', largeBox.checked);
  });

  /* ---- bio toggle: real checkbox styled like the others; flies to the statement ---- */
  var bioBox = document.getElementById('bio-box');
  if (bioBox) {
    bioBox.addEventListener('change', function () {
      if (moved >= 8) { bioBox.checked = false; return; } /* it was a drag, not a tap */
      stopTween(); flyTo('#section-4');
      bioBox.checked = false; /* it's an action, not a state (programmatic set doesn't re-fire change) */
    });
  }

  /* ---- section nav widget: press to reveal up/down arrows, arrow = snap to
     prev/next section, press again to hide. Lives on <body> (screen-fixed),
     NOT inside #world, so position:fixed actually sticks to the viewport. ---- */
  (function () {
    var widget = document.createElement('div');
    widget.className = 'nav-widget';
    widget.innerHTML =
      '<button type="button" class="nav-btn nav-up hand-ui" aria-label="previous section"></button>' +
      '<button type="button" class="nav-btn nav-down hand-ui" aria-label="next section"></button>' +
      '<button type="button" class="nav-btn nav-toggle hand-ui" aria-label="show or hide section arrows"></button>';
    document.body.appendChild(widget);

    var toggle = widget.querySelector('.nav-toggle');
    toggle.addEventListener('click', function (e) {
      e.stopPropagation(); e.preventDefault();
      if (moved >= 8) return; /* it was a drag, not a tap */
      widget.classList.toggle('open');
    });

    function sections() {
      return Array.prototype.slice.call(document.querySelectorAll('#column > .block'));
    }
    function nearestIndex(els) {
      /* world-y of the viewport center; closest block center wins */
      var wy = (vh / 2 - ty) / s, best = 0, bestD = Infinity;
      els.forEach(function (el, i) {
        var r = worldRectOf(el);
        var d = Math.abs(r.y + r.h / 2 - wy);
        if (d < bestD) { bestD = d; best = i; }
      });
      return best;
    }
    function go(dir) {
      var els = sections();
      if (!els.length) return;
      var i = nearestIndex(els) + dir;
      i = Math.max(0, Math.min(els.length - 1, i));
      stopTween(); flyTo('#' + (els[i].id || els[i].tagName.toLowerCase()));
    }
    /* hold-to-repeat: pressing an arrow hops one section every 0.75s until release */
    function holdRepeat(btn, dir) {
      var timer = null;
      function start(e) {
        e.stopPropagation(); e.preventDefault();
        go(dir); /* first hop right away, then every 0.75s while held */
        timer = setInterval(function () { go(dir); }, 750);
      }
      function stop() { if (timer) { clearInterval(timer); timer = null; } }
      btn.addEventListener('pointerdown', start);
      btn.addEventListener('pointerup', stop);
      btn.addEventListener('pointerleave', stop);
      btn.addEventListener('pointercancel', stop);
      /* touch devices: keep the press from also firing a click/scroll */
      btn.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); });
    }
    holdRepeat(widget.querySelector('.nav-up'), -1);
    holdRepeat(widget.querySelector('.nav-down'), 1);
  })();

  var overlayOpen = false; /* true while the read/img overlay covers the screen —
                              world pan/zoom pauses and the overlay drag-scrolls instead */
  /* ---- EXPERIMENTAL: reading & image modes. Every section carries "read" and
     "IMG." toggles (styled like the assist-toggles). "read" opens a black overlay
     with the section's text re-flowed; "IMG." opens the same overlay showing the
     section's images stacked in an optimized vertical row. The toggles live
     inside their section, so they travel with it during pan/zoom. ---- */
  (function () {
    var overlay = document.createElement('div');
    overlay.className = 'read-overlay';
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'read-close hand-ui';
    close.textContent = 'close';
    overlay.appendChild(close);
    var page = document.createElement('div');
    page.className = 'read-page';
    overlay.appendChild(page);
    document.body.appendChild(overlay);

    var activeBox = null;

    function buildText(section) {
      var clone = section.cloneNode(true);
      Array.prototype.forEach.call(clone.querySelectorAll('img, video, audio, object, .read-toggle'), function (el) {
        if (el.parentNode) el.parentNode.removeChild(el);
      });
      page.innerHTML = '';
      page.appendChild(clone);
    }
    function buildImages(section) {
      page.innerHTML = '';
      var imgs = section.querySelectorAll('img');
      if (!imgs.length) {
        page.textContent = 'This section has no images.';
        return;
      }
      Array.prototype.forEach.call(imgs, function (src) {
        var img = src.cloneNode(false);
        img.className = 'read-img';
        img.setAttribute('draggable', 'false');
        page.appendChild(img);
      });
    }

    /* ---- zoom inside the img overlay: pinch (touch), wheel, drag-to-pan ----
       The page div carries the zoom transform (origin 0 0); zoom >= 1.
       While zoomed in, the overlay switches to touch-action:none and we pan it
       ourselves (native vertical scroll would fight the pan). */
    var oz = 1, ox = 0, oy = 0, oPointers = new Map(), oPinch = null, oPan = null;
    function oApply() {
      page.style.transformOrigin = '0 0';
      page.style.transform = 'translate(' + ox + 'px,' + oy + 'px) scale(' + oz + ')';
      overlay.style.touchAction = oz > 1.01 ? 'none' : 'pan-y';
    }
    function oReset() {
      oz = 1; ox = 0; oy = 0; oPinch = null; oPan = null;
      page.style.transform = ''; oApply();
    }
    overlay.addEventListener('pointerdown', function (e) {
      if (!page.classList.contains('img-mode')) return;
      if (e.target.closest && e.target.closest('.read-close')) return;
      if (e.button !== undefined && e.button !== 0) return;
      try { e.target.setPointerCapture(e.pointerId); } catch (err) {}
      oPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      /* NO preventDefault here: canceling pointerdown suppresses the native
         scroll that follows — the cause of the "funky, almost not working"
         overlay scrolling. Native scroll stays active until zoomed in. */
      if (oPointers.size >= 2) {
        var pts = Array.from(oPointers.values());
        var d = Math.max(dist(pts[0], pts[1]), 24);
        oPinch = { d0: d, oz0: oz, ox0: ox, oy0: oy, mx: (pts[0].x + pts[1].x) / 2, my: (pts[0].y + pts[1].y) / 2 };
        oPan = null;
      } else if (oz > 1.01) {
        oPan = { x: e.clientX, y: e.clientY };
      }
    });
    window.addEventListener('pointermove', function (e) {
      if (!oPointers.has(e.pointerId)) return;
      var p = oPointers.get(e.pointerId);
      var dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (oPointers.size >= 2 && oPinch) {
        var pts = Array.from(oPointers.values());
        var d = Math.max(dist(pts[0], pts[1]), 24);
        var f = Math.max(0.5, Math.min(2, d / oPinch.d0));
        var noz = Math.min(8, Math.max(1, oPinch.oz0 * f));
        var mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
        /* keep the pinch midpoint fixed, plus follow the midpoint's own drift */
        ox = oPinch.ox0 + (oPinch.mx - oPinch.ox0) * (1 - noz / oPinch.oz0) + (mx - oPinch.mx);
        oy = oPinch.oy0 + (oPinch.my - oPinch.oy0) * (1 - noz / oPinch.oz0) + (my - oPinch.my);
        oz = noz; oApply();
      } else if (oPan && oPointers.size === 1 && oz > 1.01) {
        ox += dx; oy += dy; oApply();
      }
    });
    function oEnd(e) {
      if (!oPointers.has(e.pointerId)) return;
      oPointers.delete(e.pointerId);
      oPinch = null; oPan = null;
      if (oPointers.size === 0 && oz <= 1.01) oReset();
    }
    window.addEventListener('pointerup', oEnd);
    window.addEventListener('pointercancel', oEnd);
    overlay.addEventListener('wheel', function (e) {
      if (!page.classList.contains('img-mode')) return; /* text mode scrolls natively */
      if (!e.ctrlKey) return; /* plain wheel/trackpad scroll: native (works at 1x and while zoomed) */
      e.preventDefault();
      var f = Math.exp(-e.deltaY * 0.0016);
      var noz = Math.min(8, Math.max(1, oz * f));
      if (noz === oz) return;
      /* keep the cursor's point fixed while zooming */
      var rect = page.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      ox = mx - (mx - ox) * (noz / oz);
      oy = my - (my - oy) * (noz / oz);
      oz = noz;
      if (oz <= 1.001) { ox = 0; oy = 0; oz = 1; }
      oApply();
    }, { passive: false });

    function open(section, box, imgMode) {
      if (activeBox && activeBox !== box) activeBox.checked = false; /* one view at a time */
      activeBox = box;
      page.classList.toggle('img-mode', !!imgMode);
      /* statement prose reads better at double the standard measure */
      page.classList.toggle('wide', !!(section.classList && section.classList.contains('secstatement')));
      if (imgMode) buildImages(section); else buildText(section);
      oReset(); /* fresh view: clear any zoom from the previous img view */
      overlayOpen = true;
      overlay.classList.add('open');
    }
    function closeAll() { oReset(); overlay.classList.remove('open'); overlayOpen = false; if (activeBox) activeBox.checked = false; activeBox = null; }
    function sectionOf(label) { return label.closest ? label.closest('.block') : null; }

    /* for every "read" toggle, add an "img" toggle beside it (skipping sections
       with no images, like the statement) and wire both */
    Array.prototype.forEach.call(document.querySelectorAll('#column .read-toggle'), function (label) {
      var box = label.querySelector('input');
      if (!box) return;
      var section = sectionOf(label) || label.parentNode;

      if (section.querySelector('img')) {   /* only add "img" where there are images */
        var imgLabel = document.createElement('label');
        imgLabel.className = 'read-toggle hand-ui';
        var imgBox = document.createElement('input');
        imgBox.type = 'checkbox';
        imgLabel.appendChild(imgBox);
        imgLabel.appendChild(document.createTextNode('img'));
        label.parentNode.insertBefore(imgLabel, label.nextSibling); /* to the right of "read" */
      }

      box.addEventListener('change', function (e) {
        e.stopPropagation();
        if (activeBox && activeBox !== box) activeBox.checked = false;
        if (box.checked) { if (imgBox && imgBox.checked) imgBox.checked = false; if (sectionOf(label)) open(sectionOf(label), box, false); else box.checked = false; }
        else closeAll();
      });
      box.addEventListener('click', function (e) { e.stopPropagation(); });

      if (imgBox) imgBox.addEventListener('change', function (e) {
        e.stopPropagation();
        if (imgBox.checked) { if (box.checked) box.checked = false; if (sectionOf(imgLabel)) open(sectionOf(imgLabel), imgBox, true); else imgBox.checked = false; }
        else closeAll();
      });
    });
    close.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); closeAll(); });

    /* mouse drag-to-scroll: touch already scrolls natively (touch-action: pan-y),
       but an overflow container ignores mouse drags — map them to scrolling so
       the click-and-drag feel carries over into the reading view. */
    var dragScrolling = false, dragStartY = 0, dragStartScroll = 0;
    overlay.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') return;   /* native scroll handles touch */
      if (page.classList.contains('img-mode') && oz > 1.01) return; /* zoomed img view pans via oPointers instead */
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest && e.target.closest('.read-close')) return;  /* close stays a click */
      dragScrolling = true;
      dragStartY = e.clientY;
      dragStartScroll = overlay.scrollTop;
      e.preventDefault();                       /* don't select text/images while dragging */
    });
    window.addEventListener('pointermove', function (e) {
      if (!dragScrolling) return;
      overlay.scrollTop = dragStartScroll - (e.clientY - dragStartY);
    });
    window.addEventListener('pointerup', function () { dragScrolling = false; });
    window.addEventListener('pointercancel', function () { dragScrolling = false; });
  })();

  /* ---- pointer input: mouse drag, 1-finger pan, 2-finger pinch ---- */
  var pointers = new Map(), pinch = null, moved = 0;
  function snapPinch() { /* snapshot the two most recent fingers; a stale
     snapshot after fingers change caused sudden zoom jumps on phones */
    if (pointers.size >= 2) {
      var p = Array.from(pointers.values()).slice(-2);
      var pd = Math.max(dist(p[0], p[1]), 24); /* floor stops blow-ups when fingers land close together */
      pinch = { d0: pd, ld: pd };
    } else pinch = null;
  }
  var lastTap = 0, lastTapX = 0, lastTapY = 0;
  /* never let the browser grab images for native drag — always pan instead */
  window.addEventListener('dragstart', function (e) { e.preventDefault(); });
  window.addEventListener('pointerdown', function (e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (overlayOpen) return; /* overlay covers the screen: world pan pauses, the overlay drag-scrolls instead */
    try { e.target.setPointerCapture(e.pointerId); } catch (err) {}
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0; stopTween();
    momentumId++; /* a fresh touch kills any glide */
    if (pointers.size === 1) { /* first finger of a new gesture: pinch state resets */
      pinched = false; postPinchDist = 0;
      velX = 0; velY = 0; lastMoveT = Date.now();
    }
    axis = null;
    if (e.pointerType === 'touch') {
      var ui = !!(e.target.closest && e.target.closest('.hand-ui'));
      vcurShow(e.pointerId, e.clientX, e.clientY, ui);
    }
    document.body.classList.add('dragging');
    if (pointers.size >= 2) { snapPinch(); pinched = true; postPinchDist = 0; velX = 0; velY = 0; } /* two fingers: velocity cross-talk, so no glide after this gesture */
  });
  window.addEventListener('pointermove', function (e) {
    var p = pointers.get(e.pointerId);
    if (!p) return;
    var dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    /* smoothed per-frame velocity, for the release glide.
       While pinched (or in the pinch-tail), velocity stays frozen: the staggered
       lift of two fingers otherwise slingshots a bogus momentum release.
       Leeway: ~24px of real dragging after the pinch re-arms momentum. */
    if (pinched) {
      /* velocity only re-arms while ONE finger remains after the pinch.
         Counting movement during the pinch itself would re-arm mid-gesture
         (two fingers feed the same counter) and rebuild the slingshot. */
      if (pointers.size === 1 && !pinch) {
        postPinchDist += Math.abs(dx) + Math.abs(dy);
        if (postPinchDist > 24) { pinched = false; velX = 0; velY = 0; lastMoveT = Date.now(); }
      }
    } else {
      var now = Date.now(), dt = Math.max(1, now - lastMoveT); lastMoveT = now;
      var fx = (dx / dt) * 16.7, fy = (dy / dt) * 16.7; /* normalize to px per frame */
      velX = velX * 0.7 + fx * 0.3; velY = velY * 0.7 + fy * 0.3;
    }
    if (e.pointerType === 'touch') vcurMove(e.pointerId, e.clientX, e.clientY);
    if (pointers.size === 1) {
      if (axisBox && axisBox.checked) {
        /* commit to one axis on the first meaningful motion of the gesture */
        if (!axis && moved > 10) axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
        if (axis === 'x') dy = 0;
        else if (axis === 'y') dx = 0;
      }
      tx += dx; ty += dy; scheduleApply();
    }
    else if (pointers.size >= 2 && pinch) {
      /* incremental pinch: zoom anchored at the current midpoint, capped
         per-event so one glitchy reading can't fling the zoom */
      var pt = Array.from(pointers.values());
      var d = dist(pt[0], pt[1]);
      var mx = (pt[0].x + pt[1].x) / 2, my = (pt[0].y + pt[1].y) / 2;
      var f = Math.max(0.5, Math.min(2, d / (pinch.ld || d)));
      pinch.ld = d;
      var ns = Math.min(MAX_S, Math.max(minS(), s * f));
      var wx = (mx - tx) / s, wy = (my - ty) / s;
      s = ns; tx = mx - wx * ns; ty = my - wy * ns; scheduleApply();
    }
  });
  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    snapPinch();
    /* NOTE: when a pinch ends with one finger still down, `pinched` deliberately
       stays set — the staggered lift must not slingshot. Velocity stays frozen
       until the remaining finger drags ~24px (handled in pointermove). */
    if (pointers.size === 0) {
      document.body.classList.remove('dragging');
      /* a real drag (not a tap, not a pinch) glides a little after release */
      if (moved >= 8 && !pinch) startMomentum();
    }
    /* release whichever finger lifted — its open fist fades in place (works per-finger during a pinch) */
    if (e.pointerType === 'touch') { lastTouchT = Date.now(); vcurRelease(e.pointerId, e.clientX, e.clientY); }
    if (pointers.size === 0) {
      if (moved < 8) { /* tap */
        var now = Date.now();
        if (e.pointerType !== 'mouse' && now - lastTap < 320 &&
            Math.abs(e.clientX - lastTapX) < 40 && Math.abs(e.clientY - lastTapY) < 40) {
          zoomAt(e.clientX, e.clientY, 1.9); lastTap = 0;
        } else { lastTap = now; lastTapX = e.clientX; lastTapY = e.clientY; }
      }
    }
  }
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);

  /* ---- trackpad vs mouse: two-finger scroll pans like a traditional site,
     trackpad pinch (browsers map it to ctrl+wheel) zooms, mouse wheel zooms ----
     Detection: trackpads emit small/fractional deltas, often both axes at once;
     mouse wheels emit large integer jumps on Y only. Score recent events. */
  var wpScore = 0, wpDecided = false, wpIsTrackpad = false;
  function trackpadLike(e, dy0) {
    if (wpDecided) return wpIsTrackpad;
    var frac = Math.abs(e.deltaY % 1) > 0.01 || Math.abs(e.deltaX % 1) > 0.01;
    var hasX = Math.abs(e.deltaX) > 0.5;
    var small = Math.abs(dy0) > 0 && Math.abs(dy0) < 50;
    if (frac) wpScore += 2;
    if (hasX) wpScore += 2;
    if (small) wpScore += 1;
    if (Math.abs(dy0) >= 90 && !frac && !hasX) wpScore -= 3;
    if (wpScore >= 3) { wpDecided = true; wpIsTrackpad = true; }
    if (wpScore <= -3) { wpDecided = true; wpIsTrackpad = false; }
    return wpDecided ? wpIsTrackpad : (frac || hasX || small);
  }
  function vcMake() {
    var el = document.createElement('img');
    el.className = 'virtual-cursor'; el.alt = ''; el.draggable = false;
    document.body.appendChild(el);
    return el;
  }
  /* scroll fist: one fist per gesture that moves opposite the scroll with no
     per-event cap; when it runs off the top or bottom of the screen it resets
     to mid-screen and starts over. Spawns 100px left of where the cursor was
     when scrolling began. Stops → opens and fades 2s. */
  var sfEl = null, sfTimer = 0, sfX = 0;
  function sfEvent(dx, dy, cursorX) {
    clearTimeout(sfTimer);
    if (!sfEl) { /* fresh gesture: spawn offset AWAY from center — cursor on the left half: 100px left; right half: 100px right */
      sfEl = vcMake();
      sfEl.src = ROOT + 'assets/images/cursor-closed.png';
      sfX = cursorX < vw / 2 ? cursorX - 100 : cursorX + 100;
      sfEl.style.left = sfX + 'px';
      sfEl.style.top = (vh * 0.5) + 'px';
      sfEl.classList.add('show');
    } else { /* continuing: re-close and keep moving */
      sfEl.src = ROOT + 'assets/images/cursor-closed.png';
      sfEl.classList.remove('fade', 'fade2');
      sfEl.classList.add('show');
    }
    var y = parseFloat(sfEl.style.top) - dy * 0.25; /* opposite the scroll, slower, no cap */
    if (y < 0 || y > vh) y = vh * 0.5;             /* ran off the edge: reset and start over */
    sfEl.style.top = y + 'px';
    sfTimer = setTimeout(sfStop, 150);
  }
  function sfStop() {
    if (!sfEl) return;
    var el = sfEl;
    sfEl = null; /* the gesture ended: the next scroll spawns a brand-new fist */
    el.src = ROOT + 'assets/images/cursor-open.png';
    el.classList.remove('show');
    el.classList.add('fade2');
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 2100);
  }
  /* pinch fists: the cursor is the CENTER — the pair straddles it diagonally
     at 45 degrees, starting 270px apart, spreading when zooming in and closing
     when out; they open and fade 2s after the pinch stops */
  var pfA = null, pfB = null, pfTimer = 0, pfD = 270, pfX = 0, pfY = 0;
  function pfPlace() {
    var d = pfD * 0.35355; /* half-spacing projected on each axis for 45 degrees */
    pfA.style.left = (pfX + d) + 'px'; pfA.style.top = (pfY - d) + 'px';   /* up-right */
    pfB.style.left = (pfX - d) + 'px'; pfB.style.top = (pfY + d) + 'px';   /* down-left */
  }
  function pfEvent(f, cx, cy) {
    clearTimeout(pfTimer);
    if (!pfA) { /* fresh pinch: spawn centered on the focal point (cursor) */
      pfA = vcMake(); pfB = vcMake();
      pfX = cx; pfY = cy; pfD = 270;
      pfA.src = ROOT + 'assets/images/cursor-closed.png';
      pfB.src = ROOT + 'assets/images/cursor-closed.png';
      pfPlace();
      pfA.classList.add('show'); pfB.classList.add('show');
    } else { /* continuing: re-close and keep spreading/closing */
      pfA.src = ROOT + 'assets/images/cursor-closed.png';
      pfB.src = ROOT + 'assets/images/cursor-closed.png';
      pfA.classList.remove('fade', 'fade2'); pfB.classList.remove('fade', 'fade2');
      pfA.classList.add('show'); pfB.classList.add('show');
    }
    pfD = Math.min(Math.max(pfD * f, 40), Math.min(vw, vh) * 0.8);
    pfPlace();
    pfTimer = setTimeout(pfStop, 150);
  }
  function pfStop() {
    if (!pfA) return;
    var a = pfA, b = pfB;
    pfA = null; pfB = null; /* next pinch spawns a fresh pair centered on its own focal point */
    a.src = ROOT + 'assets/images/cursor-open.png';
    b.src = ROOT + 'assets/images/cursor-open.png';
    a.classList.remove('show'); b.classList.remove('show');
    a.classList.add('fade2'); b.classList.add('fade2');
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      if (b.parentNode) b.parentNode.removeChild(b);
    }, 2100);
  }

  /* ---- wheel: mouse zooms toward cursor; trackpad scroll pans, pinch zooms ---- */
  window.addEventListener('wheel', function (e) {
    if (overlayOpen) return; /* let the overlay scroll natively instead of zooming the hidden world */
    e.preventDefault(); stopTween();
    var k = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    var dy = e.deltaY * k, dx = e.deltaX * k;
    if (e.ctrlKey) { /* trackpad pinch gesture (or ctrl+wheel) → zoom (boosted: pinch deltas are small) */
      var f = Math.exp(-dy * 0.012);
      pfEvent(f, e.clientX, e.clientY);
      zoomAt(e.clientX, e.clientY, f);
      return;
    }
    if (trackpadLike(e, dy)) { /* two-finger scroll → pan like a traditional site */
      sfEvent(dx, dy, e.clientX);
      if (axisBox && axisBox.checked) {
        if (!axis && Math.abs(dx) + Math.abs(dy) > 20) axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
        if (axis === 'x') dy = 0; else if (axis === 'y') dx = 0;
      }
      tx -= dx; ty -= dy; clamp(); apply();
      return;
    }
    /* mouse wheel: zoom toward the cursor (unchanged) */
    zoomAt(e.clientX, e.clientY, Math.exp(-dy * 0.0016));
  }, { passive: false });

  /* ---- keyboard ---- */
  window.addEventListener('keydown', function (e) {
    var step = 140;
    switch (e.key) {
      case 'ArrowLeft': tx += step; break;
      case 'ArrowRight': tx -= step; break;
      case 'ArrowUp': ty += step; break;
      case 'ArrowDown': ty -= step; break;
      case '+': case '=': zoomAt(vw / 2, vh / 2, 1.25); return;
      case '-': case '_': zoomAt(vw / 2, vh / 2, 0.8); return;
      case '0': case 'Home': stopTween(); initialView(); return;
      default: return;
    }
    stopTween(); clamp(); apply(); e.preventDefault();
  });

  window.addEventListener('dblclick', function (e) {
    if (Date.now() - lastTouchT < 500) return; /* touch handles its own double-tap */
    zoomAt(e.clientX, e.clientY, 1.9);
  });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });

  /* ---- animated fly-to (down arrows) ---- */
  var tweenId = 0;
  function stopTween() { tweenId++; momentumId++; } /* also cancels any glide */
  function worldRectOf(el) {
    var x = 0, y = 0, n = el;
    while (n && n !== world) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { x: x, y: y, w: el.offsetWidth, h: el.offsetHeight };
  }
  function flyTo(sel) {
    var el = document.querySelector(sel);
    if (!el) return;
    var r = worldRectOf(el);
    var ns = Math.min(MAX_S, Math.max(minS(), Math.min(vw * 0.85 / r.w, vh * 0.85 / r.h)));
    tween(vw / 2 - (r.x + r.w / 2) * ns, vh / 2 - (r.y + r.h / 2) * ns, ns, 750);
  }
  function tween(fx, fy, fs, ms) {
    var id = ++tweenId, x0 = tx, y0 = ty, s0 = s, t0 = performance.now();
    function frame(now) {
      if (id !== tweenId) return;
      var k = Math.min(1, (now - t0) / ms);
      k = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      tx = x0 + (fx - x0) * k; ty = y0 + (fy - y0) * k; s = s0 + (fs - s0) * k;
      clamp(); apply();
      if (k < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  Array.prototype.forEach.call(document.querySelectorAll('.arrow-box'), function (a) {
    a.addEventListener('click', function (e) {
      if (moved >= 8) { e.stopPropagation(); e.preventDefault(); return; } /* it was a drag, not a tap */
      e.stopPropagation(); flyTo(a.getAttribute('data-goto'));
    });
  });

  /* ---- floaters: slow random drift across the world ---- */
  var DEFS = [
    ['layer-3.png', 200], ['layer-12.png', 300], ['layer-29.png', 260], ['layer-40.png', 320],
    ['layer-50.png', 260], ['layer-67.png', 300], ['layer-111.png', 240], ['layer-124.png', 300],
    ['patch-3.png', 260], ['patch-4.png', 260], ['drift.gif', 300],
    ['microbe-2.mp4', 300], ['microbe-3.mp4', 320], ['virus-25.mp4', 300]
  ];
  var floaters = [];
  function spawnFloaters() {
    var lo = COL_X - 5600, hi = COL_X + COL_W + 5600;
    DEFS.forEach(function (def, i) {
      var el, isVideo = /\.mp4$/.test(def[0]);
      if (isVideo) {
        el = document.createElement('video');
        el.muted = true; el.loop = true; el.autoplay = true;
        el.setAttribute('muted', ''); el.setAttribute('playsinline', ''); el.playsInline = true;
        el.src = ROOT + 'assets/images/floaters/' + def[0];
        el.addEventListener('canplay', function () { el.play().catch(function () {}); });
      } else {
        el = document.createElement('img');
        el.alt = ''; el.draggable = false;
        el.src = ROOT + 'assets/images/floaters/' + def[0];
      }
      var w = def[1] * (0.8 + 0.4 * Math.random());
      el.style.width = w + 'px';
      floatersEl.appendChild(el);
      floaters.push({
        el: el, w: w, h: w,
        x: lo + ((i * 3671 + 911) % (hi - lo - 600)),
        y: COL_Y - 2000 + ((i * 2731 + 577) % Math.max(1000, colH + 4000)),
        /* pace: bump these ranges to speed up / slow down the drift */
        vx: (Math.random() * 30 + 18) * (Math.random() < 0.5 ? -1 : 1),
        vy: (Math.random() * 18 + 9) * (Math.random() < 0.5 ? -1 : 1),
        ph: Math.random() * 6.28
      });
    });
  }
  var lastT = performance.now();
  function tick(now) {
    var dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    for (var i = 0; i < floaters.length; i++) {
      var f = floaters[i];
      f.x += f.vx * dt; f.y += f.vy * dt; f.ph += dt;
      if (f.x < 600) { f.x = 600; f.vx *= -1; }
      if (f.x > WORLD_W - 600 - f.w) { f.x = WORLD_W - 600 - f.w; f.vx *= -1; }
      if (f.y < 600) { f.y = 600; f.vy *= -1; }
      if (f.y > worldH - 600 - f.h) { f.y = worldH - 600 - f.h; f.vy *= -1; }
      f.el.style.transform = 'translate3d(' + f.x + 'px,' + (f.y + Math.sin(f.ph) * 14) + 'px,0)';
    }
    requestAnimationFrame(tick);
  }

  window.addEventListener('resize', function () {
    vw = window.innerWidth; vh = window.innerHeight; measure(); clamp(); apply();
  });
  window.addEventListener('load', function () { measure(); clamp(); apply(); });

  measure();
  /* randomize the CGI filmstrip order on every load */
  var strip = document.querySelector('.filmstrip');
  if (strip) {
    var cards = Array.prototype.slice.call(strip.children);
    while (cards.length) {
      strip.appendChild(cards.splice(Math.floor(Math.random() * cards.length), 1)[0]);
    }
  }
  spawnFloaters();
  initialView();
  requestAnimationFrame(tick);
})();