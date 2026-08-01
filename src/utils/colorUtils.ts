export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface Lab {
  l: number;
  a: number;
  b: number;
}

export function hexToRgb(hex: string): RGB {
  let cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    cleanHex = cleanHex.split('').map(c => c + c).join('');
  }
  const num = parseInt(cleanHex, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Convert RGB to CIE L*a*b* color space for human perceptual accuracy
 */
export function rgbToLab(r: number, g: number, b: number): Lab {
  let sr = r / 255;
  let sg = g / 255;
  let sb = b / 255;

  sr = sr > 0.04045 ? Math.pow((sr + 0.055) / 1.055, 2.4) : sr / 12.92;
  sg = sg > 0.04045 ? Math.pow((sg + 0.055) / 1.055, 2.4) : sg / 12.92;
  sb = sb > 0.04045 ? Math.pow((sb + 0.055) / 1.055, 2.4) : sb / 12.92;

  const x = (sr * 0.4124 + sg * 0.3576 + sb * 0.1805) / 0.95047;
  const y = (sr * 0.2126 + sg * 0.7152 + sb * 0.0722) / 1.00000;
  const z = (sr * 0.0193 + sg * 0.1192 + sb * 0.9505) / 1.08883;

  const fx = x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116;
  const fy = y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116;
  const fz = z > 0.008856 ? Math.cbrt(z) : 7.787 * z + 16 / 116;

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

export function labDistanceSq(c1: Lab, c2: Lab): number {
  const dl = c1.l - c2.l;
  const da = c1.a - c2.a;
  const db = c1.b - c2.b;
  return dl * dl + da * da + db * db;
}

export function colorDistanceSq(c1: RGB, c2: RGB): number {
  const lab1 = rgbToLab(c1.r, c1.g, c1.b);
  const lab2 = rgbToLab(c2.r, c2.g, c2.b);
  return labDistanceSq(lab1, lab2);
}

/**
 * Perceptually-Accurate CIE L*a*b* K-Means Color Quantization
 */
export function quantizeColorsKMeans(
  imageData: ImageData,
  k: number,
  maxIterations: number = 15
): { palette: RGB[]; indexedPixels: Uint8Array } {
  const data = imageData.data;
  const pixelCount = data.length / 4;
  const indexedPixels = new Uint8Array(pixelCount);

  // Pre-calculate Lab for all pixels
  const labs = new Array<Lab>(pixelCount);
  const rgbs = new Array<RGB>(pixelCount);

  const samples: { rgb: RGB; lab: Lab }[] = [];
  const maxSamples = 12000;
  const step = Math.max(1, Math.floor(pixelCount / maxSamples));

  for (let i = 0; i < pixelCount; i++) {
    const a = data[i * 4 + 3];
    if (a < 128) continue;

    const rgb: RGB = { r: data[i * 4], g: data[i * 4 + 1], b: data[i * 4 + 2] };
    const lab = rgbToLab(rgb.r, rgb.g, rgb.b);

    rgbs[i] = rgb;
    labs[i] = lab;

    if (i % step === 0 && samples.length < maxSamples) {
      samples.push({ rgb, lab });
    }
  }

  if (samples.length === 0) {
    samples.push({
      rgb: { r: 0, g: 0, b: 0 },
      lab: { l: 0, a: 0, b: 0 },
    });
  }

  // Initialize centroids with k-means++ spread in Lab space
  const centroids: { rgb: RGB; lab: Lab }[] = [];
  // Pick initial centroid from middle of sample array for determinism
  centroids.push({ ...samples[Math.floor(samples.length / 2)] });

  while (centroids.length < k && centroids.length < samples.length) {
    let maxDist = -1;
    let bestCandidate = samples[0];

    for (const sample of samples) {
      let minDist = Infinity;
      for (const centroid of centroids) {
        const dist = labDistanceSq(sample.lab, centroid.lab);
        if (dist < minDist) minDist = dist;
      }
      if (minDist > maxDist) {
        maxDist = minDist;
        bestCandidate = sample;
      }
    }
    centroids.push({ ...bestCandidate });
  }

  // Fast iterative clustering in Lab space
  for (let iter = 0; iter < maxIterations; iter++) {
    const sums = centroids.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));

    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      let closestIdx = 0;
      let minDist = Infinity;

      for (let c = 0; c < centroids.length; c++) {
        const dist = labDistanceSq(sample.lab, centroids[c].lab);
        if (dist < minDist) {
          minDist = dist;
          closestIdx = c;
        }
      }

      sums[closestIdx].r += sample.rgb.r;
      sums[closestIdx].g += sample.rgb.g;
      sums[closestIdx].b += sample.rgb.b;
      sums[closestIdx].count++;
    }

    let moved = false;
    for (let c = 0; c < centroids.length; c++) {
      if (sums[c].count > 0) {
        const newR = Math.round(sums[c].r / sums[c].count);
        const newG = Math.round(sums[c].g / sums[c].count);
        const newB = Math.round(sums[c].b / sums[c].count);

        const currentRgb = centroids[c].rgb;
        if (newR !== currentRgb.r || newG !== currentRgb.g || newB !== currentRgb.b) {
          const newLab = rgbToLab(newR, newG, newB);
          centroids[c] = { rgb: { r: newR, g: newG, b: newB }, lab: newLab };
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  const palette = centroids.map(c => c.rgb);

  // Single fast assignment pass for all pixels in Lab space
  for (let i = 0; i < pixelCount; i++) {
    const a = data[i * 4 + 3];
    if (a < 128) {
      indexedPixels[i] = 255;
      continue;
    }

    const lab = labs[i] || rgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);

    let closestIdx = 0;
    let minDist = Infinity;

    for (let c = 0; c < centroids.length; c++) {
      const dist = labDistanceSq(lab, centroids[c].lab);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = c;
      }
    }

    indexedPixels[i] = closestIdx;
  }

  return { palette, indexedPixels };
}

/**
 * Extract dominant palette colors by sampling ONLY low-gradient (flat) image pixels.
 * Ignores anti-aliased edge transition pixels during K-Means centroid selection.
 */
export function quantizeDominantPalette(
  imageData: ImageData,
  maxColors: number,
  maxIterations: number = 15
): { palette: RGB[]; indexedPixels: Uint8Array } {
  const { width, height, data } = imageData;
  const pixelCount = width * height;

  const labs: Lab[] = new Array(pixelCount);
  const gradients = new Float32Array(pixelCount);

  // 1. Compute pixel RGB -> Lab and spatial color gradient
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const idx = row + x;
      const off = idx * 4;
      const r = data[off], g = data[off + 1], b = data[off + 2], a = data[off + 3];

      if (a < 128) {
        labs[idx] = { l: 0, a: 0, b: 0 };
        gradients[idx] = 999;
        continue;
      }

      labs[idx] = rgbToLab(r, g, b);

      // Gradient with right and bottom neighbors
      let maxGradSq = 0;
      if (x < width - 1) {
        const offR = off + 4;
        const dr = r - data[offR], dg = g - data[offR + 1], db = b - data[offR + 2];
        maxGradSq = Math.max(maxGradSq, dr * dr + dg * dg + db * db);
      }
      if (y < height - 1) {
        const offB = off + width * 4;
        const dr = r - data[offB], dg = g - data[offB + 1], db = b - data[offB + 2];
        maxGradSq = Math.max(maxGradSq, dr * dr + dg * dg + db * db);
      }

      gradients[idx] = Math.sqrt(maxGradSq);
    }
  }

  // 2. Filter samples to keep ONLY low-gradient (flat/solid) pixels
  const flatSamples: { rgb: RGB; lab: Lab }[] = [];
  const gradThreshold = 24.0;

  for (let y = 1; y < height - 1; y += 2) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 2) {
      const idx = row + x;
      if (data[idx * 4 + 3] < 128) continue;
      if (gradients[idx] < gradThreshold) {
        const r = data[idx * 4], g = data[idx * 4 + 1], b = data[idx * 4 + 2];
        flatSamples.push({ rgb: { r, g, b }, lab: labs[idx] });
      }
    }
  }

  // Fallback if image has very few flat samples
  if (flatSamples.length < maxColors) {
    for (let i = 0; i < pixelCount; i += 4) {
      if (data[i * 4 + 3] >= 128) {
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        flatSamples.push({ rgb: { r, g, b }, lab: labs[i] });
      }
    }
  }

  // 3. K-Means++ on low-gradient flat samples
  const centroids: { rgb: RGB; lab: Lab }[] = [];
  if (flatSamples.length > 0) {
    centroids.push({ ...flatSamples[Math.floor(flatSamples.length / 2)] });
  } else {
    centroids.push({ rgb: { r: 0, g: 0, b: 0 }, lab: { l: 0, a: 0, b: 0 } });
  }

  while (centroids.length < maxColors && centroids.length < flatSamples.length) {
    let maxDist = -1;
    let bestCandidate = flatSamples[0];

    for (const sample of flatSamples) {
      let minDist = Infinity;
      for (const centroid of centroids) {
        const dist = labDistanceSq(sample.lab, centroid.lab);
        if (dist < minDist) minDist = dist;
      }
      if (minDist > maxDist) {
        maxDist = minDist;
        bestCandidate = sample;
      }
    }

    if (maxDist <= 1e-4) break;
    centroids.push({ ...bestCandidate });
  }

  // Fast iterative clustering
  for (let iter = 0; iter < maxIterations; iter++) {
    const sums = centroids.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));

    for (const sample of flatSamples) {
      let closestIdx = 0;
      let minDist = Infinity;

      for (let c = 0; c < centroids.length; c++) {
        const dist = labDistanceSq(sample.lab, centroids[c].lab);
        if (dist < minDist) {
          minDist = dist;
          closestIdx = c;
        }
      }

      sums[closestIdx].r += sample.rgb.r;
      sums[closestIdx].g += sample.rgb.g;
      sums[closestIdx].b += sample.rgb.b;
      sums[closestIdx].count++;
    }

    let moved = false;
    for (let c = 0; c < centroids.length; c++) {
      if (sums[c].count > 0) {
        const newR = Math.round(sums[c].r / sums[c].count);
        const newG = Math.round(sums[c].g / sums[c].count);
        const newB = Math.round(sums[c].b / sums[c].count);

        const currentRgb = centroids[c].rgb;
        if (newR !== currentRgb.r || newG !== currentRgb.g || newB !== currentRgb.b) {
          const newLab = rgbToLab(newR, newG, newB);
          centroids[c] = { rgb: { r: newR, g: newG, b: newB }, lab: newLab };
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  // 4. Merge only near-identical duplicate centroids (Lab distance < 3^2 = 9)
  const activeCentroids: { rgb: RGB; lab: Lab }[] = [];
  for (const c of centroids) {
    let duplicate = false;
    for (const active of activeCentroids) {
      if (labDistanceSq(c.lab, active.lab) < 9) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) {
      activeCentroids.push(c);
    }
  }

  const palette = activeCentroids.map(c => c.rgb);
  const indexedPixels = new Uint8Array(pixelCount);

  // 5. Snap EVERY pixel in the image to the nearest active centroid in Lab space
  for (let i = 0; i < pixelCount; i++) {
    if (data[i * 4 + 3] < 128) {
      indexedPixels[i] = 255;
      continue;
    }

    const lab = labs[i] || rgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    let closestIdx = 0;
    let minDist = Infinity;

    for (let c = 0; c < activeCentroids.length; c++) {
      const dist = labDistanceSq(lab, activeCentroids[c].lab);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = c;
      }
    }

    indexedPixels[i] = closestIdx;
  }

  return { palette, indexedPixels };
}

/**
 * Refine edge anti-aliasing by mapping border transition pixels to nearest dominant color neighbors
 */
export function refineEdgeAntiAliasing(
  indexedPixels: Uint8Array,
  width: number,
  height: number
): void {
  const copy = Uint8Array.from(indexedPixels);

  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x;
      const currColor = copy[idx];
      if (currColor === 255) continue;

      let hasDifferentNeighbor = false;
      const neighborCounts = new Map<number, number>();

      for (let dy = -1; dy <= 1; dy++) {
        const nRow = (y + dy) * width;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nColor = copy[nRow + x + dx];
          if (nColor !== 255) {
            if (nColor !== currColor) hasDifferentNeighbor = true;
            neighborCounts.set(nColor, (neighborCounts.get(nColor) || 0) + 1);
          }
        }
      }

      if (hasDifferentNeighbor) {
        let maxCount = 0;
        let modeColor = currColor;
        neighborCounts.forEach((count, col) => {
          if (count > maxCount) {
            maxCount = count;
            modeColor = col;
          }
        });

        if (maxCount >= 5 && modeColor !== currColor) {
          indexedPixels[idx] = modeColor;
        }
      }
    }
  }
}

