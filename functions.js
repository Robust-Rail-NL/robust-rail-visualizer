let current = 0;
let timer = null;
let filterTrain = null;

const TRAIN_COLORS = ['#3b82f6','#f59e0b','#ef4444','#10b981','#8b5cf6','#ec4899','#06b6d4','#84cc16'];
const allTrains = [...new Set(data.states.flatMap(s => Object.keys(s.trains)))]
  .filter(t => data.states.some(s => s.trains[t] && s.trains[t].track))
  .sort((a, b) => {
    const aCombo = a.includes('+'), bCombo = b.includes('+');
    if (aCombo && !bCombo) return 1;
    if (!aCombo && bCombo) return -1;
    return a.localeCompare(b);
  });
const trainColorMap = {};
allTrains.forEach((t, i) => { trainColorMap[t] = TRAIN_COLORS[i % TRAIN_COLORS.length]; });

// ---- COLOR HELPERS ----
function parseHex(h) {
  h = h.replace('#','');
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  return [parseInt(h.substring(0,2),16), parseInt(h.substring(2,4),16), parseInt(h.substring(4,6),16)];
}
function toHex(r,g,b) {
  return '#' + [r,g,b].map(v => Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
}
function lerpColor(a, b, t) {
  const ca = parseHex(a), cb = parseHex(b);
  return toHex(ca[0]+(cb[0]-ca[0])*t, ca[1]+(cb[1]-ca[1])*t, ca[2]+(cb[2]-ca[2])*t);
}

// ---- COMBINE / SPLIT ANIMATION ----
let _animRaf = null;
let _animStart = 0;
let _animDuration = 3000;
let _animType = null;  // 'combine' or 'split'
let _animState = null;
let _animFrameFn = null;

function startCombineAnim(state) {
  _animType = 'combine'; _animStart = performance.now(); _animState = state;
  _animFrameFn = drawCombineFrame;
  if (!_animRaf) _animLoop();
}
function startSplitAnim(state) {
  _animType = 'split'; _animStart = performance.now(); _animState = state;
  _animFrameFn = drawSplitFrame;
  if (!_animRaf) _animLoop();
}
function cancelAnim() {
  if (_animRaf) { cancelAnimationFrame(_animRaf); _animRaf = null; }
  _animType = null; _animFrameFn = null;
  cancelMoveAnim();
}
function _animLoop() {
  if (!_animType) return;
  const elapsed = performance.now() - _animStart;
  const t = Math.min(1, elapsed / _animDuration);
  if (t < 1 && _animFrameFn) {
    _animFrameFn(t);
    _animRaf = requestAnimationFrame(_animLoop);
  } else {
    _animType = null; _animFrameFn = null; _animRaf = null;
    render(current);
  }
}

function drawCombineFrame(t) {
  const state = _animState;
  const trainName = state.train;
  if (!trainName || !trainName.includes('+')) return;
  const members = trainName.split('+');
  const combinedColor = trainColorMap[trainName] || '#888888';
  const layer = document.getElementById('train-layer');
  layer.querySelectorAll('polyline[data-combine-member]').forEach(el => {
    const m = el.getAttribute('data-combine-member');
    const origColor = trainColorMap[m] || '#888888';
    el.setAttribute('stroke', lerpColor(origColor, combinedColor, t));
  });
  layer.querySelectorAll('circle[data-combine-member]').forEach(el => {
    const m = el.getAttribute('data-combine-member');
    const origColor = trainColorMap[m] || '#888888';
    el.setAttribute('fill', lerpColor(origColor, combinedColor, t));
  });
}

function drawSplitFrame(t) {
  const state = _animState;
  const parentName = state.parent_name;
  const childNames = state.child_names || [];
  if (!parentName) return;
  const parentColor = trainColorMap[parentName] || '#888888';
  const layer = document.getElementById('train-layer');
  layer.querySelectorAll('polyline[data-split-child]').forEach(el => {
    const c = el.getAttribute('data-split-child');
    const childColor = trainColorMap[c] || '#888888';
    el.setAttribute('stroke', lerpColor(parentColor, childColor, t));
  });
  layer.querySelectorAll('circle[data-split-child]').forEach(el => {
    const c = el.getAttribute('data-split-child');
    const childColor = trainColorMap[c] || '#888888';
    el.setAttribute('fill', lerpColor(parentColor, childColor, t));
  });
}

// ---- PARK PULSE ANIMATION ----
let _parkRaf = null;
let _parkStart = 0;
let _parkTrainName = null;
function startParkPulse(trainName) {
  _parkTrainName = trainName;
  _parkStart = performance.now();
  document.querySelectorAll(`#train-layer image[data-train="${trainName}"]`).forEach(el => el.setAttribute('filter', 'url(#greenTintPulse)'));
  if (!_parkRaf) _parkPulseLoop();
}
function cancelParkPulse() {
  if (_parkRaf) { cancelAnimationFrame(_parkRaf); _parkRaf = null; }
  if (_parkTrainName) {
    document.querySelectorAll(`#train-layer image[data-train="${_parkTrainName}"]`).forEach(el => el.setAttribute('filter', 'url(#greenTint)'));
  }
  const flood = document.getElementById('greenTintPulseFlood');
  if (flood) flood.setAttribute('flood-opacity', '0.5');
  _parkTrainName = null;
}
function _parkPulseLoop() {
  const flood = document.getElementById('greenTintPulseFlood');
  if (!flood || !_parkTrainName) return;
  const elapsed = performance.now() - _parkStart;
  const opacity = 0.3 + 0.4 * Math.sin(elapsed / 300);
  flood.setAttribute('flood-opacity', opacity.toFixed(3));
  _parkRaf = requestAnimationFrame(_parkPulseLoop);
}

// ---- ARRIVAL / DEPARTURE FADE ANIMATION ----
let _arrivalRaf = null;
let _arrivalStart = 0;
let _arrivalTrainName = null;
function startArrivalAnim(trainName) {
  _arrivalTrainName = trainName;
  _arrivalStart = performance.now();
  if (!_arrivalRaf) _arrivalAnimLoop();
}
function cancelArrivalAnim() {
  if (_arrivalRaf) { cancelAnimationFrame(_arrivalRaf); _arrivalRaf = null; }
  if (_arrivalTrainName) {
    document.querySelectorAll(`#train-layer image[data-train="${_arrivalTrainName}"]`).forEach(el => el.setAttribute('opacity', '1'));
  }
  _arrivalTrainName = null;
}
function _arrivalAnimLoop() {
  if (!_arrivalTrainName) return;
  const els = document.querySelectorAll(`#train-layer image[data-train="${_arrivalTrainName}"]`);
  const elapsed = performance.now() - _arrivalStart;
  const opacity = 0.1 + 0.9 * ((Math.sin(elapsed / 400) + 1) / 2);
  els.forEach(el => el.setAttribute('opacity', opacity.toFixed(3)));
  _arrivalRaf = requestAnimationFrame(_arrivalAnimLoop);
}

let _departRaf = null;
let _departStart = 0;
let _departTrainName = null;
function startDepartAnim(trainName) {
  _departTrainName = trainName;
  _departStart = performance.now();
  if (!_departRaf) _departAnimLoop();
}
function cancelDepartAnim() {
  if (_departRaf) { cancelAnimationFrame(_departRaf); _departRaf = null; }
  if (_departTrainName) {
    document.querySelectorAll(`#train-layer image[data-train="${_departTrainName}"]`).forEach(el => el.setAttribute('opacity', '0'));
  }
  _departTrainName = null;
}
function _departAnimLoop() {
  if (!_departTrainName) return;
  const els = document.querySelectorAll(`#train-layer image[data-train="${_departTrainName}"]`);
  const elapsed = performance.now() - _departStart;
  const opacity = 1.0 - 0.9 * ((Math.sin(elapsed / 400) + 1) / 2);
  els.forEach(el => el.setAttribute('opacity', opacity.toFixed(3)));
  _departRaf = requestAnimationFrame(_departAnimLoop);
}

// ---- MOVEMENT ANIMATION ----
let _moveRaf = null;
let _moveStart = 0;
let _moveDuration = 1500;
let _moveState = null;
let _movePrevState = null;
let _movePath = null;
let _moveTotalLen = 0;
let _moveUnits = [];
let _moveAnimCompleted = false;
let _moveAnimIdx = -1;
let _moveAnimFinished = false;
let _movePathFrontOffset = 0;
let _moveFrontOff = 0;
let _moveUnitSpans = [];
let _moveSrcTrack = null;
let _moveSrcSpan = null;
let _moveSrcRev = false;

function buildMovePath(train, state, prevState, startAtTail) {
  const trackIds = state.train_path && state.train_path[train];
  if (!trackIds || trackIds.length < 1) return null;
  const srcTrack = prevState && prevState.trains[train] ? prevState.trains[train].track : null;
  let allTracks;
  if (srcTrack && trackIds[0] !== srcTrack) {
    allTracks = [srcTrack].concat(trackIds);
  } else {
    allTracks = trackIds.slice();
  }
  if (allTracks.length < 2) return null;
  _movePathFrontOffset = 0;
  _moveSrcTrack = null;
  _moveSrcSpan = null;
  _moveSrcRev = false;
  const combined = [];
  const segStartIdx = [];
  for (let i = 0; i < allTracks.length; i++) {
    const tid = allTracks[i];
    const pos = positions[tid];
    const shape = pos && Array.isArray(pos.shape) && pos.shape.length >= 2 ? pos.shape : null;
    let pts = null;
    if (shape) {
      if (i === 0) {
        // Boundary fraction where the parked train sits: with startAtTail use
        // the real span from the previous state (works for mid-track parking),
        // otherwise fall back to the flush-parking centre estimate.
        let boundary = null;
        if (startAtTail && prevState && prevState.trains[train]) {
          const span = trainFractionsOnTrack(train, tid, prevState);
          // Degenerate spans ([0,0], e.g. missing train lengths over-subscribing
          // a shared track) carry no position information -> use the fallback.
          if (span && span[1] - span[0] > 0.005) {
            boundary = span[1];
            const tailFrac = span[0];
            const exitSide0 = edgeSideOf(tid, allTracks[1]);
            if (exitSide0 === 'b') {
              pts = subPolyline(shape, Math.min(tailFrac, 0.99), 1);
            } else if (exitSide0 === 'a') {
              pts = subPolyline(shape, 0, Math.max(boundary, 0.01));
              if (pts.length >= 2) pts.reverse();
            }
            if (pts && pts.length >= 2) {
              // Arc distance from the path start (the train's tail) to its nose,
              // so the animation can place sprites at their true parked spot.
              _movePathFrontOffset = (boundary - tailFrac) * polylineLength(shape);
              _moveSrcTrack = tid;
              _moveSrcSpan = [tailFrac, boundary];
              _moveSrcRev = exitSide0 === 'a';
            }
          }
        }
        if (!pts) {
          const restSide = (prevState.trains[train] && prevState.trains[train].restSide) || 'b';
          const ratio = trainRatio(train, tid);
          const center = restSide === 'a' ? Math.min(ratio / 2, 0.99) : Math.max(1 - ratio / 2, 0.01);
          const exitSide = edgeSideOf(tid, allTracks[1]);
          if (exitSide === 'b') {
            pts = subPolyline(shape, Math.min(center, 0.99), 1);
          } else if (exitSide === 'a') {
            pts = subPolyline(shape, 0, Math.max(center, 0.01));
            if (pts.length >= 2) pts.reverse();
          } else {
            pts = restSide === 'a' ? shape.slice() : shape.slice().reverse();
          }
        }
      } else {
        const entrySide = edgeSideOf(tid, allTracks[i-1]);
        pts = (entrySide === 'b') ? shape.slice().reverse() : shape.slice();
      }
    }
    if (pts && pts.length >= 2) {
      segStartIdx.push(Math.max(0, combined.length - 1));
      let start = 0;
      if (combined.length > 0) {
        const last = combined[combined.length - 1];
        const first = pts[0];
        if (Math.abs(last[0] - first[0]) < 0.01 && Math.abs(last[1] - first[1]) < 0.01 && pts.length > 2) {
          start = 1;
        }
      }
      for (let j = start; j < pts.length; j++) combined.push(pts[j]);
    } else {
      const x = pos ? pos.x : 0;
      const y = pos ? pos.y : 0;
      if (combined.length === 0 || Math.abs(combined[combined.length-1][0] - x) > 0.01 || Math.abs(combined[combined.length-1][1] - y) > 0.01) {
        combined.push([x, y]);
        segStartIdx.push(combined.length - 1);
      }
    }
  }
  if (combined.length >= 2 && allTracks.length >= 2 && segStartIdx.length > 0) {
    const destTrack = allTracks[allTracks.length - 1];
    const destEntrySide = edgeSideOf(destTrack, allTracks[allTracks.length - 2]);
    let frontFrac = null;
    const destTrains = Object.keys(state.trains).filter(t => {
      const ti = state.trains[t];
      return ti && ti.track === destTrack && t !== train && ti.status !== 'departed' && ti.status !== 'absorbed';
    });
    if (destTrains.length > 0) {
      let nearFracs = null;
      for (const t of destTrains) {
        const tf = trainFractionsOnTrack(t, destTrack, state);
        if (tf) {
          if (destEntrySide === 'b') {
            if (!nearFracs || tf[1] > nearFracs[1]) nearFracs = tf;
          } else {
            if (!nearFracs || tf[0] < nearFracs[0]) nearFracs = tf;
          }
        }
      }
      if (nearFracs) {
        frontFrac = destEntrySide === 'b' ? (1 - nearFracs[1]) : nearFracs[0];
      }
    }
    if (frontFrac === null) {
      const fracs = trainFractionsOnTrack(train, destTrack, state);
      if (fracs) {
        frontFrac = destEntrySide === 'b' ? (1 - fracs[0]) : fracs[1];
      }
    }
    if (frontFrac !== null && frontFrac > 0.02 && frontFrac < 0.99) {
      // Distances must come from the actual polyline: hops between tracks can
      // cover extra ground (switch centres sit off the shape ends, and a path's
      // first element need not neighbour the source track), so incrementally
      // summed shape lengths drift and the cut would land far too early.
      const startIdx = segStartIdx[segStartIdx.length - 1];
      let destStartDist = 0;
      for (let j = 1; j <= startIdx; j++) {
        destStartDist += Math.hypot(combined[j][0] - combined[j-1][0], combined[j][1] - combined[j-1][1]);
      }
      const destShape = positions[destTrack] && Array.isArray(positions[destTrack].shape) ? positions[destTrack].shape : null;
      const totalLen = polylineLength(combined);
      const fullTrackLen = destShape ? polylineLength(destShape) : (totalLen - destStartDist);
      const maxDist = destStartDist + frontFrac * fullTrackLen;
      if (totalLen > 0 && maxDist < totalLen) {
        const truncated = subPolyline(combined, 0, maxDist / totalLen);
        if (truncated.length >= 2) {
          combined.length = 0;
          combined.push.apply(combined, truncated);
        }
      }
    }
  }
  return combined.length >= 2 ? combined : null;
}

function pointOnPath(polyline, dist) {
  if (!polyline || polyline.length < 2) return { x: 0, y: 0, angle: 0 };
  let acc = 0;
  for (let i = 1; i < polyline.length; i++) {
    const a = polyline[i-1], b = polyline[i];
    const seg = Math.hypot(b[0]-a[0], b[1]-a[1]);
    if (seg <= 0) continue;
    if (acc + seg >= dist) {
      const t = (dist - acc) / seg;
      return {
        x: a[0] + (b[0]-a[0]) * t,
        y: a[1] + (b[1]-a[1]) * t,
        angle: Math.atan2(b[1]-a[1], b[0]-a[0]) * 180 / Math.PI
      };
    }
    acc += seg;
  }
  const last = polyline[polyline.length - 1];
  const prev = polyline[polyline.length - 2];
  return {
    x: last[0], y: last[1],
    angle: Math.atan2(last[1]-prev[1], last[0]-prev[0]) * 180 / Math.PI
  };
}

// Arc distance from the start of the polyline to the projection of point p.
// Used to anchor a sprite's ride position at its chord midpoint, which can sit
// slightly off the rails when its slice crosses shape vertices.
function projectDistanceOnPath(polyline, p) {
  if (!polyline || polyline.length < 2) return 0;
  let best = null, acc = 0;
  for (let i = 1; i < polyline.length; i++) {
    const a = polyline[i-1], b = polyline[i];
    const seg = Math.hypot(b[0]-a[0], b[1]-a[1]);
    if (seg <= 0) continue;
    const tt = Math.max(0, Math.min(1, ((p.x-a[0])*(b[0]-a[0]) + (p.y-a[1])*(b[1]-a[1])) / (seg*seg)));
    const cx = a[0] + (b[0]-a[0])*tt, cy = a[1] + (b[1]-a[1])*tt;
    const dd = Math.hypot(p.x-cx, p.y-cy);
    if (!best || dd < best.d) best = { d: dd, dist: acc + seg*tt };
    acc += seg;
  }
  return best ? best.dist : 0;
}

function startMoveAnim(state, prevState) {
  cancelMoveAnim();
  const train = state.train;
  if (!train) return;
  const path = buildMovePath(train, state, prevState, true);
  if (!path || path.length < 2) return;
  _movePath = path;
  _moveTotalLen = polylineLength(path);
  if (_moveTotalLen <= 0) return;
  _moveFrontOff = Math.min(_movePathFrontOffset, _moveTotalLen * 0.9);
  _moveState = state;
  _movePrevState = prevState;
  
  const units = data.trainUnits ? data.trainUnits[train] : null;
  if (units && units.length) {
    _moveUnits = units.map(u => {
      return { typePrefix: u.typePrefix, length: u.length || 0, img: data.unitImages ? data.unitImages[u.typePrefix] : null };
    });
  } else {
    _moveUnits = [];
  }
  
  // Per-member spans frozen at t=0 so the moving consist starts identical to
  // the parked render: same order (array order from the span's low-fraction
  // end, split by physical length), same slice per sprite, same facing.
  _moveUnitSpans = [];
  if (_moveUnits.length > 0) {
    const span = (_moveSrcTrack && prevState) ? trainFractionsOnTrack(train, _moveSrcTrack, prevState) : null;
    const srcPos = _moveSrcTrack ? positions[_moveSrcTrack] : null;
    const srcShape = srcPos && Array.isArray(srcPos.shape) && srcPos.shape.length >= 2 ? srcPos.shape : null;
    if (_moveSrcSpan && span && srcShape && span[1] - span[0] > 0.005) {
      const shapeLen = polylineLength(srcShape);
      const totalPhys = _moveUnits.reduce((s, x) => s + (x.length || 0), 0);
      let curF = span[0];
      _moveUnits.forEach(u => {
        const natW = TRAIN_H / (u.img ? u.img.aspect : 0.25);
        const frac = ((u.length || 0) > 0 ? (u.length / totalPhys) : 1 / _moveUnits.length) * (span[1] - span[0]);
        const nextF = Math.min(span[1], curF + frac);
        if (nextF > curF) {
          // Arc distances along the move path occupied by this member at t=0.
          const dLow = (_moveSrcRev ? _moveSrcSpan[1] - nextF : curF - _moveSrcSpan[0]) * shapeLen;
          const dHigh = (_moveSrcRev ? _moveSrcSpan[1] - curF : nextF - _moveSrcSpan[0]) * shapeLen;
          let clipPct = 0;
          // Parked-style image offset: nose edge flush with the span's far
          // end (imgX = spanLen/2 - natW), so clipped sprites show exactly
          // the same slice as when parked.
          let imgX = -natW / 2;
          const seg = subPolyline(_movePath, Math.max(0, dLow) / _moveTotalLen, Math.min(1, dHigh / _moveTotalLen));
          if (seg.length >= 2) {
            const svgPts = seg.map(p => [toSvgX(p[0]), toSvgY(p[1])]);
            const L = polylineLength(svgPts);
            clipPct = Math.max(0, (1 - L / natW) * 100);
            imgX = L / 2 - natW;
          }
          // Frozen facing: the parked chord angle for this member's own span,
          // so reverse-exit moves translate the image instead of flipping it.
          const chordAngle = segAngle(subPolyline(srcShape, curF, nextF));
          // Ride anchor + exact t=0 pivot: a slice may cross shape vertices
          // (full-track parking), where chord midpoint != arc midpoint.  The
          // member rides the path from the arc projection of its chord
          // midpoint, and reproduces the parked sprite pixel-exactly at t=0.
          let mid = (dLow + dHigh) / 2;
          let pivot0 = null;
          const slice = subPolyline(srcShape, curF, nextF);
          if (slice.length >= 2) {
            const cm = {
              x: (slice[0][0] + slice[slice.length - 1][0]) / 2,
              y: (slice[0][1] + slice[slice.length - 1][1]) / 2,
            };
            pivot0 = { x: toSvgX(cm.x), y: toSvgY(cm.y) };
            mid = projectDistanceOnPath(_movePath, cm);
          }
          _moveUnitSpans.push({ mid: mid, natW: natW, clipPct: clipPct, angle: chordAngle, imgX: imgX, pivot0: pivot0 });
        } else {
          _moveUnitSpans.push(null);
        }
        curF = nextF;
      });
    } else {
      // No parked-span info: stack by natural width behind the front offset.
      let off = 0;
      _moveUnits.forEach(u => {
        const natW = TRAIN_H / (u.img ? u.img.aspect : 0.25);
        const frontD = Math.max(0, Math.min(_moveFrontOff, _moveTotalLen) - off);
        const backD = Math.max(0, frontD - natW);
        let clipPct = 0;
        let angle = 0;
        let imgX = -natW / 2;
        const seg = subPolyline(_movePath, backD / _moveTotalLen, frontD / _moveTotalLen);
        if (seg.length >= 2) {
          const svgPts = seg.map(p => [toSvgX(p[0]), toSvgY(p[1])]);
          const L = polylineLength(svgPts);
          clipPct = Math.max(0, (1 - L / natW) * 100);
          imgX = L / 2 - natW;
          angle = pointOnPath(_movePath, (frontD + backD) / 2).angle;
          if (angle > 90) angle -= 180;
          else if (angle < -90) angle += 180;
        }
        _moveUnitSpans.push({ mid: (backD + frontD) / 2, natW: natW, clipPct: clipPct, angle: angle, imgX: imgX });
        off += natW;
      });
    }
  }

  // Arrival anchors: freeze each member's destination-side geometry (chord
  // pivot, facing, image offset and clip polygon) from the post-move state,
  // so the final animated frame is pixel-identical to the parked rendering
  // that replaces it when the move completes.
  if (_moveUnits.length > 0 && state.trains[train]) {
    const destInfo = state.trains[train];
    const destPos = destInfo.track ? positions[destInfo.track] : null;
    const destShape = destPos && Array.isArray(destPos.shape) && destPos.shape.length >= 2 ? destPos.shape : null;
    const destSpan = destShape ? trainFractionsOnTrack(train, destInfo.track, state) : null;
    if (destSpan && destSpan[1] - destSpan[0] > 0.005) {
      const totalPhys = _moveUnits.reduce((s, x) => s + (x.length || 0), 0);
      let curF = destSpan[0];
      _moveUnits.forEach((u, k) => {
        const s = _moveUnitSpans[k];
        const natW = TRAIN_H / (u.img ? u.img.aspect : 0.25);
        const frac = ((u.length || 0) > 0 ? (u.length / totalPhys) : 1 / _moveUnits.length) * (destSpan[1] - destSpan[0]);
        const nextF = Math.min(destSpan[1], curF + frac);
        if (s && nextF > curF) {
          const pts = subPolyline(destShape, curF, nextF);
          if (pts.length >= 2) {
            const svgPts = pts.map(p => [toSvgX(p[0]), toSvgY(p[1])]);
            const L = polylineLength(svgPts);
            s.imgX1 = L / 2 - natW;
            s.clipPct1 = Math.max(0, (1 - L / natW) * 100);
            s.angle1 = segAngle(pts);
            s.pivot1 = {
              x: toSvgX((pts[0][0] + pts[pts.length - 1][0]) / 2),
              y: toSvgY((pts[0][1] + pts[pts.length - 1][1]) / 2),
            };
          }
        }
        curF = nextF;
      });
    }
  }
  
  // Constant speed: 300 px/s, clamped 300ms - 5000ms
  _moveDuration = Math.max(300, Math.min(5000, (_moveTotalLen / 300) * 1000));
  const trainEls = document.querySelectorAll('#train-layer [data-train="'+train+'"]');
  trainEls.forEach(el => { el.setAttribute('data-move-hidden','1'); el.style.display='none'; });
  _moveStart = performance.now();
  if (!_moveRaf) _moveMoveLoop();
}

function cancelMoveAnim() {
  if (_moveRaf) { cancelAnimationFrame(_moveRaf); _moveRaf = null; }
  document.querySelectorAll('#train-layer [data-move-hidden]').forEach(el => {
    el.removeAttribute('data-move-hidden'); el.style.display='';
  });
  document.querySelectorAll('#train-layer [data-move-anim]').forEach(el => el.remove());
  document.getElementById('yard-svg').querySelectorAll('clipPath[id^="mc-"]').forEach(cp => cp.remove());
  _movePath = null; _moveState = null; _movePrevState = null; _moveUnits = [];
  _moveFrontOff = 0;
  _moveUnitSpans = [];
  _moveSrcTrack = null;
  _moveSrcSpan = null;
  _moveSrcRev = false;
}

function _moveMoveLoop() {
  if (!_movePath) return;
  const elapsed = performance.now() - _moveStart;
  const t = Math.min(1, elapsed / _moveDuration);
  _moveDrawFrame(t);
  if (t < 1) {
    _moveRaf = requestAnimationFrame(_moveMoveLoop);
  } else {
    _moveRaf = null;
    _movePath = null;
    _moveAnimCompleted = true;
    _moveAnimIdx = current;
    _moveAnimFinished = true;
    render(current);
  }
}

function _moveDrawFrame(t) {
  if (!_movePath || !_moveState) return;
  const layer = document.getElementById('train-layer');
  layer.querySelectorAll('[data-move-anim]').forEach(el => el.remove());
  
  const train = _moveState.train;
  const color = trainColorMap[train] || '#888';
  const easeT = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
  const shift = easeT * (_moveTotalLen - _moveFrontOff);

  // Draw train sprites from their frozen t=0 spans: every member translates
  // along the path keeping its own slice and parked facing.
  if (_moveUnits.length > 0) {
    _moveUnits.forEach((u, unitIndex) => {
      const s = _moveUnitSpans[unitIndex];
      if (!s || !u.img) return;
      // Frame 0 reproduces the parked sprite at the origin exactly; frame 1
      // reproduces the parked sprite at the destination exactly, so starting
      // or ending a move never shifts the train.  In between, each member
      // rides the path tangent at its own position.
      const firstFrame = t === 0;
      const lastFrame = t === 1 && s.pivot1;
      const pm = pointOnPath(_movePath, s.mid + shift);
      const cx = lastFrame ? s.pivot1.x : (firstFrame && s.pivot0) ? s.pivot0.x : toSvgX(pm.x);
      const cy = lastFrame ? s.pivot1.y : (firstFrame && s.pivot0) ? s.pivot0.y : toSvgY(pm.y);
      // Each member follows the path tangent at its own position. The tangent
      // is unwrapped against the angle rendered in the PREVIOUS frame (parked
      // facing for the first frame), so members turn continuously through
      // curves and never mirror 180°.  On the final frame the parked facing is
      // emitted unmodified so it matches the static render bit-for-bit.
      let deg;
      if (lastFrame) {
        deg = s.angle1;
      } else {
        deg = firstFrame ? s.angle : pm.angle;
        const ref = (s.lastDeg == null) ? s.angle : s.lastDeg;
        while (deg - ref > 90) deg -= 180;
        while (deg - ref < -90) deg += 180;
      }
      s.lastDeg = deg;
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'image');
      const imgX = lastFrame ? s.imgX1 : s.imgX;
      const clipPct = lastFrame ? s.clipPct1 : s.clipPct;
      el.setAttribute('href', u.img.uri);
      // Parked-style offset: the visible (post-clip) part of the image sits
      // exactly where it does when parked, so the span midpoint doubles as a
      // stable pivot for clipped sprites while they turn.
      el.setAttribute('x', imgX);
      el.setAttribute('y', -TRAIN_H);
      el.setAttribute('width', s.natW);
      el.setAttribute('height', TRAIN_H);
      el.setAttribute('transform', `translate(${cx},${cy}) rotate(${deg})`);
      el.setAttribute('style', clipPct > 0
        ? `pointer-events:none; clip-path: polygon(${clipPct}% 0, 100% 0, 100% 100%, ${clipPct}% 100%)`
        : 'pointer-events:none');
      if (train) el.setAttribute('data-train', train);
      el.setAttribute('data-move-anim','1');
      layer.appendChild(el);
    });
  } else {
    // Fallback for trains without unit images
    const midDist = Math.max(0, _moveFrontOff + shift - TRAIN_H);
    const pm = pointOnPath(_movePath, midDist);
    const cx = toSvgX(pm.x);
    const cy = toSvgY(pm.y);
    let deg = pm.angle;
    if (deg > 90) deg -= 180;
    else if (deg < -90) deg += 180;
    const w = Math.max(10, TRAIN_H * 1.5);
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    el.setAttribute('x', -w/2); el.setAttribute('y', -TRAIN_H/2);
    el.setAttribute('width', w); el.setAttribute('height', TRAIN_H);
    el.setAttribute('rx', 3); el.setAttribute('fill', color);
    el.setAttribute('transform', `translate(${cx},${cy}) rotate(${deg})`);
    el.setAttribute('style', 'pointer-events:none');
    if (train) el.setAttribute('data-train', train);
    el.setAttribute('data-move-anim','1');
    layer.appendChild(el);
  }
}

