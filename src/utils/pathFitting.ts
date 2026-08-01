import {
  fitContourSegments,
  type CubicSegment,
  type Point,
} from './curveFitting.ts';

export type { Point };

/**
 * Extract exact topological closed boundary contours for a binary mask.
 * Guarantees 100% closed loops with zero broken edges or canvas line leaks.
 */
export function traceMaskContours(
  mask: Uint8Array,
  width: number,
  height: number
): Point[][] {
  const contours: Point[][] = [];
  const visitedLeft = new Uint8Array((width + 1) * (height + 1));

  const getPixel = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    return mask[y * width + x];
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (mask[idx] === 0) continue;

      const edgeKey = y * (width + 1) + x;

      if ((x === 0 || mask[idx - 1] === 0) && !visitedLeft[edgeKey]) {
        const path: Point[] = [];
        let vx = x;
        let vy = y;
        let dir = 2; // Start moving DOWN along left edge of pixel (x, y)

        const startVx = vx;
        const startVy = vy;
        const maxSteps = width * height * 4;
        let steps = 0;

        while (steps < maxSteps) {
          path.push({ x: vx, y: vy });

          if (dir === 2 && vx >= 0 && vx <= width && vy >= 0 && vy < height) {
            visitedLeft[vy * (width + 1) + vx] = 1;
          }

          if (dir === 0) vy--;      // UP
          else if (dir === 1) vx++; // RIGHT
          else if (dir === 2) vy++; // DOWN
          else if (dir === 3) vx--; // LEFT

          if (vx === startVx && vy === startVy && path.length > 2) break;

          const tl = getPixel(vx - 1, vy - 1);
          const tr = getPixel(vx, vy - 1);
          const bl = getPixel(vx - 1, vy);
          const br = getPixel(vx, vy);

          let FL = 0, FR = 0;
          if (dir === 0) { FL = tl; FR = tr; }
          else if (dir === 1) { FL = tr; FR = br; }
          else if (dir === 2) { FL = br; FR = bl; }
          else if (dir === 3) { FL = bl; FR = tl; }

          if (FL === 1 && FR === 0) {
            // Keep straight
          } else if (FL === 0 && FR === 0) {
            // Turn left
            if (dir === 0) dir = 3;
            else if (dir === 1) dir = 0;
            else if (dir === 2) dir = 1;
            else if (dir === 3) dir = 2;
          } else {
            // Turn right
            if (dir === 0) dir = 1;
            else if (dir === 1) dir = 2;
            else if (dir === 2) dir = 3;
            else if (dir === 3) dir = 0;
          }

          steps++;
        }

        if (path.length > 3) {
          contours.push(path);
        }
      }
    }
  }

  return contours;
}

/**
 * Refine topological boundary vertices to sub-pixel floating-point positions using anti-aliased image gradient.
 */
export function refineSubpixelVertices(
  contours: Point[][],
  imageData: ImageData
): Point[][] {
  const { width, height, data } = imageData;

  const getLuminance = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    const idx = (y * width + x) * 4;
    return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  };

  return contours.map((path) => {
    return path.map((pt, i) => {
      const prev = path[(i - 1 + path.length) % path.length];
      const next = path[(i + 1) % path.length];

      let subX = pt.x;
      let subY = pt.y;

      // Vertical edge vertex refinement
      if (prev.x === pt.x && next.x === pt.x) {
        const x = Math.floor(pt.x);
        const y = Math.floor(pt.y);
        const l1 = getLuminance(x - 1, y);
        const l2 = getLuminance(x, y);
        const denom = Math.abs(l1 - l2);
        if (denom > 10) {
          const shift = (128 - l1) / (l2 - l1);
          subX = x - 0.5 + Math.max(-0.4, Math.min(0.4, shift));
        }
      }
      // Horizontal edge vertex refinement
      else if (prev.y === pt.y && next.y === pt.y) {
        const x = Math.floor(pt.x);
        const y = Math.floor(pt.y);
        const l1 = getLuminance(x, y - 1);
        const l2 = getLuminance(x, y);
        const denom = Math.abs(l1 - l2);
        if (denom > 10) {
          const shift = (128 - l1) / (l2 - l1);
          subY = y - 0.5 + Math.max(-0.4, Math.min(0.4, shift));
        }
      }

      return { x: subX, y: subY };
    });
  });
}

