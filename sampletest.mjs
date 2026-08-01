// Run the REAL pipeline on the user's sample image and diff output vs source.
import fs from 'node:fs';
import jpeg from 'jpeg-js';
import { preparePreprocessedImageData } from './src/utils/imagePreprocess.ts';
import { quantizeDominantPalette, consolidatePalette, refineEdgeAntiAliasing, smoothIndexedEdges, mergeThinRimLayers, rgbToHex } from './src/utils/colorUtils.ts';
import { extractBoundaryContours, potraceFitContour } from './src/utils/potraceEngine.ts';
import { groupCompoundPaths } from './src/utils/topology.ts';
import { renderSvgFromLayers } from './src/utils/vectorizerEngine.ts';

class StubCanvas {
  constructor(w, h) { this._w = w; this._h = h; this.data = new Uint8ClampedArray(w * h * 4); }
  get width() { return this._w; } set width(v) { this._w = v; this.data = new Uint8ClampedArray(v * this._h * 4); }
  get height() { return this._h; } set height(v) { this._h = v; this.data = new Uint8ClampedArray(this._w * v * 4); }
  getContext() { const c = this; return {
    fillStyle: '#ffffff', filter: 'none', imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
    fillRect(x, y, w, h) { for (let yy = Math.max(0,y); yy < Math.min(c.height, y+h); yy++) for (let xx = Math.max(0,x); xx < Math.min(c.width, x+w); xx++) { const i=(yy*c.width+xx)*4; c.data[i]=255;c.data[i+1]=255;c.data[i+2]=255;c.data[i+3]=255; } },
    drawImage(img, dx, dy, dw, dh) { const sw = img.width || img.naturalWidth, sh = img.height || img.naturalHeight; const sdata = img.data || img._data;
      for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
        const gx = (x + 0.5) * sw / dw - 0.5, gy = (y + 0.5) * sh / dh - 0.5;
        const x0 = Math.max(0, Math.min(sw-1, Math.floor(gx))), y0 = Math.max(0, Math.min(sh-1, Math.floor(gy)));
        const x1 = Math.min(sw-1, x0+1), y1 = Math.min(sh-1, y0+1);
        const fx = Math.max(0, Math.min(1, gx-x0)), fy = Math.max(0, Math.min(1, gy-y0));
        const i00=(y0*sw+x0)*4, i10=(y0*sw+x1)*4, i01=(y1*sw+x0)*4, i11=(y1*sw+x1)*4;
        const oi = (y * dw + x) * 4;
        for (let ch = 0; ch < 4; ch++) {
          const v = (1-fx)*(1-fy)*sdata[i00+ch] + fx*(1-fy)*sdata[i10+ch] + (1-fx)*fy*sdata[i01+ch] + fx*fy*sdata[i11+ch];
          c.data[oi+ch] = Math.round(v);
        }
      } },
    getImageData(x, y, w, h) { return { width: w, height: h, data: c.data.slice((y*c.width+x)*4, ((y+h)*c.width+x)*4) }; },
    createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w*h*4) }; },
  }; }
}
globalThis.document = { createElement: () => new StubCanvas(1, 1) };

const OPTIONS = { presetProfile:'clipart', geometryMode:'filled', engineMode:'potrace', filterMode:'none', quantizationMode:'dominant', maxColors:16, speckleFilter:8, smoothness:7, cornerThreshold:35, pathOverlap:true, upscale:true, upscaleMinDimension:1024, blurRadius:0, minColorAreaRatio:0.0005, strokeWidth:2 };

const raw = jpeg.decode(fs.readFileSync('samples/source image.jpg'));
const src = { width: raw.width, height: raw.height, data: raw.data };
console.log('source:', raw.width, 'x', raw.height);

const fakeImg = { naturalWidth: src.width, naturalHeight: src.height, width: src.width, height: src.height, _data: src.data };
const t0 = performance.now();
const { imageData, width, height } = preparePreprocessedImageData(fakeImg, OPTIONS);
console.log('preprocessed:', width, 'x', height);
const q = quantizeDominantPalette(imageData, OPTIONS.maxColors, 15);
const cons = consolidatePalette(q.palette, q.indexedPixels, OPTIONS.minColorAreaRatio);
let palette = cons.palette, indexed = cons.indexedPixels;
refineEdgeAntiAliasing(indexed, width, height);
smoothIndexedEdges(indexed, width, height, 1);
const merged = mergeThinRimLayers(palette, indexed, width, height);
palette = merged.palette; indexed = merged.indexedPixels;
smoothIndexedEdges(indexed, width, height, 1);
console.log('final palette:', palette.map(p => rgbToHex(p.r,p.g,p.b)).join(' '));

