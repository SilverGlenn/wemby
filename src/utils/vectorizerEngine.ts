import type { ColorLayer, ColorSwatch, VectorizerOptions, VectorizerResult } from '../types/vectorizer.ts';

import {
  quantizeColorsKMeans,
  quantizeDominantPalette,
  quantizeMedianCut,
  consolidatePalette,
  refineEdgeAntiAliasing,
  smoothIndexedEdges,
  mergeThinRimLayers,
  rgbToHex,
} from './colorUtils.ts';
import { preparePreprocessedImageData } from './imagePreprocess.ts';
import {
  extractBoundaryContours,
  potraceFitContour,
  type Point,
} from './potraceEngine.ts';
import {
  zhangSuenThinning,
  extractSkeletonStrokes,
  estimateAverageStrokeWidth,
  strokeToSvgPathData,
} from './centerlineEngine.ts';
import { vectorizeWithImageTracerEngine } from './imageTracerEngine.ts';
import { groupCompoundPaths } from './topology.ts';

/**
 * Filter isolated speckle noise (islands smaller than minArea)
 */
function removeSpeckles(
  indexedPixels: Uint8Array,
  width: number,
  height: number,
  minArea: number
): void {
  if (minArea <= 0) return;

  const totalPixels = width * height;
  const visited = new Uint8Array(totalPixels);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx] || indexedPixels[idx] === 255) continue;

      const colorVal = indexedPixels[idx];
      const componentIndices: number[] = [];
      const queue: number[] = [idx];
      visited[idx] = 1;

      let head = 0;
      while (head < queue.length) {
        const curr = queue[head++];
        componentIndices.push(curr);

        const cx = curr % width;
        const cy = Math.floor(curr / width);

        const neighbors = [
          cy > 0 ? curr - width : -1,
          cy < height - 1 ? curr + width : -1,
          cx > 0 ? curr - 1 : -1,
          cx < width - 1 ? curr + 1 : -1,
        ];

        for (const n of neighbors) {
          if (n !== -1 && !visited[n] && indexedPixels[n] === colorVal) {
            visited[n] = 1;
            queue.push(n);
          }
        }
      }

      if (componentIndices.length < minArea) {
        const neighborCounts = new Map<number, number>();
        for (const cIdx of componentIndices) {
          const cx = cIdx % width;
          const cy = Math.floor(cIdx / width);
          const adj = [
            cy > 0 ? cIdx - width : -1,
            cy < height - 1 ? cIdx + width : -1,
            cx > 0 ? cIdx - 1 : -1,
            cx < width - 1 ? cIdx + 1 : -1,
          ];
          for (const a of adj) {
            if (a !== -1 && indexedPixels[a] !== colorVal && indexedPixels[a] !== 255) {
              const c = indexedPixels[a];
              neighborCounts.set(c, (neighborCounts.get(c) || 0) + 1);
            }
          }
        }

        let bestNeighbor = colorVal;
        let maxCount = 0;
        neighborCounts.forEach((count, c) => {
          if (count > maxCount) {
            maxCount = count;
            bestNeighbor = c;
          }
        });

        if (bestNeighbor !== colorVal) {
          for (const cIdx of componentIndices) {
            indexedPixels[cIdx] = bestNeighbor;
          }
        }
      }
    }
  }
}

/**
 * Render SVG string with fill-rule="evenodd" subpath hole subtraction & stroked layer support.
 * Path overlap stroke prevents transparent white hairline seam artifacts between color regions.
 */
