declare module 'imagetracerjs' {
  import type { ImageTracerOptions } from '../utils/tracerOptions';

  interface TracerColor {
    r: number;
    g: number;
    b: number;
    a: number;
  }

  interface TracerSegment {
    type: 'L' | 'Q';
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    x3?: number;
    y3?: number;
  }

  interface TracerPath {
    segments: TracerSegment[];
    isholepath: boolean;
    holechildren: number[];
  }

  export interface TracerData {
    layers: TracerPath[][];
    palette: TracerColor[];
    width: number;
    height: number;
  }

  interface ImageTracerApi {
    imagedataToTracedata(
      imageData: ImageData,
      options: ImageTracerOptions
    ): TracerData;
    svgpathstring(
      tracedata: TracerData,
      layerNumber: number,
      pathNumber: number,
      options: ImageTracerOptions
    ): string;
  }

  const ImageTracer: ImageTracerApi;
  export default ImageTracer;
}