/**
 * Straighten quantization jitter along color boundaries.
 *
 * Smooth upscaling creates a 2-4px anti-aliasing band on every hard logo edge;
 * per-pixel color snapping turns that band into 1-2px bumps and notches on the
 * boundary. A boundary pixel is flipped to its 3x3 mode color when it has at
 * most 2 same-color 4-connected pixels (including itself). This discriminates
 * precisely: a 1px bump/notch has 2, an isolated speckle has 1, while real
 * features are thicker - a 1px line has 3 (self + up + down), a clean
 * staircase edge has 3+, and anything 2px+ thick has 4+. The only casualty is
 * 1px line endpoints, which erode by ~1px per pass.
 */
export function smoothIndexedEdges(
  indexedPixels: Uint8Array,
  width: number,
  height: number,
  passes: number = 2
): void {
  const counts = new Int32Array(256);
  const touched: number[] = [];

  for (let pass = 0; pass < passes; pass++) {
    const copy = Uint8Array.from(indexedPixels);

    for (let y = 1; y < height - 1; y++) {
      const row = y * width;
      for (let x = 1; x < width - 1; x++) {
        const idx = row + x;
        const self = copy[idx];
        if (self === 255) continue;

        // Same-color 4-connected count including self.
        let conn4 = 1;
        if (copy[idx - width] === self) conn4++;
        if (copy[idx + width] === self) conn4++;
        if (copy[idx - 1] === self) conn4++;
        if (copy[idx + 1] === self) conn4++;

        // 3x3 mode color (ignoring transparent/ignored pixels).
        let modeColor = -1;
        let modeCount = 0;
        counts[self] = 1;
        touched.length = 0;
        touched.push(self);

        for (let dy = -1; dy <= 1; dy++) {
          const nRow = (y + dy) * width;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nColor = copy[nRow + x + dx];
            if (nColor === 255) continue;
            if (counts[nColor] === 0) touched.push(nColor);
            counts[nColor]++;
          }
        }
        for (const c of touched) {
          if (counts[c] > modeCount) {
            modeCount = counts[c];
            modeColor = c;
          }
        }
        for (const c of touched) counts[c] = 0;

        if (conn4 <= 2 && modeColor !== self && modeColor !== -1) {
          indexedPixels[idx] = modeColor;
        }
      }
    }
  }
}

