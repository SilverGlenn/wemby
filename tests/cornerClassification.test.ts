import assert from 'node:assert/strict';
import test from 'node:test';
import { potraceFitContour, potraceDetectCorners, normalizeContour, potraceOptimalPolygon, simplifyNearCollinear, straightenRuns } from '../src/utils/potraceEngine.ts';

const fit = (pts) => potraceFitContour(pts, 7, 45, 1024);

// Polygon stages exactly as potraceFitContour runs them (simplify + straighten
// remove mid-edge reach-cap artifacts before corner detection).
const fitPolygon = (pts) => {
  const alpha = Math.min(2.0, Math.max(0.4, 1.2 - 7 * 0.08) + Math.min(1.4, (1024 - 256) * 0.0012));
  const norm = normalizeContour(pts);
  let poly = simplifyNearCollinear(potraceOptimalPolygon(norm, alpha), alpha * 0.4);
  poly = simplifyNearCollinear(straightenRuns(poly, alpha * 0.35), alpha * 0.4);
  return { poly, norm, alpha };
};
const stats = (d) => ({
  C: (d.match(/C /g) || []).length,
  L: (d.match(/ L /g) || []).length,
});

const linearPolygon = (n, radius = 300) => {
  const verts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    verts.push([500 + radius * Math.cos(a), 500 + radius * Math.sin(a)]);
  }
  const pts = [];
  for (let i = 0; i < n; i++) {
    const [x0, y0] = verts[i], [x1, y1] = verts[(i + 1) % n];
    for (let s = 0; s < 100; s++) {
      const t = s / 100;
      pts.push({ x: Math.round((x0 + (x1 - x0) * t) * 100) / 100, y: Math.round((y0 + (y1 - y0) * t) * 100) / 100 });
    }
  }
  return pts;
};

const circle = (radius, count = 400) => {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    pts.push({ x: Math.round((500 + radius * Math.cos(a)) * 100) / 100, y: Math.round((500 + radius * Math.sin(a)) * 100) / 100 });
  }
  return pts;
};

test('sharp polygon corners render as straight segments (square/hexagon/pentagon)', () => {
  const square = [];
  for (let x = 0; x <= 300; x++) square.push({ x, y: 0 });
  for (let y = 0; y <= 300; y++) square.push({ x: 300, y });
  for (let x = 300; x >= 0; x--) square.push({ x, y: 300 });
  for (let y = 300; y >= 0; y--) square.push({ x: 0, y });
  const sq = stats(fit(square));
  assert.ok(sq.L >= 4, `square corners must be straight, got L=${sq.L}`);

  const hex = stats(fit(linearPolygon(6)));
  assert.ok(hex.L >= 5 && hex.C === 0, `hexagon corners must be sharp, got L=${hex.L} C=${hex.C}`);

  const pent = stats(fit(linearPolygon(5)));
  assert.ok(pent.L >= 4 && pent.C === 0, `pentagon corners must be sharp, got L=${pent.L} C=${pent.C}`);
});

test('curves stay curves: circles and tight arcs are not faceted', () => {
  const big = stats(fit(circle(300, 4000)));
  assert.ok(big.C > 20, `big circle must be smooth, got C=${big.C}`);

  const small = stats(fit(circle(20, 200)));
  assert.ok(small.C >= 6 && small.L === 0, `small circle must be smooth, got C=${small.C} L=${small.L}`);

  const tight = [];
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI;
    tight.push({ x: Math.round((100 + 8 * Math.cos(a)) * 100) / 100, y: Math.round((100 + 8 * Math.sin(a)) * 100) / 100 });
  }
  for (let i = 58; i >= 1; i--) tight.push({ x: tight[i].x, y: 100 - (tight[i].y - 100) });
  const tc = stats(fit(tight));
  assert.ok(tc.C >= 2, `tight curve must stay curved, got C=${tc.C} L=${tc.L}`);
});

