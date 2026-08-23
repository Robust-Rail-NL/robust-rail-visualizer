// Harness: run the visualizer's move animation in Node and verify that the
// t=0 animation frame matches the parked rendering for every move state:
// position of the VISIBLE (post-clip) centre, angle, width and clip fraction
// must all be identical, so starting a move never visually shifts the train.
//
// Usage: node harness.js <data.json>
'use strict';
const { loadFunctions } = require('./domstub');

const dataFile = process.argv[2];
if (!dataFile) { console.error('usage: node harness.js <data.json>'); process.exit(2); }
const { T, byId, data } = loadFunctions(dataFile);

function clearLayer() { byId('train-layer').children.length = 0; }

function spritesOf(layer) {
  return layer.filter(el => el.tag === 'image');
}

function parkedSprites(train, trackId, state) {
  clearLayer();
  const pr = T.trainFractionsOnTrack(train, trackId, state);
  const out = [];
  if (!pr) return out;
  T.drawTrainOnTrack(trackId, pr[0], pr[1], train,
    (state.trains[train].restSide === 'b'), !!state.trains[train].wasParked);
  for (const el of byId('train-layer').children) {
    if (el.tag === 'image') {
      out.push({
        transform: el.attrs.transform,
        width: parseFloat(el.attrs.width),
        xImg: parseFloat(el.attrs.x),
        style: el.attrs.style || '',
      });
    }
  }
  clearLayer();
  return out;
}

const D2R = Math.PI / 180;
function parseTransform(tr) {
  const m = /translate\(([-\d.e]+),([-\d.e]+)\)\s*rotate\(([-\d.e]+)\)/.exec(tr);
  return m ? { x: +m[1], y: +m[2], a: +m[3] } : null;
}
function clipPctOf(style) {
  const m = /polygon\(([\d.e]+)%/.exec(style);
  return m ? +m[1] : 0;
}
// World position of the visible (post-clip) centre of a sprite.
function visibleCenter(tr, xImg, w, style) {
  const t = parseTransform(tr);
  const c = clipPctOf(style) / 100;
  const lx = xImg + (w * (c + 1)) / 2; // visible centre in image-local coords
  const ly = -15;                      // -TRAIN_H/2
  const cos = Math.cos(t.a * D2R), sin = Math.sin(t.a * D2R);
  return { x: t.x + lx * cos - ly * sin, y: t.y + lx * sin + ly * cos };
}

let checked = 0, failures = 0;
for (let i = 1; i < data.states.length; i++) {
  const state = data.states[i];
  const prevState = data.states[i - 1];
  if (state.action_type !== 'move') continue;
  const train = state.train;
  if (!train || !data.trainUnits[train]) continue;
  const prevInfo = prevState.trains[train];
  if (!prevInfo || !prevInfo.track) {
    console.log('SKIP', `state ${i} ${train}: no previous placement`);
    continue;
  }

  T.startMoveAnim(state, prevState);
  const spans = T.getSpans();
  if (!T.getPath()) continue;

  clearLayer();
  T._moveDrawFrame(0);
  const moving = spritesOf(byId('train-layer').children);
  const parked = parkedSprites(train, prevState.trains[train].track, prevState);

  checked++;
  let ok = parked.length > 0 && parked.length === moving.length &&
           spans.filter(Boolean).length === moving.length;
  if (!ok) console.log('FAIL', `state ${i} ${train}: count mismatch parked=${parked.length} moving=${moving.length}`);
  const deltas = [];
  for (let k = 0; k < Math.min(parked.length, moving.length); k++) {
    const pv = visibleCenter(parked[k].transform, parked[k].xImg, parked[k].width, parked[k].style);
    const mv = visibleCenter(moving[k].attrs.transform, parseFloat(moving[k].attrs.x),
                             parseFloat(moving[k].attrs.width), moving[k].attrs.style);
    const pa = parseTransform(parked[k].transform).a, ma = parseTransform(moving[k].attrs.transform).a;
    const dVis = Math.hypot(pv.x - mv.x, pv.y - mv.y);
    const dAng = Math.abs(pa - ma);
    const dW = Math.abs(parked[k].width - parseFloat(moving[k].attrs.width));
    const dClip = Math.abs(clipPctOf(parked[k].style) - clipPctOf(moving[k].attrs.style));
    deltas.push({ member: k, dVis: +dVis.toFixed(3), dAng: +dAng.toFixed(3), dW: +dW.toFixed(3), dClip: +dClip.toFixed(3) });
    if (!(dVis < 0.5 && dAng < 1 && dW < 0.5 && dClip < 0.5)) ok = false;
  }
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL'), `state ${i} ${train} (${parked.length} sprites)`,
    deltas.map(d => `m${d.member}: vis=${d.dVis} ang=${d.dAng} w=${d.dW} clip=${d.dClip}`).join(' | '));
}
console.log(`\nchecked ${checked} move states, failures: ${failures}`);
process.exit(failures ? 1 : 0);
