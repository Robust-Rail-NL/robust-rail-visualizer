// Shared fake-DOM sandbox that runs the real functions.js inside Node.
// The visualizer only touches the DOM through getElementById/createElement(NS)
// and element attribute/style APIs, so a recording stub is enough to execute
// the animation code headlessly and inspect every emitted attribute.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..', '..');

function fakeEl(tag) {
  const el = {
    tag, children: [], attrs: {}, style: {}, dataset: {},
    classList: { add(){}, remove(){}, toggle(){} },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] !== undefined ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.unshift(c); return c; },
    remove() {},
    querySelectorAll() { return []; },
    addEventListener() {},
    scrollIntoView() {},
  };
  return el;
}

// Load functions.js into a fresh sandbox together with the parsed data object.
// Returns { T, byId } where T exposes the move-animation internals plus an
// exact expected-pivot oracle, and byId hands out the stubbed elements.
function loadFunctions(dataFile) {
  const data = JSON.parse(
    fs.readFileSync(dataFile, 'utf8').replace(/^\uFEFF/, '').replace(/;\s*$/, ''));

  const ids = {};
  function byId(id) {
    if (!ids[id]) ids[id] = fakeEl(id === 'yard-svg' ? 'svg' : 'div');
    return ids[id];
  }
  const sandbox = {
    console, data,
    performance: { now: () => 0 },
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      getElementById: byId,
      createElementNS: (ns, tag) => fakeEl(tag),
      createElement: tag => fakeEl(tag),
      querySelectorAll: () => [],
      querySelector: () => null,
      documentElement: { setAttribute(){} },
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(REPO, 'functions.js'), 'utf8');
  vm.runInContext(src + `
;this.__t = {
  startMoveAnim, _moveDrawFrame, drawTrainOnTrack, trainFractionsOnTrack,
  layoutTrack, buildMovePath, edgeSideOf, trackCapacityViolations,
  getSpans: () => _moveUnitSpans,
  getUnits: () => _moveUnits,
  getPath: () => _movePath,
  // Exact expected pivot (svg coords) for member i at anim fraction t,
  // using the same quadratic ease and arc offset as _moveDrawFrame.
  // Frame 0 reproduces the parked sprite's chord midpoint at the origin and
  // frame 1 the parked sprite's chord midpoint at the destination; frames in
  // between ride the path arc.
  expectedPos: (i, t) => {
    const e = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
    const s = _moveUnitSpans[i];
    if (!s || !_movePath) return null;
    if (t === 0 && s.pivot0) return { x: s.pivot0.x, y: s.pivot0.y };
    if (t === 1 && s.pivot1) return { x: s.pivot1.x, y: s.pivot1.y };
    const pm = pointOnPath(_movePath, s.mid + e * (_moveTotalLen - _moveFrontOff));
    return { x: toSvgX(pm.x), y: toSvgY(pm.y) };
  }
};`, sandbox, { filename: 'functions.js' });
  return { T: sandbox.__t, byId, data };
}

module.exports = { loadFunctions, REPO };
