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

function distance(p1: Point, p2: Point): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function normalize(v: Point): Point {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-9) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

function dot(v1: Point, v2: Point): number {
  return v1.x * v2.x + v1.y * v2.y;
}

function evaluateCubicBezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
    y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y,
  };
}

/**
 * Chord-length parameterization of points array
 */
function chordLengthParameterize(points: Point[], first: number, last: number): number[] {
  const u: number[] = [0];
  for (let i = first + 1; i <= last; i++) {
    u.push(u[i - first - 1] + distance(points[i], points[i - 1]));
  }
  const totalLength = u[u.length - 1];
  if (totalLength < 1e-9) {
    return u.map(() => 0);
  }
  for (let i = 0; i < u.length; i++) {
    u[i] /= totalLength;
  }
  return u;
}

/**
 * Check if all points between first and last lie on a straight line within maxDev
 */
export function isStraightLineSegment(
  points: Point[],
  first: number,
  last: number,
  maxDev: number = 0.4
): boolean {
  if (last - first <= 1) return true;
  const pStart = points[first];
  const pEnd = points[last];
  const dx = pEnd.x - pStart.x;
  const dy = pEnd.y - pStart.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq < 1e-6) return true;

  for (let i = first + 1; i < last; i++) {
    const p = points[i];
    const num = Math.abs(dy * p.x - dx * p.y + pEnd.x * pStart.y - pEnd.y * pStart.x);
    const dist = num / Math.sqrt(lenSq);
    if (dist > maxDev) return false;
  }
  return true;
}

/**
 * Fit a single Cubic Bezier curve to a range of points using least-squares approximation.
 */
function fitCubicSingle(
  points: Point[],
  first: number,
  last: number,
  u: number[],
  tHat1: Point,
  tHat2: Point
): { p1: Point; p2: Point } {
  const p0 = points[first];
  const p3 = points[last];
  const nPts = last - first + 1;

  // Compute A vector
  const A: [Point, Point][] = new Array(nPts);
  for (let i = 0; i < nPts; i++) {
    const ui = u[i];
    const mt = 1 - ui;
    const b1 = 3 * ui * mt * mt;
    const b2 = 3 * ui * ui * mt;
    A[i] = [
      { x: tHat1.x * b1, y: tHat1.y * b1 },
      { x: tHat2.x * b2, y: tHat2.y * b2 },
    ];
  }

  // Compute C matrix and X vector
  let C00 = 0, C01 = 0, C11 = 0;
  let X0 = 0, X1 = 0;

  for (let i = 0; i < nPts; i++) {
    const ui = u[i];
    const b0 = (1 - ui) * (1 - ui) * (1 - ui);
    const b1 = 3 * ui * (1 - ui) * (1 - ui);
    const b2 = 3 * ui * ui * (1 - ui);
    const b3 = ui * ui * ui;

    const tmp = {
      x: points[first + i].x - (b0 * p0.x + b1 * p0.x + b2 * p3.x + b3 * p3.x),
      y: points[first + i].y - (b0 * p0.y + b1 * p0.y + b2 * p3.y + b3 * p3.y),
    };

    C00 += dot(A[i][0], A[i][0]);
    C01 += dot(A[i][0], A[i][1]);
    C11 += dot(A[i][1], A[i][1]);

    X0 += dot(A[i][0], tmp);
    X1 += dot(A[i][1], tmp);
  }

  // Compute determinants
  const detC0C1 = C00 * C11 - C01 * C01;
  const detC0X = C00 * X1 - C01 * X0;
  const detXC1 = X0 * C11 - X1 * C01;

  let alpha1 = Math.abs(detC0C1) < 1e-9 ? 0 : detXC1 / detC0C1;
  let alpha2 = Math.abs(detC0C1) < 1e-9 ? 0 : detC0X / detC0C1;

  // Handle negative, zero, NaN or oversized alpha to prevent crazy curve overshoots
  const segLength = distance(p0, p3);
  const maxAlpha = Math.max(0.1, segLength * 1.5);
  const epsilon = 1e-6 * segLength;
  if (!Number.isFinite(alpha1) || alpha1 < epsilon || alpha1 > maxAlpha) {
    alpha1 = segLength / 3;
  }
  if (!Number.isFinite(alpha2) || alpha2 < epsilon || alpha2 > maxAlpha) {
    alpha2 = segLength / 3;
  }

  return {
    p1: { x: p0.x + tHat1.x * alpha1, y: p0.y + tHat1.y * alpha1 },
    p2: { x: p3.x + tHat2.x * alpha2, y: p3.y + tHat2.y * alpha2 },
  };
}

