export interface Point {
  x: number;
  y: number;
}

export interface CubicSegment {
  type: 'line' | 'cubic';
  end: Point;
  cp1?: Point;
  cp2?: Point;
}

/**
 * Extract 4-connected / 8-connected closed topological boundary cycles for a binary mask.
 */
export function extractBoundaryContours(
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
        let dir = 2; // 0=UP, 1=RIGHT, 2=DOWN, 3=LEFT

        const startVx = vx;
        const startVy = vy;
        const maxSteps = width * height * 4;
        let steps = 0;

        while (steps < maxSteps) {
          path.push({ x: vx, y: vy });

          if (dir === 2 && vx >= 0 && vx <= width && vy >= 0 && vy < height) {
            visitedLeft[vy * (width + 1) + vx] = 1;
          }

          if (dir === 0) vy--;
          else if (dir === 1) vx++;
          else if (dir === 2) vy++;
          else if (dir === 3) vx--;

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
            // straight
          } else if (FL === 0 && FR === 0) {
            dir = (dir + 3) % 4; // turn left
          } else {
            dir = (dir + 1) % 4; // turn right
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
 * Potrace Algorithm Phase 1: Dynamic Programming Optimal Polygon Fitting.
 * Solves for the minimal number of vertices that lie within maxDev (epsilon) of the grid boundary contour.
 */
export function potraceOptimalPolygon(
  contour: Point[],
  alphamax: number = 1.0
): Point[] {
  const n = contour.length;
  if (n <= 4) return contour;

  // Cap the straight-segment reach scan so worst-case cost stays bounded on
  // large contours (e.g. upscaled logos). Very long straight edges may emit a
  // few extra collinear vertices, which are exact and harmless (the bezier
  // fitter renders them as crisp straight segments).
  const REACH_CAP = 128;
  const alphamaxSq = alphamax * alphamax;

  // Compute straight-line segment validity matrix for pairs (i, j)
  // Segment (i, j) is valid if all intermediate contour points lie within alphamax distance of line (i, j)
  const isStraightValid = (i: number, j: number): boolean => {
    const count = j >= i ? j - i : n - i + j;
    if (count <= 1) return true;

    const pStart = contour[i];
    const pEnd = contour[j];
    const dx = pEnd.x - pStart.x;
    const dy = pEnd.y - pStart.y;
    const lenSq = dx * dx + dy * dy;

    if (lenSq < 1e-6) return true;

    // Squared comparison: |cross| / sqrt(lenSq) <= alphamax  <=>  cross^2 <= alphamax^2 * lenSq
    const crossConst = pEnd.x * pStart.y - pEnd.y * pStart.x;
    const tolSq = alphamaxSq * lenSq;

    for (let k = 1; k < count; k++) {
      const p = contour[(i + k) % n];
      const cross = dy * p.x - dx * p.y + crossConst;
      if (cross * cross > tolSq) return false;
    }
    return true;
  };

  // Furthest valid jump from each vertex (bounded by REACH_CAP)
  const longestReach = new Int32Array(n);
  const maxScan = Math.min(n - 1, REACH_CAP);
  for (let i = 0; i < n; i++) {
    let r = 1;
    while (r <= maxScan && isStraightValid(i, (i + r) % n)) {
      r++;
    }
    longestReach[i] = Math.min(r - 1, maxScan);
  }

  // Greedy polygon reconstruction: from each vertex, jump as far as the longest
  // valid reach allows. (A minimal-vertex DP was previously attempted here but
  // was never read by the caller and cost O(n^3) - a hard freeze at traced
  // resolutions >= 1024px.)
  // Jumps are capped at n-1-curr so they NEVER cross the contour's wrap: a
  // wrap-spanning jump re-walks the boundary (its chord is "valid" because it
  // hugs the straight closing run) and the closing edge then becomes a long
  // diagonal crossing the shape's own notches - evenodd XORs those crossings
  // into huge transparent chunks. Capped, the walk is monotonic, terminates at
  // contour[n-1], and the closing edge is the contour's own tiny last->first
  // boundary edge.
  const polygon: Point[] = [];
  const visited = new Uint8Array(n);
  let curr = 0;
  let steps = 0;

  while (steps < n && !visited[curr]) {
    visited[curr] = 1;
    polygon.push(contour[curr]);

    const reach = Math.max(1, Math.min(longestReach[curr], n - 1 - curr));
    curr = (curr + reach) % n;
    steps++;

    if (curr === 0) break;
  }

  return polygon.length >= 3 ? polygon : contour;
}

/**
 * Potrace Algorithm Phase 2: Corner Detection.
 *
 * A vertex is a corner when its turn angle exceeds the threshold AND both of
 * its adjacent edges are STRAIGHT (the raw contour between the vertex and its
 * polygon neighbors stays within straightTol of the chord). This separates
 * real corners (which connect two straight edges - e.g. a hexagon's vertices)
 * from curve vertices (a small circle's polygon vertices have sharp-looking
 * turns but the contour between them is curved). Small elements and cursive
 * strokes keep their curves instead of being faceted into polygons.
 *
 * When no contour is supplied, falls back to the angle-only test.
 */
export function potraceDetectCorners(
  points: Point[],
  cornerThresholdDeg: number = 45,
  contour: Point[] | null = null,
  straightTol: number = 0.9
): number[] {
  const len = points.length;
  // Polygons can collapse all the way to a triangle under aggressive
  // tolerances; those vertices are real corners and must be detected
  // (otherwise a triangle gets fitted as rounded blobs with overshoot).
  if (len < 3) return [];

  const cornerIndices: number[] = [];
  const minAngleRad = (cornerThresholdDeg * Math.PI) / 180;

  // Map each polygon vertex to its nearest contour index (polygon vertices are
  // contour points, possibly shifted <= 0.6px by straighten/projection).
  let contourIdx: Int32Array | null = null;
  if (contour && contour.length > 0) {
    contourIdx = new Int32Array(len);
    for (let i = 0; i < len; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let k = 0; k < contour.length; k++) {
        const dx = contour[k].x - points[i].x;
        const dy = contour[k].y - points[i].y;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = k; }
      }
      contourIdx[i] = best;
    }
  }

  // Intrinsic straightness of the contour segment between polygon vertices a
  // and b: fit a line through the segment's own points. Returns the mean
  // absolute deviation (jitter = sparse outliers = tiny mean; a curve bows
  // consistently = large mean) and the signed-deviation balance (a curve's
  // points all sit on ONE side of the line ~1.0; jitter alternates ~0).
  const edgeDev = (a: number, b: number): { mean: number; balance: number } => {
    if (!contour || !contourIdx) return { mean: 0, balance: 0 };
    const cA = contourIdx[a];
    const cB = contourIdx[b];
    if (cA === cB) return { mean: 0, balance: 0 };
    const pts: Point[] = [];
    let k = cA;
    while (true) {
      pts.push(contour[k]);
      if (k === cB) break;
      k = (k + 1) % contour.length;
    }
    // The endpoints are the polygon vertices themselves (possibly shifted by
    // straighten projections); only the INTERIOR contour points define the
    // edge's intrinsic straightness. Short segments (tight curves' chords) are
    // too short to demonstrate straightness - their mean deviation is trivially
    // tiny - so they are not "straight" (the corner gate then rejects them,
    // keeping tight curves smooth).
    const interior = pts.slice(1, -1);
    if (interior.length < 8) return { mean: Infinity, balance: 1 };
    let sx = 0, sy = 0;
    for (const p of interior) { sx += p.x; sy += p.y; }
    const cx = sx / interior.length, cy = sy / interior.length;
    let xx = 0, xy = 0, yy = 0;
    for (const p of interior) {
      const px = p.x - cx, py = p.y - cy;
      xx += px * px; xy += px * py; yy += py * py;
    }
    const theta = 0.5 * Math.atan2(2 * xy, xx - yy);
    const dx = Math.cos(theta), dy = Math.sin(theta);
    let sumAbs = 0, sumSigned = 0;
    for (const p of interior) {
      const d = (p.x - cx) * dy - (p.y - cy) * dx;
      sumAbs += Math.abs(d);
      sumSigned += d;
    }
    const mean = sumAbs / interior.length;
    const balance = sumAbs > 1e-9 ? Math.abs(sumSigned) / sumAbs : 0;
    return { mean, balance };
  };

  for (let i = 0; i < len; i++) {
    // Skip degenerate neighbor edges (e.g. the polygon's tiny wrap-closing edge
    // whose interior is empty) by stepping outward until a real edge is found.
    let prevIdx = (i - 1 + len) % len;
    for (let step = 0; step < 4 && !isFinite(edgeDev(prevIdx, i).mean); step++) {
      prevIdx = (prevIdx - 1 + len) % len;
    }
    let nextIdx = (i + 1) % len;
    for (let step = 0; step < 4 && !isFinite(edgeDev(i, nextIdx).mean); step++) {
      nextIdx = (nextIdx + 1) % len;
    }
    const prev = points[prevIdx];
    const curr = points[i];
    const next = points[nextIdx];

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

    // Compute the turn angle from the CONTOUR's LOCAL tangents: a real corner's
    // direction change is concentrated at one point (the local 2-3px angle
    // equals the full corner angle), while a curve's change is gradual (the
    // local angle is a few degrees regardless of radius). The polygon vertex can
    // sit 1-2px off the true corner (straighten projections), so take the max
    // local angle over a small neighborhood around the vertex's contour index.
    let angle: number;
    if (contour && contourIdx) {
      const k = contourIdx[i];
      const n = contour.length;
      const w = Math.max(1, Math.min(3, Math.floor(n / 40)));
      const localTurn = (j: number): number => {
        const p0 = contour[((j - w) % n + n) % n];
        const p1 = contour[j];
        const p2 = contour[(j + w) % n];
        const v1x = p1.x - p0.x, v1y = p1.y - p0.y;
        const v2x = p2.x - p1.x, v2y = p2.y - p1.y;
        const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
        if (l1 < 1e-9 || l2 < 1e-9) return 0;
        const dot = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
        return Math.acos(dot) * 180 / Math.PI;
      };
      let best = 0;
      for (let dj = -4; dj <= 4; dj++) {
        const j = ((k + dj) % n + n) % n;
        const t = localTurn(j);
        if (t > best) best = t;
      }
      // localTurn returns degrees; the threshold is in radians.
      angle = best * Math.PI / 180;
    } else {
      const dotProd = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (len1 * len2)));
      angle = Math.acos(dotProd);
    }

    if (angle >= minAngleRad) {
      if (contourIdx) {
        // Real corners connect two straight edges: low mean deviation AND the
        // deviations must not all fall on one side (a curve bows consistently,
        // jitter alternates).
        const devPrev = edgeDev(prevIdx, i);
        const devNext = edgeDev(i, nextIdx);
        if (
          devPrev.mean < straightTol && devNext.mean < straightTol &&
          devPrev.balance < 0.6 && devNext.balance < 0.6
        ) {
          cornerIndices.push(i);
        }
      } else {
        cornerIndices.push(i);
      }
    }
  }

  return cornerIndices;
}