// ---- PARTICLE IMAGE PROCESSING ----
const _processedParticleCache = {};
function processParticleImage(uri) {
  if (!uri) return Promise.resolve(uri);
  if (_processedParticleCache[uri]) return Promise.resolve(_processedParticleCache[uri]);
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const id = ctx.getImageData(0, 0, c.width, c.height);
      const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 230 && d[i+1] > 230 && d[i+2] > 230) d[i+3] = 0;
      }
      ctx.putImageData(id, 0, 0);
      const out = c.toDataURL('image/png');
      _processedParticleCache[uri] = out;
      resolve(out);
    };
    img.onerror = () => resolve(uri);
    img.src = uri;
  });
}
let _particlesReady = false;
function ensureParticleImages() {
  if (_particlesReady) return Promise.resolve();
  const uris = data.particleImages || {};
  const keys = Object.keys(uris);
  return Promise.all(keys.map(k => processParticleImage(uris[k]))).then(results => {
    keys.forEach((k, i) => { data.particleImages[k] = results[i]; });
    _particlesReady = true;
  });
}

// ---- PARTICLE SYSTEM ----
const particles = [];
let _particleRaf = null;
let _serviceSpawn = null;  // trackId, serviceType, state, nextSpawn

function Particle(x, y, vx, vy, size, imgUri, life) {
  this.x = x; this.y = y; this.vx = vx; this.vy = vy;
  this.size = size; this.imgUri = imgUri;
  this.life = life; this.maxLife = life;
  this.opacity = 1;
}

