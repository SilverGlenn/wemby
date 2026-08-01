import type { Point } from './potraceEngine.ts';

/**
 * Zhang-Suen Thinning Algorithm.
 * Skeletonizes a binary mask down to 1-pixel thin medial axis lines.
 */
export function zhangSuenThinning(
  mask: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const grid = Uint8Array.from(mask);

  const getPixel = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    return grid[y * width + x];
  };

  let hasChanged = true;
  let iter = 0;
  const maxIter = 100;

  while (hasChanged && iter < maxIter) {
    hasChanged = false;
    iter++;

    for (let subpass = 0; subpass < 2; subpass++) {
      const toClear: number[] = [];

      for (let y = 1; y < height - 1; y++) {
        const row = y * width;
        for (let x = 1; x < width - 1; x++) {
          const idx = row + x;
          if (grid[idx] === 0) continue;

          // 8-neighborhood P2..P9 in clockwise order
          // P2=N, P3=NE, P4=E, P5=SE, P6=S, P7=SW, P8=W, P9=NW
          const p2 = getPixel(x, y - 1);
          const p3 = getPixel(x + 1, y - 1);
          const p4 = getPixel(x + 1, y);
          const p5 = getPixel(x + 1, y + 1);
          const p6 = getPixel(x, y + 1);
          const p7 = getPixel(x - 1, y + 1);
          const p8 = getPixel(x - 1, y);
          const p9 = getPixel(x - 1, y - 1);

          const neighbors = [p2, p3, p4, p5, p6, p7, p8, p9];
          const B = neighbors.reduce((sum, v) => sum + v, 0);

          // Condition 1: 2 <= B <= 6
          if (B < 2 || B > 6) continue;

          // Condition 2: A = number of 0->1 transitions in sequence P2..P9,P2
          let A = 0;
          for (let i = 0; i < 8; i++) {
            if (neighbors[i] === 0 && neighbors[(i + 1) % 8] === 1) {
              A++;
            }
          }
          if (A !== 1) continue;

          // Condition 3 & 4 depending on subpass
          if (subpass === 0) {
            if (p2 * p4 * p6 !== 0) continue;
            if (p4 * p6 * p8 !== 0) continue;
          } else {
            if (p2 * p4 * p8 !== 0) continue;
            if (p2 * p6 * p8 !== 0) continue;
          }

          toClear.push(idx);
        }
      }

      if (toClear.length > 0) {
        hasChanged = true;
        for (const idx of toClear) {
          grid[idx] = 0;
        }
      }
    }
  }

  return grid;
}

/**
 * Extract skeletonized strokes from 1-pixel binary skeleton mask into open polyline paths.
 */
export function extractSkeletonStrokes(
  skeleton: Uint8Array,
  width: number,
  height: number
): Point[][] {
  const visited = new Uint8Array(width * height);
  const strokes: Point[][] = [];

  const getPixel = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    return skeleton[y * width + x];
  };

  const getNeighbors = (x: number, y: number): { x: number; y: number; idx: number }[] => {
    const list: { x: number; y: number; idx: number }[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (getPixel(nx, ny) === 1) {
          list.push({ x: nx, y: ny, idx: ny * width + nx });
        }
      }
    }
    return list;
  };

  // Find endpoints (pixels with exactly 1 neighbor) first to start strokes cleanly
  const endpoints: { x: number; y: number; idx: number }[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (skeleton[idx] === 1) {
        const nbrs = getNeighbors(x, y);
        if (nbrs.length === 1) {
          endpoints.push({ x, y, idx });
        }
      }
    }
  }

  const traceLine = (startX: number, startY: number) => {
    const path: Point[] = [];
    let currX = startX;
    let currY = startY;

    while (true) {
      const currIdx = currY * width + currX;
      visited[currIdx] = 1;
      path.push({ x: currX + 0.5, y: currY + 0.5 });

      const nbrs = getNeighbors(currX, currY).filter(n => !visited[n.idx]);
      if (nbrs.length === 0) break;

      currX = nbrs[0].x;
      currY = nbrs[0].y;
    }

    if (path.length > 2) {
      strokes.push(path);
    }
  };

  // Trace starting from endpoints
  for (const ep of endpoints) {
    if (!visited[ep.idx]) {
      traceLine(ep.x, ep.y);
    }
  }

  // Trace remaining closed skeleton loops
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (skeleton[idx] === 1 && !visited[idx]) {
        traceLine(x, y);
      }
    }
  }

  return strokes;
}

/**
 * Estimate average stroke width from binary mask distance transform
 */
export function estimateAverageStrokeWidth(
  originalMask: Uint8Array,
  width: number,
  height: number
): number {
  let totalThickness = 0;
  let sampleCount = 0;

  const step = Math.max(1, Math.floor(width / 100));

  for (let y = 5; y < height - 5; y += step) {
    const row = y * width;
    for (let x = 5; x < width - 5; x += step) {
      const idx = row + x;
      if (originalMask[idx] === 1) {
        // Measure horizontal span
        let lx = x;
        while (lx > 0 && originalMask[row + lx] === 1) lx--;
        let rx = x;
        while (rx < width - 1 && originalMask[row + rx] === 1) rx++;

        const span = rx - lx;
        if (span > 0 && span < 40) {
          totalThickness += span;
          sampleCount++;
        }
      }
    }
  }

  if (sampleCount === 0) return 2.5;
  return Math.max(1.0, Math.min(15.0, Number((totalThickness / sampleCount).toFixed(1))));
}

/**
 * Convert open stroke polyline points to SVG path string (`M x y L x y...`)
 */
export function strokeToSvgPathData(points: Point[]): string {
  if (points.length < 2) return '';
  const format = (n: number) => (Math.round(n * 10) / 10).toString();

  let d = `M ${format(points[0].x)} ${format(points[0].y)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${format(points[i].x)} ${format(points[i].y)}`;
  }
  return d;
}