/**
 * Potrace Algorithm Phase 3: Constrained $C^1$-Continuous Bezier Curve Fitting.
 */
export function potraceFitBezierPath(
  points: Point[],
  cornerIndices: number[],
  smoothness: number = 7,
  maxDeviation: number = 1.0
): string {
  const len = points.length;
  if (len < 3) return '';

  const format = (n: number) => (Math.round(n * 100) / 100).toString();

  // If smoothness <= 1, output crisp linear polygon
  if (smoothness <= 1 || cornerIndices.length === len) {
    let d = `M ${format(points[0].x)} ${format(points[0].y)}`;
    for (let i = 1; i < len; i++) {
      d += ` L ${format(points[i].x)} ${format(points[i].y)}`;
    }
    d += ' Z';
    return d;
  }

  const isCorner = new Uint8Array(len);
  for (const idx of cornerIndices) {
    isCorner[idx] = 1;
  }

  let d = `M ${format(points[0].x)} ${format(points[0].y)}`;

  // Handle tension factor: reduced when either endpoint is a corner so the
  // chord tangent cannot overshoot past the corner (visible as thin color
  // spikes poking out of small elements).
  const tension = Math.min(0.38, 0.20 + smoothness * 0.018);

  for (let i = 0; i < len; i++) {
    const nextIdx = (i + 1) % len;
    const p1 = points[i];
    const p2 = points[nextIdx];
    const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);

    if (segLen < 0.01) continue;

    // Any segment adjacent to a DETECTED corner renders as a straight line:
    // the contour-aware gate guarantees only real corners are detected, so the
    // corner stays exactly sharp (a curve would bow toward it and round it).
    if (isCorner[i] || isCorner[nextIdx]) {
      d += ` L ${format(p2.x)} ${format(p2.y)}`;
    } else {
      const cornerAdjacent = isCorner[i] || isCorner[nextIdx];
      const handleDist = cornerAdjacent
        ? Math.min(segLen * tension, segLen * 0.18)
        : segLen * tension;

      const p0 = points[(i - 1 + len) % len];
      const p3 = points[(nextIdx + 1) % len];

      // Tangent vector at p1
      let t1x: number, t1y: number;
      if (isCorner[i]) {
        t1x = p2.x - p1.x;
        t1y = p2.y - p1.y;
      } else {
        t1x = p2.x - p0.x;
        t1y = p2.y - p0.y;
      }

      // Tangent vector at p2
      let t2x: number, t2y: number;
      if (isCorner[nextIdx]) {
        t2x = p2.x - p1.x;
        t2y = p2.y - p1.y;
      } else {
        t2x = p3.x - p1.x;
        t2y = p3.y - p1.y;
      }

      const t1Len = Math.hypot(t1x, t1y);
      const t2Len = Math.hypot(t2x, t2y);

      // Clamp handles so the fitted curve cannot overshoot past the polygon by
      // more than maxDeviation. Unclamped long chords at shallow turns bulge
      // several px past the polygon; a hole bulging across its parent's fitted
      // path gets XOR'd into transparent chunks by evenodd. Corner tangents run
      // along the chord (sin ~ 0) and stay unclamped.
      const chordDx = p2.x - p1.x;
      const chordDy = p2.y - p1.y;
      const chordLen = Math.hypot(chordDx, chordDy);
      const clampHandle = (hx: number, hy: number, hd: number): number => {
        const hl = Math.hypot(hx, hy);
        if (hl < 1e-9 || chordLen < 1e-9) return hd;
        const sinAng = Math.abs(hx * chordDy - hy * chordDx) / (hl * chordLen);
        if (sinAng < 1e-6) return hd;
        return Math.min(hd, Math.max(0.35, maxDeviation / sinAng));
      };
      const hd1 = clampHandle(t1x, t1y, handleDist);
      const hd2 = clampHandle(t2x, t2y, handleDist);

      const cp1x = t1Len > 0 ? p1.x + (t1x / t1Len) * hd1 : p1.x;
      const cp1y = t1Len > 0 ? p1.y + (t1y / t1Len) * hd1 : p1.y;
      const cp2x = t2Len > 0 ? p2.x - (t2x / t2Len) * hd2 : p2.x;
      const cp2y = t2Len > 0 ? p2.y - (t2y / t2Len) * hd2 : p2.y;

      d += ` C ${format(cp1x)} ${format(cp1y)}, ${format(cp2x)} ${format(cp2y)}, ${format(p2.x)} ${format(p2.y)}`;
    }
  }

  d += ' Z';
  return d;
}

