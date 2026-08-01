import React, { useState } from 'react';
import {
  Sliders,
  Palette,
  Eye,
  EyeOff,
  RotateCcw,
  Sparkles,
  Zap,
  Check,
  Image as ImageIcon,
  Camera,
  Edit3,
  Feather,
  Layers,
  Square,
} from 'lucide-react';
import type { ColorSwatch, VectorizerOptions, PresetProfile, GeometryMode } from '../types/vectorizer';

interface ControlPanelProps {
  options: VectorizerOptions;
  onOptionsChange: (newOptions: VectorizerOptions) => void;
  swatches: ColorSwatch[];
  swatchMap: Map<string, string>;
  swatchVisibilityMap: Map<string, boolean>;
  onColorReplaced: (colorId: string, newHex: string) => void;
  onToggleSwatchVisibility: (colorId: string) => void;
  onResetColors: () => void;
  onReVectorize: () => void;
  isProcessing: boolean;
}

const PRESET_PALETTES = [
  { name: 'Original', colors: [] },
  { name: 'Monochrome', colors: ['#0f172a', '#334155', '#64748b', '#94a3b8', '#cbd5e1', '#f8fafc'] },
  { name: 'Cyberpunk', colors: ['#0f172a', '#ff007f', '#00f0ff', '#7000ff', '#ffe600', '#ffffff'] },
  { name: 'Pastel', colors: ['#ffb7b2', '#ffdac1', '#e2f0cb', '#b5ead7', '#c7ceea', '#ffffff'] },
  { name: 'Retro Arcade', colors: ['#1a1c23', '#d92525', '#f2a900', '#00a352', '#0077c8', '#f2f2f2'] },
];

