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

type DetectedInfo = { source: 'explicit' | 'scene'; label: string };

function extractNum(text: string, key: string): number | undefined {
  const m = new RegExp(`${key}["']?\\s*:\\s*([\\d.]+)`, 'i').exec(text);
  return m ? parseFloat(m[1]) : undefined;
}

function parseApiTag(text: string): { patch: Partial<NodeSettings>; cleanText: string } | null {
  const firstLine = text.trimStart().split('\n')[0].trim();
  const m = /^\[API:\s*([^\]]+)\]/i.exec(firstLine);
  if (!m) return null;
  const pairs = m[1];
  const patch: Partial<NodeSettings> = {};
  const modelM = /model=([^\s,\]]+)/i.exec(pairs);
  if (modelM) {
    const r = modelM[1].toLowerCase();
    patch.model = r.includes('pro') ? 'Pro' : r.includes('standard') ? 'Standard' : 'Flash';
  }
  const tempM  = /temp=([0-9.]+)/i.exec(pairs);   if (tempM)  patch.temperature = parseFloat(tempM[1]);
  const topPM  = /topP=([0-9.]+)/i.exec(pairs);   if (topPM)  patch.topP        = parseFloat(topPM[1]);
  const topKM  = /topK=([0-9]+)/i.exec(pairs);    if (topKM)  patch.topK        = parseInt(topKM[1], 10);
  const seedM  = /seed=([0-9]+)/i.exec(pairs);    if (seedM)  patch.seed        = parseInt(seedM[1], 10);
  if (!Object.keys(patch).length) return null;
  const cleanText = text.replace(/^\[API:[^\]]+\]\s*\n?/i, '');
  return { patch, cleanText };
}

const SCENE_PRESETS: Record<string, { temperature: number; topP: number; topK: number }> = {
  beach:   { temperature: 1.1, topP: 0.97, topK: 40 },
  outdoor: { temperature: 1.1, topP: 0.97, topK: 40 },
  studio:  { temperature: 0.9, topP: 0.95, topK: 30 },
  urban:   { temperature: 1.0, topP: 0.97, topK: 50 },
  city:    { temperature: 1.0, topP: 0.97, topK: 50 },
  nature:  { temperature: 1.1, topP: 0.99, topK: 60 },
};