// Compute the fraction range a train occupies on a track (replicates updateYard anchor logic).
// Stacking is clamped to the parkable straight range when available.
function trainFractionsOnTrack(train, trackId, state) {
  const pos = positions[trackId];
  const shape = pos && Array.isArray(pos.shape) && pos.shape.length >= 2 ? pos.shape : null;
  if (!shape) return null;
  const pr = parkableRanges[trackId];
  const rangeStart = pr ? pr.startFrac : 0;
  const rangeEnd = pr ? pr.endFrac : 1;
  const trainsOnTrack = [];
  Object.keys(state.trains).forEach(t => {
    const info = state.trains[t];
    if (info && info.track === trackId && info.status !== 'departed' && info.status !== 'absorbed') trainsOnTrack.push(t);
  });
  const to = state.trackOrder || {};
  if (to[trackId]) {
    const present = to[trackId].filter(t => trainsOnTrack.includes(t));
    if (present.length === trainsOnTrack.length) { trainsOnTrack.length = 0; present.forEach(t => trainsOnTrack.push(t)); }
  }
  const anchorA = [], anchorB = [];
  trainsOnTrack.forEach(t => {
    const info = state.trains[t];
    (info.restSide === 'a' ? anchorA : anchorB).push(t);
  });
  let cum = rangeStart;
  for (const t of anchorA) {
    const end = Math.min(rangeEnd, cum + trainRatio(t, trackId) * (rangeEnd - rangeStart));
    if (t === train) return [cum, end];
    cum = end;
  }
  let cumEnd = rangeEnd;
  for (const t of anchorB) {
    const start = Math.max(rangeStart, cumEnd - trainRatio(t, trackId) * (rangeEnd - rangeStart));
    if (t === train) return [start, cumEnd];
    cumEnd = start;
  }
  return null;
}

