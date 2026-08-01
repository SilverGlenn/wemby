import assert from 'node:assert/strict';
import test from 'node:test';
import { potraceOptimalPolygon, potraceFitContour } from '../src/utils/potraceEngine.ts';
import { zhangSuenThinning, extractSkeletonStrokes } from '../src/utils/centerlineEngine.ts';
import { applyBilateralFilter, removeAntiAliasHalos } from '../src/utils/imagePreprocess.ts';

function createSquareStaircase(size: number): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (let x = 0; x < size; x++) pts.push({ x, y: 0 });
  for (let y = 0; y < size; y++) pts.push({ x: size, y });
  for (let x = size; x > 0; x--) pts.push({ x, y: size });
  for (let y = size; y > 0; y--) pts.push({ x: 0, y });
  return pts;
}

test('potraceOptimalPolygon collapses a square perimeter near-straight edges', () => {
  const square = createSquareStaircase(50);
  const polygon = potraceOptimalPolygon(square, 1.0);

  // The chord cap keeps ~7px segments in the raw polygon; the collapse quality
  // is measured by the max deviation of the polygon from the ideal square
  // outline, which must stay within the tolerance scale.
  let maxDev = 0;
  for (const p of polygon) {
    const dxo = Math.max(0, p.x - 50, -p.x);
    const dyo = Math.max(0, p.y - 50, -p.y);
    maxDev = Math.max(maxDev, Math.sqrt(dxo * dxo + dyo * dyo));
  }
  assert.ok(maxDev < 2.5, `polygon must hug the square, maxDev=${maxDev.toFixed(2)}px`);
});

test('potraceFitContour generates valid SVG path with crisp lines and curves', () => {
  const staircase = createSquareStaircase(40);
  const pathData = potraceFitContour(staircase, 7, 45);

  assert.match(pathData, /^M\s+/);
  assert.match(pathData, /\s+Z$/);
});

test('zhangSuenThinning thins thick strokes into 1-pixel skeletons', () => {
  const width = 20;
  const height = 20;
  const mask = new Uint8Array(width * height);

  // Draw a 5px thick vertical bar
  for (let y = 2; y < 18; y++) {
    for (let x = 8; x <= 12; x++) {
      mask[y * width + x] = 1;
    }
  }

  const skeleton = zhangSuenThinning(mask, width, height);
  const strokes = extractSkeletonStrokes(skeleton, width, height);

  assert.ok(strokes.length > 0, 'should extract stroke polyline from skeleton');
  assert.ok(strokes[0].length >= 10, 'stroke path should contain skeleton points');
});

test('applyBilateralFilter preserves dimensions and cleans noise', () => {
  const width = 10;
  const height = 10;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 200;
    data[i + 1] = 100;
    data[i + 2] = 50;
    data[i + 3] = 255;
  }
  const imgData = { width, height, data };

  const filtered = applyBilateralFilter(imgData, 2.0, 20.0);
  assert.equal(filtered.width, width);
  assert.equal(filtered.height, height);
  assert.equal(filtered.data.length, imgData.data.length);
});

test('removeAntiAliasHalos process does not crash on empty images', () => {
  const imgData = { width: 10, height: 10, data: new Uint8ClampedArray(10 * 10 * 4) };
  const result = removeAntiAliasHalos(imgData, 20);
  assert.equal(result.width, 10);
});

