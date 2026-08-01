import React, { useState, useRef, useEffect } from 'react';
import {
  Columns,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Eye,
  Sliders,
  Layers,
  Sparkles,
} from 'lucide-react';
import type { ComparisonMode, VectorizerResult } from '../types/vectorizer';

interface ComparisonCanvasProps {
  originalImg: HTMLImageElement;
  result: VectorizerResult;
  mode: ComparisonMode;
  onModeChange: (mode: ComparisonMode) => void;
  onSelectColorFromCanvas?: (hex: string) => void;
}

export const ComparisonCanvas: React.FC<ComparisonCanvasProps> = ({
  originalImg,
  result,
  mode,
  onModeChange,
  onSelectColorFromCanvas,
}) => {
  const [splitPos, setSplitPos] = useState<number>(50); // 0 to 100 percentage
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [startPan, setStartPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [overlayOpacity, setOverlayOpacity] = useState<number>(0.5);
  const [isEyedropperActive, setIsEyedropperActive] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const splitSliderRef = useRef<HTMLDivElement>(null);
  const isDraggingSplitRef = useRef<boolean>(false);

  // Reset zoom & pan when image changes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [result.width, result.height]);

  // Handle Split Curtain Drag
  const handleSplitMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingSplitRef.current = true;
    window.addEventListener('mousemove', handleSplitMouseMove);
    window.addEventListener('mouseup', handleSplitMouseUp);
  };

  const handleSplitMouseMove = (e: MouseEvent) => {
    if (!isDraggingSplitRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const newPos = (x / rect.width) * 100;
    setSplitPos(newPos);
  };

  const handleSplitMouseUp = () => {
    isDraggingSplitRef.current = false;
    window.removeEventListener('mousemove', handleSplitMouseMove);
    window.removeEventListener('mouseup', handleSplitMouseUp);
  };

  // Handle Pan & Zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    const newZoom = Math.max(0.2, Math.min(10, zoom * zoomFactor));
    setZoom(newZoom);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isDraggingSplitRef.current) return;
    if (isEyedropperActive && onSelectColorFromCanvas) {
      sampleColorAtPoint(e);
      return;
    }
    setIsPanning(true);
    setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    setPan({ x: e.clientX - startPan.x, y: e.clientY - startPan.y });
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  const sampleColorAtPoint = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = result.width;
    canvas.height = result.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(originalImg, 0, 0, result.width, result.height);
    
    const rect = containerRef.current.getBoundingClientRect();
    const clickX = (e.clientX - rect.left - pan.x) / zoom;
    const clickY = (e.clientY - rect.top - pan.y) / zoom;

    const pixelX = Math.max(0, Math.min(Math.floor(clickX), result.width - 1));
    const pixelY = Math.max(0, Math.min(Math.floor(clickY), result.height - 1));

    const pixelData = ctx.getImageData(pixelX, pixelY, 1, 1).data;
    const toHex = (n: number) => n.toString(16).padStart(2, '0');
    const hex = `#${toHex(pixelData[0])}${toHex(pixelData[1])}${toHex(pixelData[2])}`;
    
    if (onSelectColorFromCanvas) {
      onSelectColorFromCanvas(hex);
    }
    setIsEyedropperActive(false);
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSplitPos(50);
  };

  return (
    <div className="canvas-workspace">
      {/* Viewport Control Bar */}
      <div className="canvas-toolbar">
        <div className="mode-toggle-group">
          <button
            className={`mode-btn ${mode === 'split' ? 'active' : ''}`}
            onClick={() => onModeChange('split')}
            title="Split curtain comparison"
          >
            <Columns className="mode-icon" />
            <span>Split Curtain</span>
          </button>

          <button
            className={`mode-btn ${mode === 'side-by-side' ? 'active' : ''}`}
            onClick={() => onModeChange('side-by-side')}
            title="Side-by-side dual sync view"
          >
            <Maximize2 className="mode-icon" />
            <span>Side-by-Side</span>
          </button>

          <button
            className={`mode-btn ${mode === 'overlay' ? 'active' : ''}`}
            onClick={() => onModeChange('overlay')}
            title="Fade overlay comparison"
          >
            <Eye className="mode-icon" />
            <span>Overlay Fade</span>
          </button>

          <button
            className={`mode-btn ${mode === 'vector-only' ? 'active' : ''}`}
            onClick={() => onModeChange('vector-only')}
            title="Vector SVG only"
          >
            <Layers className="mode-icon" />
            <span>Vector SVG</span>
          </button>

          <button
            className={`mode-btn ${mode === 'diff' ? 'active' : ''}`}
            onClick={() => onModeChange('diff')}
            title="Highlight differences / artifacts"
          >
            <Sparkles className="mode-icon" />
            <span>Diff Heatmap</span>
          </button>
        </div>

        <div className="toolbar-controls-right">
          {mode === 'overlay' && (
            <div className="opacity-slider-container">
              <span className="slider-label">Opacity: {Math.round(overlayOpacity * 100)}%</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={overlayOpacity}
                onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))}
                className="range-input"
              />
            </div>
          )}

          <div className="zoom-controls">
            <button onClick={() => setZoom((z) => Math.max(0.2, z - 0.2))} title="Zoom Out" className="icon-btn">
              <ZoomOut />
            </button>

            <span className="zoom-label">{Math.round(zoom * 100)}%</span>

            <button onClick={() => setZoom((z) => Math.min(10, z + 0.2))} title="Zoom In" className="icon-btn">
              <ZoomIn />
            </button>

            <button onClick={resetView} title="Reset View" className="icon-btn">
              <RotateCcw />
            </button>
          </div>
        </div>
      </div>

      {/* Main Canvas Viewport Area */}
      <div
        ref={containerRef}
        className={`canvas-container ${isPanning ? 'panning' : ''} ${isEyedropperActive ? 'eyedropper-cursor' : ''}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div
          className="canvas-content-wrapper"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
          {/* Mode 1: Split Screen Curtain */}
          {mode === 'split' && (
            <div className="split-view-container" style={{ width: result.width, height: result.height }}>
              {/* Raster Left Layer */}
              <div
                className="split-layer raster-layer"
                style={{ clipPath: `inset(0 ${100 - splitPos}% 0 0)` }}
              >
                <img src={originalImg.src} alt="Original Raster" className="render-image" />
                <div className="watermark-tag raster-tag">Original Raster</div>
              </div>

              {/* Vector Right Layer */}
              <div
                className="split-layer vector-layer"
                style={{ clipPath: `inset(0 0 0 ${splitPos}%)` }}
              >
                <div
                  className="svg-render-container"
                  dangerouslySetInnerHTML={{ __html: result.svgString }}
                />
                <div className="watermark-tag vector-tag">Vectorized SVG</div>
              </div>

              {/* Interactive Divider Line & Handle */}
              <div
                ref={splitSliderRef}
                className="split-divider"
                style={{ left: `${splitPos}%` }}
                onMouseDown={handleSplitMouseDown}
              >
                <div className="split-handle">
                  <Sliders className="handle-icon" />
                </div>
              </div>
            </div>
          )}

          {/* Mode 2: Side-by-Side Dual View */}
          {mode === 'side-by-side' && (
            <div className="side-by-side-container">
              <div className="side-box">
                <div className="side-header">Original Raster</div>
                <img src={originalImg.src} alt="Original" style={{ width: result.width, height: result.height }} />
              </div>
              <div className="side-box">
                <div className="side-header">Vectorized SVG</div>
                <div
                  style={{ width: result.width, height: result.height }}
                  dangerouslySetInnerHTML={{ __html: result.svgString }}
                />
              </div>
            </div>
          )}

          {/* Mode 3: Overlay Fade */}
          {mode === 'overlay' && (
            <div className="overlay-view-container" style={{ width: result.width, height: result.height }}>
              <img src={originalImg.src} alt="Original" className="render-image" />
              <div
                className="svg-overlay-layer"
                style={{ opacity: overlayOpacity }}
                dangerouslySetInnerHTML={{ __html: result.svgString }}
              />
            </div>
          )}

          {/* Mode 4: Vector Only */}
          {mode === 'vector-only' && (
            <div
              className="vector-only-container"
              style={{ width: result.width, height: result.height }}
              dangerouslySetInnerHTML={{ __html: result.svgString }}
            />
          )}

          {/* Mode 5: Diff / Artifact Heatmap */}
          {mode === 'diff' && (
            <div className="diff-view-container" style={{ width: result.width, height: result.height }}>
              <img src={originalImg.src} alt="Original" className="diff-bg" />
              <div
                className="diff-vector-fg"
                dangerouslySetInnerHTML={{ __html: result.svgString }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