function spawnParticles(trackId, serviceType, state) {
  const MAX_PARTICLES = 15;
  if (particles.length >= MAX_PARTICLES) return;
  const pos = positions[trackId];
  if (!pos) return;
  const imgUri = serviceType === 'Monteur'
    ? (data.particleImages.gears || null)
    : (data.particleImages.waterdrop || null);
  if (!imgUri) return;
  let cx, cy;
  const fracs = state ? trainFractionsOnTrack(state.train, trackId, state) : null;
  if (fracs && pos.shape && pos.shape.length >= 2) {
    const pts = subPolyline(pos.shape, fracs[0], fracs[1]);
    if (pts.length >= 2) {
      const mid = pts[Math.floor(pts.length / 2)];
      cx = toSvgX(mid[0]); cy = toSvgY(mid[1]);
    } else {
      cx = toSvgX(pos.x); cy = toSvgY(pos.y);
    }
  } else {
    cx = toSvgX(pos.x); cy = toSvgY(pos.y);
  }
  const isMonteur = serviceType === 'Monteur';
  const batch = Math.min(3, MAX_PARTICLES - particles.length);
  for (let i = 0; i < batch; i++) {
    const ox = (Math.random() - 0.5) * 30;
    const oy = (Math.random() - 0.5) * 15;
    const vx = (Math.random() - 0.5) * 0.3;
    const vy = isMonteur ? -(0.2 + Math.random() * 0.4) : (0.2 + Math.random() * 0.4);
    const size = isMonteur ? 16 + Math.random() * 10 : 14 + Math.random() * 8;
    const life = 1200 + Math.random() * 800;
    particles.push(new Particle(cx + ox, cy + oy, vx, vy, size, imgUri, life));
  }
}

function updateParticles(now) {
  const layer = document.getElementById('particles-layer');
  if (!layer) return;
  if (!now) now = performance.now();
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= 16;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx; p.y += p.vy;
    p.opacity = Math.min(1, p.life / (p.maxLife * 0.3));
  }
  layer.innerHTML = '';
  particles.forEach(p => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    el.setAttribute('href', p.imgUri);
    el.setAttribute('x', p.x - p.size / 2);
    el.setAttribute('y', p.y - p.size / 2);
    el.setAttribute('width', p.size);
    el.setAttribute('height', p.size);
    el.setAttribute('opacity', p.opacity);
    el.setAttribute('style', 'pointer-events:none');
    layer.appendChild(el);
  });
}

function _particleLoop(now) {
  if (!_serviceSpawn && particles.length === 0) { _particleRaf = null; return; }
  if (_serviceSpawn && now >= _serviceSpawn.nextSpawn) {
    spawnParticles(_serviceSpawn.trackId, _serviceSpawn.serviceType, _serviceSpawn.state);
    _serviceSpawn.nextSpawn = now + 1500;
  }
  updateParticles(now);
  _particleRaf = requestAnimationFrame(_particleLoop);
}

