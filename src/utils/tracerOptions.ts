import type { VectorizerOptions } from '../types/vectorizer';

export interface ImageTracerOptions {
  ltres: number;
  qtres: number;
  pathomit: number;
  rightangleenhance: boolean;
  colorsampling: number;
  numberofcolors: number;
  mincolorratio: number;
  colorquantcycles: number;
  layering: number;
  strokewidth: number;
  linefilter: boolean;
  scale: number;
  roundcoords: number;
  viewbox: boolean;
  desc: boolean;
  blurradius: number;
  blurdelta: number;
  pal?: Array<{ r: number; g: number; b: number; a: number }>;
}

export function createTracerOptions(options: VectorizerOptions): ImageTracerOptions {
  const numberOfColors = options.presetProfile === 'drawing'
    ? 2
    : Math.max(2, Math.min(64, options.maxColors));
  const isLogo = options.presetProfile === 'clipart';
  const precision = isLogo
    ? 0.35
    : Math.max(0.35, 1.05 - options.smoothness * 0.07);

  return {
    ltres: precision,
    qtres: precision,
    // ImageTracer measures contour-node length, not pixel area. The UI value
    // is an area-style control, so scale it to the tracer's perimeter unit.
    pathomit: Math.max(0, Math.round(options.speckleFilter * 2)),
    rightangleenhance: isLogo || options.presetProfile === 'drawing',
    // Let ImageTracer sample its own color palette from the image. A fixed
    // "balanced" palette was never actually provided (the pal option stays
    // unset), which left the tracer with no colors and crashed the layer
    // extraction with undefined path data.
    colorsampling: 1,
    numberofcolors: numberOfColors,
    // Small edge shades are part of the shape. Do not replace them.
    mincolorratio: 0,
    colorquantcycles: isLogo ? 5 : 3,
    // Sequential layers retain hole ownership and avoid contour collisions.
    layering: 0,
    strokewidth: 0,
    linefilter: false,
    scale: 1,
    roundcoords: 2,
    viewbox: true,
    desc: false,
    blurradius: options.blurRadius,
    blurdelta: isLogo ? 20 : 32,
  };
}
