import React, { useState } from 'react';
import { Download, Copy, X, FileCode, Code, CheckCircle } from 'lucide-react';
import type { VectorizerResult } from '../types/vectorizer';

interface ExportModalProps {
  result: VectorizerResult;
  filename: string;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ result, filename, onClose }) => {
  const [copied, setCopied] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'svg' | 'code'>('svg');

  const baseName = filename.replace(/\.[^/.]+$/, '') || 'vectorized_image';

  const handleDownloadSvg = () => {
    const blob = new Blob([result.svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${baseName}_vectorized.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(result.svgString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="export-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="export-dialog-header">
          <div className="dialog-title-wrapper">
            <FileCode className="dialog-icon" />
            <h3 className="dialog-title">Export Vector Graphic</h3>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X />
          </button>
        </div>

        <div className="export-dialog-tabs">
          <button
            className={`dialog-tab ${activeTab === 'svg' ? 'active' : ''}`}
            onClick={() => setActiveTab('svg')}
          >
            <Download className="tab-icon" /> SVG Preview
          </button>
          <button
            className={`dialog-tab ${activeTab === 'code' ? 'active' : ''}`}
            onClick={() => setActiveTab('code')}
          >
            <Code className="tab-icon" /> Raw SVG Code
          </button>
        </div>

        <div className="export-dialog-body">
          {activeTab === 'svg' ? (
            <div className="export-preview-box">
              <div
                className="svg-display-wrapper"
                dangerouslySetInnerHTML={{ __html: result.svgString }}
              />
              <div className="export-meta-info">
                <span>Dimensions: {result.width} × {result.height} px</span>
                <span>Total Layers: {result.layers.length}</span>
                <span>Total Paths: {result.totalPaths}</span>
              </div>
            </div>
          ) : (
            <div className="code-viewer-container">
              <pre className="code-block">
                <code>{result.svgString}</code>
              </pre>
            </div>
          )}
        </div>

        <div className="export-dialog-footer">
          <button className="btn btn-secondary" onClick={handleCopyCode}>
            {copied ? <CheckCircle className="btn-icon success" /> : <Copy className="btn-icon" />}
            <span>{copied ? 'Copied SVG Code!' : 'Copy Code'}</span>
          </button>

          <button className="btn btn-primary glow-accent" onClick={handleDownloadSvg}>
            <Download className="btn-icon" />
            <span>Download SVG (.svg)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