function stopParticles() {
  _serviceSpawn = null;
  particles.length = 0;
  const layer = document.getElementById('particles-layer');
  if (layer) layer.innerHTML = '';
  if (_particleRaf) { cancelAnimationFrame(_particleRaf); _particleRaf = null; }
}

function shortName(n) {
  if (/^train_in_standing_\d+$/.test(n)) return n.replace(/^train_in_standing_(\d+)$/, 'Standing $1');
  if (/^train\D/.test(n)) return n.replace(/^train/, 'Train ');
  if (/^su_/.test(n)) return n.replace(/^su_/, 'SU ');
  if (n.includes('+')) { const parts = n.split('+'); return parts.join(' + ') + ' \u2014 combined'; }
  return n;
}
function actionLabel(a) {
  return {arrive:'arrive',move:'move',park:'park',depart:'depart',service:'service',wait:'wait',initial:'start',combine:'combine',split:'split'}[a]||a;
}
function plainDesc(state) {
  const t = state.train ? shortName(state.train) : null;
  const raw = state.raw || '';
  const a = state.action_type;
  if (a==='initial') return 'Initial state \u2014 all trains at starting positions';
  if (a==='arrive'&&t) { const m=raw.match(/@\s*(\S+)/); return m?t+' arrived at track '+m[1]:t+' arrived'; }
  if (a==='move'&&t) {
    const info=data.states[current].trains[state.train];
    const prev=data.states[Math.max(0,current-1)].trains[state.train];
    const isCombined = state.train && state.train.includes('+');
    const suffix = isCombined ? ' \u2014 combined unit' : '';
    return t+' moved from track '+trackName(prev?prev.track:null)+' \u2192 track '+trackName(info?info.track:null)+suffix;
  }
  if (a==='park'&&t) { const info=data.states[current].trains[state.train]; return t+' parked on track '+trackName(info?info.track:null); }
  if (a==='depart'&&t) { const m=raw.match(/@\s*(\S+)/); return t+' departed from track '+(m?m[1]:'?')+' \u2713'; }
  if (a==='service'&&t) return t+' \u2014 service: '+raw.replace(/^\d+(\.\.\d+)?:\s*/,'');
  if (a==='wait'&&t) return t+' waiting';
  if (a==='split'&&t) { const m=raw.match(/\u2192\s*(.+)$/); return t+' split into '+(m?m[1]:'?'); }
  return raw.replace(/^\d+(\.\.\d+)?:\s*/,'');
}

// ---- YARD MAP ----
const positions = data.positions || {};
const trackMeta = data.trackMeta || {};
const posKeys = Object.keys(positions);
const hasPositions = posKeys.length > 0;
function trackName(id) {
  if (!id) return '?';
  const pos = positions[id];
  if (pos && pos.name) return pos.name;
  const meta = trackMeta[id];
  if (meta && meta.name) return meta.name;
  return id;
}
let svgMinX=0, svgMinY=0, svgScaleX=1, svgScaleY=1, svgPad=20, svgNodeR=3, svgNodeRActive=5, svgNodeRPrev=4, svgTrackW=2, svgTrackWActive=3, svgTrackWPrev=2.5;

function portOf(pos, side) {
  if (pos && Array.isArray(pos.shape) && pos.shape.length>=2) {
    return side==='a' ? pos.shape[0] : pos.shape[pos.shape.length-1];
  }
  return pos ? [pos.x, pos.y] : null;
}
function nodeCircleR(pos, meta) {
  const layoutSize=pos&&pos.size;
  const isParking=meta.parkingAllowed===true;
  if (layoutSize==='big') return svgNodeR;
  if (isParking) return svgNodeR;
  return Math.max(1, svgNodeR*0.22);
}
function attachTooltip(el,id,meta,isParking) {
  el.addEventListener('mouseover', function(e) {
    const tip=document.getElementById('node-tooltip');
    tip.querySelector('.tt-name').textContent=trackName(id);
    tip.querySelector('.tt-type').textContent=meta.type?'('+meta.type+')':'';
    tip.querySelector('.tt-parking').textContent=isParking?'parking':'';
    tip.style.display='block';
  });
  el.addEventListener('mousemove', function(e) {
    const tip=document.getElementById('node-tooltip');
    tip.style.left=(e.clientX+12)+'px';
    tip.style.top=(e.clientY-8)+'px';
  });
  el.addEventListener('mouseout', function() {
    document.getElementById('node-tooltip').style.display='none';
  });
}

function buildYard() {
  if (!hasPositions) { document.getElementById('yard-panel').style.display='none'; return; }
  const xs=posKeys.map(k=>positions[k].x), ys=posKeys.map(k=>positions[k].y);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const hasImage = data.imageDataUri && data.imageWidth && data.imageHeight;
  if (hasImage) {
    const imgW = data.imageWidth, imgH = data.imageHeight;
    svgPad = 0; svgScaleX = 1; svgScaleY = 1; svgMinX = 0; svgMinY = 0;
    svgNodeR = 14; svgNodeRActive = 20; svgNodeRPrev = 16;
    svgTrackW = 6; svgTrackWActive = 9; svgTrackWPrev = 7;
    const svg = document.getElementById('yard-svg');
    svg.setAttribute('viewBox', `0 0 ${imgW} ${imgH}`);
    const aspectH = Math.round(800 * imgH / imgW);
    svg.setAttribute('height', Math.max(200, aspectH));
    const img = document.createElementNS('http://www.w3.org/2000/svg','image');
    img.setAttribute('href', data.imageDataUri);
    img.setAttribute('x', 0); img.setAttribute('y', 0);
    img.setAttribute('width', imgW); img.setAttribute('height', imgH);
    svg.insertBefore(img, svg.firstChild);
  } else {
    const pad=20,svgW=1000,svgH=120;
    const scale=Math.min((svgW-pad*2)/(maxX-minX||1),(svgH-pad*2)/(maxY-minY||1));
    svgPad=20; svgScaleX=scale; svgScaleY=scale; svgMinX=minX; svgMinY=minY;
    svgNodeR=3; svgNodeRActive=5; svgNodeRPrev=4; svgTrackW=2; svgTrackWActive=3; svgTrackWPrev=2.5;
    document.getElementById('yard-svg').setAttribute('viewBox',`0 0 ${svgW} ${svgH}`);
  }
  const edgesLayer=document.getElementById('edges-layer');
  data.edges.forEach(e => {
    const a=positions[e.source],b=positions[e.target];
    if(!a||!b) return;
    const ap=portOf(a,e.sourceSide||'a'), bp=portOf(b,e.targetSide||'b');
    if(!ap||!bp) return;
    const line=document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1',toSvgX(ap[0])); line.setAttribute('y1',toSvgY(ap[1]));
    line.setAttribute('x2',toSvgX(bp[0])); line.setAttribute('y2',toSvgY(bp[1]));
    line.setAttribute('stroke','var(--yard-edge)'); line.setAttribute('stroke-width','1.5');
    line.setAttribute('data-source',e.source); line.setAttribute('data-target',e.target);
    edgesLayer.appendChild(line);
  });
  const nodesLayer=document.getElementById('nodes-layer');
  posKeys.forEach(id => {
    const pos=positions[id];
    const meta=trackMeta[id]||{};
    const isParking=meta.parkingAllowed===true;
    const shape = pos && Array.isArray(pos.shape) && pos.shape.length>=2 ? pos.shape : null;
    const nodeId='node-'+id.replace(/[^a-zA-Z0-9]/g,'_');
    let el;
    if (shape) {
      const pts=shape.map(p=>toSvgX(p[0])+','+toSvgY(p[1])).join(' ');
      el=document.createElementNS('http://www.w3.org/2000/svg','polyline');
      el.setAttribute('points',pts);
      el.setAttribute('fill','none');
      el.setAttribute('stroke','var(--yard-node)');
      el.setAttribute('stroke-width',svgTrackW);
      el.setAttribute('stroke-linejoin','round');
      el.setAttribute('stroke-linecap','round');
      el.setAttribute('style','pointer-events:stroke');
      el.setAttribute('data-shape','1');
    } else {
      el=document.createElementNS('http://www.w3.org/2000/svg','circle');
      el.setAttribute('cx',toSvgX(pos.x)); el.setAttribute('cy',toSvgY(pos.y));
      el.setAttribute('r',nodeCircleR(pos,meta));
      el.setAttribute('fill','var(--yard-node)');
      el.setAttribute('stroke','#fff'); el.setAttribute('stroke-width','2');
    }
    el.classList.add('t-node');
    el.setAttribute('data-parking',isParking?'1':'0');
    el.setAttribute('data-id',id);
    el.setAttribute('id',nodeId);
    attachTooltip(el,id,meta,isParking);
    nodesLayer.appendChild(el);
  });
  const legendEl=document.getElementById('yard-legend');
  allTrains.forEach(train => {
    const item=document.createElement('div'); item.className='yard-leg';
    item.innerHTML=`<div class="yard-leg-dot" style="background:${trainColorMap[train]}"></div>${shortName(train)}`;
    legendEl.appendChild(item);
  });
}
function toSvgX(x) { return svgPad+(x-svgMinX)*svgScaleX; }
function toSvgY(y) { return svgPad+(y-svgMinY)*svgScaleY; }

