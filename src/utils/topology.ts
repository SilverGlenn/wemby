import type { Point } from './curveFitting';

export interface ContourMeta {
  points: Point[];
  svgPathData: string;
  area: number;
  isHole: boolean;
  parentIndex: number;
}

/**
 * Calculate signed area of a 2D polygon.
 * Positive = Counter-Clockwise, Negative = Clockwise
 */
export function calculateSignedArea(points: Point[]): number {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    area += p1.x * p2.y - p2.x * p1.y;
  }
  return area / 2;
}

/**
 * Test if point (px, py) is inside closed polygon using Ray-Casting
 */
export function isPointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  const len = polygon.length;
  for (let i = 0, j = len - 1; i < len; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;

    const intersect = ((yi > p.y) !== (yj > p.y))
      && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);

    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Group contours into parent outer paths and nested hole subpaths
 */
export function groupCompoundPaths(
  contoursWithPaths: Array<{ points: Point[]; pathData: string }>
): string[] {
  if (contoursWithPaths.length === 0) return [];

  const metas: Array<ContourMeta & { minX: number; maxX: number; minY: number; maxY: number }> = contoursWithPaths.map((item) => {
    const area = calculateSignedArea(item.points);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of item.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return {
      points: item.points,
      svgPathData: item.pathData,
      area: Math.abs(area),
      isHole: false,
      parentIndex: -1,
      minX, maxX, minY, maxY,
    };
  });

  // Sort by area descending (largest outer boundaries first)
  const sortedIndices = metas
    .map((_, idx) => idx)
    .sort((a, b) => metas[b].area - metas[a].area);

  // Find enclosing parent for each smaller contour using fast bounding-box filter first.
  // A hole must be FULLY contained: the parent's fitted path can deviate inward
  // by up to alphamax from its raw contour, so a hole hugging the parent's edge
  // may end up outside the rendered path - punching it then XORs into a
  // transparent sliver. Require an inset bbox plus sampled point tests.
  // j descends from the smallest larger contour to the largest, so the first
  // (break) match is the TIGHTEST enclosing contour: an island inside a hole
  // (donut center, letter counter) attaches to the hole contour, gets even
  // depth and renders filled - not punched out of the background.
  const MARGIN = 3;
  for (let i = 0; i < sortedIndices.length; i++) {
    const childIdx = sortedIndices[i];
    const childMeta = metas[childIdx];
    if (childMeta.points.length === 0) continue;

    // Check against larger candidate parents
    for (let j = i - 1; j >= 0; j--) {
      const parentIdx = sortedIndices[j];
      const parentMeta = metas[parentIdx];

      // Fast Bounding Box check (child bbox inside parent bbox with margin)
      if (
        childMeta.minX - MARGIN >= parentMeta.minX &&
        childMeta.maxX + MARGIN <= parentMeta.maxX &&
        childMeta.minY - MARGIN >= parentMeta.minY &&
        childMeta.maxY + MARGIN <= parentMeta.maxY
      ) {
        // Sample up to 128 evenly spaced contour points; all must be inside.
        const step = Math.max(1, Math.floor(childMeta.points.length / 128));
        let allInside = true;
        for (let k = 0; k < childMeta.points.length; k += step) {
          if (!isPointInPolygon(childMeta.points[k], parentMeta.points)) {
            allInside = false;
            break;
          }
        }
        if (allInside) {
          childMeta.parentIndex = parentIdx;
          break;
        }
      }
    }
  }


  // Determine hole depth (even depth = outer, odd depth = hole)
  for (const meta of metas) {
    let depth = 0;
    let curr = meta.parentIndex;
    while (curr !== -1) {
      depth++;
      curr = metas[curr].parentIndex;
    }
    meta.isHole = depth % 2 === 1;
  }

  // Combine hole subpath strings into parent outer path string
  const outerPathsMap = new Map<number, string[]>();

  for (let i = 0; i < metas.length; i++) {
    const meta = metas[i];
    if (!meta.isHole) {
      if (!outerPathsMap.has(i)) {
        outerPathsMap.set(i, []);
      }
      outerPathsMap.get(i)!.push(meta.svgPathData);
    }
  }

  for (let i = 0; i < metas.length; i++) {
    const meta = metas[i];
    if (meta.isHole && meta.parentIndex !== -1) {
      let rootParent = meta.parentIndex;
      while (metas[rootParent].isHole && metas[rootParent].parentIndex !== -1) {
        rootParent = metas[rootParent].parentIndex;
      }
      if (outerPathsMap.has(rootParent)) {
        outerPathsMap.get(rootParent)!.push(meta.svgPathData);
      }
    }
  }

  const resultSvgPaths: string[] = [];
  outerPathsMap.forEach((subpaths) => {
    resultSvgPaths.push(subpaths.join(' '));
  });

  return resultSvgPaths;
}
