import type { VectorizerOptions } from '../types/vectorizer.ts';

export interface SimpleImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/**
 * Apply Bilateral Edge-Preserving Filter to ImageData.
 * Smooths flat color regions (reducing JPEG/compression noise) while keeping sharp edges crisp.
 */
export function applyBilateralFilter(
  imageData: SimpleImageData,
  spatialSigma: number = 3.0,
  rangeSigma: number = 28.0
): SimpleImageData {
  const width = imageData.width;
  const height = imageData.height;
  const src = imageData.data;
  const dst = new Uint8ClampedArray(src);

  const radius = Math.min(4, Math.ceil(spatialSigma * 2));
  const twoSpatialSigmaSq = 2 * spatialSigma * spatialSigma;
  const twoRangeSigmaSq = 2 * rangeSigma * rangeSigma;

  // Precompute spatial Gaussian weights matrix
  const spatialKernel: number[][] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    const row: number[] = [];
    for (let dx = -radius; dx <= radius; dx++) {
      const distSq = dx * dx + dy * dy;
      row.push(Math.exp(-distSq / twoSpatialSigmaSq));
    }
    spatialKernel.push(row);
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const centerIdx = (y * width + x) * 4;
      const r0 = src[centerIdx];
      const g0 = src[centerIdx + 1];
      const b0 = src[centerIdx + 2];
      const a0 = src[centerIdx + 3];

      if (a0 < 128) continue; // Skip transparent pixels

      let normSum = 0;
      let sumR = 0, sumG = 0, sumB = 0;

      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        const rowOffset = ny * width;

        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;

          const nIdx = (rowOffset + nx) * 4;
          if (src[nIdx + 3] < 128) continue;

          const r = src[nIdx];
          const g = src[nIdx + 1];
          const b = src[nIdx + 2];

          const dr = r - r0;
          const dg = g - g0;
          const db = b - b0;
          const colorDistSq = dr * dr + dg * dg + db * db;

          const spatialW = spatialKernel[dy + radius][dx + radius];
          const rangeW = Math.exp(-colorDistSq / twoRangeSigmaSq);
          const weight = spatialW * rangeW;

          sumR += r * weight;
          sumG += g * weight;
          sumB += b * weight;
          normSum += weight;
        }
      }

      if (normSum > 0) {
        dst[centerIdx] = Math.round(sumR / normSum);
        dst[centerIdx + 1] = Math.round(sumG / normSum);
        dst[centerIdx + 2] = Math.round(sumB / normSum);
      }
    }
  }

  return { width, height, data: dst };
}

/**
 * Remove anti-alias halos around high-contrast logo and text edges.
 * Anti-aliased transition pixels (e.g. gray pixels between black text and white background)
 * are snapped to their nearest dominant neighbor to eliminate intermediate color rings.
 */
export function removeAntiAliasHalos(
  imageData: SimpleImageData,
  threshold: number = 32
): SimpleImageData {
  const width = imageData.width;
  const height = imageData.height;
  const src = imageData.data;
  const dst = new Uint8ClampedArray(src);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      const r = src[idx], g = src[idx + 1], b = src[idx + 2], a = src[idx + 3];

      if (a < 128) continue;

      // Calculate maximum gradient with 8 neighbors
      let maxDiff = 0;
      let minNeighborIdx = idx;
      let maxNeighborIdx = idx;
      let minVal = 999;
      let maxVal = -1;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nIdx = ((y + dy) * width + (x + dx)) * 4;
          if (src[nIdx + 3] < 128) continue;

          const nr = src[nIdx], ng = src[nIdx + 1], nb = src[nIdx + 2];
          const diff = Math.abs(r - nr) + Math.abs(g - ng) + Math.abs(b - nb);

          const lum = 0.299 * nr + 0.587 * ng + 0.114 * nb;
          if (lum < minVal) {
            minVal = lum;
            minNeighborIdx = nIdx;
          }
          if (lum > maxVal) {
            maxVal = lum;
            maxNeighborIdx = nIdx;
          }

          if (diff > maxDiff) {
            maxDiff = diff;
          }
        }
      }

      // If this pixel is an anti-aliased edge transition pixel between two strong colors
      if (maxDiff > threshold && maxVal - minVal > 60) {
        const currLum = 0.299 * r + 0.587 * g + 0.114 * b;
        const midLum = (minVal + maxVal) / 2;

        const snapIdx = currLum < midLum ? minNeighborIdx : maxNeighborIdx;
        dst[idx] = src[snapIdx];
        dst[idx + 1] = src[snapIdx + 1];
        dst[idx + 2] = src[snapIdx + 2];
      }
    }
  }

  return { width, height, data: dst };
}