function polylineLength(shape) {
  let total = 0;
  for (let i = 1; i < shape.length; i++) {
    total += Math.hypot(shape[i][0]-shape[i-1][0], shape[i][1]-shape[i-1][1]);
  }
  return total;
}

// Sub-polyline of `shape` covering cumulative pixel-length fractions [fStart, fEnd].
function subPolyline(shape, fStart, fEnd) {
  const total = polylineLength(shape);
  if (total <= 0 || fStart >= 1 || fEnd <= 0 || fEnd <= fStart) return [];
  const startD = Math.max(0, Math.min(total, fStart * total));
  const endD = Math.max(startD, Math.min(total, fEnd * total));
  const pts = [];
  let acc = 0;
  for (let i = 1; i < shape.length; i++) {
    const a = shape[i-1], b = shape[i];
    const seg = Math.hypot(b[0]-a[0], b[1]-a[1]);
    if (seg <= 0) continue;
    const segStart = acc, segEnd = acc + seg;
    if (segEnd < startD) { acc = segEnd; continue; }
    if (segStart > endD) break;
    if (pts.length === 0) {
      const t0 = Math.max(0, (startD - segStart) / seg);
      pts.push([a[0] + (b[0]-a[0])*t0, a[1] + (b[1]-a[1])*t0]);
    }
    if (segEnd >= endD) {
      const t1 = Math.min(1, (endD - segStart) / seg);
      if (t1 > 0) pts.push([a[0] + (b[0]-a[0])*t1, a[1] + (b[1]-a[1])*t1]);
      break;
    }
    pts.push([b[0], b[1]]);
    acc = segEnd;
  }
  if (pts.length === 1) pts.push(pts[0]);
  return pts;
}

// ---- PARKABLE RANGES & GLOBAL SCALE ----
// Where trains may park on each track: a [startFrac, endFrac] window of the
// polyline, measured from the A-side end (shape start).  A track can override
// it in the layout file with "parking": [s, e]; anything missing or invalid
// means the whole shape is parkable.
const parkableRanges = {};
(function computeParkableRanges() {
  Object.keys(positions).forEach(tid => {
    const pos = positions[tid];
    const shape = pos && Array.isArray(pos.shape) && pos.shape.length >= 2 ? pos.shape : null;
    if (!shape) { parkableRanges[tid] = null; return; }
    const total = polylineLength(shape);
    if (!(total > 0)) { parkableRanges[tid] = null; return; }
    let startFrac = 0, endFrac = 1;
    const pk = pos.parking;
    if (Array.isArray(pk) && pk.length === 2 &&
        Number.isFinite(+pk[0]) && Number.isFinite(+pk[1])) {
      startFrac = Math.min(1, Math.max(0, +pk[0]));
      endFrac = Math.min(1, Math.max(0, +pk[1]));
      if (!(endFrac > startFrac)) { startFrac = 0; endFrac = 1; }
    }
    parkableRanges[tid] = {
      startFrac,
      endFrac,
      pixelLength: polylineLength(subPolyline(shape, startFrac, endFrac)),
    };
  });
})();

// Global scale factor: map physical metres to pixel width so that if the real
// train lengths fit on a track, the visual sprites fit too.  Derived from the
// track whose straight segment has the *smallest* pixel-to-metre ratio (the
// most compressed rendering).  Falls back to 1 px/m when no track has a
// physical length.
let globalScale = 1;
const DEFAULT_TRACK_PHYSICAL_M = 200;
(function computeGlobalScale() {
  let bestRatio = Infinity;
  Object.keys(parkableRanges).forEach(tid => {
    const pr = parkableRanges[tid];
    if (!pr) return;
    const meta = trackMeta[tid];
    const physM = (meta && meta.length > 0) ? meta.length : DEFAULT_TRACK_PHYSICAL_M;
    const ratio = pr.pixelLength / physM;
    if (ratio < bestRatio) bestRatio = ratio;
  });
  if (bestRatio < Infinity && bestRatio > 0) globalScale = bestRatio;
})();

function trainRatio(train, trackId) {
  const trackLen = trackMeta[trackId] ? trackMeta[trackId].length : 0;
  const trainLen = data.trainLengths ? data.trainLengths[train] : 0;
  if (trainLen > 0 && trackLen > 0) return Math.min(1, trainLen / trackLen);
  return 1;
}

function drawTrainSegment(trackId, fStart, fEnd, color, width) {
  const pos = positions[trackId];
  const shape = pos && Array.isArray(pos.shape) && pos.shape.length >= 2 ? pos.shape : null;
  if (!shape) return;
  const pts = subPolyline(shape, fStart, fEnd);
  if (!pts.length) return;
  const poly = document.createElementNS('http://www.w3.org/2000/svg','polyline');
  poly.setAttribute('points', pts.map(p => toSvgX(p[0]) + ',' + toSvgY(p[1])).join(' '));
  poly.setAttribute('fill','none');
  poly.setAttribute('stroke', color);
  poly.setAttribute('stroke-width', width || svgTrackWActive);
  poly.setAttribute('stroke-linejoin','round');
  poly.setAttribute('stroke-linecap','round');
  poly.setAttribute('style','pointer-events:none');
  poly.setAttribute('data-track', trackId);
  document.getElementById('train-layer').appendChild(poly);
}

// Direction (degrees) of the first->last chord of a sub-polyline.  Normalised
// so the sprite is never flipped more than 90 degrees from upright.
function segAngle(pts) {
  if (!pts || pts.length < 2) return 0;
  const a = pts[0], b = pts[pts.length - 1];
  let deg = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
  if (deg > 90) deg -= 180;
  else if (deg < -90) deg += 180;
  return deg;
}

// Fixed height (SVG units) for all train sprites.  The image is rendered at
// its natural aspect ratio; if it is wider than the lit segment, the excess
// is clipped from the LEFT so the front/right of the train stays visible.
const TRAIN_H = 30;

// Draw one unit's sprite.  Height is TRAIN_H, width is the natural image width
// at that height, right-aligned to the segment end.  A band clipPath around the
// sub-polyline chord slices off the left overflow.
function drawTrainSprite(trackId, fStart, fEnd, typePrefix, flip, parked, trainName) {
  const pos = positions[trackId];
  const shape = pos && Array.isArray(pos.shape) && pos.shape.length >= 2 ? pos.shape : null;
  const img = data.unitImages ? data.unitImages[typePrefix] : null;
  if (!shape || !img) return;
  const pts = subPolyline(shape, fStart, fEnd);
  if (pts.length < 2) return;
  // Segment length in SVG coordinates (handles both background-image and
  // no-background coordinate systems correctly).
  const svgPts = pts.map(p => [toSvgX(p[0]), toSvgY(p[1])]);
  const segLen = polylineLength(svgPts);
  const natW = TRAIN_H / img.aspect;
  const cx = toSvgX((pts[0][0] + pts[pts.length - 1][0]) / 2);
  const cy = toSvgY((pts[0][1] + pts[pts.length - 1][1]) / 2);
  let deg = segAngle(pts);
  const imgX = segLen / 2 - natW;
  const el = document.createElementNS('http://www.w3.org/2000/svg','image');
  el.setAttribute('href', img.uri);
  el.setAttribute('x', imgX);
  el.setAttribute('y', -TRAIN_H);
  el.setAttribute('width', natW);
  el.setAttribute('height', TRAIN_H);
  el.setAttribute('transform', `translate(${cx},${cy}) rotate(${deg})`);
  const clipPct = Math.max(0, (1 - segLen / natW) * 100);
  el.setAttribute('style', clipPct > 0
    ? `pointer-events:none; clip-path: polygon(${clipPct}% 0, 100% 0, 100% 100%, ${clipPct}% 100%)`
    : 'pointer-events:none');
  if (parked) el.setAttribute('filter','url(#greenTint)');
  if (trainName) el.setAttribute('data-train', trainName);
  document.getElementById('train-layer').appendChild(el);
}

// Draw a train's colored segment and one sprite per member laid out in name
// order from the rest anchor.  Each sprite has fixed height TRAIN_H and is
// clipped to the fraction span.
function drawTrainOnTrack(trackId, fStart, fEnd, train, restSideB, parked) {
  drawTrainSegment(trackId, fStart, fEnd, trainColorMap[train]);
  const units = data.trainUnits ? data.trainUnits[train] : null;
  if (!units || !units.length) return;
  let cur = fStart;
  units.forEach(u => {
    const span = (u.length || 0) > 0 ? (u.length / (units.reduce((s,x) => s + (x.length || 0), 0) || units.length)) * (fEnd - fStart) : (fEnd - fStart) / units.length;
    const next = Math.min(fEnd, cur + span);
    if (next > cur) {
      const img = data.unitImages ? data.unitImages[u.typePrefix] : null;
      drawTrainSprite(trackId, cur, next, u.typePrefix, !!(img && img.flip), parked, train);
    }
    cur = next;
  });
}

// Which end ('a' or 'b') of trackId connects to neighborId, via data.edges.
function edgeSideOf(trackId, neighborId) {
  for (let i = 0; i < data.edges.length; i++) {
    const e = data.edges[i];
    if (e.source === trackId && e.target === neighborId) return e.sourceSide;
    if (e.source === neighborId && e.target === trackId) return e.targetSide;
  }
  return null;
}

