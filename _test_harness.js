/* vm harness: verifies the touch click-fist behavior over .hand-ui controls
   and the bio checkbox fly-to, using stubbed DOM */
var fs = require('fs'), vm = require('vm');

function fakeEl() {
  return {
    children: [], style: {}, classList: {
      _s: new Set(),
      add: function (c) { this._s.add(c); },
      remove: function (c) { this._s.delete(c); },
      toggle: function (c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); },
      contains: function (c) { return this._s.has(c); }
    },
    handlers: {},
    addEventListener: function (t, f) { this.handlers[t] = f; },
    setAttribute: function () {}, appendChild: function (c) { this.children.push(c); c.parentNode = this; },
    removeChild: function (c) { c.parentNode = null; },
    querySelector: function (sel) {
      var cls = sel.replace(/^\./, '');
      var hit = this.children.filter(function (c) { return c.className === cls || c.classList.contains(cls); })[0];
      if (!hit) { hit = fakeEl(); hit.className = cls; this.appendChild(hit); }
      return hit;
    },
    querySelectorAll: function (sel) {
      var cls = sel.replace(/^\./, '');
      return this.children.filter(function (c) { return c.className === cls || c.classList.contains(cls); });
    },
    closest: function (sel) { return this._ui && sel === '.hand-ui' ? this : null; },
    src: '', textContent: '', offsetWidth: 4000, offsetHeight: 1000,
    offsetLeft: 0, offsetTop: 0, offsetParent: null,
    getBoundingClientRect: function () { return { left: 0, top: 0, width: 100, height: 40 }; }
  };
}

var worldEl = fakeEl(), columnEl = fakeEl(), floatersEl = fakeEl();
var bioBox = fakeEl(); bioBox.checked = false;
var axisBox = fakeEl(); axisBox.checked = false;
var normalBox = fakeEl(); normalBox.checked = false;
var howto = fakeEl();
var section4 = fakeEl(); section4.id = 'section-4';
var navSecA = fakeEl(); navSecA.id = 'nav-a'; navSecA.offsetTop = 10000;
var navSecB = fakeEl(); navSecB.id = 'nav-b'; navSecB.offsetTop = 30000;
navSecA.offsetParent = navSecB.offsetParent = { offsetLeft: 0, offsetTop: 0, offsetParent: worldEl };
section4.offsetLeft = 12000; section4.offsetTop = 40000;
section4.offsetParent = { offsetLeft: 0, offsetTop: 0, offsetParent: worldEl };
columnEl.offsetHeight = 24000;

var created = [], winHandlers = {}, headKids = [], rafQ = [];
var document = {
  body: Object.assign(fakeEl(), { getAttribute: function () { return '/'; } }),
  head: { appendChild: function (e) { headKids.push(e); } },
  createElement: function (tag) { var el = fakeEl(); el.tag = tag; created.push(el); return el; },
  getElementById: function (id) {
    return { world: worldEl, column: columnEl, floaters: floatersEl,
      'bio-box': bioBox, 'axis-lock': axisBox, 'normal-mode': normalBox }[id] || null;
  },
  querySelector: function (sel) {
    if (sel === '.howto') return howto;
    if (sel === '#section-4') return section4;
    if (sel === '#nav-a') return navSecA;
    if (sel === '#nav-b') return navSecB;
    return null;
  },
  querySelectorAll: function (sel) {
    if (sel === '#column > .block') return [navSecA, navSecB];
    return [];
  },
  createRange: function () { return { selectNodeContents: function () {}, getBoundingClientRect: howto.getBoundingClientRect }; },
  addEventListener: function () {}
};
var window = {
  innerWidth: 900, innerHeight: 1600,
  addEventListener: function (t, f) { winHandlers[t] = f; },
  scrollTo: function () {}, removeEventListener: function () {}
};
var sandbox = {
  document: document, window: window, Map: Map, Array: Array, Math: Math, Date: Date,
  setTimeout: function (f) { return 0; }, clearTimeout: function () {},
  performance: { now: function () { return Date.now(); } },
  requestAnimationFrame: function (f) { rafQ.push(f); return rafQ.length; },
  history: {}
};
sandbox.window.setTimeout = sandbox.setTimeout;
sandbox.window.clearTimeout = sandbox.clearTimeout;
sandbox.window.requestAnimationFrame = sandbox.requestAnimationFrame;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('assets/js/panzoom.js', 'utf8'), sandbox);

var fails = 0;
function check(name, ok) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name); if (!ok) fails++; }

// grab the virtual-cursor image created by a touch pointerdown
function touchDown(id, onUi) {
  var t = fakeEl(); t._ui = onUi;
  winHandlers.pointerdown({ pointerId: id, pointerType: 'touch', clientX: 100, clientY: 100, button: 0, target: t });
}
function touchUp(id) {
  winHandlers.pointerup({ pointerId: id, pointerType: 'touch', clientX: 100, clientY: 100 });
}
var vcur = function () {
  return created.filter(function (e) { return e.tag === 'img' && (e.className === 'virtual-cursor' || e.classList.contains('virtual-cursor')); });
};

// 1. touch on a hand-ui control shows the click fist
touchDown(1, true);
var c1 = vcur()[0];
check('touch on hand-ui shows click fist', /click%20fist\.png$/.test(c1.src));

// 2. releasing over hand-ui fades in place (no open-fist swap)
touchUp(1);
check('release over hand-ui does NOT swap to open fist', !/cursor-open\.png$/.test(c1.src));
check('release over hand-ui still fades out', c1.classList.contains('fade'));

// 3. touch on the world still shows grab fist, release opens it
touchDown(2, false);
var c2 = vcur()[1];
check('touch on world shows closed grab fist', /cursor-closed\.png$/.test(c2.src));
touchUp(2);
check('release on world swaps to open fist', /cursor-open\.png$/.test(c2.src));

// 4. bio checkbox flies to #section-4 and unchecks itself
bioBox.checked = true;
bioBox.handlers.change();
check('bio change started a tween (world transform animated)',
  /translate\(/.test(worldEl.style.transform || ''));
check('bio checkbox self-clears', bioBox.checked === false);

// 5. the nav widget: toggle shows/hides arrows, down arrow flies forward
var navWidget = created.filter(function (e) { return e.tag === 'div' && e.className === 'nav-widget'; })[0];
var navToggle = navWidget.querySelector('.nav-toggle');
var navDown = navWidget.querySelector('.nav-down');
navToggle.handlers.click({ stopPropagation: function () {}, preventDefault: function () {} });
check('nav toggle press shows the arrows', navWidget.classList.contains('open'));
worldEl.style.transform = '';
navDown.handlers.click({ stopPropagation: function () {}, preventDefault: function () {} });
var t = 0; var n2 = 0; while (rafQ.length && n2++ < 30) { t += 50; rafQ.shift()(Date.now() + t); }
check('nav down arrow started a fly-to tween',
  /translate\(/.test(worldEl.style.transform || ''));
navToggle.handlers.click({ stopPropagation: function () {}, preventDefault: function () {} });
check('nav toggle press again hides the arrows', !navWidget.classList.contains('open'));

console.log(fails ? '\n' + fails + ' FAILURES' : '\nAll tests passed');
process.exit(fails ? 1 : 0);