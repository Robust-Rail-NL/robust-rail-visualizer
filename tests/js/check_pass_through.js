// Physical-parking checker: verifies the deep-pack parking policy end to end.
//
// For every state:
//   A) co-present trains on one track never have overlapping spans, unless
//      that track is red-flagged as physically over-capacity in that state;
// For every move state:
//   B) the mover's animated path terminates on its own assigned slot
//      boundary of the destination track (nose flush with the pack);
//   C) no standing train sits between the entry wall and the newcomer's
//      slot - i.e. parking never requires driving through standing stock.
// Red-flagged (over 100% physical length) tracks are exempt from A/C because
// the overlap is unavoidable and surfaced as a timeline badge instead.
//
// Usage: node check_pass_through.js <data.json>
'use strict';
const { loadFunctions } = require('./domstub');

const dataFile = process.argv[2];
if (!dataFile) { console.error('usage: node check_pass_through.js <data.json>'); process.exit(2); }
const { T, data } = loadFunctions(dataFile);

const EPS = 0.012;       // span overlap tolerance (fraction of track)
const LAND_TOL = 0.045;  // landing-point tolerance along the dest shape

function presentGroups(state) {
  const g = {};
  Object.keys(state.trains || {}).forEach(t => {
    const info = state.trains[t];
    if (!info || !info.track || info.status === 'departed' || info.status === 'absorbed') return;
    const fr = T.trainFractionsOnTrack(t, String(info.track), state);
    if (fr && fr[1] - fr[0] > 0.004) (g[String(info.track)] = g[String(info.track)] || []).push({ train: t, f0: fr[0], f1: fr[1] });
  });
  return g;
}

function redTracks(state) {
  const s = new Set();
  (T.trackCapacityViolations(state) || []).forEach(v => { if (v.level === 'red') s.add(String(v.track)); });
  return s;
}

function fracOfPointOnShape(shape, p) {
  // Fraction (0..1 of arc length from shape start) nearest to point p.
  let total = 0;
  const segs = [];
  for (let i = 1; i < shape.length; i++) {
    const d = Math.hypot(shape[i][0] - shape[i - 1][0], shape[i][1] - shape[i - 1][1]);
    segs.push(d); total += d;
  }
  if (total <= 0) return null;
  let best = { d: Infinity, frac: 0 };
  let acc = 0;
  for (let i = 1; i < shape.length; i++) {
    const a = shape[i - 1], b = shape[i], seg = segs[i - 1];
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const L2 = vx * vx + vy * vy;
    const tt = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a[0]) * vx + (p.y - a[1]) * vy) / L2)) : 0;
    const cx = a[0] + vx * tt, cy = a[1] + vy * tt;
    const dd = Math.hypot(p.x - cx, p.y - cy);
    if (dd < best.d) best = { d: dd, frac: (acc + seg * tt) / total };
    acc += seg;
  }
  return best.frac;
}

let failures = 0;
let warnings = 0;
function fail(msg) { failures++; console.log('FAIL', msg); }
function warn(msg) { warnings++; console.log('WARN', msg); }

