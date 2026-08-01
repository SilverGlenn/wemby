import ImageTracer from 'imagetracerjs';
import type { VectorizerOptions, VectorizerResult, ColorLayer, ColorSwatch } from '../types/vectorizer.ts';
import { createTracerOptions } from './tracerOptions.ts';
import { rgbToHex } from './colorUtils.ts';

/**
 * ImageTracerJS Engine Wrapper.
 * Converts ImageData / HTMLCanvasElement using imagetracerjs with custom color palette tuning.
 */
export async function vectorizeWithImageTracerEngine(
  canvas: HTMLCanvasElement,
  options: VectorizerOptions
): Promise<VectorizerResult> {
  const startTime = performance.now();
  const width = canvas.width;
  const height = canvas.height;

  const tracerOptions = createTracerOptions(options);

  // Run ImageTracer.imagedataToSVG
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const imgData = ctx.getImageData(0, 0, width, height);

  const tracer = ImageTracer as unknown as {
    imagedataToSVG: (data: ImageData, options?: unknown) => string;
    imagedataToTracedata: (data: ImageData, options?: unknown) => { palette?: Array<{ r: number; g: number; b: number; a: number }>; layers?: unknown };
  };

  const svgString = tracer.imagedataToSVG(imgData, tracerOptions);

  // Extract swatches and layers from ImageTracer SVG data
  const tracerData = tracer.imagedataToTracedata(imgData, tracerOptions);

  const swatches: ColorSwatch[] = [];
  const layers: ColorLayer[] = [];
  let totalPaths = 0;

  if (tracerData && tracerData.palette) {
    const palette = tracerData.palette;
    const layersData = (tracerData.layers || []) as Array<Array<Array<{ type: string; x1: number; y1: number; x2?: number; y2?: number; x3?: number; y3?: number }>>>;


    const totalPixels = width * height;

    palette.forEach((color, idx) => {
      const hex = rgbToHex(color.r, color.g, color.b);
      const colorId = `color-${idx}`;
      const layerPaths = layersData[idx] || [];

      // Calculate path count
      totalPaths += layerPaths.length;

      swatches.push({
        id: colorId,
        originalHex: hex,
        currentHex: hex,
        percentage: Number(((layerPaths.length / (totalPaths || 1)) * 100).toFixed(2)),
        pixelCount: Math.round(totalPixels / palette.length),
        visible: true,
      });

      // Format layer paths as SVG path data. ImageTracer v1.2.6's tracedata
      // uses path OBJECTS with a .segments array (not bare node arrays).
      const svgPaths: string[] = [];
      layerPaths.forEach((pathObj) => {
        const pathNodes = (pathObj && pathObj.segments) || [];
        if (pathNodes.length === 0) return;
        let d = `M ${pathNodes[0].x1} ${pathNodes[0].y1}`;
        pathNodes.forEach((node) => {
          if (node.type === 'L') {
            d += ` L ${node.x2} ${node.y2}`;
          } else if (node.type === 'Q' && node.x3 !== undefined && node.y3 !== undefined) {
            d += ` Q ${node.x2} ${node.y2} ${node.x3} ${node.y3}`;
          }
        });
        d += ' Z';
        svgPaths.push(d);
      });

      layers.push({
        colorId,
        hex,
        svgPaths,
      });
    });
  }

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