const layers = [];
for (let cIdx = 0; cIdx < palette.length; cIdx++) {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) if (indexed[i] === cIdx) mask[i] = 1;
  const rawC = extractBoundaryContours(mask, width, height);
  const valid = rawC.filter(pts => { if (pts.length < 4) return false;
    let a=1e9,b=1e9,c2=-1,e2=-1;
    for (const p of pts) { a=Math.min(a,p.x);b=Math.min(b,p.y);c2=Math.max(c2,p.x);e2=Math.max(e2,p.y); }
    return (c2-a)*(e2-b) >= 6 || rawC.length < 5; });
  const wp = [];
  for (const contour of valid) {
    const pd = potraceFitContour(contour, OPTIONS.smoothness, OPTIONS.cornerThreshold, width);
    if (pd) wp.push({ points: contour, pathData: pd });
  }
  layers.push({ colorId: `c${cIdx}`, hex: rgbToHex(palette[cIdx].r, palette[cIdx].g, palette[cIdx].b), svgPaths: groupCompoundPaths(wp) });
}
const svg = renderSvgFromLayers(layers, new Map(layers.map(l => [l.colorId, l.hex])), new Map(layers.map(l => [l.colorId, true])), width, height, true);
console.log('pipeline:', (performance.now()-t0).toFixed(0), 'ms | svg:', (svg.length/1024).toFixed(1), 'KB');
fs.writeFileSync('samples/output.svg', svg);
console.log('saved samples/output.svg');

// --- analyze the output: where does it deviate from the source? ---
// rasterize the output fills
function rasterizeFills(svg, size) {
  const out = new Uint8Array(size * size);
  for (const pm of svg.matchAll(/<path d="([^"]*)"(?:[^>]*fill="([^"]*)")?[^>]*\/>/g)) {
    if (pm[2] === 'none') continue;
    const d = pm[1];
    const toks = d.match(/[MLCZ]|[-+]?\d*\.?\d+/g) || [];
    let i = 0, x = 0, y = 0, sx = 0, sy = 0;
    const polys = []; let cur = [];
    while (i < toks.length) {
      const t = toks[i];
      if (t === 'M') { x = parseFloat(toks[++i]); y = parseFloat(toks[++i]); sx = x; sy = y; cur = [[x,y]]; }
      else if (t === 'L') { x = parseFloat(toks[++i]); y = parseFloat(toks[++i]); cur.push([x,y]); }
      else if (t === 'C') {
        const c1x = parseFloat(toks[++i]), c1y = parseFloat(toks[++i]);
        const c2x = parseFloat(toks[++i]), c2y = parseFloat(toks[++i]);
        const nx = parseFloat(toks[++i]), ny = parseFloat(toks[++i]);
        for (let s = 1; s <= 24; s++) {
          const t1 = s / 24, t0 = 1 - t1;
          cur.push([t0**3*x + 3*t0**2*t1*c1x + 3*t0*t1**2*c2x + t1**3*nx, t0**3*y + 3*t0**2*t1*c1y + 3*t0*t1**2*c2y + t1**3*ny]);
        }
        x = nx; y = ny;
      }
      else if (t === 'Z') { polys.push(cur); cur = []; x = sx; y = sy; i++; }
      else i++;
    }
    if (cur.length > 2) polys.push(cur);
    for (const poly of polys) {
      for (let yy = 0; yy < size; yy++) {
        const ys = yy + 0.5;
        const xs = [];
        for (let k = 0; k < poly.length; k++) {
          const [ax, ay] = poly[k], [bx, by] = poly[(k+1) % poly.length];
          if ((ay <= ys && by <= ys) || (ay > ys && by > ys)) continue;
          xs.push(ax + (ys - ay) * (bx - ax) / (by - ay));
        }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const x0 = Math.max(0, Math.ceil(xs[k] - 0.5)), x1 = Math.min(size, Math.floor(xs[k+1] + 0.5));
          for (let xx = x0; xx < x1; xx++) out[yy * size + xx] ^= 1;
        }
      }
    }
  }
  return out;
}

// src mask: greens are the shapes of interest
const greenIdx = [];
palette.forEach((p, i) => { const h = rgbToHex(p.r,p.g,p.b); if (h.startsWith('#3') || h.startsWith('#8') || h.startsWith('#2')) greenIdx.push(i); });
console.log('green palette indices:', greenIdx.join(','));