/**
 * Merge thin anti-aliasing rim layers into their dominant neighbor.
 *
 * Mid-tone pixels that survive quantization (JPEG noise, off-white rims,
 * upscale AA bands) form 1-3px "skin" layers hugging shape boundaries.
 * A layer is treated as a rim when most of its pixels vanish under erosion
 * (no solid interior). Rims are merged when their color is a blend of their
 * two most-adjacent neighbor colors (the classic AA signature) or sits very
 * close to one neighbor (noisy band pixels). Legit thin design elements
 * (gold rings, thin outlines) sit far from their neighbors in Lab space and
 * are protected. Merges iterate to a fixpoint so rim chains (a rim whose
 * neighbors are all rims) collapse layer by layer.
 */
export function mergeThinRimLayers(
  palette: RGB[],
  indexedPixels: Uint8Array,
  width: number,
  height: number
): { palette: RGB[]; indexedPixels: Uint8Array } {
  const total = width * height;
  const colorCount = palette.length;
  if (colorCount < 3) return { palette, indexedPixels };

  const labs = palette.map((p) => rgbToLab(p.r, p.g, p.b));

  // Is color c a blend of colors a and b (within tolSq of the Lab segment)?
  const isBlendBetween = (c: number, a: number, b: number, tolSq: number): boolean => {
    const pc = labs[c];
    const pa = labs[a];
    const pb = labs[b];
    const abx = pb.l - pa.l, aby = pb.a - pa.a, abz = pb.b - pa.b;
    const denom = abx * abx + aby * aby + abz * abz;
    if (denom < 1e-9) return labDistanceSq(pc, pa) < tolSq;
    let t = ((pc.l - pa.l) * abx + (pc.a - pa.a) * aby + (pc.b - pa.b) * abz) / denom;
    t = Math.max(0, Math.min(1, t));
    const ql = pa.l + t * abx, qa = pa.a + t * aby, qb = pa.b + t * abz;
    return (pc.l - ql) ** 2 + (pc.a - qa) ** 2 + (pc.b - qb) ** 2 < tolSq;
  };

  // Iterate to a fixpoint so rim chains collapse (a rim whose neighbors are
  // all rims merges once its neighbors merge into solid colors).
  let changed = true;
  for (let pass = 0; pass < 4 && changed; pass++) {
    changed = false;

    const counts = new Array(colorCount).fill(0);
    for (let i = 0; i < total; i++) {
      const c = indexedPixels[i];
      if (c < colorCount) counts[c]++;
    }

    // Erode: a pixel survives only if all 8 neighbors share its color.
    const eroded = new Array(colorCount).fill(0);
    for (let y = 1; y < height - 1; y++) {
      const row = y * width;
      for (let x = 1; x < width - 1; x++) {
        const idx = row + x;
        const c = indexedPixels[idx];
        if (c >= colorCount) continue;
        let allSame = true;
        for (let dy = -1; dy <= 1 && allSame; dy++) {
          const nRow = (y + dy) * width;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (indexedPixels[nRow + x + dx] !== c) {
              allSame = false;
              break;
            }
          }
        }
        if (allSame) eroded[c]++;
      }
    }

    // A rim layer: small and mostly hollow (no solid interior). Erosion ratio
    // (w-2)/w for a band of width w: <= 4px-wide bands (upscale AA scale) are
    // rims; 5px+ survive (likely design intent).
    const isRim = new Array(colorCount).fill(false);
    for (let c = 0; c < colorCount; c++) {
      if (counts[c] === 0) continue;
      isRim[c] = counts[c] / total < 0.02 && eroded[c] / counts[c] < 0.55;
    }

    const remap = new Array(colorCount).fill(-1).map((_, i) => i);

    // Resolve merge target through tentative remaps; -1 signals a cycle.
    const resolve = (idx: number, seen: Set<number>): number => {
      if (remap[idx] === idx) return idx;
      if (seen.has(idx)) return -1;
      seen.add(idx);
      return resolve(remap[idx], seen);
    };

    for (let c = 0; c < colorCount; c++) {
      if (!isRim[c]) continue;

      // Count 4-connected adjacency to all other colors.
      const adj = new Map<number, number>();
      for (let y = 1; y < height - 1; y++) {
        const row = y * width;
        for (let x = 1; x < width - 1; x++) {
          const idx = row + x;
          if (indexedPixels[idx] !== c) continue;
          const neighbors = [idx - width, idx + width, idx - 1, idx + 1];
          for (const nIdx of neighbors) {
            const nc = indexedPixels[nIdx];
            if (nc < colorCount && nc !== c) {
              adj.set(nc, (adj.get(nc) || 0) + 1);
            }
          }
        }
      }

      if (adj.size === 0) continue;
      const order = Array.from(adj.keys()).sort((a, b) => (adj.get(b) || 0) - (adj.get(a) || 0));
      const target = order[0];
      const second = order.length > 1 ? order[1] : target;

      // Merge if the rim color is a blend of its two dominant neighbors, or
      // very close to its single dominant neighbor. Gold rings and other legit
      // thin elements sit far from their neighbors and survive.
      const blendOk = second === target
        ? labDistanceSq(labs[c], labs[target]) < 900
        : isBlendBetween(c, target, second, 784);
      if (!blendOk) continue;

      const resolved = resolve(target, new Set());
      if (resolved === -1) continue;
      remap[c] = resolved;
      changed = true;
    }

    // Apply remap to pixels. Rim pixels are assigned PER-PIXEL to the majority
    // color among their 4-connected non-rim neighbors (noise-robust: a rim
    // between two shades of the same color splits naturally between them
    // instead of one shade bleeding a full pixel into the other, and JPEG noise
    // cannot flip individual pixels into blotches). Pixels without any non-rim
    // neighbor fall back to the batch (chain-resolved) target.
    for (let i = 0; i < total; i++) {
      const c = indexedPixels[i];
      // Only per-pixel split colors whose batch merge was approved by the
      // blend gate (remap[c] !== c); rejected rims (e.g. legit gold rings)
      // keep every pixel.
      if (c >= colorCount || !isRim[c] || remap[c] === c) continue;
      const x = i % width;
      const y = Math.floor(i / width);
      const counts = new Map<number, number>();
      for (const nIdx of [
        y > 0 ? i - width : -1,
        y < height - 1 ? i + width : -1,
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
      ]) {
        if (nIdx === -1) continue;
        const nc = indexedPixels[nIdx];
        if (nc < colorCount && !isRim[nc]) {
          counts.set(nc, (counts.get(nc) || 0) + 1);
        }
      }
      let best = -1;
      let bestCount = 0;
      counts.forEach((cnt, col) => {
        if (cnt > bestCount) {
          bestCount = cnt;
          best = col;
        }
      });
      // Tie-break by Lab proximity (keeps mid-tone rims on the closer shade).
      if (best !== -1 && bestCount < 2) {
        let bestDist = Infinity;
        counts.forEach((_cnt, col) => {
          const dist = labDistanceSq(labs[c], labs[col]);
          if (dist < bestDist) {
            bestDist = dist;
            best = col;
          }
        });
      }
      indexedPixels[i] = best !== -1 ? best : remap[c];
    }
  }

  // Compact the palette to surviving colors and re-index pixels.
  const counts = new Array(colorCount).fill(0);
  for (let i = 0; i < total; i++) {
    const c = indexedPixels[i];
    if (c < colorCount) counts[c]++;
  }
  const newPalette: RGB[] = [];
  const oldToNew = new Array(colorCount).fill(-1);
  for (let c = 0; c < colorCount; c++) {
    if (counts[c] === 0) continue;
    if (oldToNew[c] === -1) {
      oldToNew[c] = newPalette.length;
      newPalette.push(palette[c]);
    }
  }
  for (let i = 0; i < total; i++) {
    const c = indexedPixels[i];
    if (c < colorCount && oldToNew[c] !== -1) indexedPixels[i] = oldToNew[c];
  }

  return { palette: newPalette, indexedPixels };
}