/**
 * Find maximum error between points and fitted Bezier curve
 */
function findMaxError(
  points: Point[],
  first: number,
  last: number,
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  u: number[]
): { maxError: number; splitPoint: number } {
  let maxDist = 0;
  let splitIdx = Math.floor((first + last) / 2);

  for (let i = first + 1; i < last; i++) {
    const P = evaluateCubicBezier(p0, p1, p2, p3, u[i - first]);
    const dist = distance(points[i], P);
    if (dist >= maxDist) {
      maxDist = dist;
      splitIdx = i;
    }
  }

  return { maxError: maxDist, splitPoint: splitIdx };
}

/**
 * Newton-Raphson root finding for re-parameterizing u
 */
function reparameterize(
  points: Point[],
  first: number,
  last: number,
  u: number[],
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point
): number[] {
  const nPts = last - first + 1;
  const uPrime: number[] = new Array(nPts);

  for (let i = first; i <= last; i++) {
    const ui = u[i - first];
    const P = evaluateCubicBezier(p0, p1, p2, p3, ui);

    // Q'(t)
    const Qprime = {
      x: 3 * (1 - ui) * (1 - ui) * (p1.x - p0.x) + 6 * (1 - ui) * ui * (p2.x - p1.x) + 3 * ui * ui * (p3.x - p2.x),
      y: 3 * (1 - ui) * (1 - ui) * (p1.y - p0.y) + 6 * (1 - ui) * ui * (p2.y - p1.y) + 3 * ui * ui * (p3.y - p2.y),
    };

    // Q''(t)
    const Qpprime = {
      x: 6 * (1 - ui) * (p2.x - 2 * p1.x + p0.x) + 6 * ui * (p3.x - 2 * p2.x + p1.x),
      y: 6 * (1 - ui) * (p2.y - 2 * p1.y + p0.y) + 6 * ui * (p3.y - 2 * p2.y + p1.y),
    };

    const num = (P.x - points[i].x) * Qprime.x + (P.y - points[i].y) * Qprime.y;
    const den = Qprime.x * Qprime.x + Qprime.y * Qprime.y + (P.x - points[i].x) * Qpprime.x + (P.y - points[i].y) * Qpprime.y;

    if (Math.abs(den) < 1e-9) {
      uPrime[i - first] = ui;
    } else {
      uPrime[i - first] = ui - num / den;
    }
  }

  return uPrime;
}

/**
 * Fit cubic Bezier curve to a range of points recursively using Schneider's algorithm
 */
function fitCubic(
  points: Point[],
  first: number,
  last: number,
  tHat1: Point,
  tHat2: Point,
  errorTolerance: number,
  results: CubicSegment[]
): void {
  if (last - first === 1) {
    const p0 = points[first];
    const p3 = points[last];
    const dist = distance(p0, p3) / 3;
    results.push({
      type: 'cubic',
      end: p3,
      cp1: { x: p0.x + tHat1.x * dist, y: p0.y + tHat1.y * dist },
      cp2: { x: p3.x + tHat2.x * dist, y: p3.y + tHat2.y * dist },
    });
    return;
  }

  // Check straight line segment first
  if (isStraightLineSegment(points, first, last, errorTolerance * 0.75)) {
    results.push({
      type: 'line',
      end: points[last],
    });
    return;
  }

  let u = chordLengthParameterize(points, first, last);
  let { p1, p2 } = fitCubicSingle(points, first, last, u, tHat1, tHat2);
  let { maxError, splitPoint } = findMaxError(points, first, last, points[first], p1, p2, points[last], u);

  if (maxError < errorTolerance) {
    results.push({
      type: 'cubic',
      end: points[last],
      cp1: p1,
      cp2: p2,
    });
    return;
  }

  // Try re-parameterization if error is within 3x tolerance
  if (maxError < errorTolerance * 3) {
    for (let iter = 0; iter < 2; iter++) {
      u = reparameterize(points, first, last, u, points[first], p1, p2, points[last]);
      const reFit = fitCubicSingle(points, first, last, u, tHat1, tHat2);
      p1 = reFit.p1;
      p2 = reFit.p2;
      const err = findMaxError(points, first, last, points[first], p1, p2, points[last], u);
      if (err.maxError < errorTolerance) {
        results.push({
          type: 'cubic',
          end: points[last],
          cp1: p1,
          cp2: p2,
        });
        return;
      }
      maxError = err.maxError;
      splitPoint = err.splitPoint;
    }
  }

  // Ensure valid split point to prevent infinite recursion
  if (splitPoint <= first || splitPoint >= last) {
    splitPoint = Math.floor((first + last) / 2);
  }

  // Recursive split
  const prevIdx = Math.max(first, splitPoint - 1);
  const nextIdx = Math.min(last, splitPoint + 1);
  let tHatCenter = normalize({
    x: points[nextIdx].x - points[prevIdx].x,
    y: points[nextIdx].y - points[prevIdx].y,
  });

  if (tHatCenter.x === 0 && tHatCenter.y === 0) {
    tHatCenter = { x: 1, y: 0 };
  }

  fitCubic(points, first, splitPoint, tHat1, tHatCenter, errorTolerance, results);
  fitCubic(points, splitPoint, last, { x: -tHatCenter.x, y: -tHatCenter.y }, tHat2, errorTolerance, results);
}