/**
 * Normalize a contour to a canonical rotation (start at min-y/min-x point)
 * and counter-clockwise orientation. Two masks sharing a boundary walk it in
 * opposite directions from different starts; normalization makes both layers
 * fit the IDENTICAL path, so adjacent fills abut exactly with no seam gap.
 */
export function normalizeContour(points: Point[]): Point[] {
  const n = points.length;
  if (n <= 2) return points;

  let best = 0;
  for (let i = 1; i < n; i++) {
    if (points[i].y < points[best].y || (points[i].y === points[best].y && points[i].x < points[best].x)) {
      best = i;
    }
  }

  const rotated = new Array<Point>(n);
  for (let i = 0; i < n; i++) rotated[i] = points[(best + i) % n];

  // Force counter-clockwise orientation
  let area = 0;
  for (let i = 0; i < n; i++) {
    const p1 = rotated[i];
    const p2 = rotated[(i + 1) % n];
    area += p1.x * p2.y - p2.x * p1.y;
  }
  if (area < 0) {
    rotated.reverse();
    let b2 = 0;
    for (let i = 1; i < n; i++) {
      if (rotated[i].y < rotated[b2].y || (rotated[i].y === rotated[b2].y && rotated[i].x < rotated[b2].x)) {
        b2 = i;
      }
    }
    if (b2 > 0) {
      const rerotated = new Array<Point>(n);
      for (let i = 0; i < n; i++) rerotated[i] = rotated[(b2 + i) % n];
      return rerotated;
    }
  }
  return rotated;
}