/**
 * Consolidate close or low-area palette colors into dominant primary colors
 */
export function consolidatePalette(
  palette: RGB[],
  indexedPixels: Uint8Array,
  minAreaRatio: number = 0.008
): { palette: RGB[]; indexedPixels: Uint8Array } {
  const totalPixels = indexedPixels.length;
  const counts = new Array(palette.length).fill(0);
  for (let i = 0; i < totalPixels; i++) {
    const c = indexedPixels[i];
    if (c < palette.length) counts[c]++;
  }

  const labs = palette.map(p => rgbToLab(p.r, p.g, p.b));
  const indexMap = palette.map((_, idx) => idx);
  const sortedIdx = palette.map((_, idx) => idx).sort((a, b) => counts[b] - counts[a]);

  for (let i = 0; i < sortedIdx.length; i++) {
    const srcIdx = sortedIdx[i];
    if (indexMap[srcIdx] !== srcIdx) continue;

    const srcCount = counts[srcIdx];
    const srcRatio = srcCount / totalPixels;

    for (let j = 0; j < i; j++) {
      const domIdx = sortedIdx[j];
      if (indexMap[domIdx] !== domIdx) continue;

      const distSq = labDistanceSq(labs[srcIdx], labs[domIdx]);
      if (distSq < 144 || (srcRatio < minAreaRatio && distSq < 400)) {
        indexMap[srcIdx] = domIdx;
        counts[domIdx] += srcCount;
        counts[srcIdx] = 0;
        break;
      }
    }
  }

  const newPalette: RGB[] = [];
  const oldToNewMap = new Map<number, number>();

  for (let i = 0; i < palette.length; i++) {
    const targetIdx = indexMap[i];
    if (!oldToNewMap.has(targetIdx)) {
      oldToNewMap.set(targetIdx, newPalette.length);
      newPalette.push(palette[targetIdx]);
    }
    oldToNewMap.set(i, oldToNewMap.get(targetIdx)!);
  }

  for (let i = 0; i < totalPixels; i++) {
    const c = indexedPixels[i];
    if (c < palette.length) {
      indexedPixels[i] = oldToNewMap.get(c)!;
    }
  }

  return { palette: newPalette, indexedPixels };
}