/**
 * Fit a closed sub-pixel polygon contour into crisp straight lines and Bezier curves.
 */
export function fitContourSegments(
  points: Point[],
  cornerIndices: number[],
  errorTolerance: number = 0.5
): CubicSegment[] {
  if (points.length < 3) return [];

  const len = points.length;

  // If fewer than 2 corners detected, pick extreme bounding box points as corners
  let corners = [...cornerIndices];
  if (corners.length < 2) {
    let minXIdx = 0, maxXIdx = 0, minYIdx = 0, maxYIdx = 0;
    for (let i = 1; i < len; i++) {
      if (points[i].x < points[minXIdx].x) minXIdx = i;
      if (points[i].x > points[maxXIdx].x) maxXIdx = i;
      if (points[i].y < points[minYIdx].y) minYIdx = i;
      if (points[i].y > points[maxYIdx].y) maxYIdx = i;
    }
    const set = new Set([minXIdx, maxXIdx, minYIdx, maxYIdx]);
    corners = Array.from(set).sort((a, b) => a - b);
    if (corners.length < 2) {
      corners = [0, Math.floor(len / 2)];
    }
  }

  const segments: CubicSegment[] = [];

  for (let c = 0; c < corners.length; c++) {
    const firstIdx = corners[c];
    const lastIdx = corners[(c + 1) % corners.length];

    // Collect ordered points along arc between firstIdx and lastIdx
    const arcPoints: Point[] = [];
    let idx = firstIdx;
    while (true) {
      arcPoints.push(points[idx]);
      if (idx === lastIdx) break;
      idx = (idx + 1) % len;
    }

    if (arcPoints.length < 2) continue;

    const pStart = arcPoints[0];
    const pEnd = arcPoints[arcPoints.length - 1];

    if (isStraightLineSegment(arcPoints, 0, arcPoints.length - 1, errorTolerance * 0.75)) {
      segments.push({
        type: 'line',
        end: pEnd,
      });
    } else {
      const pPrev = points[(firstIdx - 1 + len) % len];
      const pNext = points[(lastIdx + 1) % len];

      const pSecond = arcPoints.length > 1 ? arcPoints[1] : pEnd;
      const pPenultimate = arcPoints.length > 1 ? arcPoints[arcPoints.length - 2] : pStart;

      let tHat1 = normalize({ x: pSecond.x - pPrev.x, y: pSecond.y - pPrev.y });
      let tHat2 = normalize({ x: pPenultimate.x - pNext.x, y: pPenultimate.y - pNext.y });

      if (tHat1.x === 0 && tHat1.y === 0) {
        tHat1 = normalize({ x: pEnd.x - pStart.x, y: pEnd.y - pStart.y });
      }
      if (tHat2.x === 0 && tHat2.y === 0) {
        tHat2 = normalize({ x: pStart.x - pEnd.x, y: pStart.y - pEnd.y });
      }

      fitCubic(arcPoints, 0, arcPoints.length - 1, tHat1, tHat2, errorTolerance, segments);
    }
  }

  return segments;
}