/**
 * Remove polygon vertices that sit almost on the line between their neighbors.
 * These are quantization-jitter artifacts: the bezier fitter would bow through
 * them (edges curving where they should be straight) and corner detection
 * would flag their noisy angles as false corners (edges looking too sharp).
 * Real corners stick out well beyond epsilon and survive.
 */
export function simplifyNearCollinear(
  points: Point[],
  epsilon: number,
  protectedVertices: ReadonlySet<number> | null = null
): Point[] {
  if (points.length <= 3) return points;
  const eps = Math.max(0.25, epsilon);
  let pts = points.slice();
  let changed = true;
  // The iterative cascade removes vertices whose LOCAL chords are within eps;
  // on gentle curves this can accumulate and strip real features. Bound the
  // cascade with a pass limit; the straighten stage (balance-gated) handles
  // the long straight runs afterward.
  let pass = 0;
  while (changed && pts.length > 3 && pass < 6) {
    changed = false;
    const next: Point[] = [];
    const m = pts.length;
    for (let i = 0; i < m; i++) {
      const prev = pts[(i - 1 + m) % m];
      const curr = pts[i];
      const nx = pts[(i + 1) % m];
      // Protected vertices (pre-detected corners) always survive.
      if (protectedVertices && protectedVertices.has(i)) {
        next.push(curr);
        continue;
      }
      const dx = nx.x - prev.x;
      const dy = nx.y - prev.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1e-9) continue; // duplicate point: drop
      const dist = Math.abs(dy * (curr.x - prev.x) - dx * (curr.y - prev.y)) / Math.sqrt(lenSq);
      if (dist < eps) {
        changed = true;
      } else {
        next.push(curr);
      }
    }
    if (changed) pts = next;
    pass++;
  }
  return pts;
}