function updateYard(state, prevState) {
  if(!hasPositions) return;
  document.querySelectorAll('#edges-layer line').forEach(l => {
    l.setAttribute('stroke','var(--yard-edge)'); l.setAttribute('stroke-width','1.5');
  });
  document.querySelectorAll('#nodes-layer .t-node').forEach(n => {
    const id=n.getAttribute('data-id');
    const pos=id?positions[id]:null;
    const meta=id?(trackMeta[id]||{}):{};
    if (n.getAttribute('data-shape')==='1') {
      n.setAttribute('stroke','var(--yard-node)');
      n.setAttribute('stroke-width',svgTrackW);
      n.setAttribute('fill','none');
    } else {
      n.setAttribute('fill','var(--yard-node)');
      n.setAttribute('stroke','#fff'); n.setAttribute('stroke-width','2');
      n.setAttribute('r',nodeCircleR(pos,meta));
    }
  });
  document.getElementById('train-layer').innerHTML='';
  // Clean up previous clipPaths from train sprites
  const svgEl = document.getElementById('yard-svg');
  if (svgEl) svgEl.querySelectorAll('clipPath[id^="tc-"]').forEach(cp => cp.remove());
  const trainsToShow=filterTrain?[filterTrain]:allTrains;
  trainsToShow.forEach(train => {
    const info=state.trains[train];
    if(!info||!info.track||(info.status==='departed'&&!(state.action_type==='depart'&&train===state.train))||info.status==='absorbed') return;
    const color=trainColorMap[train];
    if (_movePath && _moveState && _moveState.train === train) return;
    // One continuous polyline for the whole travelled route: buildMovePath already
    // resolves entry/exit sides, concatenates track shapes through switches and
    // truncates the tail at the train's final position, so the highlight follows
    // the same geometry as the movement animation instead of per-track spans
    // stitched together with straight connector lines.
    const route = state.train_path && state.train_path[train]
      ? buildMovePath(train, state, prevState, true)
      : null;
    if (!route || route.length < 2) return;
    const poly=document.createElementNS('http://www.w3.org/2000/svg','polyline');
    poly.setAttribute('points',route.map(p=>toSvgX(p[0])+','+toSvgY(p[1])).join(' '));
    poly.setAttribute('fill','none');
    poly.setAttribute('stroke',color);
    poly.setAttribute('stroke-width',svgTrackWActive);
    poly.setAttribute('stroke-linejoin','round');
    poly.setAttribute('stroke-linecap','round');
    poly.setAttribute('style','pointer-events:none');
    poly.setAttribute('data-route',train);
    document.getElementById('train-layer').appendChild(poly);
  });

  // Trains on tracks: draw proportional-length segments along track shapes.
  // Every train with a track gets a colored segment + sprite (moving trains are
  // drawn on their current track too, so color is always accompanied by art).
  // Each train rests flush against its restSide end (a-side or b-side), i.e. it
  // moved as far as possible away from the side it entered; unknown -> b-side.
  const groups = {};
  const trackOrder = state.trackOrder || {};
  Object.keys(state.trains).forEach(train => {
    if (filterTrain && train !== filterTrain) return;
    const info = state.trains[train];
    if (!info || !info.track || (info.status==='departed'&&!(state.action_type==='depart'&&train===state.train)) || info.status==='absorbed') return;
    let renderTrack = info.track;
    if (info.status==='departed' && train===state.train && state.action_type==='depart' && prevState && prevState.trains[train] && prevState.trains[train].track) {
      renderTrack = prevState.trains[train].track;
    }
    (groups[renderTrack] = groups[renderTrack] || []).push(train);
  });
  Object.keys(groups).forEach(trackId => {
    if (trackOrder[trackId]) {
      const present = trackOrder[trackId].filter(t => groups[trackId].includes(t));
      if (present.length === groups[trackId].length) groups[trackId] = present;
    }
  });
  Object.keys(groups).forEach(trackId => {
    const pos = positions[trackId];
    const shape = pos && Array.isArray(pos.shape) && pos.shape.length >= 2 ? pos.shape : null;
    const node = document.getElementById('node-'+trackId.replace(/[^a-zA-Z0-9]/g,'_'));
    if (shape) {
      const pr = parkableRanges[trackId];
      const rangeStart = pr ? pr.startFrac : 0;
      const rangeEnd = pr ? pr.endFrac : 1;
      const anchorA = [], anchorB = [];
      groups[trackId].forEach(train => {
        const info = state.trains[train];
        (info.restSide === 'a' ? anchorA : anchorB).push(train);
      });
      let cum = rangeStart;
      anchorA.forEach(train => {
        const end = Math.min(rangeEnd, cum + trainRatio(train, trackId) * (rangeEnd - rangeStart));
        if (end > cum) drawTrainOnTrack(trackId, cum, end, train, state.trains[train].restSide === 'b', !!state.trains[train].wasParked);
        cum = end;
      });
      let cumEnd = rangeEnd;
      anchorB.forEach(train => {
        const start = Math.max(rangeStart, cumEnd - trainRatio(train, trackId) * (rangeEnd - rangeStart));
        if (cumEnd > start) drawTrainOnTrack(trackId, start, cumEnd, train, state.trains[train].restSide === 'b', !!state.trains[train].wasParked);
        cumEnd = start;
      });
    } else if (node) {
      groups[trackId].forEach(train => {
        node.setAttribute('fill', trainColorMap[train]);
        node.setAttribute('r', svgNodeRActive);
      });
    }
  });

  // ---- ANIMATION OVERLAYS ----
  // For combine: draw absorbed members' segments at the combined train's track,
  // within the combined train's actual fraction range, colored with individual colors.
  if (state.action_type === 'combine' && state.train && state.train.includes('+')) {
    const members = state.train.split('+');
    const trackId = state.trains[state.train] && state.trains[state.train].track;
    if (trackId) {
      const fracs = trainFractionsOnTrack(state.train, trackId, state);
      const pos = positions[trackId];
      const shape = pos && Array.isArray(pos.shape) && pos.shape.length >= 2 ? pos.shape : null;
      if (fracs && shape) {
        const span = fracs[1] - fracs[0];
        const totalMemberLen = members.reduce((s, m) => s + (data.trainLengths ? (data.trainLengths[m] || 0) : 0), 0);
        let cum = fracs[0];
        members.forEach(m => {
          const mLen = data.trainLengths ? (data.trainLengths[m] || 0) : 0;
          const frac = totalMemberLen > 0 ? (mLen / totalMemberLen) * span : span / members.length;
          const end = Math.min(fracs[1], cum + frac);
          if (end > cum) {
            const color = trainColorMap[m] || '#888';
            const pts = subPolyline(shape, cum, end);
            if (pts.length >= 2) {
              const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
              poly.setAttribute('points', pts.map(p => toSvgX(p[0]) + ',' + toSvgY(p[1])).join(' '));
              poly.setAttribute('fill', 'none');
              poly.setAttribute('stroke', color);
              poly.setAttribute('stroke-width', svgTrackWActive);
              poly.setAttribute('stroke-linejoin', 'round');
              poly.setAttribute('stroke-linecap', 'round');
              poly.setAttribute('style', 'pointer-events:none');
              poly.setAttribute('data-combine-member', m);
              document.getElementById('train-layer').appendChild(poly);
            }
          }
          cum = end;
        });
      }
    }
  }
  // For split: draw each child's final span in the parent's color,
  // so the animation can tween it toward that child's own color
  // (exact inverse of the combine overlay above).
  if (state.action_type === 'split' && state.parent_name && state.child_names && state.child_names.length) {
    const parentColor = trainColorMap[state.parent_name] || '#888';
    state.child_names.forEach(c => {
      const trackId = state.trains[c] && state.trains[c].track;
      if (!trackId) return;
      const fracs = trainFractionsOnTrack(c, trackId, state);
      if (!fracs) return;
      const pos = positions[trackId];
      const shape = pos && Array.isArray(pos.shape) && pos.shape.length >= 2 ? pos.shape : null;
      if (!shape) return;
      const pts = subPolyline(shape, fracs[0], fracs[1]);
      if (pts.length >= 2) {
        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        poly.setAttribute('points', pts.map(p => toSvgX(p[0]) + ',' + toSvgY(p[1])).join(' '));
        poly.setAttribute('fill', 'none');
        poly.setAttribute('stroke', parentColor);
        poly.setAttribute('stroke-width', svgTrackWActive);
        poly.setAttribute('stroke-linejoin', 'round');
        poly.setAttribute('stroke-linecap', 'round');
        poly.setAttribute('style', 'pointer-events:none');
        poly.setAttribute('data-split-child', c);
        document.getElementById('train-layer').appendChild(poly);
      }
    });
  }
}

