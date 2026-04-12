'use client';

import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Handle, NodeProps, Position, useNodes } from 'reactflow';
import { StudioContext } from '../../context/StudioContext';
import type { CarouselSlide, NodeSettings, SavedImage } from '../../context/StudioContext';

interface CarouselNodeData {
  label: string;
  slides: CarouselSlide[];
  settings?: NodeSettings;
}

interface TagStatus { name: string; tags: string[]; matched: boolean; }

export default function CarouselPromptNode({ id, data }: NodeProps<CarouselNodeData>) {
  const { onGenerateCarousel, onUpdateData, onSelectNode, onDeleteNode, connectingFromId, onStartConnect, onCompleteConnect } = useContext(StudioContext);
  const allNodes = useNodes();

  const [slides, setSlides] = useState<CarouselSlide[]>(data.slides ?? []);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [tagStatuses, setTagStatuses] = useState<TagStatus[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceTagRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const debounceDataRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Clamp index when slides change
  useEffect(() => {
    if (currentIndex >= slides.length && slides.length > 0) {
      setCurrentIndex(slides.length - 1);
    }
  }, [slides.length, currentIndex]);

  const currentSlide = slides[currentIndex];

  // Auto-expand textarea
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [currentSlide?.prompt]);

  // Sync slides back to node data (debounced 600ms)
  useEffect(() => {
    clearTimeout(debounceDataRef.current);
    debounceDataRef.current = setTimeout(() => {
      onUpdateData(id, { slides });
    }, 600);
    return () => clearTimeout(debounceDataRef.current);
  }, [slides, id, onUpdateData]);

  // Live reference detection for current slide
  const uploadAssets: SavedImage[] = allNodes
    .filter(n => n.type === 'uploadNode' && (n.data as Record<string, unknown>)?.savedImage)
    .map(n => (n.data as Record<string, unknown>).savedImage as SavedImage);

  const lower = currentSlide?.prompt.toLowerCase() ?? '';
  useEffect(() => {
    clearTimeout(debounceTagRef.current);
    debounceTagRef.current = setTimeout(() => {
      setTagStatuses(uploadAssets.map(a => ({
        name: a.name, tags: a.tags,
        matched: a.tags.some(t => lower.includes(t.toLowerCase())),
      })));
    }, 500);
    return () => clearTimeout(debounceTagRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lower, allNodes]);

  const updateCurrentPrompt = (prompt: string) => {
    setSlides(prev => prev.map((s, i) => i === currentIndex ? { ...s, prompt } : s));
  };

  const handleGenerate = useCallback(async () => {
    if (isGenerating) return;
    const filledSlides = slides.filter(s => s.prompt.trim() && s.outputNodeId);
    if (!filledSlides.length) return;
    setIsGenerating(true);
    try {
      // Flush slides to node data before generating
      onUpdateData(id, { slides });
      await onGenerateCarousel(id, filledSlides, data.settings);
    } finally {
      setIsGenerating(false);
    }
  }, [slides, isGenerating, id, data.settings, onGenerateCarousel, onUpdateData]);

  const isSource = connectingFromId === id;
  const isTarget = connectingFromId !== null && connectingFromId !== id;

  const borderColor = isSource ? '#0D9488' : isTarget ? '#7C3AED' : '#7C3AED44';
  const boxShadow = isSource
    ? '0 0 0 2px #0D948844, 0 4px 20px rgba(0,0,0,0.4)'
    : isTarget
    ? '0 0 0 2px #7C3AED44, 0 4px 20px rgba(0,0,0,0.4)'
    : '0 4px 24px rgba(124,58,237,0.18)';

  const filledCount = slides.filter(s => s.prompt.trim()).length;
  const totalCount  = slides.length;

  return (
    <div
      onClick={() => isTarget ? onCompleteConnect(id) : onSelectNode(id, 'carouselNode')}
      style={{
        width: 380,
        background: '#1A1A1F',
        border: `1px solid ${borderColor}`,
        borderRadius: 14,
        padding: 14,
        boxShadow,
        cursor: isTarget ? 'crosshair' : 'default',
        transition: 'border-color 0.2s, box-shadow 0.2s',
      }}
    >
      <Handle type="target" position={Position.Left}
        style={{ width: 10, height: 10, background: '#0D9488', border: '2px solid #1A1A1F', boxShadow: '0 0 6px #0D9488' }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
        {/* Carousel icon */}
        <div style={{
          width: 22, height: 22, borderRadius: 6,
          background: 'linear-gradient(135deg, #7C3AED22, #0D948822)',
          border: '1px solid #7C3AED44',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, flexShrink: 0,
        }}>⚡</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
          <span style={{ color: '#F1F0F5', fontWeight: 700, fontSize: 12 }}>Carousel</span>
          <span style={{ fontSize: 10, color: '#9090A8', background: '#111113', padding: '2px 8px', borderRadius: 20, border: '1px solid #2A2A35' }}>
            {totalCount} slides
          </span>
          {isGenerating && (
            <span style={{ fontSize: 9, color: '#F43F5E', animation: 'pulse 1s infinite' }}>● Generating…</span>
          )}
        </div>

        {/* Connect */}
        <button className="nodrag" title={isSource ? 'Cancel connect' : 'Connect to another node'}
          onClick={e => { e.stopPropagation(); isSource ? onCompleteConnect(id) : onStartConnect(id); }}
          style={{
            width: 20, height: 20, borderRadius: 5, border: `1px solid ${isSource ? '#0D9488' : '#2A2A35'}`,
            background: isSource ? '#0D948822' : '#111113', color: isSource ? '#0D9488' : '#55556A',
            cursor: 'pointer', fontSize: 14, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0,
          }}>
          {isSource ? '↗' : '+'}
        </button>

        {/* Delete */}
        <button className="nodrag" title="Remove node"
          onClick={e => { e.stopPropagation(); onDeleteNode(id); }}
          style={{
            width: 20, height: 20, borderRadius: 5, border: '1px solid #2A2A35',
            background: '#111113', color: '#55556A', cursor: 'pointer', fontSize: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#F43F5E'; e.currentTarget.style.borderColor = '#F43F5E44'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#55556A'; e.currentTarget.style.borderColor = '#2A2A35'; }}>
          ×
        </button>
      </div>

      {/* Slide navigator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <button className="nodrag"
          onClick={e => { e.stopPropagation(); setCurrentIndex(i => Math.max(0, i - 1)); }}
          disabled={currentIndex === 0}
          style={{
            width: 22, height: 22, borderRadius: 5, border: '1px solid #2A2A35',
            background: '#111113', color: currentIndex === 0 ? '#2A2A35' : '#9090A8',
            cursor: currentIndex === 0 ? 'not-allowed' : 'pointer', fontSize: 13,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>←</button>

        {/* Dot indicators */}
        <div style={{ flex: 1, display: 'flex', gap: 4, alignItems: 'center', overflowX: 'auto', padding: '2px 0' }}>
          {slides.map((s, i) => {
            const active = i === currentIndex;
            const filled = !!s.prompt.trim();
            return (
              <button key={s.id} className="nodrag"
                onClick={e => { e.stopPropagation(); setCurrentIndex(i); }}
                style={{
                  width: active ? 20 : 8, height: 8, borderRadius: 4, flexShrink: 0,
                  border: 'none', cursor: 'pointer',
                  background: active ? '#7C3AED' : filled ? '#0D9488' : '#2A2A35',
                  transition: 'width 0.2s, background 0.2s',
                  padding: 0,
                }} />
            );
          })}
        </div>

        <span style={{ fontSize: 10, color: '#55556A', whiteSpace: 'nowrap' }}>
          {currentIndex + 1}/{totalCount}
        </span>

        <button className="nodrag"
          onClick={e => { e.stopPropagation(); setCurrentIndex(i => Math.min(totalCount - 1, i + 1)); }}
          disabled={currentIndex === totalCount - 1}
          style={{
            width: 22, height: 22, borderRadius: 5, border: '1px solid #2A2A35',
            background: '#111113', color: currentIndex === totalCount - 1 ? '#2A2A35' : '#9090A8',
            cursor: currentIndex === totalCount - 1 ? 'not-allowed' : 'pointer', fontSize: 13,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>→</button>
      </div>

      {/* Current slide label */}
      <label style={{ color: '#55556A', fontSize: 10, display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Slide {currentIndex + 1} — Scene Description
      </label>

      {/* Prompt textarea */}
      <textarea
        ref={textareaRef}
        className="nodrag"
        value={currentSlide?.prompt ?? ''}
        onChange={e => updateCurrentPrompt(e.target.value)}
        placeholder={`Slide ${currentIndex + 1}: describe the scene…`}
        style={{
          width: '100%', background: '#111113', border: '1px solid #2A2A35',
          borderRadius: 7, padding: '7px 9px', color: '#F1F0F5', fontSize: 11,
          resize: 'none', outline: 'none', lineHeight: 1.6, marginBottom: 9,
          boxSizing: 'border-box', fontFamily: 'inherit', minHeight: 72, overflow: 'hidden',
        }}
      />

      {/* Live reference detection */}
      {uploadAssets.length > 0 && (
        <div style={{ background: '#111113', border: '1px solid #2A2A35', borderRadius: 7, padding: '7px 9px', marginBottom: 9 }}>
          <p style={{ fontSize: 9, color: '#55556A', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Reference Detection — Slide {currentIndex + 1}</p>
          {tagStatuses.map(s => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: s.matched ? '#0D9488' : '#2A2A35', boxShadow: s.matched ? '0 0 4px #0D9488' : 'none', flexShrink: 0, transition: 'all 0.2s' }} />
              <span style={{ fontSize: 11, color: s.matched ? '#F1F0F5' : '#55556A', flex: 1, transition: 'color 0.2s' }}>{s.name}</span>
              <span style={{ fontSize: 9, color: '#55556A' }}>{s.tags.slice(0, 3).join(', ')}</span>
            </div>
          ))}
        </div>
      )}

      {/* Progress bar */}
      <div style={{ height: 3, background: '#2A2A35', borderRadius: 2, marginBottom: 9, overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 2, background: 'linear-gradient(90deg, #7C3AED, #0D9488)', width: `${totalCount ? (filledCount / totalCount) * 100 : 0}%`, transition: 'width 0.3s' }} />
      </div>

      {/* Generate button */}
      <button
        className="nodrag"
        onClick={e => { e.stopPropagation(); handleGenerate(); }}
        disabled={isGenerating || filledCount === 0}
        style={{
          width: '100%', padding: '8px', borderRadius: 7, border: 'none',
          cursor: isGenerating || filledCount === 0 ? 'not-allowed' : 'pointer',
          background: isGenerating || filledCount === 0 ? '#2A2A35' : 'linear-gradient(135deg, #7C3AED, #0D9488)',
          color: isGenerating || filledCount === 0 ? '#55556A' : '#fff',
          fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
        }}>
        {isGenerating
          ? 'Generating…'
          : filledCount === 0
          ? 'Fill in prompts above'
          : `⚡ Generate ${filledCount} Slide${filledCount !== 1 ? 's' : ''}`}
      </button>

      <Handle type="source" position={Position.Right}
        style={{ width: 10, height: 10, background: '#7C3AED', border: '2px solid #1A1A1F', boxShadow: '0 0 6px #7C3AED' }} />
    </div>
  );
}
