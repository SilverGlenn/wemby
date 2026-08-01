import assert from 'node:assert/strict';
import test from 'node:test';
import { createTracerOptions } from '../src/utils/tracerOptions.ts';
import type { VectorizerOptions } from '../src/types/vectorizer.ts';

const logoOptions: VectorizerOptions = {
  presetProfile: 'clipart',
  geometryMode: 'filled',
  maxColors: 16,
  speckleFilter: 8,
  smoothness: 7,
  cornerThreshold: 45,
  pathOverlap: true,
  upscale: true,
  upscaleMinDimension: 1024,
  blurRadius: 0,
  minColorAreaRatio: 0,
};

test('uses detailed layered tracing for clipart', () => {
  const options = createTracerOptions(logoOptions);

  assert.equal(options.numberofcolors, 16);
  assert.equal(options.layering, 0);
  assert.equal(options.colorsampling, 0);
  assert.equal(options.pathomit, 16);
  assert.equal(options.ltres, 0.35);
  assert.equal(options.qtres, 0.35);
  assert.equal(options.rightangleenhance, true);
});

test('does not hide small target colors', () => {
  const options = createTracerOptions({
    ...logoOptions,
    minColorAreaRatio: 0.01,
  });

  assert.equal(options.mincolorratio, 0);
});
