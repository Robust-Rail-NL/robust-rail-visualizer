// Verify mid-animation invariants for every move state:
//  - every sprite rides the exact eased arc position (monotonic by construction)
//  - rotation follows each member's local tangent with no mirror jumps
//  - width/clip frozen; visible slice centred like the parked render
//  - pivot stays on the rails
//
// Usage: node midanim.js <data.json>
'use strict';
const { loadFunctions } = require('./domstub');

const dataFile = process.argv[2];
if (!dataFile) { console.error('usage: node midanim.js <data.json>'); process.exit(2); }
const { T, byId, data } = loadFunctions(dataFile);

const D2R = Math.PI / 180;
function wrap180(d) { while (d > 180) d -= 360; while (d < -180) d += 360; return d; }

function snap() {
  return byId('train-layer').children.filter(e => e.tag === 'image').map(e => {
    const m = /translate\(([-\d.e]+),([-\d.e]+)\)\s*rotate\(([-\d.e]+)\)/.exec(e.attrs.transform);
    const c = /polygon\(([\d.e]+)%/.exec(e.attrs.style || '');
    const t = { x: +m[1], y: +m[2], ang: +m[3] };
    const w = parseFloat(e.attrs.width);
    const clipPct = c ? +c[1] : 0;
    const lx = parseFloat(e.attrs.x) + w * ((clipPct / 100) + 1) / 2; // visible centre, local
    const cos = Math.cos(t.ang * D2R), sin = Math.sin(t.ang * D2R);
    return {
      ang: t.ang, w, clipPct,
      ox: t.x, oy: t.y,
      vx: t.x + lx * cos - (-15) * sin,
      vy: t.y + lx * sin + (-15) * cos,
    };
  });
}

function projectOnPath(pts, p) {
  let best = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i-1], b = pts[i];
    const seg = Math.hypot(b[0]-a[0], b[1]-a[1]);
    if (seg <= 0) continue;
    const tt = Math.max(0, Math.min(1, ((p.x-a[0])*(b[0]-a[0]) + (p.y-a[1])*(b[1]-a[1])) / (seg*seg)));
    const cx = a[0] + (b[0]-a[0])*tt, cy = a[1] + (b[1]-a[1])*tt;
    const dd = Math.hypot(p.x-cx, p.y-cy);
    if (!best || dd < best.off) best = { off: dd };
  }
  return best || { off: Infinity };
}

let failures = 0;
for (let i = 1; i < data.states.length; i++) {
  const state = data.states[i];
  const prevState = data.states[i - 1];
  if (state.action_type !== 'move') continue;
  const train = state.train;
  if (!train || !data.trainUnits[train]) continue;
  T.startMoveAnim(state, prevState);
  const path = T.getPath();
  if (!path) continue;

  const order = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
  const frames = {};
  for (const t of order) {
    byId('train-layer').children.length = 0;
    T._moveDrawFrame(t);
    frames[t] = snap();
  }
  const n = frames[0].length;
  if (n === 0) continue;
  let ok = true, why = [];
  for (let k = 0; k < n; k++) {
    const spanOk = T.getSpans()[k];
    // rides the exact eased arc position
    for (const t of order) {
      const exp = T.expectedPos(k, t);
      const f = frames[t][k];
      if (!exp || !spanOk) { ok = false; why.push(`m${k} missing span`); break; }
      const d = Math.hypot(exp.x - f.ox, exp.y - f.oy);
      if (d > 0.75) { ok = false; why.push(`m${k} off arc @${t} (${d.toFixed(2)})`); break; }
    }
    // net movement happened
    const p0 = frames[order[0]][k], p1 = frames[order[order.length - 1]][k];
    if (Math.hypot(p1.ox - p0.ox, p1.oy - p0.oy) < 5) {
      ok = false; why.push(`m${k} no movement`);
    }
    // no mirror jumps between sampled frames; the very last transition is
    // exempt because arriving normalizes the sprite to its parked facing
    // (bit-exactness of that landing is pinned by harness.js END checks)
    for (let s2 = 1; s2 < order.length - 1; s2++) {
      const dAng = Math.abs(wrap180(frames[order[s2]][k].ang - frames[order[s2-1]][k].ang));
      if (dAng > 95) { ok = false; why.push(`m${k} jump @${order[s2]} (${dAng.toFixed(1)}deg)`); }
    }
    // constant size/clip while riding the path; the final frame may switch
    // once to the destination-side parked geometry (width/clip/polygon)
    for (const t of order.slice(1, -1)) {
      if (frames[t][k].w !== frames[0][k].w) { ok = false; why.push(`m${k} w changed @${t}`); }
      if (frames[t][k].clipPct !== frames[0][k].clipPct) { ok = false; why.push(`m${k} clip changed @${t}`); }
    }
    // pivot stays on the rails
    for (const t of [0.25, 0.5, 0.75]) {
      const pj = projectOnPath(path, { x: frames[t][k].ox, y: frames[t][k].oy });
      if (pj.off > 1.5) { ok = false; why.push(`m${k} off rails @${t} (${pj.off.toFixed(2)})`); }
    }
    // clipped sprites: visible slice centred on the pivot; unclipped ones sit
    // nose-flush like the parked render (offset up to half a sprite length).
    // The limit is per-frame: arriving may swap the sprite to the
    // destination-side parked geometry (e.g. clipped -> unclipped).
    for (const t of order) {
      const f = frames[t][k];
      const limit = f.clipPct > 0 ? 1.0 : 80;
      const along = Math.abs((f.vx - f.ox) * Math.cos(f.ang * D2R) + (f.vy - f.oy) * Math.sin(f.ang * D2R));
      if (along > limit) { ok = false; why.push(`m${k} vis-centre off @${t} (${along.toFixed(2)})`); break; }
    }
  }
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL'), `state ${i} ${train} (${n} sprites)`, why.join('; '));
}
console.log(`failures: ${failures}`);
process.exit(failures ? 1 : 0);