// ---- TABLE ----
function buildRows() {
  document.getElementById('tbody').innerHTML = allTrains.map(train => {
    const isComboPair = train.includes('+');
    const rowClass = isComboPair ? 'data-row combo-row' : 'data-row';
    return `<tr class="${rowClass}" id="row-${train}" onclick="filterByTrain('${train}')">
      <td><span class="train-dot" style="background:${trainColorMap[train]}"></span><span class="train-name">${shortName(train)}</span>${data.trainLengths && data.trainLengths[train] ? `<span class="train-len">\u00b7 ${data.trainLengths[train]} m</span>` : ''}</td>
      <td id="status-${train}">-</td>
      <td id="track-${train}">-</td>
      <td id="prev-track-${train}"><span class="prev-track">-</span></td>
    </tr>`;
  }).join('');
}

// ---- TIMELINE ----
function buildTimeline() {
  const tl=document.getElementById('timeline');
  tl.innerHTML='';
  data.states.forEach((state,i) => {
    const item=document.createElement('div');
    item.className='t-item'; item.dataset.idx=i; item.dataset.train=state.train||'';
    const atype=state.action_type||'initial';
    const badgeClass = 'badge-'+atype;
    const badgeText = actionLabel(atype);
    item.innerHTML=`
      <div class="t-num">${String(i).padStart(2,'0')}</div>
      <span class="t-badge ${badgeClass}">${badgeText}</span>
      <div class="t-text">${state.train?shortName(state.train)+' \u2014 ':''}${state.raw.replace(/^\d+(\.\.\d+)?:\s*/,'').replace(/\s*[-@\u2192]\s*/g,' \u2192 ')}</div>
    `;
    item.onclick=()=>render(i);
    tl.appendChild(item);
  });
}

function filterByTrain(train) {
  if(filterTrain===train){clearFilter();return;}
  filterTrain=train;
  document.getElementById('filter-label').textContent='Clear filter \u00d7';
  document.querySelectorAll('.data-row').forEach(r=>r.classList.toggle('selected',r.id==='row-'+train));
  applyFilter(); render(current);
}
function clearFilter() {
  filterTrain=null;
  document.getElementById('filter-label').textContent='';
  document.querySelectorAll('.data-row').forEach(r=>r.classList.remove('selected'));
  applyFilter(); render(current);
}
function applyFilter() {
  document.querySelectorAll('.t-item').forEach(el => {
    el.classList.toggle('hidden',!(!filterTrain||el.dataset.train===filterTrain||el.dataset.idx==='0'));
  });
}

function updateSummary() {
  const last=data.states[data.states.length-1].trains;
  document.getElementById('s-trains').textContent=allTrains.length;
  document.getElementById('s-steps').textContent=data.states.length-1;
  document.getElementById('s-departed').textContent=Object.values(last).filter(t=>t.status==='departed').length;
  document.getElementById('s-parked').textContent=Object.values(last).filter(t=>t.status==='parked').length;
}

function render(idx) {
  current=Math.max(0,Math.min(data.states.length-1,idx));
  if (current !== _moveAnimIdx) { _moveAnimCompleted = false; _moveAnimFinished = false; }
  const state=data.states[current];
  const prevState=data.states[Math.max(0,current-1)];
  const atype=state.action_type||'initial';

  const badge=document.getElementById('action-badge');
  badge.textContent=actionLabel(atype);
  badge.className='action-badge action-'+atype;
  document.getElementById('action-desc').textContent=plainDesc(state);
  document.getElementById('slider').value=current;
  document.getElementById('ctr').textContent=current+' / '+(data.states.length-1);

  allTrains.forEach(train => {
    const info=state.trains[train];
    const prev=prevState.trains[train];
    const statusEl=document.getElementById('status-'+train);
    const trackEl=document.getElementById('track-'+train);
    const prevEl=document.getElementById('prev-track-'+train);
    const row=document.getElementById('row-'+train);

    if(!info){statusEl.innerHTML='-';trackEl.innerHTML='-';prevEl.innerHTML='<span class="prev-track">-</span>';return;}

    const changed=current>0&&prev&&prev.track!==info.track;
    const isCombined=info.status==='combined';

    if(row) {
      row.classList.toggle('is-combined', info.status==='absorbed');
    }
    let statusHTML='';
    if(info.status==='parked') statusHTML='<span class="status-badge status-parked">parked</span>';
    else if(info.status==='departed') statusHTML='<span class="status-badge status-departed">departed</span>';
    else if(info.status==='combined') statusHTML='<span class="status-badge status-combined">combined</span>';
    else if(info.status==='absorbed') statusHTML='<span class="status-badge status-absorbed">absorbed</span>';
    else if(info.status==='service') statusHTML='<span class="status-badge status-service">service</span>';
    else if(train===state.train && atype!=='wait' && atype!=='initial') statusHTML='<span class="status-badge status-active">moving</span>';
    else statusHTML='<span class="status-badge status-waiting">waiting</span>';
    statusEl.innerHTML=statusHTML;

    const isAbsorbed = info.status==='absorbed';
    const cls=changed?'track-cell track-changed':isAbsorbed?'track-cell track-departed':'track-cell track-normal';

    // Entry queue tag
    const trainsOnSameTrack=allTrains.filter(t=>state.trains[t]&&state.trains[t].track===info.track);
    const noneHaveMoved=trainsOnSameTrack.every(t=>{
      const init=data.states[0].trains[t];
      return init&&init.track===state.trains[t].track;
    });
    const entryTag=trainsOnSameTrack.length>1&&noneHaveMoved
      ?' <span style="font-size:10px;color:var(--muted);font-weight:400">(entry queue)</span>':'';
    const trackDisplay = info.track ? trackName(info.track) : (info.status==='absorbed' ? '\u2014 absorbed' : isCombined ? '\u2014 combined' : '\u2014 not yet in yard');
    trackEl.innerHTML=`<span class="${cls}">${trackDisplay}</span>${entryTag}`;
    prevEl.innerHTML=`<span class="prev-track">${prev&&prev.track?trackName(prev.track):'-'}</span>`;
  });

  if (_moveAnimFinished) {
    _moveAnimFinished = false;
  } else {

  updateYard(state,prevState);

  // ---- ANIMATION & PARTICLE LIFECYCLE ----
  cancelAnim();
  cancelParkPulse();
  cancelArrivalAnim();
  cancelDepartAnim();
  stopParticles();
  if ((atype === 'move' || atype === 'move_to') && !(_moveAnimCompleted && _moveAnimIdx === current) && state.train && state.train_path && state.train_path[state.train] && state.train_path[state.train].length >= 2) {
    startMoveAnim(state, prevState);
  } else if (atype === 'combine' && state.train && state.train.includes('+')) {
    startCombineAnim(state);
  } else if (atype === 'split' && state.parent_name) {
    startSplitAnim(state);
  } else if (atype === 'park') {
    startParkPulse(state.train);
  } else if (atype === 'arrive') {
    startArrivalAnim(state.train);
  } else if (atype === 'depart') {
    startDepartAnim(state.train);
  }
  if (atype === 'service' && state.service_type) {
    const svcTrack = state.trains[state.train] && state.trains[state.train].track;
    if (svcTrack) {
      ensureParticleImages().then(() => {
        _serviceSpawn = { trackId: svcTrack, serviceType: state.service_type, state: state, nextSpawn: 0 };
        spawnParticles(svcTrack, state.service_type, state);
        if (!_particleRaf) _particleRaf = requestAnimationFrame(_particleLoop);
      });
    }
  }

  }

  document.querySelectorAll('.t-item').forEach((el,i)=>el.classList.toggle('current',i===current));
  const cur=document.querySelector('.t-item.current:not(.hidden)');
  if(cur) cur.scrollIntoView({block:'nearest',behavior:'smooth'});
}

function prev(){render(current-1);}
function next(){render(current+1);}
function togglePlay(){
  if(timer){clearInterval(timer);timer=null;document.getElementById('playBtn').innerHTML='&#9654; Play';}
  else{
    document.getElementById('playBtn').innerHTML='&#9646;&#9646; Pause';
    timer=setInterval(()=>{
      if(current>=data.states.length-1){clearInterval(timer);timer=null;document.getElementById('playBtn').innerHTML='&#9654; Play';}
      else render(current+1);
    },900);
  }
}
function toggleTheme(){
  const html=document.documentElement;
  const isDark=html.getAttribute('data-theme')==='dark';
  html.setAttribute('data-theme',isDark?'light':'dark');
  document.getElementById('theme-btn').textContent=isDark?'Dark':'Light';
  localStorage.setItem('shunting-theme',isDark?'light':'dark');
}
let bottomOpen=false;
function toggleBottom(){
  bottomOpen=!bottomOpen;
  const panel=document.getElementById('bottom-panel');
  const yp=document.getElementById('yard-panel');
  const arrow=document.getElementById('toggle-arrow');
  if(bottomOpen){
    panel.style.display='grid';
    yp.classList.add('panel-open');
    arrow.textContent='\u25BC';
  } else {
    panel.style.display='none';
    yp.classList.remove('panel-open');
    arrow.textContent='\u25B2';
  }
}
const saved=localStorage.getItem('shunting-theme');
if(saved){
  document.documentElement.setAttribute('data-theme',saved);
  document.getElementById('theme-btn').textContent=saved==='dark'?'Light':'Dark';
}

document.getElementById('slider').max=data.states.length-1;
buildYard();
buildRows();
buildTimeline();
updateSummary();
render(0);