/**
 * Collapse near-straight runs onto a least-squares fitted line.
 *
 * Long straight edges (letter strokes, bars) keep residual 0.3-1px
 * quantization waviness that survives polygon fitting (REACH_CAP splits long
 * edges into segments that each carry the waviness). The bezier fitter then
 * renders those segments slightly slanted/curved. This pass groups consecutive
 * vertices within epsilon of a running best-fit line and replaces each run
 * with its two projected endpoints, making long edges exactly straight.
 * Real corners deviate from any neighboring line by far more than epsilon and
 * break the runs.
 */
export function straightenRuns(points: Point[], epsilon: number): Point[] {
  const n = points.length;
  if (n <= 3) return points;
  const eps = Math.max(0.35, epsilon);

  const fitLine = (pts: Point[]): { cx: number; cy: number; dx: number; dy: number } => {
    let sx = 0, sy = 0;
    for (const p of pts) { sx += p.x; sy += p.y; }
    const cx = sx / pts.length;
    const cy = sy / pts.length;
    let xx = 0, xy = 0, yy = 0;
    for (const p of pts) {
      const px = p.x - cx, py = p.y - cy;
      xx += px * px; xy += px * py; yy += py * py;
    }
    const theta = 0.5 * Math.atan2(2 * xy, xx - yy);
    return { cx, cy, dx: Math.cos(theta), dy: Math.sin(theta) };
  };
  const distToLine = (p: Point, l: { cx: number; cy: number; dx: number; dy: number }): number => {
    const px = p.x - l.cx, py = p.y - l.cy;
    return Math.abs(px * l.dy - py * l.dx);
  };
  const project = (p: Point, l: { cx: number; cy: number; dx: number; dy: number }): Point => {
    const px = p.x - l.cx, py = p.y - l.cy;
    const t = px * l.dx + py * l.dy;
    return { x: l.cx + t * l.dx, y: l.cy + t * l.dy };
  };

  const result: Point[] = [];
  let start = 0;
  while (start < n) {
    let end = start + 1;
    const runPts = [points[start]];
    let line = fitLine(runPts);
    while (end < n && distToLine(points[end], line) <= eps) {
      runPts.push(points[end]);
      line = fitLine(runPts);
      end++;
    }
    // Validate every run member against the final fitted line; if any drifted
    // (the greedy grow overshot), advance by one and re-examine from there.
    // Also require the residuals to be BALANCED (jitter alternates around the
    // line, balance ~ 0). A gentle curve's points bow consistently to one side
    // (balance ~ 1): collapsing it would flatten the curve into rigid chords.
    const finalLine = line;
    let signedSum = 0, absSum = 0;
    for (const p of runPts) {
      const d = (p.x - finalLine.cx) * finalLine.dy - (p.y - finalLine.cy) * finalLine.dx;
      signedSum += d;
      absSum += Math.abs(d);
    }
    const balance = absSum > 1e-9 ? Math.abs(signedSum) / absSum : 0;
    if (runPts.length >= 3 && balance < 0.55 && runPts.every((p) => distToLine(p, finalLine) <= eps)) {
      result.push(project(points[start], finalLine));
      result.push(project(points[end - 1], finalLine));
      start = end;
    } else {
      result.push(points[start]);
      start++;
    }
  }
  return result;
}