/**
 * Pre-process image canvas with options
 */
export function preparePreprocessedImageData(
  img: HTMLImageElement,
  options: VectorizerOptions,
  maxDimension: number = 2048
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; imageData: ImageData; width: number; height: number } {
  let width = img.naturalWidth || img.width || 800;
  let height = img.naturalHeight || img.height || 600;

  if (width <= 0 || height <= 0) {
    width = 800;
    height = 600;
  }

  // --- Alpha flattening -----------------------------------------------------
  // Semi-transparent pixels (PNG soft edges, alpha dithering) become "ignored"
  // pixels later (index 255) and are excluded from every color layer, which
  // shows up as transparent lines/chunks along element edges. Composite the
  // source onto a solid background first so every pixel is opaque.
  // White is the safe default; a white logo on transparency flattens onto
  // black instead (detected via pixel statistics) so it stays visible.
  let bgFill = '#ffffff';
  const statsCanvas = document.createElement('canvas');
  statsCanvas.width = width;
  statsCanvas.height = height;
  const statsCtx = statsCanvas.getContext('2d', { willReadFrequently: true })!;
  statsCtx.drawImage(img, 0, 0, width, height);
  const statsData = statsCtx.getImageData(0, 0, width, height).data;
  {
    let total = 0, transparent = 0, opaque = 0, nearWhite = 0;
    for (let i = 0; i < statsData.length; i += 4) {
      total++;
      if (statsData[i + 3] < 128) transparent++;
      else {
        opaque++;
        if (statsData[i] > 235 && statsData[i + 1] > 235 && statsData[i + 2] > 235) nearWhite++;
      }
    }
    if (transparent / total >= 0.05 && opaque > 0 && nearWhite / opaque >= 0.9) {
      bgFill = '#000000';
    }
  }

  // Smart upscale: trace small images at higher resolution so contour extraction
  // and Bezier fitting get more sample points. Low-res logos (e.g. 200x200) trace
  // into jagged, wobbly paths otherwise. The SVG stays resolution-independent, so
  // the larger working canvas only improves precision.
  if (options.upscale && options.upscaleMinDimension > 0) {
    const minDim = Math.min(width, height);
    const target = Math.min(options.upscaleMinDimension, maxDimension);
    let scale = target / minDim;

    // Never let the upscaled long edge exceed the max working dimension.
    const maxAfterScale = Math.max(width, height) * scale;
    if (maxAfterScale > maxDimension) {
      scale = maxDimension / Math.max(width, height);
    }

    if (scale > 1.05) {
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
  }

  if (width > maxDimension || height > maxDimension) {
    if (width > height) {
      height = Math.max(1, Math.round((height * maxDimension) / width));
      width = maxDimension;
    } else {
      width = Math.max(1, Math.round((width * maxDimension) / height));
      height = maxDimension;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Flatten onto the solid background BEFORE any filter is applied (a blur
  // filter on the fill would leave semi-transparent canvas edges).
  ctx.fillStyle = bgFill;
  ctx.fillRect(0, 0, width, height);

  if (options.filterMode === 'blur' && options.blurRadius > 0) {
    ctx.filter = `blur(${options.blurRadius}px)`;
  }

  ctx.drawImage(img, 0, 0, width, height);
  ctx.filter = 'none';

  let rawData = ctx.getImageData(0, 0, width, height);
  let currentSimple: SimpleImageData = { width, height, data: rawData.data };

  // Apply Bilateral Filter if enabled or for continuous photo profile
  if (options.filterMode === 'bilateral' || (options.filterMode !== 'none' && options.presetProfile === 'photo')) {
    const spatialSigma = options.blurRadius > 0 ? options.blurRadius : 2.5;
    currentSimple = applyBilateralFilter(currentSimple, spatialSigma, 24.0);
  }

  // Remove Anti-Alias Halos for logos, clipart, and drawings
  if (options.presetProfile === 'clipart' || options.presetProfile === 'drawing') {
    currentSimple = removeAntiAliasHalos(currentSimple, 28);
  }

  const finalImageData = ctx.createImageData(width, height);
  finalImageData.data.set(currentSimple.data);

  return { canvas, ctx, imageData: finalImageData, width, height };
}

