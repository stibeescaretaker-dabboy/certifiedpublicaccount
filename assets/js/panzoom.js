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
  function apply() { world.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')'; }
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
    if (normalMode && s < minS()) zoomAt(vw / 2, vh / 2, minS() / s); /* pull in to the fit scale */
    else { clamp(); apply(); }
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
    function open(section, box, imgMode) {
      if (activeBox && activeBox !== box) activeBox.checked = false; /* one view at a time */
      activeBox = box;
      page.classList.toggle('img-mode', !!imgMode);
      if (imgMode) buildImages(section); else buildText(section);
      overlay.classList.add('open');
    }
    function closeAll() { overlay.classList.remove('open'); if (activeBox) activeBox.checked = false; activeBox = null; }
    function sectionOf(label) { return label.closest ? label.closest('.block') : null; }

    /* for every "read" toggle, add an "IMG." toggle beside it and wire both */
    Array.prototype.forEach.call(document.querySelectorAll('#column .read-toggle'), function (label) {
      var box = label.querySelector('input');
      if (!box) return;

      var imgLabel = document.createElement('label');
      imgLabel.className = 'read-toggle hand-ui';
      var imgBox = document.createElement('input');
      imgBox.type = 'checkbox';
      imgLabel.appendChild(imgBox);
      imgLabel.appendChild(document.createTextNode('img'));
      label.parentNode.insertBefore(imgLabel, label.nextSibling); /* to the right of "read" */

      box.addEventListener('change', function (e) {
        e.stopPropagation();
        if (activeBox && activeBox !== box) activeBox.checked = false;
        if (box.checked) { if (imgBox.checked) imgBox.checked = false; if (sectionOf(label)) open(sectionOf(label), box, false); else box.checked = false; }
        else closeAll();
      });
      box.addEventListener('click', function (e) { e.stopPropagation(); });

      imgBox.addEventListener('change', function (e) {
        e.stopPropagation();
        if (imgBox.checked) { if (box.checked) box.checked = false; if (sectionOf(imgLabel)) open(sectionOf(imgLabel), imgBox, true); else imgBox.checked = false; }
        else closeAll();
      });
      imgBox.addEventListener('click', function (e) { e.stopPropagation(); });
    });
    close.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); closeAll(); });
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
    try { e.target.setPointerCapture(e.pointerId); } catch (err) {}
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0; stopTween();
    axis = null;
    if (e.pointerType === 'touch') {
      var ui = !!(e.target.closest && e.target.closest('.hand-ui'));
      vcurShow(e.pointerId, e.clientX, e.clientY, ui);
    }
    document.body.classList.add('dragging');
    if (pointers.size >= 2) snapPinch();
  });
  window.addEventListener('pointermove', function (e) {
    var p = pointers.get(e.pointerId);
    if (!p) return;
    var dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (e.pointerType === 'touch') vcurMove(e.pointerId, e.clientX, e.clientY);
    if (pointers.size === 1) {
      if (axisBox && axisBox.checked) {
        /* commit to one axis on the first meaningful motion of the gesture */
        if (!axis && moved > 10) axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
        if (axis === 'x') dy = 0;
        else if (axis === 'y') dx = 0;
      }
      tx += dx; ty += dy; clamp(); apply();
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
      s = ns; tx = mx - wx * ns; ty = my - wy * ns; clamp(); apply();
    }
  });
  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    snapPinch();
    if (pointers.size === 0) {
      document.body.classList.remove('dragging');
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

  /* ---- wheel zoom toward cursor ---- */
  window.addEventListener('wheel', function (e) {
    e.preventDefault(); stopTween();
    var d = e.deltaY;
    if (e.deltaMode === 1) d *= 33; else if (e.deltaMode === 2) d *= 400;
    zoomAt(e.clientX, e.clientY, Math.exp(-d * 0.0016));
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
  function stopTween() { tweenId++; }
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