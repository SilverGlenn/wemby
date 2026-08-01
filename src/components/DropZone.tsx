import React, { useState, useRef, useEffect } from 'react';
import { Upload, Image as ImageIcon, Sparkles, FileImage, ShieldCheck } from 'lucide-react';
import { SAMPLE_IMAGES } from '../utils/sampleImages';
import type { SampleImage } from '../types/vectorizer';

interface DropZoneProps {
  onImageSelected: (img: HTMLImageElement, filename: string) => void;
}

export const DropZone: React.FC<DropZoneProps> = ({ onImageSelected }) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/') && !file.name.endsWith('.svg')) {
      alert('Please upload a valid image file (PNG, JPG, WEBP, GIF, BMP, SVG).');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        onImageSelected(img, file.name);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleSampleClick = (sample: SampleImage) => {
    const img = new Image();
    img.onload = () => {
      onImageSelected(img, `${sample.name}.png`);
    };
    img.src = sample.url;
  };

  // Support pasting image from clipboard
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (e.clipboardData?.files.length) {
        const file = e.clipboardData.files[0];
        if (file.type.startsWith('image/')) {
          handleFile(file);
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  return (
    <div className="dropzone-wrapper">
      <div
        className={`dropzone-card ${isDragging ? 'dragging' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          type="file"
          ref={fileInputRef}
          className="hidden-file-input"
          accept="image/*,.svg"
          onChange={(e) => {
            if (e.target.files?.length) {
              handleFile(e.target.files[0]);
            }
          }}
        />

        <div className="dropzone-icon-circle">
          <Upload className="dropzone-upload-icon" />
        </div>

        <h2 className="dropzone-title">Drop your image here or click to browse</h2>
        <p className="dropzone-subtitle">
          Supports PNG, JPG, WEBP, GIF, BMP & SVG (Paste with Ctrl+V)
        </p>

        <div className="feature-tags">
          <div className="tag">
            <ShieldCheck className="tag-icon" /> Zero White-Gap Slivers
          </div>
          <div className="tag">
            <Sparkles className="tag-icon" /> Speckle Noise Filter
          </div>
          <div className="tag">
            <FileImage className="tag-icon" /> 2-64 Custom Colors
          </div>
        </div>
      </div>

      <div className="samples-section">
        <h3 className="samples-title">
          <ImageIcon className="samples-title-icon" /> Or try with instant sample artwork
        </h3>
        <div className="samples-grid">
          {SAMPLE_IMAGES.map((sample) => (
            <div
              key={sample.id}
              className="sample-card"
              onClick={() => handleSampleClick(sample)}
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
      </div>
    </div>
  );
};