/**
 * Complete Potrace Vectorizer pipeline for a single contour loop.
 *
 * workingSize is the traced image's width/height; alphamax scales with it
 * because quantization/AA jitter is proportional to working resolution -
 * a fixed pixel tolerance chases pixel noise on large canvases (rough,
 * over-fitted edges) while being too coarse on tiny ones.
 */
/**
 * Detect self-intersections in a polygon (segment pair crossing test with a
 * bounding-box prefilter). O(n^2) worst case, but fast in practice.
 */
export function polygonSelfIntersects(points: Point[]): boolean {
  const n = points.length;
  if (n < 4) return false;
  const segs = points.map((p, i) => ({
    x0: p.x, y0: p.y,
    x1: points[(i + 1) % n].x, y1: points[(i + 1) % n].y,
  }));
  const cross = (a: number[], b: number[], c: number[]) =>
    (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
  for (let a = 0; a < n; a++) {
    const sa = segs[a];
    const minAx = Math.min(sa.x0, sa.x1), maxAx = Math.max(sa.x0, sa.x1);
    const minAy = Math.min(sa.y0, sa.y1), maxAy = Math.max(sa.y0, sa.y1);
    for (let b = a + 2; b < n; b++) {
      if (a === 0 && b === n - 1) continue; // adjacent at the wrap
      const sb = segs[b];
      if (maxAx < Math.min(sb.x0, sb.x1) || minAx > Math.max(sb.x0, sb.x1)) continue;
      if (maxAy < Math.min(sb.y0, sb.y1) || minAy > Math.max(sb.y0, sb.y1)) continue;
      const p1 = [sa.x0, sa.y0], p2 = [sa.x1, sa.y1];
      const p3 = [sb.x0, sb.y0], p4 = [sb.x1, sb.y1];
      const o1 = cross(p1, p2, p3), o2 = cross(p1, p2, p4);
      const o3 = cross(p3, p4, p1), o4 = cross(p3, p4, p2);
      if (o1 * o2 < 0 && o3 * o4 < 0) return true;
    }
  }
  return false;
}

/**
 * Smooth jitter on curved polygon runs: each non-corner vertex is replaced by
 * a weighted average of itself and its neighbors (2 iterations). Corner
 * vertices stay fixed, so sharp corners are untouched.
 *
 * The smoothing can pull vertices inward on sparse clean polygons (the
 * neighbors' centroid of a convex arc lies inside the curve). To prevent that,
 * each smoothed vertex is clamped: it may never drift more than maxDrift
 * beyond its ORIGINAL distance from the raw contour (jitter is small, so the
 * clamp only binds on the pathological sparse-polygon case).
 */
export function smoothCurveVertices(
  points: Point[],
  cornerIndices: number[],
  contour: Point[] | null = null,
  maxDrift: number = 0.8
): Point[] {
  const n = points.length;
  if (n <= 4) return points;
  const isCorner = new Uint8Array(n);
  for (const idx of cornerIndices) isCorner[idx] = 1;

  const nearestContour = (p: Point): Point => {
    let best = Infinity;
    let bx = p.x, by = p.y;
    for (const c of contour!) {
      const dx = c.x - p.x, dy = c.y - p.y;
      const d = dx * dx + dy * dy;
      if (d < best) { best = d; bx = c.x; by = c.y; }
    }
    return { x: bx, y: by };
  };

  let pts = points.slice();
  for (let iter = 0; iter < 2; iter++) {
    const next = pts.slice();
    for (let i = 0; i < n; i++) {
      if (isCorner[i]) continue;
      const prev = pts[(i - 1 + n) % n];
      const curr = pts[i];
      const nx = pts[(i + 1) % n];
      // Skip averaging across a corner (keeps corner-adjacent edges crisp).
      const wPrev = isCorner[(i - 1 + n) % n] ? 0 : 0.25;
      const wNext = isCorner[(i + 1) % n] ? 0 : 0.25;
      const wSelf = 1 - wPrev - wNext;
      const denom = wPrev + wSelf + wNext;
      const sm = {
        x: (wPrev * prev.x + wSelf * curr.x + wNext * nx.x) / denom,
        y: (wPrev * prev.y + wSelf * curr.y + wNext * nx.y) / denom,
      };
      if (contour && contour.length > 0) {
        // Clamp: the smoothed vertex must stay within maxDrift of the raw
        // contour (absolute). The Laplacian's inward sagitta-pull on convex
        // arcs is thereby bounded to sub-pixel, while genuine jitter averaging
        // (the centroid sits on the contour) is unaffected.
        const nc = nearestContour(sm);
        const dx = sm.x - nc.x, dy = sm.y - nc.y;
        const dist = Math.hypot(dx, dy);
        if (dist > maxDrift && dist > 1e-6) {
          const t = maxDrift / dist;
          next[i] = { x: nc.x + dx * t, y: nc.y + dy * t };
        } else {
          next[i] = sm;
        }
      } else {
        next[i] = sm;
      }
    }
    pts = next;
  }
  return pts;
}

export function potraceFitContour(
  contour: Point[],
  smoothness: number,
  cornerThresholdDeg: number,
  workingSize: number = 0
): string {
  if (contour.length < 3) return '';

  const baseAlpha = Math.max(0.4, 1.2 - smoothness * 0.08);
  const sizeFactor = workingSize > 256 ? Math.min(0.7, (workingSize - 256) * 0.0008) : 0;
  let alphamax = Math.min(2.0, baseAlpha + sizeFactor);

  // Thin elements (script tails, narrow strokes) cannot tolerate the full
  // size-scaled tolerance: the fit's chords could cut across the stroke or
  // collapse its fill. Cap the tolerance by the contour's narrowest bbox
  // dimension.
  {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of contour) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const minDim = Math.min(maxX - minX, maxY - minY);
    alphamax = Math.min(alphamax, Math.max(0.6, minDim * 0.12));
  }

  // Canonical rotation/orientation: adjacent layers sharing this boundary fit
  // the identical path, so their fills abut exactly (no transparent seams).
  const normalized = normalizeContour(contour);
  const rawPolygon = potraceOptimalPolygon(normalized, alphamax);
  // Detect corners on the RAW polygon first and protect them through the
  // simplification: the simplify's iterative cascade can otherwise strip
  // corner/feature vertices ("some points got skipped" -> lost corners).
  const rawCorners = potraceDetectCorners(rawPolygon, cornerThresholdDeg, normalized, Math.max(0.35, alphamax * 0.25));
  const protectedVerts = new Set(rawCorners);
  let polygon = simplifyNearCollinear(rawPolygon, alphamax * 0.4, protectedVerts);
  // Straighten long runs onto exact lines (letter strokes stay straight),
  // then drop any residual kinks introduced at run seams.
  polygon = simplifyNearCollinear(straightenRuns(polygon, alphamax * 0.35), alphamax * 0.4);
  const corners = potraceDetectCorners(polygon, cornerThresholdDeg, normalized, Math.max(0.35, alphamax * 0.25));
  // Remove residual jitter on curved runs (big arcs stay smooth, corners fixed,
  // vertices clamped to the contour so sparse polygons cannot shrink inward).
  const smoothed = smoothCurveVertices(polygon, corners, normalized);
  // Safety: the simplify/straighten/smooth stages can in rare cases push
  // vertices across concave features, producing a self-intersecting polygon
  // that evenodd fills XOR into huge transparent chunks. Fall back to the
  // last provably simple stage.
  if (!polygonSelfIntersects(smoothed)) {
    polygon = smoothed;
  } else if (polygonSelfIntersects(polygon)) {
    // Extremely rare: even the post-straighten polygon is degenerate.
    // Rebuild from the raw optimal polygon.
    polygon = potraceOptimalPolygon(normalized, alphamax);
  }
  return potraceFitBezierPath(polygon, corners, smoothness, alphamax);
}
