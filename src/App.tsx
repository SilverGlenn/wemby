import React, { useState, useCallback, useMemo } from 'react';
import { Header } from './components/Header';
import { DropZone } from './components/DropZone';
import { ComparisonCanvas } from './components/ComparisonCanvas';
import { ControlPanel } from './components/ControlPanel';
import { ExportModal } from './components/ExportModal';
import type {
  ComparisonMode,
  VectorizerOptions,
  VectorizerResult,
  SampleImage,
} from './types/vectorizer';
import { vectorizeImage, renderSvgFromLayers } from './utils/vectorizerEngine';
import { SAMPLE_IMAGES } from './utils/sampleImages';
import './App.css';

const DEFAULT_OPTIONS: VectorizerOptions = {
  presetProfile: 'clipart',
  geometryMode: 'filled',
  engineMode: 'potrace',
  filterMode: 'none',
  quantizationMode: 'dominant',
  maxColors: 16,
  speckleFilter: 8,
  smoothness: 7,
  cornerThreshold: 35,
  pathOverlap: true,
  upscale: true,
  upscaleMinDimension: 1024,
  blurRadius: 0,
  minColorAreaRatio: 0.0005,
  strokeWidth: 2,
};

export const App: React.FC = () => {
  const [originalImg, setOriginalImg] = useState<HTMLImageElement | null>(null);
  const [filename, setFilename] = useState<string>('vector_graphic');
  const [options, setOptions] = useState<VectorizerOptions>(DEFAULT_OPTIONS);
  const [result, setResult] = useState<VectorizerResult | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>('split');
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isSampleModalOpen, setIsSampleModalOpen] = useState<boolean>(false);

  // Swatch Replacements state maps
  const [swatchMap, setSwatchMap] = useState<Map<string, string>>(new Map());
  const [swatchVisibilityMap, setSwatchVisibilityMap] = useState<Map<string, boolean>>(new Map());

  // Run vectorization process
  const processImage = useCallback(
    async (img: HTMLImageElement, opts: VectorizerOptions) => {
      setIsProcessing(true);
      try {
        const res = await vectorizeImage(img, opts);
        setResult(res);

        // Reset color maps for new vector result
        const initialSwatchMap = new Map<string, string>();
        const initialVisMap = new Map<string, boolean>();
        res.swatches.forEach((s) => {
          initialSwatchMap.set(s.id, s.originalHex);
          initialVisMap.set(s.id, true);
        });
        setSwatchMap(initialSwatchMap);
        setSwatchVisibilityMap(initialVisMap);
      } catch (err) {
        console.error('Vectorization Error:', err);
        alert(`Vectorization error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIsProcessing(false);
      }
    },
    []
  );

  const handleImageSelected = (img: HTMLImageElement, name: string) => {
    setOriginalImg(img);
    setFilename(name);
    processImage(img, options);
  };

  const handleReVectorize = () => {
    if (originalImg) {
      processImage(originalImg, options);
    }
  };

  // Real-time live SVG recoloring when swatch colors or visibilities change
  const updatedSvgString = useMemo(() => {
    if (!result) return '';
    return renderSvgFromLayers(
      result.layers,
      swatchMap,
      swatchVisibilityMap,
      result.width,
      result.height,
      options.pathOverlap,
      options.geometryMode,
      options.strokeWidth
    );
  }, [result, swatchMap, swatchVisibilityMap, options.pathOverlap, options.geometryMode, options.strokeWidth]);


  // Combined result with live recolored SVG
  const liveResult = useMemo(() => {
    if (!result) return null;
    return {
      ...result,
      svgString: updatedSvgString,
    };
  }, [result, updatedSvgString]);

  const handleColorReplaced = (colorId: string, newHex: string) => {
    setSwatchMap((prev) => {
      const next = new Map(prev);
      next.set(colorId, newHex);
      return next;
    });
  };

  const handleToggleSwatchVisibility = (colorId: string) => {
    setSwatchVisibilityMap((prev) => {
      const next = new Map(prev);
      const curr = next.get(colorId) ?? true;
      next.set(colorId, !curr);
      return next;
    });
  };

  const handleResetColors = () => {
    if (!result) return;
    const resetMap = new Map<string, string>();
    const resetVisMap = new Map<string, boolean>();
    result.swatches.forEach((s) => {
      resetMap.set(s.id, s.originalHex);
      resetVisMap.set(s.id, true);
    });
    setSwatchMap(resetMap);
    setSwatchVisibilityMap(resetVisMap);
  };

  const handleReset = () => {
    setOriginalImg(null);
    setResult(null);
  };

  const handleSampleSelected = (sample: SampleImage) => {
    const img = new Image();
    img.onload = () => {
      setOptions((prev) => ({ ...prev, maxColors: sample.recommendedColors }));
      handleImageSelected(img, `${sample.name}.png`);
      setIsSampleModalOpen(false);
    };
    img.src = sample.url;
  };

  return (
    <div className="app-container">
      <Header
        result={liveResult}
        isProcessing={isProcessing}
        onOpenExportModal={() => setIsExportModalOpen(true)}
        onReset={handleReset}
        onOpenSampleModal={() => setIsSampleModalOpen(true)}
      />

      <main className="main-layout">
        {isProcessing && (
          <div className="processing-overlay">
            <div className="spinner-ring"></div>
            <span className="processing-text">Vectorizing Image & Extracting Palette...</span>
          </div>
        )}
        {!originalImg || !liveResult || !result ? (
          <DropZone onImageSelected={handleImageSelected} />
        ) : (
          <div className="workspace-grid">
            <ComparisonCanvas
              originalImg={originalImg}
              result={liveResult}
              mode={comparisonMode}
              onModeChange={setComparisonMode}
            />

            <ControlPanel
              options={options}
              onOptionsChange={setOptions}
              swatches={result.swatches}
              swatchMap={swatchMap}
              swatchVisibilityMap={swatchVisibilityMap}
              onColorReplaced={handleColorReplaced}
              onToggleSwatchVisibility={handleToggleSwatchVisibility}
              onResetColors={handleResetColors}
              onReVectorize={handleReVectorize}
              isProcessing={isProcessing}
            />
          </div>
        )}
      </main>

      {/* Export Dialog */}
      {isExportModalOpen && liveResult && (
        <ExportModal
          result={liveResult}
          filename={filename}
          onClose={() => setIsExportModalOpen(false)}
        />
      )}

      {/* Sample Images Modal */}
      {isSampleModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsSampleModalOpen(false)}>
          <div className="sample-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-heading">Select Sample Artwork</h3>
            <p className="modal-subtext">Click any sample image below to vectorize instantly.</p>
            <div className="samples-grid">
              {SAMPLE_IMAGES.map((sample) => (
                <div
                  key={sample.id}
                  className="sample-card"
                  onClick={() => handleSampleSelected(sample)}
                >
                  <div className="sample-preview">
                    <img src={sample.url} alt={sample.name} />
                  </div>
                  <div className="sample-info">
                    <span className="sample-name">{sample.name}</span>
                    <span className="sample-category">{sample.category}</span>
                  </div>
                </div>
              ))}
            </div>
            <button className="btn btn-secondary close-modal-btn" onClick={() => setIsSampleModalOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
