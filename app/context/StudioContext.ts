'use client';

import { createContext } from 'react';
import type { GeneratedImage } from '../hooks/useBatchHistory';

export interface SavedImage {
  id: string;
  name: string;
  url: string;
  tags: string[];
}

export interface NodeSettings {
  // Image Prompt / Carousel
  temperature?: number;       // default 1.0
  guidanceScale?: number;
  negativePrompt?: string;
  seed?: string;
  safetyFilter?: string;      // legacy — kept for backward compat
  safetyThreshold?: 'BLOCK_NONE' | 'BLOCK_ONLY_HIGH' | 'BLOCK_MEDIUM_AND_ABOVE' | 'BLOCK_LOW_AND_ABOVE';
  includeThoughts?: boolean;  // default true
  mediaResolution?: 'media_resolution_high' | 'media_resolution_medium' | 'media_resolution_low';
  model?: string;
  count?: number;
  // EccoAPI-specific
  eccoModel?: 'nanobanana31' | 'nanobananapro';
  imageSize?: '1K' | '2K' | '4K';
  useGoogleSearch?: boolean;
  useImageSearch?: boolean;   // default false — image results from Google Search (Flash Image model only)
  useAsync?: boolean;         // default false (sync mode)
  useStreaming?: boolean;     // default false — SSE streaming to bypass 524 timeout
  // Image Output
  resolution?: string;
  aspectRatio?: string;
  format?: string;
  // Model Creation
  style?: string;
  lighting?: string;
  background?: string;
}

export interface CarouselSlide {
  id: string;
  prompt: string;
  outputNodeId: string;
}

export interface StudioContextType {
  onSaveImage:         (nodeId: string, image: SavedImage) => void;
  onGenerateSlide:     (promptNodeId: string, prompt: string, settings?: NodeSettings) => Promise<void>;
  onGenerateCarousel:  (nodeId: string, slides: CarouselSlide[], settings?: NodeSettings) => Promise<void>;
  onRegenerate:        (outputNodeId: string, lastPrompt: string, settings?: NodeSettings) => Promise<void>;
  onCreateModel:       (nodeId: string, description: string, settings: NodeSettings) => Promise<void>;
  onUpdateSettings:    (nodeId: string, settings: Partial<NodeSettings>) => void;
  onUpdateData:        (nodeId: string, data: Record<string, unknown>) => void;
  onSelectNode:        (nodeId: string, nodeType: string) => void;
  onAddToLibrary:      (image: Omit<GeneratedImage, 'id'>) => void;
  // Node management
  onDeleteNode:        (nodeId: string) => void;
  // Click-to-connect
  connectingFromId:    string | null;
  onStartConnect:      (nodeId: string) => void;
  onCompleteConnect:   (targetNodeId: string) => void;
  // Provider
  activeProvider:      'gemini' | 'ecco' | 'pudding';
}

export const StudioContext = createContext<StudioContextType>({
  onSaveImage:         () => {},
  onGenerateSlide:     async () => {},
  onGenerateCarousel:  async () => {},
  onRegenerate:        async () => {},
  onCreateModel:       async () => {},
  onUpdateSettings:    () => {},
  onUpdateData:        () => {},
  onSelectNode:        () => {},
  onAddToLibrary:      () => {},
  onDeleteNode:        () => {},
  connectingFromId:    null,
  onStartConnect:      () => {},
  onCompleteConnect:   () => {},
  activeProvider:      'gemini',
});