test('corner detection is contour-aware: real corners yes, smooth joins no', () => {
  // Square: 4 corners detected
  const sq = [];
  for (let x = 205; x <= 819; x++) sq.push({ x, y: 205 });
  for (let y = 206; y <= 819; y++) sq.push({ x: 819, y });
  for (let x = 818; x >= 205; x--) sq.push({ x, y: 819 });
  for (let y = 818; y >= 206; y--) sq.push({ x: 205, y });
  const { poly: sqPoly, norm: sqNorm } = fitPolygon(sq);
  assert.ok(potraceDetectCorners(sqPoly, 45, sqNorm, 0.39).length >= 4, 'square corners must be detected');

  // Fillet-style smooth join: an arc between two straight edges must NOT
  // produce a corner at the join (tangent-continuous). The contour is closed
  // like a real boundary walk (back along the bottom edge to the start).
  const fillet = [];
  for (let x = 0; x <= 100; x++) fillet.push({ x, y: 0 });
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * (Math.PI / 2);
    fillet.push({ x: Math.round((100 + 40 * Math.sin(a)) * 100) / 100, y: Math.round((40 - 40 * Math.cos(a)) * 100) / 100 });
  }
  for (let y = 0; y <= 100; y++) fillet.push({ x: 140, y });
  for (let x = 139; x >= 0; x--) fillet.push({ x, y: 100 });
  const { poly: fPoly, norm: fNorm } = fitPolygon(fillet);
  const fCorners = potraceDetectCorners(fPoly, 45, fNorm, 0.39);
  // Only the shape's two real outer corners may be detected; the smooth
  // arc joins must not be.
  const joins = fCorners.filter((i) => {
    const p = fPoly[i];
    return p.x > 50 && p.x < 130 && p.y < 50;
  });
  assert.equal(joins.length, 0, `fillet arc joins must not be corners, got ${joins.length}`);
});

test('potraceFitContour output for a sharp square is geometrically accurate', () => {
  const sq = [];
  for (let x = 0; x <= 200; x++) sq.push({ x, y: 0 });
  for (let y = 0; y <= 200; y++) sq.push({ x: 200, y });
  for (let x = 200; x >= 0; x--) sq.push({ x, y: 200 });
  for (let y = 200; y >= 0; y--) sq.push({ x: 0, y });
  const d = potraceFitContour(sq, 7, 45, 1024);
  // All four corners must appear as path points (sharp, not rounded off)
  const toks = d.match(/[MLCZ]|[-+]?\d*\.?\d+/g) || [];
  const pts = [];
  let i = 0, x = 0, y = 0, sx = 0, sy = 0;
  while (i < toks.length) {
    const t = toks[i];
    if (t === 'M') { x = parseFloat(toks[++i]); y = parseFloat(toks[++i]); sx = x; sy = y; pts.push([x, y]); }
    else if (t === 'L') { x = parseFloat(toks[++i]); y = parseFloat(toks[++i]); pts.push([x, y]); }
    else if (t === 'C') {
      const c1x = parseFloat(toks[++i]), c1y = parseFloat(toks[++i]);
      const c2x = parseFloat(toks[++i]), c2y = parseFloat(toks[++i]);
      const nx = parseFloat(toks[++i]), ny = parseFloat(toks[++i]);
      for (let s = 1; s <= 24; s++) {
        const t1 = s / 24, t0 = 1 - t1;
        pts.push([t0 ** 3 * x + 3 * t0 ** 2 * t1 * c1x + 3 * t0 * t1 ** 2 * c2x + t1 ** 3 * nx,
          t0 ** 3 * y + 3 * t0 ** 2 * t1 * c1y + 3 * t0 * t1 ** 2 * c2y + t1 ** 3 * ny]);
      }
      x = nx; y = ny;
    }
    else if (t === 'Z') { pts.push([sx, sy]); i++; }
    else i++;
  }
  // max deviation from the square outline must stay within ~1px (tolerance scale)
  let maxDev = 0;
  for (const [px, py] of pts) {
    const dxo = Math.max(0, px - 200, -px);
    const dyo = Math.max(0, py - 200, -py);
    maxDev = Math.max(maxDev, Math.sqrt(dxo * dxo + dyo * dyo));
  }
  assert.ok(maxDev < 2, `square path must stay within tolerance, maxDev=${maxDev.toFixed(2)}px`);
});
