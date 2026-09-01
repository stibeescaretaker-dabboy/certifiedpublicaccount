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

  function measure() {
    colH = column.offsetHeight;
    worldH = colH + 12000;
    world.style.height = worldH + 'px';
  }
  function clamp() { /* keep the column reachable; bounds may invert when zoomed in */
    var loX = 120 - (COL_X + COL_W) * s, hiX = vw - 120 - COL_X * s;
    var loY = 120 - (COL_Y + colH) * s, hiY = vh - 120 - COL_Y * s;
    tx = Math.min(Math.max(tx, Math.min(loX, hiX)), Math.max(loX, hiX));
    ty = Math.min(Math.max(ty, Math.min(loY, hiY)), Math.max(loY, hiY));
  }
  function apply() { world.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')'; }
  function initialView() { /* start zoomed in on the "Click/tap and drag" text */
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
    var ns = Math.min(MAX_S, Math.max(MIN_S, s * f));
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
  function vcurShow(id, x, y) {
    var c = cursors.get(id);
    if (!c) {
      var el = document.createElement('img');
      el.className = 'virtual-cursor';
      el.alt = '';
      el.draggable = false;
      el.src = ROOT + 'assets/images/cursor-closed.png';
      document.body.appendChild(el);
      c = { el: el, timer: 0 };
      cursors.set(id, c);
    }
    clearTimeout(c.timer);
    c.el.src = ROOT + 'assets/images/cursor-closed.png';
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
    c.el.src = ROOT + 'assets/images/cursor-open.png';
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
      '.hand-ui, .hand-ui * { cursor: url("' + base + 'pointer fist.png") 9 3, pointer !important; }' +
      '.hand-ui:active, .hand-ui:active * { cursor: url("' + base + 'click fist.png") 9 3, pointer !important; }';
    document.head.appendChild(st);
  })();

  /* ---- movement assist (axis lock) ---- */
  var axisBox = document.getElementById('axis-lock');
  var axis = null; /* committed per-gesture: 'x', 'y', or null until movement starts */

  /* ---- pointer input: mouse drag, 1-finger pan, 2-finger pinch ---- */
  var pointers = new Map(), pinch = null, moved = 0;
  var lastTap = 0, lastTapX = 0, lastTapY = 0;
  /* never let the browser grab images for native drag — always pan instead */
  window.addEventListener('dragstart', function (e) { e.preventDefault(); });
  window.addEventListener('pointerdown', function (e) {
    if (e.button !== undefined && e.button !== 0) return;
    try { e.target.setPointerCapture(e.pointerId); } catch (err) {}
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0; stopTween();
    axis = null;
    if (e.pointerType === 'touch') vcurShow(e.pointerId, e.clientX, e.clientY);
    document.body.classList.add('dragging');
    if (pointers.size === 2) {
      var p = Array.from(pointers.values());
      pinch = { d: dist(p[0], p[1]), s0: s, tx0: tx, ty0: ty,
                mx: (p[0].x + p[1].x) / 2, my: (p[0].y + p[1].y) / 2 };
    }
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
    else if (pointers.size === 2 && pinch) {
      var pt = Array.from(pointers.values());
      var d = dist(pt[0], pt[1]);
      var mx = (pt[0].x + pt[1].x) / 2, my = (pt[0].y + pt[1].y) / 2;
      var ns = Math.min(MAX_S, Math.max(MIN_S, pinch.s0 * d / pinch.d));
      var wx = (pinch.mx - pinch.tx0) / pinch.s0, wy = (pinch.my - pinch.ty0) / pinch.s0;
      s = ns; tx = mx - wx * ns; ty = my - wy * ns; clamp(); apply();
    }
  });
  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
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
    var ns = Math.min(MAX_S, Math.max(MIN_S, Math.min(vw * 0.85 / r.w, vh * 0.85 / r.h)));
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