// Compare per-green-layer: output coverage vs source mask
const greenLayers = layers.filter(l => greenIdx.includes(parseInt(l.colorId.slice(1))));
console.log('green layers:', greenLayers.map(l => l.hex).join(' '));
// dump layer compound structure
layers.forEach((l) => {
  l.svgPaths.forEach((d, gi) => {
    const subs = d.split(/(?=M )/).filter(s => /^M /.test(s));
    console.log('layer', l.hex, 'compound', gi, 'subpaths:', subs.length, '| path len:', d.length);
  });
});
// row 347 detail: what does the source vs output look like for #88ba3f?
{
  const gl = greenLayers[0];
  const oneSvg = renderSvgFromLayers([gl], new Map([[gl.colorId, gl.hex]]), new Map([[gl.colorId, true]]), width, height, true);
  const out = rasterizeFills(oneSvg, width);
  const li = parseInt(gl.colorId.slice(1));
  console.log('row 347 (y=347):');
  let line = '';
  for (let x = 200; x < 1100; x += 10) {
    const s = indexed[347*width+x] === li ? 'S' : '.';
    const o = out[347*width+x] ? 'O' : '.';
    line += s === 'O' ? (o === 'O' ? 'B' : 'O') : (s === 'S' ? 's' : '.');
  }
  console.log('  legend: B=both S=source O=output');
  console.log('  ' + line);
}
// mask contour analysis for the greens
for (const li of greenIdx) {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) if (indexed[i] === li) mask[i] = 1;
  const rawC = extractBoundaryContours(mask, width, height);
  const bboxes = rawC.map(c => {
    let a=1e9,b=1e9,c2=-1,e2=-1;
    for (const p of c) { a=Math.min(a,p.x);b=Math.min(b,p.y);c2=Math.max(c2,p.x);e2=Math.max(e2,p.y); }
    return `(${Math.round(a)},${Math.round(b)})-(${Math.round(c2)},${Math.round(e2)})`;
  });
  console.log(`mask #${rgbToHex(palette[li].r,palette[li].g,palette[li].b)}: ${rawC.length} contours: ${bboxes.join(' ')}`);
}
// trace where the big hole contour went in grouping
{
  const li = greenIdx[0];
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) if (indexed[i] === li) mask[i] = 1;
  const rawC = extractBoundaryContours(mask, width, height);
  const valid = rawC.filter(pts => { if (pts.length < 4) return false;
    let a=1e9,b=1e9,c2=-1,e2=-1;
    for (const p of pts) { a=Math.min(a,p.x);b=Math.min(b,p.y);c2=Math.max(c2,p.x);e2=Math.max(e2,p.y); }
    return (c2-a)*(e2-b) >= 6 || rawC.length < 5; });
  console.log('valid contours:', valid.length, '| each area:');
  valid.forEach((c, idx) => {
    let area = 0;
    for (let k = 0; k < c.length; k++) { const p1 = c[k], p2 = c[(k+1)%c.length]; area += p1.x*p2.y - p2.x*p1.y; }
    area = Math.abs(area)/2;
    let a=1e9,b=1e9,c2=-1,e2=-1;
    for (const p of c) { a=Math.min(a,p.x);b=Math.min(b,p.y);c2=Math.max(c2,p.x);e2=Math.max(e2,p.y); }
    console.log('  c', idx, 'area', Math.round(area), 'bbox', Math.round(a), Math.round(b), '-', Math.round(c2), Math.round(e2));
  });
  const wp = valid.map(c => ({ points: c, pathData: potraceFitContour(c, 7, 35, width) })).filter(w => w.pathData);
  const groups = groupCompoundPaths(wp);
  console.log('groups:', groups.length);
  groups.forEach((g, gi) => {
    const subs = g.split(/(?=M )/).filter(s => /^M /.test(s));
    const bbs = subs.map(s => {
      const nums = s.match(/-?\d+(\.\d+)?/g)||[];
      let a=1e9,b=1e9,c2=-1,e2=-1;
      for(let k=0;k+1<nums.length;k+=2){a=Math.min(a,+nums[k]);b=Math.min(b,+nums[k+1]);c2=Math.max(c2,+nums[k]);e2=Math.max(e2,+nums[k+1]);}
      return [Math.round(a),Math.round(b),Math.round(c2),Math.round(e2)];
    });
    console.log('  group', gi, 'subpaths:', bbs.map(x=>x.join(',')).join(' | '));
  });
}
// debug containment for c2 vs c0
{
  const li = greenIdx[0];
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) if (indexed[i] === li) mask[i] = 1;
  const rawC = extractBoundaryContours(mask, width, height);
  const valid = rawC.filter(pts => { if (pts.length < 4) return false;
    let a=1e9,b=1e9,c2=-1,e2=-1;
    for (const p of pts) { a=Math.min(a,p.x);b=Math.min(b,p.y);c2=Math.max(c2,p.x);e2=Math.max(e2,p.y); }
    return (c2-a)*(e2-b) >= 6 || rawC.length < 5; });
  const outer = valid[0], hole = valid[2];
  const step = Math.max(1, Math.floor(hole.length / 128));
  let fails = 0, total = 0;
  for (let k = 0; k < hole.length; k += step) {
    total++;
    const p = hole[k];
    let inside = false;
    const poly = outer;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      if (((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    if (!inside) { fails++; if (fails <= 3) console.log('  point outside:', Math.round(p.x), Math.round(p.y)); }
  }
  console.log('containment c2 in c0: fails', fails, '/', total);
  // geometry at rows 514 and 600: the outer's x-extent and the hole's points
  for (const rowY of [514, 600, 700]) {
    let outerXs = [];
    for (const p of outer) if (Math.abs(p.y - rowY) < 2) outerXs.push(Math.round(p.x));
    let holeXs = [];
    for (const p of hole) if (Math.abs(p.y - rowY) < 2) holeXs.push(Math.round(p.x));
    console.log('  row', rowY, 'outer xs:', outerXs.slice(0,8).join(','), '... | hole xs:', holeXs.slice(0,8).join(','));
  }
  // check: is the outer contour self-intersecting?
  const segs = [];
  for (let i = 0; i < outer.length; i++) segs.push([outer[i], outer[(i+1)%outer.length]]);
  const cross = (a, b, c, d) => {
    const o1 = (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
    const o2 = (b[0]-a[0])*(d[1]-a[1]) - (b[1]-a[1])*(d[0]-a[0]);
    const o3 = (d[0]-c[0])*(a[1]-c[1]) - (d[1]-c[1])*(a[0]-c[0]);
    const o4 = (d[0]-c[0])*(b[1]-c[1]) - (d[1]-c[1])*(b[0]-c[0]);
    return o1*o2 < 0 && o3*o4 < 0;
  };
  let hits = 0;
  for (let a = 0; a < segs.length && hits < 5; a++)
    for (let b = a + 2; b < segs.length && hits < 5; b++)
      if (cross(segs[a][0], segs[a][1], segs[b][0], segs[b][1])) hits++;
  console.log('  outer self-intersections:', hits);
  // also check the bbox margin test
  console.log('bbox check:', hole.points.length > 0);
}
// which compound covers (240, 347)?
{
  const gl = greenLayers[0];
  gl.svgPaths.forEach((d, gi) => {
    const one = renderSvgFromLayers([{ ...gl, svgPaths: [d] }], new Map([[gl.colorId, gl.hex]]), new Map([[gl.colorId, true]]), width, height, true);
    const out = rasterizeFills(one, width);
    const covers = out[347*width+240] ? 'YES' : 'no';
    const bbs = d.split(/(?=M )/).filter(s => /^M /.test(s)).map(s => {
      const nums = s.match(/-?\d+(\.\d+)?/g)||[];
      let a=1e9,b=1e9,c2=-1,e2=-1;
      for(let k=0;k+1<nums.length;k+=2){a=Math.min(a,+nums[k]);b=Math.min(b,+nums[k+1]);c2=Math.max(c2,+nums[k]);e2=Math.max(e2,+nums[k+1]);}
      return [Math.round(a),Math.round(b),Math.round(c2),Math.round(e2)];
    });
    console.log('  compound', gi, 'covers (240,347):', covers, '| bbox:', bbs.map(x=>x.join(',')).join(' | '));
  });
}
for (const gl of greenLayers) {
  const oneSvg = renderSvgFromLayers([gl], new Map([[gl.colorId, gl.hex]]), new Map([[gl.colorId, true]]), width, height, true);
  const out = rasterizeFills(oneSvg, width);
  // source mask for this layer's color
  const li = parseInt(gl.colorId.slice(1));
  const srcMask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) if (indexed[i] === li) srcMask[i] = 1;
  // boundary deviation: for each row, leftmost/rightmost shape pixel, source vs output
  let maxOver = 0, maxUnder = 0, worst = '';
  for (let y = 0; y < height; y++) {
    let sL = -1, oL = -1, sR = -1, oR = -1;
    for (let x = 0; x < width; x++) {
      if (srcMask[y*width+x] && sL === -1) sL = x;
      if (out[y*width+x] && oL === -1) oL = x;
      if (srcMask[y*width+x]) sR = x;
      if (out[y*width+x]) oR = x;
    }
    if (sL !== -1 && oL !== -1) { const d = oL - sL; if (Math.abs(d) > maxOver) { maxOver = Math.abs(d); worst = `row ${y} L: src=${sL} out=${oL}`; } }
    if (sR !== -1 && oR !== -1) { const d = oR - sR; if (Math.abs(d) > maxUnder) { maxUnder = Math.abs(d); worst = `row ${y} R: src=${sR} out=${oR}`; } }
  }
  console.log(`  layer ${gl.hex}: max boundary deviation ${Math.max(maxOver, maxUnder)}px (${worst})`);
}
