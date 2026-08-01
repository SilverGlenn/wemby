// Clean analysis: which compound covers (240,347) and why does the fill extend
// far beyond the source mask at that row?
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
const fakeImg = { naturalWidth: src.width, naturalHeight: src.height, width: src.width, height: src.height, _data: src.data };
const { imageData, width, height } = preparePreprocessedImageData(fakeImg, OPTIONS);
const q = quantizeDominantPalette(imageData, OPTIONS.maxColors, 15);
const cons = consolidatePalette(q.palette, q.indexedPixels, OPTIONS.minColorAreaRatio);
let palette = cons.palette, indexed = cons.indexedPixels;
refineEdgeAntiAliasing(indexed, width, height);
smoothIndexedEdges(indexed, width, height, 1);
const merged = mergeThinRimLayers(palette, indexed, width, height);
palette = merged.palette; indexed = merged.indexedPixels;
smoothIndexedEdges(indexed, width, height, 1);
console.log('palette:', palette.map(p => rgbToHex(p.r,p.g,p.b)).join(' '));

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
fs.writeFileSync('samples/output.svg', svg);
console.log('svg saved:', (svg.length/1024).toFixed(1), 'KB');

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

// which compound covers (240, 347) in #88ba3f?
const gl = layers.find(l => l.hex === '#88ba3f');
console.log('#88ba3f compounds:', gl.svgPaths.length);
gl.svgPaths.forEach((d, gi) => {
  const one = renderSvgFromLayers([{ ...gl, svgPaths: [d] }], new Map([[gl.colorId, gl.hex]]), new Map([[gl.colorId, true]]), width, height, true);
  const out = rasterizeFills(one, width);
  const covers = out[347*width+240] ? 'YES' : 'no';
  const subBbs = d.split(/(?=M )/).filter(s => /^M /.test(s)).map(s => {
    const nums = s.match(/-?\d+(\.\d+)?/g)||[];
    let a=1e9,b=1e9,c2=-1,e2=-1;
    for(let k=0;k+1<nums.length;k+=2){a=Math.min(a,+nums[k]);b=Math.min(b,+nums[k+1]);c2=Math.max(c2,+nums[k]);e2=Math.max(e2,+nums[k+1]);}
    return [Math.round(a),Math.round(b),Math.round(c2),Math.round(e2)];
  });
  console.log('  compound', gi, '| covers (240,347):', covers, '| subpaths:', subBbs.map(x=>x.join(',')).join(' | '));
});

// source mask at row 347 vs output fill at row 347 for #88ba3f
{
  const li = palette.findIndex(p => rgbToHex(p.r,p.g,p.b) === '#88ba3f');
  const fullOut = rasterizeFills(renderSvgFromLayers([gl], new Map([[gl.colorId, gl.hex]]), new Map([[gl.colorId, true]]), width, height, true), width);
  let line = '';
  for (let x = 200; x < 1200; x += 12) {
    const s = indexed[347*width+x] === li;
    const o = fullOut[347*width+x];
    line += s && o ? 'B' : s ? 's' : o ? 'O' : '.';
  }
  console.log('row 347 (B=both s=src O=out):');
  console.log('  ' + line);
}

// dump compound 0's path crossings at row 347
{
  const d = gl.svgPaths[0];
  const toks = d.match(/[MLCZ]|[-+]?\d*\.?\d+/g) || [];
  let i = 0, x = 0, y = 0, sx = 0, sy = 0;
  const segs = [];
  let cur = [];
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
    else if (t === 'Z') { for (let k = 0; k < cur.length; k++) segs.push([cur[k], cur[(k+1)%cur.length]]); cur = []; x = sx; y = sy; i++; }
    else i++;
  }
  const ys = 347.5;
  const xs = [];
  for (const [a, b] of segs) {
    if ((a[1] <= ys && b[1] <= ys) || (a[1] > ys && b[1] > ys)) continue;
    xs.push(Math.round(a[0] + (ys - a[1]) * (b[0] - a[0]) / (b[1] - a[1])));
  }
  xs.sort((p, q) => p - q);
  console.log('compound 0 crossings at row 347:', xs.join(', '));
  // the source contour c0's crossings at row 347
  const li = palette.findIndex(p => rgbToHex(p.r,p.g,p.b) === '#88ba3f');
  const mask = new Uint8Array(width * height);
  for (let i2 = 0; i2 < width * height; i2++) if (indexed[i2] === li) mask[i2] = 1;
  const rawC = extractBoundaryContours(mask, width, height);
  const srcXs = [];
  for (const c of rawC) {
    for (let k = 0; k < c.length; k++) {
      const a = c[k], b = c[(k+1)%c.length];
      if ((a.y <= ys && b.y <= ys) || (a.y > ys && b.y > ys)) continue;
      srcXs.push(Math.round(a.x + (ys - a.y) * (b.x - a.x) / (b.y - a.y)));
    }
  }
  srcXs.sort((p, q) => p - q);
  console.log('source mask crossings at row 347:', srcXs.join(', '));
  console.log('path head:', d.slice(0, 200));
}

