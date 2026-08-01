export type ComparisonMode = 'split' | 'side-by-side' | 'overlay' | 'vector-only' | 'raster-only' | 'diff';

export type PresetProfile = 'clipart' | 'photo' | 'sketch' | 'drawing';
export type GeometryMode = 'filled' | 'stroked';
export type EngineMode = 'potrace' | 'imagetracer' | 'centerline';
export type FilterMode = 'bilateral' | 'blur' | 'none';
export type QuantizationMode = 'lab-kmeans' | 'dominant' | 'median-cut';

export interface VectorizerOptions {
  presetProfile: PresetProfile;   // 'clipart' | 'photo' | 'sketch' | 'drawing'
  geometryMode: GeometryMode;     // 'filled' | 'stroked'
  engineMode: EngineMode;         // 'potrace' (SOTA Geometric) | 'imagetracer' | 'centerline' (Stroke Skeleton)
  filterMode: FilterMode;         // 'bilateral' (Edge-Preserving) | 'blur' | 'none'
  quantizationMode: QuantizationMode; // 'dominant' | 'lab-kmeans' | 'median-cut'
  maxColors: number;             // 2 - 64
  speckleFilter: number;         // 0 - 50 px (removes isolated artifact pixels)
  smoothness: number;            // 0 - 10 scale (Bezier curve smoothing)
  cornerThreshold: number;       // 0 - 180 degrees (corner detection threshold)
  pathOverlap: boolean;          // Adds micro stroke/expansion to prevent white gap slivers
  upscale: boolean;              // Smart upscale small images before tracing (crisper curves, better contours)
  upscaleMinDimension: number;   // Target minimum dimension in px after smart upscale (e.g. 1024)
  blurRadius: number;            // 0 - 5 px (pre-process noise filter)
  minColorAreaRatio: number;     // 0 - 0.05 (filters negligible noise colors)
  strokeWidth: number;           // 1 - 20 px (for centerline / stroked mode)
}

export interface ColorSwatch {
  id: string;
  originalHex: string;
  currentHex: string;
  percentage: number;
  pixelCount: number;
  visible: boolean;
}

export interface ColorLayer {
  colorId: string;
  hex: string;
  svgPaths: string[];
}

export interface VectorizerResult {
  svgString: string;
  layers: ColorLayer[];
  swatches: ColorSwatch[];
  width: number;
  height: number;
  processingTimeMs: number;
  totalPaths: number;
}

export interface SampleImage {
  id: string;
  name: string;
  description: string;
  category: string;
  url: string;
  recommendedColors: number;
}

