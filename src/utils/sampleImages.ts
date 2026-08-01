import type { SampleImage } from '../types/vectorizer';

// Generate SVG data URLs for instant high-quality sample testing
const generateSampleSvgDataUrl = (type: 'mascot' | 'geometric' | 'badge' | 'landscape'): string => {
  let svgContent = '';

  if (type === 'mascot') {
    svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
      <rect width="600" height="600" fill="#0f172a"/>
      <circle cx="300" cy="300" r="220" fill="#3b82f6"/>
      <circle cx="300" cy="300" r="180" fill="#1e293b"/>
      <!-- Robot Head -->
      <rect x="180" y="200" width="240" height="180" rx="30" fill="#38bdf8"/>
      <rect x="200" y="220" width="200" height="140" rx="20" fill="#090d16"/>
      <!-- Glowing Eyes -->
      <circle cx="250" cy="275" r="30" fill="#22d3ee"/>
      <circle cx="250" cy="275" r="15" fill="#ffffff"/>
      <circle cx="350" cy="275" r="30" fill="#818cf8"/>
      <circle cx="350" cy="275" r="15" fill="#ffffff"/>
      <!-- Mouth -->
      <rect x="240" y="320" width="120" height="15" rx="7" fill="#f43f5e"/>
      <!-- Antenna -->
      <line x1="300" y1="200" x2="300" y2="130" stroke="#38bdf8" stroke-width="12" stroke-linecap="round"/>
      <circle cx="300" cy="120" r="22" fill="#fbbf24"/>
      <!-- Decorative Cheeks -->
      <circle cx="225" cy="310" r="12" fill="#f472b6" opacity="0.8"/>
      <circle cx="375" cy="310" r="12" fill="#f472b6" opacity="0.8"/>
    </svg>`;
  } else if (type === 'geometric') {
    svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
      <rect width="600" height="600" fill="#18181b"/>
      <!-- Hexagon Cluster -->
      <polygon points="300,80 450,166 450,334 300,420 150,334 150,166" fill="#ec4899"/>
      <polygon points="300,120 410,183 410,317 300,380 190,317 190,183" fill="#8b5cf6"/>
      <polygon points="300,160 370,200 370,300 300,340 230,300 230,200" fill="#06b6d4"/>
      <polygon points="300,200 330,217 330,283 300,300 270,283 270,217" fill="#10b981"/>
      <circle cx="300" cy="250" r="25" fill="#fbbf24"/>
      <!-- Accent Triangles -->
      <polygon points="100,100 180,100 140,170" fill="#f97316"/>
      <polygon points="500,100 420,100 460,170" fill="#a855f7"/>
      <polygon points="100,500 180,500 140,430" fill="#3b82f6"/>
      <polygon points="500,500 420,500 460,430" fill="#14b8a6"/>
    </svg>`;
  } else if (type === 'badge') {
    svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
      <rect width="600" height="600" fill="#020617"/>
      <circle cx="300" cy="300" r="240" fill="#dc2626"/>
      <circle cx="300" cy="300" r="210" fill="#ffffff"/>
      <circle cx="300" cy="300" r="180" fill="#0284c7"/>
      <!-- Star -->
      <polygon points="300,150 335,240 430,240 355,295 385,385 300,330 215,385 245,295 170,240 265,240" fill="#facc15"/>
      <circle cx="300" cy="300" r="45" fill="#0f172a"/>
    </svg>`;
  } else {
    // Landscape
    svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
      <rect width="600" height="600" fill="#0f172a"/>
      <!-- Sun -->
      <circle cx="300" cy="220" r="90" fill="#fb923c"/>
      <!-- Mountains -->
      <polygon points="0,600 180,280 380,600" fill="#1e1b4b"/>
      <polygon points="120,600 350,220 580,600" fill="#312e81"/>
      <polygon points="300,600 480,320 600,600" fill="#4338ca"/>
      <!-- Foreground Waves -->
      <path d="M0 480 Q 150 430, 300 480 T 600 480 L 600 600 L 0 600 Z" fill="#06b6d4"/>
      <path d="M0 530 Q 150 490, 300 530 T 600 530 L 600 600 L 0 600 Z" fill="#0891b2"/>
    </svg>`;
  }

  return 'data:image/svg+xml;base64,' + btoa(svgContent);
};

export const SAMPLE_IMAGES: SampleImage[] = [
  {
    id: 'cyber-bot',
    name: 'Cyber Bot Mascot',
    description: 'Clean vector mascot with distinct color shapes',
    category: 'Mascot & Logo',
    url: generateSampleSvgDataUrl('mascot'),
    recommendedColors: 8,
  },
  {
    id: 'geometric-hex',
    name: 'Geometric Hexagon',
    description: 'Sharp angles and vibrant gradient layers',
    category: 'Abstract',
    url: generateSampleSvgDataUrl('geometric'),
    recommendedColors: 8,
  },
  {
    id: 'retro-badge',
    name: 'Retro Star Emblem',
    description: 'High contrast badge ideal for testing precision',
    category: 'Emblem',
    url: generateSampleSvgDataUrl('badge'),
    recommendedColors: 5,
  },
  {
    id: 'sunset-peaks',
    name: 'Synthwave Sunset',
    description: 'Layered mountain landscape with sun backdrop',
    category: 'Landscape',
    url: generateSampleSvgDataUrl('landscape'),
    recommendedColors: 6,
  },
];