// trace the fit stages for the c0 contour
{
  const li = palette.findIndex(p => rgbToHex(p.r,p.g,p.b) === '#88ba3f');
  const mask = new Uint8Array(width * height);
  for (let i2 = 0; i2 < width * height; i2++) if (indexed[i2] === li) mask[i2] = 1;
  const rawC = extractBoundaryContours(mask, width, height);
  const c0 = rawC.reduce((a, b) => (b.length > a.length ? b : a));
  console.log('c0 length:', c0.length);
  const ys = 347.5;
  const crossings = (pts) => {
    const xs = [];
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k+1)%pts.length];
      if ((a.y <= ys && b.y <= ys) || (a.y > ys && b.y > ys)) continue;
      xs.push(Math.round(a.x + (ys - a.y) * (b.x - a.x) / (b.y - a.y)));
    }
    xs.sort((p, q) => p - q);
    return xs.join(', ');
  };
  console.log('c0 raw crossings:', crossings(c0));
  import('./src/utils/potraceEngine.ts').then(({ normalizeContour, potraceOptimalPolygon, simplifyNearCollinear, straightenRuns }) => {
    const alpha = Math.min(2.0, Math.max(0.4, 1.2-7*0.08) + Math.min(1.4, (width-256)*0.0012));
    const norm = normalizeContour(c0);
    console.log('normalized crossings:', crossings(norm));
    const poly = potraceOptimalPolygon(norm, alpha);
    console.log('polygon crossings:', crossings(poly), '| verts:', poly.length);
    const p2 = simplifyNearCollinear(poly, alpha*0.4);
    console.log('simplify crossings:', crossings(p2), '| verts:', p2.length);
    const p3 = straightenRuns(p2, alpha*0.35);
    console.log('straighten crossings:', crossings(p3), '| verts:', p3.length);
  });
}

// the path segments crossing row 347
{
  const d = gl.svgPaths[0];
  const toks = d.match(/[MLCZ]|[-+]?\d*\.?\d+/g) || [];
  let i = 0, x = 0, y = 0, sx = 0, sy = 0;
  const segs = [];
  let cur = [];
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
    else if (t === 'Z') { for (let k = 0; k < cur.length; k++) segs.push([cur[k], cur[(k+1)%cur.length]]); cur = []; x = sx; y = sy; i++; }
    else i++;
  }
  const ys = 347.5;
  const hits = [];
  for (const [a, b] of segs) {
    if ((a[1] <= ys && b[1] <= ys) || (a[1] > ys && b[1] > ys)) continue;
    hits.push({ x: Math.round(a[0] + (ys - a[1]) * (b[0] - a[0]) / (b[1] - a[1])), from: a.map(v=>Math.round(v)), to: b.map(v=>Math.round(v)) });
  }
  hits.sort((p, q) => p.x - q.x);
  hits.forEach(h => console.log('  crossing at x=' + h.x, 'seg from', h.from.join(','), 'to', h.to.join(',')));
  // find the raw path commands near (240,347)
  const cmds = d.match(/[MLC] [-\d.]+ [-\d.]+(?:, [-\d.]+ [-\d.]+){0,5}/g) || [];
  const near = [];
  cmds.forEach((c, idx) => {
    const nums = c.match(/-?\d+\.?\d*/g).map(Number);
    for (let k = 0; k + 1 < nums.length; k += 2) {
      if (Math.abs(nums[k] - 250) < 120 && Math.abs(nums[k+1] - 347) < 100) { near.push(idx + ': ' + c); break; }
    }
  });
  console.log('commands near (250,347):');
  near.slice(0, 10).forEach(c => console.log('  ' + c));
}