export const ControlPanel: React.FC<ControlPanelProps> = ({
  options,
  onOptionsChange,
  swatches,
  swatchMap,
  swatchVisibilityMap,
  onColorReplaced,
  onToggleSwatchVisibility,
  onResetColors,
  onReVectorize,
  isProcessing,
}) => {
  const [activeTab, setActiveTab] = useState<'settings' | 'colors'>('settings');
  const [editingSwatch, setEditingSwatch] = useState<ColorSwatch | null>(null);
  const [customHexInput, setCustomHexInput] = useState<string>('#ffffff');

  const handleProfileSelect = (profile: PresetProfile) => {
    let defaultColors = options.maxColors;
    let smoothness = options.smoothness;
    let speckleFilter = options.speckleFilter;
    let engineMode = options.engineMode;
    let filterMode = options.filterMode;
    let quantizationMode = options.quantizationMode;

    if (profile === 'clipart') {
      defaultColors = 16;
      smoothness = 7;
      speckleFilter = 8;
      engineMode = 'potrace';
      filterMode = 'none';
      quantizationMode = 'dominant';
    } else if (profile === 'photo') {
      defaultColors = 16;
      smoothness = 8;
      speckleFilter = 10;
      engineMode = 'potrace';
      filterMode = 'bilateral';
      quantizationMode = 'median-cut';
    } else if (profile === 'sketch') {
      defaultColors = 4;
      smoothness = 6;
      speckleFilter = 6;
      engineMode = 'centerline';
      filterMode = 'bilateral';
      quantizationMode = 'lab-kmeans';
    } else if (profile === 'drawing') {
      defaultColors = 2;
      smoothness = 5;
      speckleFilter = 5;
      engineMode = 'potrace';
      filterMode = 'none';
      quantizationMode = 'dominant';
    }

    onOptionsChange({
      ...options,
      presetProfile: profile,
      maxColors: defaultColors,
      smoothness,
      speckleFilter,
      engineMode,
      filterMode,
      quantizationMode,
    });
  };

  const handleGeometrySelect = (mode: GeometryMode) => {
    onOptionsChange({ ...options, geometryMode: mode });
  };

  const handleMaxColorsChange = (count: number) => {
    onOptionsChange({ ...options, maxColors: count });
  };

  const handleOpenColorPicker = (swatch: ColorSwatch) => {
    const currentHex = swatchMap.get(swatch.id) || swatch.currentHex;
    setEditingSwatch(swatch);
    setCustomHexInput(currentHex);
  };

  const handleApplyColorChange = (swatchId: string, hex: string) => {
    onColorReplaced(swatchId, hex);
    setEditingSwatch(null);
  };

  const handlePresetApply = (paletteColors: string[]) => {
    if (paletteColors.length === 0) {
      onResetColors();
      return;
    }
    swatches.forEach((swatch, idx) => {
      const targetColor = paletteColors[idx % paletteColors.length];
      onColorReplaced(swatch.id, targetColor);
    });
  };

  return (
    <aside className="control-panel">
      {/* Panel Navigation Tabs */}
      <div className="panel-tabs">
        <button
          className={`panel-tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <Sliders className="tab-icon" />
          <span>Tracing Engine</span>
        </button>

        <button
          className={`panel-tab ${activeTab === 'colors' ? 'active' : ''}`}
          onClick={() => setActiveTab('colors')}
        >
          <Palette className="tab-icon" />
          <span>Colors ({swatches.length})</span>
        </button>
      </div>

      <div className="panel-body">
        {/* Tab 1: Tracing Parameters & Input Profile Routing */}
        {activeTab === 'settings' && (
          <div className="settings-tab-content">
            {/* Input Profile Selection */}
            <div className="setting-group">
              <label className="setting-label">Preset Profile</label>
              <div className="profile-grid">
                <button
                  className={`profile-card ${options.presetProfile === 'clipart' ? 'active' : ''}`}
                  onClick={() => handleProfileSelect('clipart')}
                >
                  <ImageIcon className="profile-icon" />
                  <span className="profile-title">Clipart / Logo</span>
                  <span className="profile-desc">Crisp solid colors</span>
                </button>

                <button
                  className={`profile-card ${options.presetProfile === 'photo' ? 'active' : ''}`}
                  onClick={() => handleProfileSelect('photo')}
                >
                  <Camera className="profile-icon" />
                  <span className="profile-title">Photo</span>
                  <span className="profile-desc">Rich gradients</span>
                </button>

                <button
                  className={`profile-card ${options.presetProfile === 'sketch' ? 'active' : ''}`}
                  onClick={() => handleProfileSelect('sketch')}
                >
                  <Edit3 className="profile-icon" />
                  <span className="profile-title">Sketch / Line Art</span>
                  <span className="profile-desc">Single strokes</span>
                </button>

                <button
                  className={`profile-card ${options.presetProfile === 'drawing' ? 'active' : ''}`}
                  onClick={() => handleProfileSelect('drawing')}
                >
                  <Feather className="profile-icon" />
                  <span className="profile-title">Drawing</span>
                  <span className="profile-desc">Black & White</span>
                </button>
              </div>
            </div>

            {/* Engine Selection */}
            <div className="setting-group">
              <label className="setting-label">Vectorization Engine</label>
              <div className="geometry-toggle-row">
                <button
                  className={`geo-btn ${options.engineMode === 'potrace' ? 'active' : ''}`}
                  onClick={() => onOptionsChange({ ...options, engineMode: 'potrace' })}
                >
                  <span>Potrace (SOTA)</span>
                </button>

                <button
                  className={`geo-btn ${options.engineMode === 'centerline' ? 'active' : ''}`}
                  onClick={() => onOptionsChange({ ...options, engineMode: 'centerline' })}
                >
                  <span>Centerline Stroke</span>
                </button>

                <button
                  className={`geo-btn ${options.engineMode === 'imagetracer' ? 'active' : ''}`}
                  onClick={() => onOptionsChange({ ...options, engineMode: 'imagetracer' })}
                >
                  <span>ImageTracer</span>
                </button>
              </div>
            </div>

            {/* Pre-Filter Selection */}
            <div className="setting-group">
              <label className="setting-label">Pre-Filter (Noise Reduction)</label>
              <div className="geometry-toggle-row">
                <button
                  className={`geo-btn ${options.filterMode === 'bilateral' ? 'active' : ''}`}
                  onClick={() => onOptionsChange({ ...options, filterMode: 'bilateral' })}
                >
                  <span>Bilateral (Edge Preserving)</span>
                </button>

                <button
                  className={`geo-btn ${options.filterMode === 'blur' ? 'active' : ''}`}
                  onClick={() => onOptionsChange({ ...options, filterMode: 'blur' })}
                >
                  <span>Gaussian Blur</span>
                </button>

                <button
                  className={`geo-btn ${options.filterMode === 'none' ? 'active' : ''}`}
                  onClick={() => onOptionsChange({ ...options, filterMode: 'none' })}
                >
                  <span>None (Raw)</span>
                </button>
              </div>
            </div>

            {/* Smart Upscale (Pre-Trace Resolution Boost) */}
            <div className="setting-group toggle-group">
              <div>
                <label className="setting-label">Smart Upscale</label>
                <p className="setting-desc">Upscales low-res images before tracing so curves come out smooth and clean.</p>
              </div>
              <input
                type="checkbox"
                checked={options.upscale}
                onChange={(e) => onOptionsChange({ ...options, upscale: e.target.checked })}
                className="toggle-checkbox"
              />
            </div>

            {/* Geometry Mode Selection */}
            <div className="setting-group">
              <label className="setting-label">Geometry Mode</label>
              <div className="geometry-toggle-row">
                <button
                  className={`geo-btn ${options.geometryMode === 'filled' ? 'active' : ''}`}
                  onClick={() => handleGeometrySelect('filled')}
                >
                  <Layers className="geo-icon" />
                  <span>Filled Layers</span>
                </button>

                <button
                  className={`geo-btn ${options.geometryMode === 'stroked' ? 'active' : ''}`}
                  onClick={() => handleGeometrySelect('stroked')}
                >
                  <Square className="geo-icon" />
                  <span>Stroked Outlines</span>
                </button>
              </div>
            </div>

            {/* Line Weight / Stroke Width (for centerline / stroked mode) */}
            {(options.geometryMode === 'stroked' || options.engineMode === 'centerline') && (
              <div className="setting-group">
                <div className="setting-header">
                  <label className="setting-label">Stroke Line Weight</label>
                  <span className="setting-value">{options.strokeWidth || 2} px</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="20"
                  value={options.strokeWidth || 2}
                  onChange={(e) => onOptionsChange({ ...options, strokeWidth: parseInt(e.target.value) })}
                  className="range-input"
                />
              </div>
            )}

            {/* Max Colors Slider */}
            <div className="setting-group">
              <div className="setting-header">
                <label className="setting-label">Max Colors Limit</label>
                <span className="setting-value">{options.maxColors} Colors</span>
              </div>
              <input
                type="range"
                min="2"
                max="64"
                value={options.maxColors}
                onChange={(e) => handleMaxColorsChange(parseInt(e.target.value))}
                className="range-input"
              />
              <div className="preset-color-chips">
                {[2, 4, 8, 12, 16, 32, 64].map((cnt) => (
                  <button
                    key={cnt}
                    className={`color-count-btn ${options.maxColors === cnt ? 'active' : ''}`}
                    onClick={() => handleMaxColorsChange(cnt)}
                  >
                    {cnt}
                  </button>
                ))}
              </div>
            </div>

            {/* Speckle Noise Filter (Artifact Removal) */}
            <div className="setting-group">
              <div className="setting-header">
                <label className="setting-label">
                  <Sparkles className="inline-icon highlight" /> Speckle Noise Filter
                </label>
                <span className="setting-value">{options.speckleFilter} px</span>
              </div>
              <input
                type="range"
                min="0"
                max="30"
                value={options.speckleFilter}
                onChange={(e) => onOptionsChange({ ...options, speckleFilter: parseInt(e.target.value) })}
                className="range-input"
              />
              <p className="setting-desc">
                Eliminates small isolated noise dots and compression artifacts.
              </p>
            </div>

            {/* Bezier Curve Smoothness */}
            <div className="setting-group">
              <div className="setting-header">
                <label className="setting-label">Curve Smoothness</label>
                <span className="setting-value">{options.smoothness} / 10</span>
              </div>
              <input
                type="range"
                min="0"
                max="10"
                value={options.smoothness}
                onChange={(e) => onOptionsChange({ ...options, smoothness: parseInt(e.target.value) })}
                className="range-input"
              />
              <p className="setting-desc">
                Controls Bezier curve tension; lower values keep sharp logo corners.
              </p>
            </div>

            {/* Path Overlap (Zero Gap Slivers) */}
            <div className="setting-group toggle-group">
              <div>
                <label className="setting-label">Gap-Free Shape Overlap</label>
                <p className="setting-desc">Adds micro-stroke overlap to prevent sub-pixel white slivers.</p>
              </div>
              <input
                type="checkbox"
                checked={options.pathOverlap}
                onChange={(e) => onOptionsChange({ ...options, pathOverlap: e.target.checked })}
                className="toggle-checkbox"
              />
            </div>

            <button
              onClick={onReVectorize}
              className="btn btn-primary full-width glow-accent"
              disabled={isProcessing}
            >
              <Zap className="btn-icon" />
              <span>{isProcessing ? 'Processing...' : 'Re-Vectorize Image'}</span>
            </button>
          </div>
        )}


        {/* Tab 2: Colors & Live Color Replacement */}
        {activeTab === 'colors' && (
          <div className="colors-tab-content">
            <div className="section-header-row">
              <span className="section-title">
                <Palette className="inline-icon" /> Color Palette Replacement
              </span>
              <button onClick={onResetColors} className="btn-text-icon" title="Reset to Original Colors">
                <RotateCcw className="mini-icon" /> Reset
              </button>
            </div>

            <p className="section-hint">
              Click any color swatch to pick a replacement color. Changes render in real-time!
            </p>

            {/* Swatches Grid */}
            <div className="swatches-grid">
              {swatches.map((swatch) => {
                const currentHex = swatchMap.get(swatch.id) || swatch.currentHex;
                const isVisible = swatchVisibilityMap.get(swatch.id) ?? true;
                const isReplaced = currentHex.toLowerCase() !== swatch.originalHex.toLowerCase();

                return (
                  <div
                    key={swatch.id}
                    className={`swatch-card ${!isVisible ? 'hidden-layer' : ''}`}
                  >
                    <div
                      className="swatch-color-box"
                      style={{ backgroundColor: currentHex }}
                      onClick={() => handleOpenColorPicker(swatch)}
                      title="Click to pick replacement color"
                    >
                      {isReplaced && <span className="replaced-indicator">•</span>}
                    </div>

                    <div className="swatch-details" onClick={() => handleOpenColorPicker(swatch)}>
                      <span className="swatch-hex">{currentHex.toUpperCase()}</span>
                      <span className="swatch-pct">{swatch.percentage}%</span>
                    </div>

                    <button
                      className="swatch-vis-btn"
                      onClick={() => onToggleSwatchVisibility(swatch.id)}
                      title={isVisible ? 'Hide layer' : 'Show layer'}
                    >
                      {isVisible ? <Eye className="vis-icon" /> : <EyeOff className="vis-icon off" />}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Color Preset Palette Quick Selection */}
            <div className="presets-section">
              <span className="preset-label">Apply Preset Palette:</span>
              <div className="preset-chips">
                {PRESET_PALETTES.map((preset) => (
                  <button
                    key={preset.name}
                    className="preset-chip"
                    onClick={() => handlePresetApply(preset.colors)}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Color Picker Popover Modal */}
      {editingSwatch && (
        <div className="modal-backdrop" onClick={() => setEditingSwatch(null)}>
          <div className="color-picker-dialog" onClick={(e) => e.stopPropagation()}>
            <h4 className="picker-title">Pick Replacement Color</h4>

            <div className="picker-preview-row">
              <div className="color-compare-box">
                <span className="compare-label">Original</span>
                <div
                  className="compare-swatch"
                  style={{ backgroundColor: editingSwatch.originalHex }}
                />
              </div>

              <div className="color-compare-box">
                <span className="compare-label">New Color</span>
                <div
                  className="compare-swatch"
                  style={{ backgroundColor: customHexInput }}
                />
              </div>
            </div>

            <div className="native-color-picker-row">
              <input
                type="color"
                value={customHexInput}
                onChange={(e) => setCustomHexInput(e.target.value)}
                className="color-wheel-input"
              />
              <input
                type="text"
                value={customHexInput}
                onChange={(e) => setCustomHexInput(e.target.value)}
                className="hex-text-input"
                maxLength={7}
              />
            </div>

            <div className="quick-palette-grid">
              {[
                '#000000', '#ffffff', '#ef4444', '#f97316', '#f59e0b',
                '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
                '#ec4899', '#f43f5e', '#1e293b', '#64748b', '#cbd5e1'
              ].map((hex) => (
                <button
                  key={hex}
                  className="quick-color-btn"
                  style={{ backgroundColor: hex }}
                  onClick={() => setCustomHexInput(hex)}
                />
              ))}
            </div>

            <div className="dialog-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setEditingSwatch(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => handleApplyColorChange(editingSwatch.id, customHexInput)}
              >
                <Check className="btn-icon" /> Apply Color
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
