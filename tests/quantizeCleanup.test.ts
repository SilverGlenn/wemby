import assert from 'node:assert/strict';
import test from 'node:test';
import { smoothIndexedEdges, mergeThinRimLayers } from '../src/utils/colorUtils.ts';
import { potraceDetectCorners, straightenRuns } from '../src/utils/potraceEngine.ts';
import { groupCompoundPaths } from '../src/utils/topology.ts';

test('potraceDetectCorners detects all corners of a collapsed 3-vertex polygon', () => {
  // Aggressive alphamax can collapse a small triangle to 3 vertices; those
  // must be corners, otherwise it is fitted as rounded blobs with overshoot.
  const tri = [
    { x: 100, y: 82 },
    { x: 115.6, y: 109 },
    { x: 84.4, y: 109 },
  ];
  const corners = potraceDetectCorners(tri, 45);
  assert.equal(corners.length, 3);
});

test('groupCompoundPaths punches holes only when fully contained', () => {  const square = (x0, y0, x1, y1) => ({
    points: [
      { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
    ],
    pathData: `M ${x0} ${y0} L ${x1} ${y0} L ${x1} ${y1} L ${x0} ${y1} Z`,
  });

  const outer = square(0, 0, 100, 100);
  const hole = square(40, 40, 60, 60);
  const edgeHugger = square(95, 40, 105, 60); // pokes outside the parent

  const result = groupCompoundPaths([outer, hole, edgeHugger]);

  assert.equal(result.length, 2, 'outer+hole compound and standalone edge contour');
  const compound = result.find((d) => d.includes('M 0 0'))!;
  const standalone = result.find((d) => d.includes('M 95 40'))!;
  assert.ok(compound.includes('M 40 40'), 'hole should be punched into the outer path');
  assert.ok(!standalone.includes('M 40 40'), 'edge-hugging contour must stay standalone');
});

test('smoothIndexedEdges removes 1px boundary bumps but keeps 1px line interiors', () => {
  const W = 300, H = 100;
  const base = new Uint8Array(W * H); // 0 = white, 1 = blue
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) base[y * W + x] = y >= 50 ? 1 : 0;

  // 1px bumps: alternating rows 49/50 at scattered columns
  for (let x = 10; x < W; x += 7) base[49 * W + x] = 1;
  for (let x = 13; x < W; x += 9) base[50 * W + x] = 0;
  // isolated noise pixels
  base[20 * W + 40] = 1;
  base[80 * W + 200] = 0;
  // legit 1px vertical blue line
  for (let y = 10; y < 40; y++) base[y * W + 150] = 1;

  smoothIndexedEdges(base, W, H, 2);

  // Boundary deviation per column (rows 45-55) must be ~0
  let dev = 0;
  for (let x = 0; x < W; x++) {
    if (x === 150) continue;
    let pos = 50;
    for (let y = 45; y < 55; y++) {
      if (base[y * W + x] === 1) { pos = y; break; }
    }
    dev += Math.abs(pos - 50);
  }
  assert.equal(dev, 0, `expected straight boundary, deviation=${dev}`);

  // 1px line interior survives (endpoints may erode by design)
  for (let y = 12; y < 38; y++) {
    assert.equal(base[y * W + 150], 1, `line pixel eaten at y=${y}`);
  }
});

test('smoothIndexedEdges removes isolated noise speckles', () => {
  const W = 20, H = 20;
  const idx = new Uint8Array(W * H); // all color 0
  idx[5 * W + 5] = 1;  // isolated speckle
  idx[10 * W + 10] = 2;
  idx[10 * W + 11] = 2; // 2px speckle pair
  smoothIndexedEdges(idx, W, H, 2);
  assert.equal(idx[5 * W + 5], 0, 'single speckle not removed');
  assert.equal(idx[10 * W + 10], 0, 'speckle pair not removed');
  assert.equal(idx[10 * W + 11], 0, 'speckle pair not removed');
});