/**
 * Detect hard corner indices along a closed contour
 */
export function detectCornerIndices(
  points: Point[],
  cornerThresholdDegrees: number = 35
): number[] {
  const len = points.length;
  if (len < 4) return [];

  const cornerIndices: number[] = [];
  const minAngleRad = (cornerThresholdDegrees * Math.PI) / 180;
  const k = Math.min(2, Math.max(1, Math.floor(len / 24)));

  for (let i = 0; i < len; i++) {
    const prev = points[(i - k + len) % len];
    const curr = points[i];
    const next = points[(i + k) % len];

    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;

    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);

    if (len1 < 0.01 || len2 < 0.01) {
      cornerIndices.push(i);
      continue;
    }

    const dotProd = (v1x * v2x + v1y * v2y) / (len1 * len2);
    const clampedDot = Math.max(-1, Math.min(1, dotProd));
    const turnAngleRad = Math.acos(clampedDot);

    if (turnAngleRad >= minAngleRad) {
      cornerIndices.push(i);
    }
  }

  return cornerIndices;
}

/**
 * Convert cubic segments into formatted SVG path data
 */
export function segmentsToSvgPathData(startPoint: Point, segments: CubicSegment[]): string {
  if (segments.length === 0) return '';
  const format = (n: number) => {
    const rounded = Math.round(n * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded);
  };

  let d = `M ${format(startPoint.x)} ${format(startPoint.y)}`;
  for (const seg of segments) {
    if (seg.type === 'line') {
      d += ` L ${format(seg.end.x)} ${format(seg.end.y)}`;
    } else if (seg.type === 'cubic' && seg.cp1 && seg.cp2) {
      d += ` C ${format(seg.cp1.x)} ${format(seg.cp1.y)}, ${format(seg.cp2.x)} ${format(seg.cp2.y)}, ${format(seg.end.x)} ${format(seg.end.y)}`;
    }
  }
  d += ' Z';
  return d;
}

/**
 * Fit a closed contour to crisp SVG path data
 */
export function contourToSvgPathData(
  points: Point[],
  smoothness: number,
  cornerThreshold: number
): string {
  if (points.length < 3) return '';

  const simplified = simplifyClosedContour(points, smoothness);
  const corners = detectCornerIndices(simplified, cornerThreshold);
  const errorTolerance = Math.max(0.15, 0.85 - (smoothness * 0.05));
  const segments = fitContourSegments(simplified, corners, errorTolerance);

  const startPoint = simplified[corners[0] ?? 0];
  return segmentsToSvgPathData(startPoint, segments);
}

/**
 * Feature-aware adaptive closed contour simplification
 */
export function simplifyClosedContour(points: Point[], smoothness: number): Point[] {
  if (points.length <= 4) return points;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const minDim = Math.min(maxX - minX, maxY - minY);
  const scaleFactor = minDim < 40 ? Math.max(0.15, minDim / 40) : 1.0;
  const epsilon = (0.2 + smoothness * 0.12) * scaleFactor;

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end - start <= 1) continue;

    let maxDist = 0;
    let maxIdx = start;

    const lineStart = points[start];
    const lineEnd = points[end];
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const len = Math.hypot(dx, dy);

    for (let i = start + 1; i < end; i++) {
      const p = points[i];
      let dist = 0;
      if (len < 1e-6) {
        dist = Math.hypot(p.x - lineStart.x, p.y - lineStart.y);
      } else {
        dist = Math.abs(dy * p.x - dx * p.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / len;
      }
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }

    if (maxDist > epsilon) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx]);
      stack.push([maxIdx, end]);
    }
  }

  const result: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) result.push(points[i]);
  }
  return result.length >= 3 ? result : points;
}