// what's in the mask at the suspicious coordinates?
{
  const li = palette.findIndex(p => rgbToHex(p.r,p.g,p.b) === '#88ba3f');
  const li36 = palette.findIndex(p => rgbToHex(p.r,p.g,p.b) === '#36a14a');
  const probe = (x, y) => {
    const c = indexed[y*width+x];
    return c === li ? '#88ba3f' : c === li36 ? '#36a14a' : c === 0 ? '#010101' : c === 2 ? '#fbfbfb' : 'idx' + c;
  };
  console.log('probes:');
  for (const [x, y] of [[202,347],[330,347],[250,300],[307,310],[545,347],[583,347],[600,347],[250,250],[400,300]]) {
    console.log('  (' + x + ',' + y + '):', probe(x, y));
  }
  // the c0 contour's points near (202,347)
  const mask = new Uint8Array(width * height);
  for (let i2 = 0; i2 < width * height; i2++) if (indexed[i2] === li) mask[i2] = 1;
  const rawC = extractBoundaryContours(mask, width, height);
  const c0 = rawC.reduce((a, b) => (b.length > a.length ? b : a));
  const near = c0.filter(p => Math.abs(p.x - 202) < 15 && Math.abs(p.y - 347) < 15);
  console.log('c0 contour points near (202,347):', near.length, near.slice(0, 8).map(p => Math.round(p.x)+','+Math.round(p.y)).join(' | '));
  const near2 = c0.filter(p => Math.abs(p.x - 250) < 100 && Math.abs(p.y - 300) < 40);
  console.log('c0 contour points near (250,300):', near2.length, near2.slice(0, 12).map(p => Math.round(p.x)+','+Math.round(p.y)).join(' | '));
}