test('mergeThinRimLayers collapses rim chains into solid colors', () => {
  // Solid blue | band rim | beige skin rim (only rim neighbors) | band rim | white
  const W = 400, H = 400;
  const palette = [
    { r: 20, g: 40, b: 160 },   // 0: blue
    { r: 138, g: 148, b: 208 }, // 1: AA band
    { r: 232, g: 222, b: 190 }, // 2: beige skin
    { r: 250, g: 247, b: 235 }, // 3: AA band
    { r: 255, g: 255, b: 255 }, // 4: white
  ];
  const indexed = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = x < 150 ? 0 : x < 153 ? 1 : x < 155 ? 2 : x < 158 ? 3 : 4;
      indexed[y * W + x] = c;
    }
  }

  const m = mergeThinRimLayers(palette, indexed, W, H);

  assert.ok(m.palette.length < 5, `expected rim layers merged, got ${m.palette.length} colors`);
  assert.ok(!m.palette.some((p) => p.r === 232 && p.g === 222), 'beige skin layer survived');
});

test('mergeThinRimLayers protects legit thin design elements (gold ring)', () => {
  const W = 400, H = 400, CX = 200, CY = 200;
  const palette = [
    { r: 20, g: 40, b: 160 },   // blue circle
    { r: 218, g: 165, b: 32 },  // gold ring
    { r: 255, g: 255, b: 255 }, // white bg
  ];
  const indexed = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - CX, y - CY) - 120;
      indexed[y * W + x] = d < 0 ? 0 : d < 1 ? 1 : 2;
    }
  }

  const m = mergeThinRimLayers(palette, indexed, W, H);

  assert.ok(m.palette.length === 3, `gold ring should survive, got ${m.palette.length} colors`);
  assert.ok(m.palette.some((p) => p.r === 218 && p.g === 165), 'gold ring was eaten');
});

test('groupCompoundPaths keeps islands inside holes as filled (donut center)', () => {
  const square = (x0, y0, x1, y1) => ({
    points: [
      { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
    ],
    pathData: `M ${x0} ${y0} L ${x1} ${y0} L ${x1} ${y1} L ${x0} ${y1} Z`,
  });

  // bg | ring region (hole in bg) | center island (inside the ring hole)
  const bg = square(0, 0, 200, 200);
  const ring = square(40, 40, 160, 160);
  const island = square(80, 80, 120, 120);

  const result = groupCompoundPaths([bg, ring, island]);

  const islandCompound = result.find((d) => d.includes('M 80 80'));
  const bgCompound = result.find((d) => d.startsWith('M 0 0'));

  assert.ok(islandCompound, 'island must render as its own filled compound');
  assert.ok(!islandCompound.includes('M 40 40'), 'island must not be grouped with the ring hole');
  assert.ok(bgCompound && bgCompound.includes('M 40 40'), 'ring hole must be punched from the background');
  assert.ok(bgCompound && !bgCompound.includes('M 80 80'), 'island must not be punched out of the background');
});

test('straightenRuns absorbs sub-epsilon waviness into exact straight lines', () => {
  // A 400px top edge with a single 0.4px bump and a 1px bump: both below the
  // 0.475 epsilon, so the whole edge collapses to one run -> two endpoints
  // sitting exactly on the fitted line.
  const pts = [];
  for (let x = 0; x <= 400; x++) {
    const w = (x === 100 ? 0.4 : 0) + (x === 300 ? 0.4 : 0);
    pts.push({ x, y: 100 + w });
  }
  for (let x = 400; x >= 0; x--) pts.push({ x, y: 120 });

  const out = straightenRuns(pts, 0.475);
  const top = out.filter((p) => Math.abs(p.y - 100) < 12);

  assert.equal(top.length, 2, `expected single collapsed run (2 endpoints), got ${top.length}`);
  assert.ok(Math.abs(top[0].y - 100) < 0.01 && Math.abs(top[1].y - 100) < 0.01,
    'collapsed edge must sit on the fitted line');
});