export default function CarouselPromptNode({ id, data }: NodeProps<CarouselNodeData>) {
  const { onGenerateCarousel, onUpdateData, onUpdateSettings, onSelectNode, onDeleteNode, connectingFromId, onStartConnect, onCompleteConnect, onAddCarouselSlide, onRemoveCarouselSlide } = useContext(StudioContext);
  const allNodes = useNodes();

  const [slides, setSlides] = useState<CarouselSlide[]>(data.slides ?? []);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [tagStatuses, setTagStatuses] = useState<TagStatus[]>([]);
  const [detectedInfo, setDetectedInfo] = useState<DetectedInfo | null>(null);

  const textareaRef    = useRef<HTMLTextAreaElement>(null);
  const debounceTagRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const debounceDataRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const autoDetectRef  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tagStrippedRef = useRef(false);
  const dragIndexRef   = useRef<number | null>(null);

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

  // Auto-detect API params from Director prompt output (fires on current slide prompt change)
  useEffect(() => {
    clearTimeout(autoDetectRef.current);
    const text = currentSlide?.prompt ?? '';
    autoDetectRef.current = setTimeout(() => {
      if (!text.trim()) { setDetectedInfo(null); return; }

      if (tagStrippedRef.current) { tagStrippedRef.current = false; return; }

      // Priority 1: [API: ...] tag on line 1 — applies carousel-level settings + strips tag from slide
      const tagResult = parseApiTag(text);
      if (tagResult) {
        onUpdateSettings(id, tagResult.patch);
        tagStrippedRef.current = true;
        updateCurrentPrompt(tagResult.cleanText);
        setDetectedInfo({ source: 'explicit', label: Object.keys(tagResult.patch).join(', ') });
        return;
      }

      // Priority 2: explicit values
      const seed        = extractNum(text, 'seed');
      const temperature = extractNum(text, 'temperature');
      const topP        = extractNum(text, 'top[_\\s-]?p');
      const topK        = extractNum(text, 'top[_\\s-]?k');
      const hasExplicit = seed !== undefined || temperature !== undefined || topP !== undefined || topK !== undefined;
      if (hasExplicit) {
        const patch: Partial<NodeSettings> = {};
        if (temperature !== undefined) patch.temperature = temperature;
        if (topP !== undefined)        patch.topP = topP;
        if (topK !== undefined)        patch.topK = Math.round(topK);
        if (seed !== undefined)        patch.seed = Math.round(seed);
        onUpdateSettings(id, patch);
        setDetectedInfo({ source: 'explicit', label: Object.keys(patch).join(', ') });
        return;
      }

      // Priority 3: scene-type presets
      const lower = text.toLowerCase();
      for (const [kw, preset] of Object.entries(SCENE_PRESETS)) {
        if (lower.includes(kw)) {
          onUpdateSettings(id, preset);
          setDetectedInfo({ source: 'scene', label: kw });
          return;
        }
      }
      setDetectedInfo(null);
    }, 500);
    return () => clearTimeout(autoDetectRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSlide?.prompt]);

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

  const borderColor = isSource ? '#0D9488' : isTarget ? 'var(--studio-accent)' : 'color-mix(in srgb, var(--studio-accent) 27%, transparent)';
  const boxShadow = isSource
    ? '0 0 0 2px #0D948844, 0 4px 20px rgba(0,0,0,0.4)'
    : isTarget
    ? '0 0 0 2px color-mix(in srgb, var(--studio-accent) 27%, transparent), 0 4px 20px rgba(0,0,0,0.4)'
    : '0 4px 24px rgba(124,58,237,0.18)';

  const filledCount = slides.filter(s => s.prompt.trim()).length;
  const totalCount  = slides.length;

  return (
    <div
      onClick={() => isTarget ? onCompleteConnect(id) : onSelectNode(id, 'carouselNode')}
      style={{
        width: 380,
        background: 'var(--studio-elevated)',
        border: `1px solid ${borderColor}`,
        borderRadius: 14,
        padding: 14,
        boxShadow,
        cursor: isTarget ? 'crosshair' : 'default',
        transition: 'border-color 0.2s, box-shadow 0.2s',
      }}
    >
      <Handle type="target" position={Position.Left}
        style={{ width: 10, height: 10, background: '#0D9488', border: '2px solid var(--studio-elevated)', boxShadow: '0 0 6px #0D9488' }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
        {/* Carousel icon */}
        <div style={{
          width: 22, height: 22, borderRadius: 6,
          background: 'linear-gradient(135deg, color-mix(in srgb, var(--studio-accent) 13%, transparent), #0D948822)',
          border: '1px solid color-mix(in srgb, var(--studio-accent) 27%, transparent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, flexShrink: 0,
        }}>⚡</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
          <span style={{ color: 'var(--studio-text)', fontWeight: 700, fontSize: 12 }}>Carousel</span>
          <span style={{ fontSize: 10, color: 'var(--studio-text-sec)', background: 'var(--studio-surface)', padding: '2px 8px', borderRadius: 20, border: '1px solid var(--studio-border)' }}>
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
            width: 20, height: 20, borderRadius: 5, border: `1px solid ${isSource ? '#0D9488' : 'var(--studio-border)'}`,
            background: isSource ? '#0D948822' : 'var(--studio-surface)', color: isSource ? '#0D9488' : 'var(--studio-text-muted)',
            cursor: 'pointer', fontSize: 14, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0,
          }}>
          {isSource ? '↗' : '+'}
        </button>

        {/* Collapse */}
        <button className="nodrag" title={collapsed ? 'Expand' : 'Collapse'}
          onClick={e => { e.stopPropagation(); setCollapsed(v => !v); }}
          style={{
            width: 20, height: 20, borderRadius: 5, border: '1px solid var(--studio-border)',
            background: 'var(--studio-surface)', color: 'var(--studio-text-muted)', cursor: 'pointer', fontSize: 11,
            display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0,
          }}>
          <span className={`collapse-chevron ${collapsed ? 'collapsed' : ''}`}>⌄</span>
        </button>

        {/* Delete */}
        <button className="nodrag" title="Remove node"
          onClick={e => { e.stopPropagation(); onDeleteNode(id); }}
          style={{
            width: 20, height: 20, borderRadius: 5, border: '1px solid var(--studio-border)',
            background: 'var(--studio-surface)', color: 'var(--studio-text-muted)', cursor: 'pointer', fontSize: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#F43F5E'; e.currentTarget.style.borderColor = '#F43F5E44'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--studio-text-muted)'; e.currentTarget.style.borderColor = 'var(--studio-border)'; }}>
          ×
        </button>
      </div>

      {/* Slide navigator */}
      {collapsed ? (
        <div style={{ fontSize: 11, color: 'var(--studio-text-muted)', fontStyle: 'italic', padding: '4px 2px' }}>
          {slides.length} slide{slides.length !== 1 ? 's' : ''} — expand to edit
        </div>
      ) : (<>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <button className="nodrag"
          onClick={e => { e.stopPropagation(); setCurrentIndex(i => Math.max(0, i - 1)); }}
          disabled={currentIndex === 0}
          style={{
            width: 22, height: 22, borderRadius: 5, border: '1px solid var(--studio-border)',
            background: 'var(--studio-surface)', color: currentIndex === 0 ? 'var(--studio-border)' : 'var(--studio-text-sec)',
            cursor: currentIndex === 0 ? 'not-allowed' : 'pointer', fontSize: 13,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>←</button>

        {/* Dot indicators — draggable to reorder slides */}
        <div style={{ flex: 1, display: 'flex', gap: 4, alignItems: 'center', overflowX: 'auto', padding: '2px 0' }}>
          {slides.map((s, i) => {
            const active = i === currentIndex;
            const filled = !!s.prompt.trim();
            return (
              <button key={s.id} className="nodrag"
                draggable
                onDragStart={e => { e.stopPropagation(); dragIndexRef.current = i; e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={e => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; }}
                onDrop={e => {
                  e.preventDefault(); e.stopPropagation();
                  const from = dragIndexRef.current;
                  if (from === null || from === i) return;
                  setSlides(prev => {
                    const next = [...prev];
                    const [moved] = next.splice(from, 1);
                    next.splice(i, 0, moved);
                    return next;
                  });
                  setCurrentIndex(i);
                  dragIndexRef.current = null;
                }}
                onDragEnd={() => { dragIndexRef.current = null; }}
                onClick={e => { e.stopPropagation(); setCurrentIndex(i); }}
                title={`Slide ${i + 1}${filled ? ' (has prompt)' : ''} — drag to reorder`}
                style={{
                  width: active ? 20 : 8, height: 8, borderRadius: 4, flexShrink: 0,
                  border: 'none', cursor: 'grab',
                  background: active ? 'var(--studio-accent)' : filled ? '#0D9488' : 'var(--studio-border)',
                  transition: 'width 0.2s, background 0.2s',
                  padding: 0,
                }} />
            );
          })}
        </div>

        <span style={{ fontSize: 10, color: 'var(--studio-text-muted)', whiteSpace: 'nowrap' }}>
          {currentIndex + 1}/{totalCount}
        </span>

        <button className="nodrag"
          onClick={e => { e.stopPropagation(); setCurrentIndex(i => Math.min(totalCount - 1, i + 1)); }}
          disabled={currentIndex === totalCount - 1}
          style={{
            width: 22, height: 22, borderRadius: 5, border: '1px solid var(--studio-border)',
            background: 'var(--studio-surface)', color: currentIndex === totalCount - 1 ? 'var(--studio-border)' : 'var(--studio-text-sec)',
            cursor: currentIndex === totalCount - 1 ? 'not-allowed' : 'pointer', fontSize: 13,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>→</button>

        {/* Add / Remove slide buttons */}
        <button className="nodrag"
          onClick={e => { e.stopPropagation(); onRemoveCarouselSlide(id, currentIndex); }}
          disabled={totalCount <= 1}
          title="Remove current slide"
          style={{
            width: 22, height: 22, borderRadius: 5, border: '1px solid #F43F5E44',
            background: 'var(--studio-surface)', color: totalCount <= 1 ? 'var(--studio-border)' : '#F43F5E',
            cursor: totalCount <= 1 ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>−</button>
        <button className="nodrag"
          onClick={e => { e.stopPropagation(); onAddCarouselSlide(id); }}
          title="Add slide"
          style={{
            width: 22, height: 22, borderRadius: 5, border: '1px solid #0D948844',
            background: 'var(--studio-surface)', color: '#0D9488',
            cursor: 'pointer', fontSize: 14, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>+</button>
      </div>

      {/* Current slide label */}
      <label style={{ color: 'var(--studio-text-muted)', fontSize: 10, display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
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
          width: '100%', background: 'var(--studio-surface)', border: '1px solid var(--studio-border)',
          borderRadius: 7, padding: '7px 9px', color: 'var(--studio-text)', fontSize: 11,
          resize: 'none', outline: 'none', lineHeight: 1.6, marginBottom: 9,
          boxSizing: 'border-box', fontFamily: 'inherit', minHeight: 72, overflow: 'hidden',
        }}
      />

      {/* Live reference detection */}
      {uploadAssets.length > 0 && (
        <div style={{ background: 'var(--studio-surface)', border: '1px solid var(--studio-border)', borderRadius: 7, padding: '7px 9px', marginBottom: 9 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
            <p style={{ fontSize: 9, color: 'var(--studio-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
              Refs — Slide {currentIndex + 1}
            </p>
            <span
              title="Generation uses up to 14 matched reference images per call"
              style={{
                fontSize: 9,
                color: tagStatuses.filter(s => s.matched).length > 14 ? '#F59E0B' : 'var(--studio-text-muted)',
                background: 'var(--studio-bg)', padding: '1px 6px', borderRadius: 10,
                border: '1px solid var(--studio-border)', cursor: 'default',
              }}
            >
              {tagStatuses.filter(s => s.matched).length}/14
            </span>
          </div>
          {tagStatuses.map(s => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: s.matched ? '#0D9488' : 'var(--studio-border)', boxShadow: s.matched ? '0 0 4px #0D9488' : 'none', flexShrink: 0, transition: 'all 0.2s' }} />
              <span style={{ fontSize: 11, color: s.matched ? 'var(--studio-text)' : 'var(--studio-text-muted)', flex: 1, transition: 'color 0.2s' }}>{s.name}</span>
              <span style={{ fontSize: 9, color: 'var(--studio-text-muted)' }}>{s.tags.slice(0, 3).join(', ')}</span>
            </div>
          ))}
        </div>
      )}

      {/* Progress bar */}
      <div style={{ height: 3, background: 'var(--studio-border)', borderRadius: 2, marginBottom: 9, overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 2, background: 'linear-gradient(90deg, #7C3AED, #0D9488)', width: `${totalCount ? (filledCount / totalCount) * 100 : 0}%`, transition: 'width 0.3s' }} />
      </div>

      {detectedInfo && (
        <div style={{ marginBottom: 7, padding: '4px 8px', borderRadius: 6, background: '#0D948811', border: '1px solid #0D948833', display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 9, color: '#0D9488' }}>⚡</span>
          <span style={{ fontSize: 9, color: '#0D9488' }}>
            {detectedInfo.source === 'explicit'
              ? `Auto-filled: ${detectedInfo.label}`
              : `Scene preset applied: ${detectedInfo.label}`}
          </span>
        </div>
      )}

      {/* Generate button */}
      <button
        className="nodrag"
        onClick={e => { e.stopPropagation(); handleGenerate(); }}
        disabled={isGenerating || filledCount === 0}
        style={{
          width: '100%', padding: '8px', borderRadius: 7, border: 'none',
          cursor: isGenerating || filledCount === 0 ? 'not-allowed' : 'pointer',
          background: isGenerating || filledCount === 0 ? 'var(--studio-border)' : 'linear-gradient(135deg, #7C3AED, #0D9488)',
          color: isGenerating || filledCount === 0 ? 'var(--studio-text-muted)' : '#fff',
          fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
        }}>
        {isGenerating
          ? 'Generating…'
          : filledCount === 0
          ? 'Fill in prompts above'
          : `⚡ Generate ${filledCount} Slide${filledCount !== 1 ? 's' : ''}`}
      </button>
      </>)}

      <Handle type="source" position={Position.Right}
        style={{ width: 10, height: 10, background: 'var(--studio-accent)', border: '2px solid var(--studio-elevated)', boxShadow: '0 0 6px var(--studio-accent)' }} />
    </div>
  );
}