// Generate a comparison PNG: source | output | diff (scaled to ~900px wide)
{
  const zlib = await import('node:zlib');
  const scale = 0.55;
  const W3 = Math.round(width * scale), H3 = Math.round(height * scale);
  const panelW = Math.round(width * scale);
  const canvas = new StubCanvas(W3 * 3, H3);
  // source panel (from preprocessed imageData)
  for (let y = 0; y < H3; y++) for (let x = 0; x < panelW; x++) {
    const sx = Math.round(x / scale), sy = Math.round(y / scale);
    const i = (sy * width + sx) * 4;
    const o = ((y * W3 + x) * 4);
    canvas.data[o] = imageData.data[i]; canvas.data[o+1] = imageData.data[i+1]; canvas.data[o+2] = imageData.data[i+2]; canvas.data[o+3] = 255;
  }
  // output panel (full layer render)
  const fullSvg = renderSvgFromLayers(layers, new Map(layers.map(l => [l.colorId, l.hex])), new Map(layers.map(l => [l.colorId, true])), width, height, true);
  const fills = rasterizeFills(fullSvg, width);
  // need per-pixel colors: re-rasterize with colors — simpler: draw each layer
  const outPix = new Uint8ClampedArray(width * height * 4);
  for (const l of layers) {
    const one = renderSvgFromLayers([l], new Map([[l.colorId, l.hex]]), new Map([[l.colorId, true]]), width, height, true);
    const m = rasterizeFills(one, width);
    const hex = l.hex;
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    for (let i = 0; i < m.length; i++) if (m[i]) { outPix[i*4]=r; outPix[i*4+1]=g; outPix[i*4+2]=b; outPix[i*4+3]=255; }
  }
  for (let y = 0; y < H3; y++) for (let x = 0; x < panelW; x++) {
    const sx = Math.round(x / scale), sy = Math.round(y / scale);
    const i = (sy * width + sx) * 4;
    const o = ((y * W3 + panelW + x) * 4);
    canvas.data[o] = outPix[i]; canvas.data[o+1] = outPix[i+1]; canvas.data[o+2] = outPix[i+2]; canvas.data[o+3] = 255;
  }
  // diff panel: red where they differ
  for (let y = 0; y < H3; y++) for (let x = 0; x < panelW; x++) {
    const sx = Math.round(x / scale), sy = Math.round(y / scale);
    const i = (sy * width + sx) * 4;
    const sr = imageData.data[i], sg = imageData.data[i+1], sb = imageData.data[i+2];
    const or = outPix[i], og = outPix[i+1], ob = outPix[i+2];
    const o = ((y * W3 + panelW*2 + x) * 4);
    const d = Math.abs(sr-or) + Math.abs(sg-og) + Math.abs(sb-ob);
    if (d > 90) { canvas.data[o]=255; canvas.data[o+1]=40; canvas.data[o+2]=40; }
    else { canvas.data[o]=sr; canvas.data[o+1]=sg; canvas.data[o+2]=sb; }
    canvas.data[o+3] = 255;
  }
  // encode PNG
  const Wp = W3*3, Hp = H3;
  const raw = Buffer.alloc((Wp*4+1)*Hp);
  for (let y = 0; y < Hp; y++) {
    raw[y*(Wp*4+1)] = 0;
    for (let x = 0; x < Wp; x++) {
      const i = (y*Wp+x)*4;
      raw[y*(Wp*4+1)+1+x*4] = canvas.data[i];
      raw[y*(Wp*4+1)+1+x*4+1] = canvas.data[i+1];
      raw[y*(Wp*4+1)+1+x*4+2] = canvas.data[i+2];
      raw[y*(Wp*4+1)+1+x*4+3] = canvas.data[i+3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(Wp, 0); ihdr.writeUInt32BE(Hp, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? 0 : 0);
    return Buffer.concat([len, td]);
  };
  // crc32
  const crcTable = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  const crc32 = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const mkChunk = (type, data) => {
    const td = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const idat = zlib.deflateSync(raw);
  const png = Buffer.concat([
    Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),
    mkChunk('IHDR', ihdr),
    mkChunk('IDAT', idat),
    mkChunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync('samples/compare.png', png);
  console.log('saved samples/compare.png', Wp, 'x', Hp);
}

// find green interleaving (blotch regions): where do the two greens alternate?
{
  const li = palette.findIndex(p => rgbToHex(p.r,p.g,p.b) === '#88ba3f');
  const li36 = palette.findIndex(p => rgbToHex(p.r,p.g,p.b) === '#36a14a');
  // count mixed neighborhoods: for each green pixel, other-green neighbors
  const mixed = new Map(); // region key -> mix count
  let worstX = 0, worstY = 0, worstCount = 0;
  const heat = new Float32Array(width * height);
  for (let y = 1; y < height-1; y++) for (let x = 1; x < width-1; x++) {
    const i = y*width+x;
    const c = indexed[i];
    if (c !== li && c !== li36) continue;
    let other = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const n = indexed[(y+dy)*width + (x+dx)];
      if (n !== c && (n === li || n === li36)) other++;
    }
    if (other > 0) {
      heat[i] = other;
      if (other > worstCount) { worstCount = other; worstX = x; worstY = y; }
    }
  }
  console.log('worst mixed pixel at', worstX, worstY, 'with', worstCount, 'other-green neighbors');
  // cluster the mixed pixels and find their bboxes
  const visited = new Uint8Array(width*height);
  const regions = [];
  for (let i = 0; i < width*height; i++) {
    if (heat[i] === 0 || visited[i]) continue;
    const comp = [];
    const queue = [i]; visited[i] = 1; let head = 0;
    while (head < queue.length) {
      const cur = queue[head++]; comp.push(cur);
      const cx = cur % width, cy = (cur / width) | 0;
      for (const n of [cy>0?cur-width:-1, cy<height-1?cur+width:-1, cx>0?cur-1:-1, cx<width-1?cur+1:-1])
        if (n !== -1 && !visited[n] && heat[n] > 0) { visited[n] = 1; queue.push(n); }
    }
    if (comp.length > 40) {
      let a=1e9,b=1e9,c2=-1,e2=-1;
      for (const p of comp) { const px = p%width, py = (p/width)|0; a=Math.min(a,px);b=Math.min(b,py);c2=Math.max(c2,px);e2=Math.max(e2,py); }
      regions.push({ n: comp.length, x: a, y: b, w: c2-a, h: e2-b });
    }
  }
  regions.sort((p,q) => q.n - p.n);
  console.log('mixed regions (>40px):', regions.length);
  regions.slice(0, 8).forEach(r => console.log(`  ${r.n}px at (${r.x},${r.y}) ${r.w}x${r.h}`));
}

// ASCII dump of a mixed region to see the interleaving pattern
{
  const li = palette.findIndex(p => rgbToHex(p.r,p.g,p.b) === '#88ba3f');
  const li36 = palette.findIndex(p => rgbToHex(p.r,p.g,p.b) === '#36a14a');
  const x0 = 540, y0 = 363;
  console.log('region (540,363) 40x40:');
  for (let y = y0; y < y0 + 40; y++) {
    let row = '';
    for (let x = x0; x < x0 + 40; x++) {
      const c = indexed[y*width+x];
      row += c === li ? 'L' : c === li36 ? 'D' : '.';
    }
    console.log('  ' + row);
  }
}

// small-text region: source vs output (both greens)
{
  const li = palette.findIndex(p => rgbToHex(p.r,p.g,p.b) === '#88ba3f');
  const li36 = palette.findIndex(p => rgbToHex(p.r,p.g,p.b) === '#36a14a');
  const gLayers = layers.filter(l => [li, li36].includes(parseInt(l.colorId.slice(1))));
  // rasterize both greens together with colors
  const outPix = new Uint8ClampedArray(width * height * 4);
  for (const l of gLayers) {
    const one = renderSvgFromLayers([l], new Map([[l.colorId, l.hex]]), new Map([[l.colorId, true]]), width, height, true);
    const m = rasterizeFills(one, width);
    const hex = l.hex;
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    for (let i = 0; i < m.length; i++) if (m[i]) { outPix[i*4]=r; outPix[i*4+1]=g; outPix[i*4+2]=b; outPix[i*4+3]=255; }
  }
  const x0 = 1380, y0 = 640, Wd = 380, Hd = 140;
  console.log('small text region (' + x0 + ',' + y0 + '): source (L=light D=dark .=bg)');
  for (let y = y0; y < y0 + Hd; y += 3) {
    let row = '';
    for (let x = x0; x < x0 + Wd; x += 3) {
      const c = indexed[y*width+x];
      row += c === li ? 'L' : c === li36 ? 'D' : '.';
    }
    console.log('  ' + row);
  }
  console.log('output:');
  for (let y = y0; y < y0 + Hd; y += 3) {
    let row = '';
    for (let x = x0; x < x0 + Wd; x += 3) {
      const i = (y*width+x)*4;
      const r = outPix[i], g = outPix[i+1], b = outPix[i+2];
      row += r > 100 && g > 150 && b < 120 ? 'D' : r > 100 && g > 120 && b < 130 ? 'L' : '.';
    }
    console.log('  ' + row);
  }
}

// correct-legend dump of the small text: source vs output
{
  const li = palette.findIndex(p => rgbToHex(p.r,p.g,p.b) === '#88ba3f');
  const li36 = palette.findIndex(p => rgbToHex(p.r,p.g,p.b) === '#36a14a');
  const gLayers = layers.filter(l => [li, li36].includes(parseInt(l.colorId.slice(1))));
  const outPix = new Uint8ClampedArray(width * height * 4);
  for (const l of gLayers) {
    const one = renderSvgFromLayers([l], new Map([[l.colorId, l.hex]]), new Map([[l.colorId, true]]), width, height, true);
    const m = rasterizeFills(one, width);
    const hex = l.hex;
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    for (let i = 0; i < m.length; i++) if (m[i]) { outPix[i*4]=r; outPix[i*4+1]=g; outPix[i*4+2]=b; outPix[i*4+3]=255; }
  }
  const x0 = 1380, y0 = 640, Wd = 380, Hd = 140;
  const classify = (r, g, b) => {
    // light #88ba3f = 136,186,63 | dark #36a14a = 54,161,74 | bg #010101
    if (Math.abs(r-136)<40 && Math.abs(g-186)<40 && Math.abs(b-63)<50) return 'L';
    if (Math.abs(r-54)<40 && Math.abs(g-161)<40 && Math.abs(b-74)<50) return 'D';
    return '.';
  };
  console.log('small text region source (L=light D=dark):');
  for (let y = y0; y < y0 + Hd; y += 4) {
    let row = '';
    for (let x = x0; x < x0 + Wd; x += 4) {
      const i = (y*width+x)*4;
      row += classify(imageData.data[i], imageData.data[i+1], imageData.data[i+2]);
    }
    console.log('  ' + row);
  }
  console.log('output:');
  for (let y = y0; y < y0 + Hd; y += 4) {
    let row = '';
    for (let x = x0; x < x0 + Wd; x += 4) {
      const i = (y*width+x)*4;
      row += classify(outPix[i], outPix[i+1], outPix[i+2]);
    }
    console.log('  ' + row);
  }
}