data.states.forEach((state, i) => {
  const prevState = i > 0 ? data.states[i - 1] : null;
  const groups = presentGroups(state);
  const red = redTracks(state);

  // A) static span overlaps
  Object.keys(groups).forEach(tid => {
    if (red.has(tid)) return;
    const arr = groups[tid];
    for (let x = 0; x < arr.length; x++) {
      for (let y = x + 1; y < arr.length; y++) {
        const ov = Math.min(arr[x].f1, arr[y].f1) - Math.max(arr[x].f0, arr[y].f0);
        if (ov > EPS) fail(`state ${i} track ${tid}: "${arr[x].train}" x "${arr[y].train}" spans overlap ${(ov * 100).toFixed(1)}%`);
      }
    }
  });

  if (state.action_type !== 'move' || !state.train) return;
  const train = state.train;
  const destInfo = state.trains[train];
  if (!destInfo || !destInfo.track || destInfo.status === 'departed' || destInfo.status === 'absorbed') return;
  const destTrack = String(destInfo.track);

  const own = T.trainFractionsOnTrack(train, destTrack, state);
  if (!own || own[1] - own[0] <= 0.005) return; // degenerate/over-capacity slot
  if (!state.train_path || !state.train_path[train]) return;

  const route = state.train_path[train];
  const srcTrack = prevState && prevState.trains[train] ? prevState.trains[train].track : null;
  const prevPart = route.length >= 2 ? route[route.length - 2] : srcTrack;
  if (!prevPart) return;
  const entry = T.edgeSideOf(destTrack, String(prevPart));
  if (!entry) return;

  const frontFrac = entry === 'b' ? (1 - own[0]) : own[1];

  // B) landing point of the animation path
  const path = T.buildMovePath(train, state, prevState, true);
  const shapePos = data.positions ? data.positions[destTrack] : null;
  const shape = shapePos && Array.isArray(shapePos.shape) ? shapePos.shape : null;
  if (path && path.length >= 2 && shape && shape.length >= 2) {
    const tail = path[path.length - 1];
    const phi = fracOfPointOnShape(shape, { x: tail[0], y: tail[1] });
    if (phi != null) {
      const dEntry = entry === 'b' ? (1 - phi) : phi;
      if (Math.abs(dEntry - frontFrac) > LAND_TOL) {
        fail(`state ${i} ${train}: lands at ${(dEntry * 100).toFixed(1)}% from entry, slot boundary is ${(frontFrac * 100).toFixed(1)}%`);
      }
    }
  }

  // C) nothing stands between the entry wall and the newcomer's slot
  if (red.has(destTrack)) return;
  const bystanders = (groups[destTrack] || []).filter(b => b.train !== train);
  for (const b of bystanders) {
    // Deeper stock (beyond the slot) is fine - the newcomer bumps against it.
    // A train inside the sweep corridor [slot boundary .. entry wall] means
    // the move would have to drive through standing stock.
    const blocks = entry === 'b'
      ? b.f1 > own[0] + EPS
      : b.f0 < own[1] - EPS;
    if (blocks) {
      fail(`state ${i} ${train}: "${b.train}" [${b.f0.toFixed(3)},${b.f1.toFixed(3)}] blocks the sweep corridor on ${destTrack} (slot [${own[0].toFixed(3)},${own[1].toFixed(3)}], entry ${entry})`);
    }
  }

  // D) departure corridor (warning only): leaving a track past standing
  // stock requires solver re-sequencing, which the visualizer cannot invent.
  const depInfo = prevState && prevState.trains ? prevState.trains[train] : null;
  const depTrack = depInfo && depInfo.track ? String(depInfo.track) : null;
  const routeIds = state.train_path && state.train_path[train] ? state.train_path[train] : null;
  if (!depInfo || !depTrack || !routeIds || !routeIds.length) return;
  const allTracks = routeIds[0] !== depTrack ? [depTrack].concat(routeIds) : routeIds;
  if (allTracks.length < 2) return;
  const exitSide = T.edgeSideOf(depTrack, String(allTracks[1]));
  if (!exitSide || red.has(depTrack)) return;
  const srcFr = T.trainFractionsOnTrack(train, depTrack, prevState);
  if (!srcFr || srcFr[1] - srcFr[0] <= 0.005) return;
  const prevGroups = presentGroups(prevState);
  for (const b of (prevGroups[depTrack] || [])) {
    if (b.train === train) continue;
    const blocks = exitSide === 'b'
      ? b.f0 < 1 && b.f1 > srcFr[1] + EPS
      : b.f0 < srcFr[0] - EPS && b.f1 > 0;
    if (blocks) {
      warn(`state ${i} ${train}: exits ${depTrack} on the ${exitSide} side through "${b.train}" [${b.f0.toFixed(3)},${b.f1.toFixed(3)}] (parked [${srcFr[0].toFixed(3)},${srcFr[1].toFixed(3)}])`);
    }
  }
});

console.log(`pass-through check: ${failures} failures, ${warnings} warnings`);
process.exit(failures ? 1 : 0);
