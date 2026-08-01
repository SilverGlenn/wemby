import React from 'react';
import { Sparkles, Download, RefreshCw, Layers, Image as ImageIcon } from 'lucide-react';
import type { VectorizerResult } from '../types/vectorizer';

interface HeaderProps {
  result: VectorizerResult | null;
  isProcessing: boolean;
  onOpenExportModal: () => void;
  onReset: () => void;
  onOpenSampleModal: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  result,
  isProcessing,
  onOpenExportModal,
  onReset,
  onOpenSampleModal,
}) => {
  return (
    <header className="header-container">
      <div className="header-left">
        <div className="brand-logo">
          <Sparkles className="brand-icon" />
          <span className="brand-text">Vector<span className="brand-highlight">Wemby</span></span>
        </div>
        <span className="brand-badge">Pro Vectorizer</span>
      </div>

      <div className="header-center">
        {result && (
          <div className="status-pill">
            <Layers className="status-icon" />
            <span>{result.swatches.length} Colors</span>
            <span className="dot-divider">•</span>
            <span>{result.totalPaths} Paths</span>
            <span className="dot-divider">•</span>
            <span>{result.processingTimeMs}ms</span>
          </div>
        )}
      </div>

      <div className="header-right">
        <button
          onClick={onOpenSampleModal}
          className="btn btn-secondary"
          title="Try Sample Images"
        >
          <ImageIcon className="btn-icon" />
          <span>Samples</span>
        </button>

        {result && (
          <>
            <button
              onClick={onReset}
              className="btn btn-secondary"
              title="Reset Image"
              disabled={isProcessing}
            >
              <RefreshCw className="btn-icon" />
              <span>New</span>
            </button>

            <button
              onClick={onOpenExportModal}
              className="btn btn-primary glow-accent"
              title="Export SVG File or Copy Code"
            >
              <Download className="btn-icon" />
              <span>Export SVG</span>
            </button>
          </>
        )}
      </div>
    </header>
  );
};