export function renderSvgFromLayers(
  layers: ColorLayer[],
  swatchMap: Map<string, string>,
  swatchVisibilityMap: Map<string, boolean>,
  width: number,
  height: number,
  pathOverlap: boolean,
  geometryMode: 'filled' | 'stroked' = 'filled',
  strokeWidth: number = 2
): string {
  const overlapStrokeWidth = Math.max(1.6, strokeWidth * 0.2);

  const visibleLayers = layers.filter((layer) => swatchVisibilityMap.get(layer.colorId) ?? true);

  // Stroked geometry mode: strokes ARE the output, no fills.
  if (geometryMode === 'stroked') {
    const strokeEls = visibleLayers.flatMap((layer) => {
      const currentHex = swatchMap.get(layer.colorId) || layer.hex;
      return layer.svgPaths
        .filter(Boolean)
        .map((d) => `    <path d="${d}" fill="none" stroke="${currentHex}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round"/>`);
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">\n${strokeEls.join('\n')}\n</svg>`;
  }

  // Pass 1: seam-covering micro-strokes, drawn BEFORE all fills. A stroke
  // extends ~0.3px past its shape into the neighbor's region, but the
  // neighbor's fill (pass 2) renders on top of it, so no color bleeds into
  // neighboring sections (critical for different shades of the same color).
  const strokeEls = pathOverlap
    ? visibleLayers.flatMap((layer) => {
        const currentHex = swatchMap.get(layer.colorId) || layer.hex;
        return layer.svgPaths
          .filter(Boolean)
          .map((d) => `    <path d="${d}" fill="none" stroke="${currentHex}" stroke-width="${overlapStrokeWidth}" stroke-linejoin="round" stroke-linecap="round"/>`);
      })
    : [];

  // Pass 2: fills on top. Contours are normalized (canonical rotation, CCW)
  // so shared boundaries fit identically and fills ABUT exactly - subpaths
  // never overlap, which makes winding-agnostic evenodd fill safe (it punches
  // holes without XOR-ing anything). One <path> per compound group keeps
  // independent shapes self-contained.
  const fillEls = visibleLayers.flatMap((layer) => {
    const currentHex = swatchMap.get(layer.colorId) || layer.hex;
    const compoundPaths = layer.svgPaths.filter(Boolean);
    if (compoundPaths.length === 0) return [];
    const paths = compoundPaths
      .map((d) => `    <path d="${d}" fill="${currentHex}" fill-rule="evenodd"/>`)
      .join('\n');
    return [`  <g id="layer-${layer.colorId}">\n${paths}\n  </g>`];
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">\n${strokeEls.join('\n')}\n${fillEls.join('\n')}\n</svg>`;
}

/**
 * Centerline Stroke Skeleton Vectorizer Engine (for Line Art, Drawings & Sketches)
 */
async function vectorizeCenterlineEngine(
  imageData: ImageData,
  options: VectorizerOptions
): Promise<VectorizerResult> {
  const startTime = performance.now();
  const width = imageData.width;
  const height = imageData.height;

  // Convert image to binary mask for foreground strokes
  const pixelCount = width * height;
  const mask = new Uint8Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const r = imageData.data[i * 4];
    const g = imageData.data[i * 4 + 1];
    const b = imageData.data[i * 4 + 2];
    const a = imageData.data[i * 4 + 3];

    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (a >= 128 && lum < 180) {
      mask[i] = 1;
    }
  }

  // Thin mask using Zhang-Suen algorithm
  const skeleton = zhangSuenThinning(mask, width, height);

  // Extract polyline strokes
  const strokePolylines = extractSkeletonStrokes(skeleton, width, height);

  // Estimate line thickness if not set
  const detectedWidth = estimateAverageStrokeWidth(mask, width, height);
  const effectiveStrokeWidth = options.strokeWidth > 0 ? options.strokeWidth : detectedWidth;

  const svgPaths = strokePolylines.map((pts) => strokeToSvgPathData(pts)).filter(Boolean);

  const hex = '#1a1a1a';
  const colorId = 'color-0';

  const swatches: ColorSwatch[] = [{
    id: colorId,
    originalHex: hex,
    currentHex: hex,
    percentage: 100,
    pixelCount: mask.reduce((a, b) => a + b, 0),
    visible: true,
  }];

  const layers: ColorLayer[] = [{
    colorId,
    hex,
    svgPaths,
  }];

  const swatchMap = new Map([[colorId, hex]]);
  const swatchVis = new Map([[colorId, true]]);

  const svgString = renderSvgFromLayers(
    layers,
    swatchMap,
    swatchVis,
    width,
    height,
    false,
    'stroked',
    effectiveStrokeWidth
  );

  const processingTimeMs = Math.round(performance.now() - startTime);

  return {
    svgString,
    layers,
    swatches,
    width,
    height,
    processingTimeMs,
    totalPaths: svgPaths.length,
  };
}

/**
 * State-of-the-Art Potrace Geometric Subpixel Vectorization Engine
 */
export async function vectorizeWithPotraceEngine(
  imageData: ImageData,
  options: VectorizerOptions
): Promise<VectorizerResult> {
  const startTime = performance.now();
  const width = imageData.width;
  const height = imageData.height;

  await new Promise((resolve) => setTimeout(resolve, 0));

  let effectiveMaxColors = options.maxColors;
  if (options.presetProfile === 'clipart' && options.maxColors > 16) {
    effectiveMaxColors = 16;
  } else if (options.presetProfile === 'drawing') {
    effectiveMaxColors = 2;
  }

  let palette;
  let indexedPixels;

  const mode = options.quantizationMode || (
    options.presetProfile === 'photo' ? 'median-cut' :
    options.presetProfile === 'clipart' ? 'dominant' : 'lab-kmeans'
  );

  if (mode === 'dominant') {
    const dominant = quantizeDominantPalette(imageData, effectiveMaxColors);
    palette = dominant.palette;
    indexedPixels = dominant.indexedPixels;
  } else if (mode === 'median-cut') {
    const medianCut = quantizeMedianCut(imageData, effectiveMaxColors);
    palette = medianCut.palette;
    indexedPixels = medianCut.indexedPixels;
  } else {
    const kMeans = quantizeColorsKMeans(imageData, effectiveMaxColors, 15);
    palette = kMeans.palette;
    indexedPixels = kMeans.indexedPixels;
  }

  // Merge near-duplicate palette colors: JPEG/compression noise splits one
  // real color into several near-identical centroids (visible as speckled
  // edges and "extra" swatches). Lab distance < 12 (AE) merges them.
  const consolidated = consolidatePalette(palette, indexedPixels, options.minColorAreaRatio);
  palette = consolidated.palette;
  indexedPixels = consolidated.indexedPixels;

  refineEdgeAntiAliasing(indexedPixels, width, height);

  // Light pass: flip isolated noise pixels before island cleanup.
  smoothIndexedEdges(indexedPixels, width, height, 1);

  // Remove speckle noise
  removeSpeckles(indexedPixels, width, height, options.speckleFilter);

  // Merge thin anti-aliasing rim layers into their neighbors ("skin" edges)
  const merged = mergeThinRimLayers(palette, indexedPixels, width, height);
  palette = merged.palette;
  indexedPixels = merged.indexedPixels;

  // Second pass: straighten the 1-2px quantization jitter along the now-clean
  // color boundaries. Only ONE pass here: each pass erodes ~1px off every thin
  // tip/end (script tails, stroke terminals), and the polygon fit absorbs the
  // residual sub-pixel jitter.
  smoothIndexedEdges(indexedPixels, width, height, 1);

  const totalPixels = width * height;
  const colorCounts = new Array(palette.length).fill(0);

  for (let i = 0; i < indexedPixels.length; i++) {
    const cIdx = indexedPixels[i];
    if (cIdx < palette.length) {
      colorCounts[cIdx]++;
    }
  }

  const sortedColorIndices = palette
    .map((_, idx) => idx)
    .sort((a, b) => colorCounts[b] - colorCounts[a]);

  // Pre-pass: colors below minColorAreaRatio would otherwise be skipped in the
  // layer loop, leaving their pixels with NO layer at all (transparent chunks
  // in random places). Reassign those pixels to their most-adjacent kept color
  // so every pixel belongs to some layer.
  {
    const dropSet = new Set<number>();
    for (const cIdx of sortedColorIndices) {
      if (colorCounts[cIdx] / totalPixels < options.minColorAreaRatio) dropSet.add(cIdx);
    }
    if (dropSet.size > 0 && dropSet.size < sortedColorIndices.length) {
      for (let i = 0; i < indexedPixels.length; i++) {
        const c = indexedPixels[i];
        if (!dropSet.has(c)) continue;
        const x = i % width;
        const y = Math.floor(i / width);
        const neighborCounts = new Map<number, number>();
        const adj = [
          y > 0 ? i - width : -1,
          y < height - 1 ? i + width : -1,
          x > 0 ? i - 1 : -1,
          x < width - 1 ? i + 1 : -1,
        ];
        for (const nIdx of adj) {
          if (nIdx === -1) continue;
          const nc = indexedPixels[nIdx];
          if (nc < palette.length && !dropSet.has(nc)) {
            neighborCounts.set(nc, (neighborCounts.get(nc) || 0) + 1);
          }
        }
        let best = -1;
        let bestCount = 0;
        neighborCounts.forEach((cnt, col) => {
          if (cnt > bestCount) {
            bestCount = cnt;
            best = col;
          }
        });
        if (best !== -1) indexedPixels[i] = best;
      }
    }
  }

  const swatches: ColorSwatch[] = [];
  const swatchMap = new Map<string, string>();
  const swatchVisibilityMap = new Map<string, boolean>();
  const layers: ColorLayer[] = [];
  let totalPaths = 0;

  for (const cIdx of sortedColorIndices) {
    const count = colorCounts[cIdx];
    if (count === 0) continue;

    const percentage = Number(((count / totalPixels) * 100).toFixed(2));

    const rgb = palette[cIdx];
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    const colorId = `color-${cIdx}`;

    swatches.push({
      id: colorId,
      originalHex: hex,
      currentHex: hex,
      percentage,
      pixelCount: count,
      visible: true,
    });

    swatchMap.set(colorId, hex);
    swatchVisibilityMap.set(colorId, true);

    const mask = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      if (indexedPixels[i] === cIdx) {
        mask[i] = 1;
      }
    }

    // Extract closed boundary contours
    const rawContours = extractBoundaryContours(mask, width, height);

    // Filter tiny noise contours
    const validContours = rawContours.filter((pts) => {
      if (pts.length < 4) return false;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const area = (maxX - minX) * (maxY - minY);
      return area >= 6 || rawContours.length < 5;
    });

    // Potrace optimal polygon reduction and Bezier fitting
    const contoursWithPaths: Array<{ points: Point[]; pathData: string }> = [];

    for (const contour of validContours) {
      if (contour.length < 3) continue;
      const pathData = potraceFitContour(contour, options.smoothness, options.cornerThreshold, width);
      if (pathData) {
        contoursWithPaths.push({ points: contour, pathData });
      }
    }

    // Topological hole subtraction with fill-rule="evenodd"
    const compoundSvgPaths = groupCompoundPaths(contoursWithPaths);

    totalPaths += compoundSvgPaths.length;
    layers.push({
      colorId,
      hex,
      svgPaths: compoundSvgPaths,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const svgString = renderSvgFromLayers(
    layers,
    swatchMap,
    swatchVisibilityMap,
    width,
    height,
    options.pathOverlap,
    options.geometryMode,
    options.strokeWidth
  );

  const processingTimeMs = Math.round(performance.now() - startTime);

  return {
    svgString,
    layers,
    swatches,
    width,
    height,
    processingTimeMs,
    totalPaths,
  };
}

/**
 * Main Vectorizer Entry Point.
 * Selects engine mode: 'potrace' (SOTA Geometric), 'centerline' (Stroke Skeleton), or 'imagetracer'.
 */
export async function vectorizeImage(
  img: HTMLImageElement,
  options: VectorizerOptions
): Promise<VectorizerResult> {
  const { canvas, imageData } = preparePreprocessedImageData(img, options);

  if (options.engineMode === 'centerline' || (options.presetProfile === 'sketch' && options.geometryMode === 'stroked')) {
    return vectorizeCenterlineEngine(imageData, options);
  }

  if (options.engineMode === 'imagetracer') {
    return vectorizeWithImageTracerEngine(canvas, options);
  }

  return vectorizeWithPotraceEngine(imageData, options);
}