/**
 * Median-Cut Color Quantization for continuous photos and complex artwork.
 */
export function quantizeMedianCut(
  imageData: ImageData,
  maxColors: number
): { palette: RGB[]; indexedPixels: Uint8Array } {
  const { width, height, data } = imageData;
  const pixelCount = width * height;
  const pixels: RGB[] = [];

  for (let i = 0; i < pixelCount; i++) {
    if (data[i * 4 + 3] >= 128) {
      pixels.push({ r: data[i * 4], g: data[i * 4 + 1], b: data[i * 4 + 2] });
    }
  }

  if (pixels.length === 0) {
    return { palette: [{ r: 0, g: 0, b: 0 }], indexedPixels: new Uint8Array(pixelCount).fill(255) };
  }

  interface ColorBox {
    colors: RGB[];
    rMin: number; rMax: number;
    gMin: number; gMax: number;
    bMin: number; bMax: number;
  }

  const findBounds = (colors: RGB[]): ColorBox => {
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
    for (const c of colors) {
      if (c.r < rMin) rMin = c.r; if (c.r > rMax) rMax = c.r;
      if (c.g < gMin) gMin = c.g; if (c.g > gMax) gMax = c.g;
      if (c.b < bMin) bMin = c.b; if (c.b > bMax) bMax = c.b;
    }
    return { colors, rMin, rMax, gMin, gMax, bMin, bMax };
  };

  const boxes: ColorBox[] = [findBounds(pixels)];

  while (boxes.length < maxColors) {
    let maxRange = -1;
    let splitBoxIdx = -1;

    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.colors.length <= 1) continue;
      const rRange = b.rMax - b.rMin;
      const gRange = b.gMax - b.gMin;
      const bRange = b.bMax - b.bMin;
      const range = Math.max(rRange, gRange, bRange);

      if (range > maxRange) {
        maxRange = range;
        splitBoxIdx = i;
      }
    }

    if (splitBoxIdx === -1 || maxRange <= 0) break;

    const boxToSplit = boxes.splice(splitBoxIdx, 1)[0];
    const rRange = boxToSplit.rMax - boxToSplit.rMin;
    const gRange = boxToSplit.gMax - boxToSplit.gMin;
    const bRange = boxToSplit.bMax - boxToSplit.bMin;

    let sortChannel: 'r' | 'g' | 'b' = 'r';
    if (gRange >= rRange && gRange >= bRange) sortChannel = 'g';
    else if (bRange >= rRange && bRange >= gRange) sortChannel = 'b';

    boxToSplit.colors.sort((a, b) => a[sortChannel] - b[sortChannel]);

    const mid = Math.floor(boxToSplit.colors.length / 2);
    boxes.push(findBounds(boxToSplit.colors.slice(0, mid)));
    boxes.push(findBounds(boxToSplit.colors.slice(mid)));
  }

  const palette: RGB[] = boxes.map((box) => {
    let r = 0, g = 0, b = 0;
    for (const c of box.colors) {
      r += c.r; g += c.g; b += c.b;
    }
    const len = box.colors.length || 1;
    return { r: Math.round(r / len), g: Math.round(g / len), b: Math.round(b / len) };
  });

  const labs = palette.map((p) => rgbToLab(p.r, p.g, p.b));
  const indexedPixels = new Uint8Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    if (data[i * 4 + 3] < 128) {
      indexedPixels[i] = 255;
      continue;
    }

    const pLab = rgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    let closestIdx = 0;
    let minDist = Infinity;

    for (let c = 0; c < labs.length; c++) {
      const dist = labDistanceSq(pLab, labs[c]);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = c;
      }
    }

    indexedPixels[i] = closestIdx;
  }

  return { palette, indexedPixels };
}


