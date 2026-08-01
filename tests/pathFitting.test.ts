import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contourToSvgPathData,
  simplifyClosedContour,
  type Point,
} from '../src/utils/pathFitting.ts';

function denseSquare(size: number): Point[] {
  const points: Point[] = [];
  for (let x = 0; x < size; x++) points.push({ x, y: 0 });
  for (let y = 0; y < size; y++) points.push({ x: size, y });
  for (let x = size; x > 0; x--) points.push({ x, y: size });
  for (let y = size; y > 0; y--) points.push({ x: 0, y });
  return points;
}

test('keeps true logo corners and removes dense edge points', () => {
  const simplified = simplifyClosedContour(denseSquare(100), 7);
  const path = contourToSvgPathData(simplified, 7, 45);

  assert.ok(simplified.length <= 8, `expected at most 8 points, received ${simplified.length}`);
  assert.match(path, / L /);
  assert.equal((path.match(/ C /g) ?? []).length, 0);
});

test('fits a compact smooth path without large curve overshoot', () => {
  const circle: Point[] = [];
  for (let degree = 0; degree < 360; degree++) {
    const angle = (degree * Math.PI) / 180;
    circle.push({
      x: 100 + Math.cos(angle) * 80,
      y: 100 + Math.sin(angle) * 80,
    });
  }

  const simplified = simplifyClosedContour(circle, 7);
  const path = contourToSvgPathData(simplified, 7, 45);
  const coordinates = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));

  assert.ok(path.length < 5000, `path is too large: ${path.length} characters`);
  assert.match(path, / C /);
  assert.ok(coordinates.every((value) => value >= 18 && value <= 182));
});
