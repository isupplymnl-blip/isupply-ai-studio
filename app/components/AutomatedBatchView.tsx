'use client';

import { useCallback, useLayoutEffect, useRef, useState, useEffect } from 'react';
interface AutoSlide { id: string; prompt: string; imageUrl?: string; isLoading?: boolean; error?: string; }

interface AutoSettings {
  temperature?: number;
  guidanceScale?: number;
  negativePrompt?: string;
  seed?: string;
  safetyFilter?: string;
  model?: string;
  resolution?: string;
  aspectRatio?: string;
}

interface TagStatus { name: string; tags: string[]; matched: boolean; }

interface RefImage { id: string; name: string; url: string; tags: string[]; }

interface Props {
  slides: AutoSlide[];
  settings: AutoSettings;
  availableRefs: RefImage[];
  onSlidesChange: (updater: AutoSlide[] | ((prev: AutoSlide[]) => AutoSlide[])) => void;
  onSettingsChange: (s: AutoSettings) => void;
  onAddToLibrary: (url: string, prompt: string) => void;
  onOpenImage: (url: string) => void;
}

export default function AutomatedBatchView({
  slides, settings, availableRefs,
  onSlidesChange, onSettingsChange, onAddToLibrary, onOpenImage,
}: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Clamp index when slides shrink
  useEffect(() => {
    if (currentIndex >= slides.length && slides.length > 0) {
      setCurrentIndex(slides.length - 1);
    }
  }, [slides.length, currentIndex]);

  const currentSlide = slides[currentIndex] ?? slides[0];

  // Auto-expand textarea height
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [currentSlide?.prompt]);

  const updateCurrentPrompt = (prompt: string) => {
    onSlidesChange(prev => prev.map((s, i) => i === currentIndex ? { ...s, prompt } : s));
  };

  const addSlide = () => {
    const newSlide: AutoSlide = { id: `slide-${Date.now()}`, prompt: '' };
    onSlidesChange(prev => [...prev, newSlide]);
    // Navigate to the new slide after state update
    setTimeout(() => setCurrentIndex(slides.length), 0);
  };

  const removeCurrentSlide = () => {
    if (slides.length <= 1) return;
    onSlidesChange(prev => prev.filter((_, i) => i !== currentIndex));
    setCurrentIndex(idx => Math.max(0, idx - 1));
  };

  // Live reference detection for current slide prompt
  const lower = currentSlide?.prompt.toLowerCase() ?? '';
  const [tagStatuses, setTagStatuses] = useState<TagStatus[]>([]);
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setTagStatuses(availableRefs.map(ref => ({
        name: ref.name,
        tags: ref.tags,
        matched: ref.tags.some(t => lower.includes(t.toLowerCase())),
      })));
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [lower, availableRefs]);

  // Generate all slides sequentially (one at a time to avoid rate limits)
  const handleGenerateAll = useCallback(async () => {
    const pending = slides.filter(s => s.prompt.trim());
    if (!pending.length || isGeneratingAll) return;
    setIsGeneratingAll(true);

    for (const slide of pending) {
      onSlidesChange(prev => prev.map(s => s.id === slide.id ? { ...s, isLoading: true, error: undefined } : s));
      try {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: slide.prompt.trim(), nodeId: slide.id, type: 'slide', settings }),
        });
        const data = await res.json();
        if (!res.ok || !data.imageUrl) throw new Error(data.error ?? 'No image returned');
        onSlidesChange(prev => prev.map(s => s.id === slide.id ? { ...s, isLoading: false, imageUrl: data.imageUrl, error: undefined } : s));
        onAddToLibrary(data.imageUrl, slide.prompt.trim());
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Generation failed';
        onSlidesChange(prev => prev.map(s => s.id === slide.id ? { ...s, isLoading: false, error: msg } : s));
      }
    }

    setIsGeneratingAll(false);
  }, [slides, settings, isGeneratingAll, onSlidesChange, onAddToLibrary]);

  // Regenerate a single slide
  const handleRegen = useCallback(async (slide: AutoSlide) => {
    if (!slide.prompt.trim() || slide.isLoading) return;
    onSlidesChange(prev => prev.map(s => s.id === slide.id ? { ...s, isLoading: true, error: undefined } : s));
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: slide.prompt.trim(), nodeId: slide.id, type: 'slide', settings }),
      });
      const data = await res.json();
      if (!res.ok || !data.imageUrl) throw new Error(data.error ?? 'No image returned');
      onSlidesChange(prev => prev.map(s => s.id === slide.id ? { ...s, isLoading: false, imageUrl: data.imageUrl, error: undefined } : s));
      onAddToLibrary(data.imageUrl, slide.prompt.trim());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Generation failed';
      onSlidesChange(prev => prev.map(s => s.id === slide.id ? { ...s, isLoading: false, error: msg } : s));
    }
  }, [settings, onSlidesChange, onAddToLibrary]);

  const promptsFilledCount = slides.filter(s => s.prompt.trim()).length;
  const anyLoading = slides.some(s => s.isLoading);

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

      {/* ── Center: Prompt Carousel + Outputs ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Slide navigator */}
        <div style={{
          background: '#111113', borderBottom: '1px solid #2A2A35',
          padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        }}>
          <button
            onClick={() => setCurrentIndex(i => Math.max(0, i - 1))}
            disabled={currentIndex === 0}
            style={{
              width: 28, height: 28, borderRadius: 6, border: '1px solid #2A2A35',
              background: '#1A1A1F', color: currentIndex === 0 ? '#2A2A35' : '#9090A8',
              cursor: currentIndex === 0 ? 'not-allowed' : 'pointer', fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>←</button>

          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto' }}>
            {slides.map((s, i) => {
              const hasPrompt = !!s.prompt.trim();
              const hasImage  = !!s.imageUrl;
              const loading   = !!s.isLoading;
              const error     = !!s.error;
              return (
                <button key={s.id} onClick={() => setCurrentIndex(i)}
                  style={{
                    width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                    border: `1px solid ${i === currentIndex ? '#7C3AED' : error ? '#F43F5E44' : hasImage ? '#0D948844' : hasPrompt ? '#2A2A35' : '#1A1A1F'}`,
                    background: i === currentIndex ? '#7C3AED' : error ? '#F43F5E11' : hasImage ? '#0D948811' : '#1A1A1F',
                    color: i === currentIndex ? '#fff' : error ? '#F43F5E' : hasImage ? '#0D9488' : '#55556A',
                    cursor: 'pointer', fontSize: 10, fontWeight: 700,
                    position: 'relative',
                  }}>
                  {loading ? (
                    <span style={{ fontSize: 12, animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
                  ) : (i + 1)}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => setCurrentIndex(i => Math.min(slides.length - 1, i + 1))}
            disabled={currentIndex === slides.length - 1}
            style={{
              width: 28, height: 28, borderRadius: 6, border: '1px solid #2A2A35',
              background: '#1A1A1F', color: currentIndex === slides.length - 1 ? '#2A2A35' : '#9090A8',
              cursor: currentIndex === slides.length - 1 ? 'not-allowed' : 'pointer', fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>→</button>

          <span style={{ fontSize: 10, color: '#55556A', whiteSpace: 'nowrap' }}>
            {currentIndex + 1} / {slides.length}
          </span>
        </div>

        {/* Current slide prompt box */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #2A2A35', background: '#0D0D0F', flexShrink: 0 }}>
          <div style={{ maxWidth: 680, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: currentSlide?.isLoading ? '#F43F5E' : '#7C3AED',
                  boxShadow: `0 0 6px ${currentSlide?.isLoading ? '#F43F5E' : '#7C3AED'}`,
                  animation: currentSlide?.isLoading ? 'pulse 1s infinite' : 'none',
                }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: '#F1F0F5' }}>Slide {currentIndex + 1}</span>
                <span style={{ fontSize: 10, color: '#9090A8', background: '#1A1A1F', padding: '2px 8px', borderRadius: 20, border: '1px solid #2A2A35' }}>
                  Image Prompt
                </span>
              </div>
              <div style={{ display: 'flex', gap: 5 }}>
                <button onClick={addSlide}
                  style={{ padding: '3px 10px', fontSize: 10, fontWeight: 600, borderRadius: 5, border: '1px solid #2A2A35', background: '#1A1A1F', color: '#9090A8', cursor: 'pointer' }}>
                  + Add Slide
                </button>
                {slides.length > 1 && (
                  <button onClick={removeCurrentSlide}
                    style={{ padding: '3px 10px', fontSize: 10, fontWeight: 600, borderRadius: 5, border: '1px solid #F43F5E44', background: '#F43F5E11', color: '#F43F5E', cursor: 'pointer' }}>
                    Remove
                  </button>
                )}
              </div>
            </div>

            <label style={{ color: '#55556A', fontSize: 10, display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Scene Description
            </label>
            <textarea
              ref={textareaRef}
              value={currentSlide?.prompt ?? ''}
              onChange={e => updateCurrentPrompt(e.target.value)}
              placeholder="Describe the scene for this slide… e.g. Extreme close-up of the product on a marble surface, soft studio lighting…"
              style={{
                width: '100%', background: '#111113', border: '1px solid #2A2A35',
                borderRadius: 7, padding: '8px 10px', color: '#F1F0F5', fontSize: 12,
                resize: 'none', outline: 'none', lineHeight: 1.6, boxSizing: 'border-box',
                fontFamily: 'inherit', minHeight: 80, overflow: 'hidden',
              }}
            />

            {/* Live reference detection */}
            {tagStatuses.length > 0 && (
              <div style={{ background: '#111113', border: '1px solid #2A2A35', borderRadius: 7, padding: '8px 10px', marginTop: 8 }}>
                <p style={{ fontSize: 9, color: '#55556A', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Reference Detection</p>
                {tagStatuses.map(s => (
                  <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: s.matched ? '#0D9488' : '#2A2A35', boxShadow: s.matched ? '0 0 4px #0D9488' : 'none', flexShrink: 0, transition: 'all 0.2s' }} />
                    <span style={{ fontSize: 11, color: s.matched ? '#F1F0F5' : '#55556A', flex: 1 }}>{s.name}</span>
                    <span style={{ fontSize: 9, color: '#55556A' }}>{s.tags.slice(0, 3).join(', ')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Generate All button */}
        <div style={{ padding: '12px 20px', background: '#0A0A0B', borderBottom: '1px solid #2A2A35', flexShrink: 0 }}>
          <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={handleGenerateAll}
              disabled={isGeneratingAll || anyLoading || promptsFilledCount === 0}
              style={{
                flex: 1, padding: '10px', borderRadius: 8, border: 'none',
                cursor: (isGeneratingAll || anyLoading || promptsFilledCount === 0) ? 'not-allowed' : 'pointer',
                background: (isGeneratingAll || anyLoading || promptsFilledCount === 0)
                  ? '#2A2A35'
                  : 'linear-gradient(135deg, #7C3AED, #0D9488)',
                color: (isGeneratingAll || anyLoading || promptsFilledCount === 0) ? '#55556A' : '#fff',
                fontSize: 13, fontWeight: 700, letterSpacing: '0.02em',
              }}>
              {isGeneratingAll
                ? `Generating… (${slides.filter(s => s.isLoading).length} in progress)`
                : `⚡ Generate ${promptsFilledCount} Slide${promptsFilledCount !== 1 ? 's' : ''}`}
            </button>
            <span style={{ fontSize: 10, color: '#55556A', whiteSpace: 'nowrap' }}>
              {promptsFilledCount}/{slides.length} prompts filled
            </span>
          </div>
        </div>

        {/* Output grid */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          <div style={{
            maxWidth: 680, margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 12,
          }}>
            {slides.map((slide, i) => (
              <SlideOutput
                key={slide.id}
                slide={slide}
                index={i}
                onRegen={() => handleRegen(slide)}
                onSave={() => slide.imageUrl && onAddToLibrary(slide.imageUrl, slide.prompt)}
                onOpen={() => slide.imageUrl && onOpenImage(slide.imageUrl)}
                onClick={() => setCurrentIndex(i)}
                isActive={i === currentIndex}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Single slide output card ──────────────────────────────────────────────────
function SlideOutput({ slide, index, onRegen, onSave, onOpen, onClick, isActive }: {
  slide: AutoSlide;
  index: number;
  onRegen: () => void;
  onSave: () => void;
  onOpen: () => void;
  onClick: () => void;
  isActive: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderRadius: 10, overflow: 'hidden',
        border: `1px solid ${isActive ? '#7C3AED' : '#2A2A35'}`,
        background: '#111113', cursor: 'pointer',
        transition: 'border-color 0.15s',
        boxShadow: isActive ? '0 0 0 1px #7C3AED44' : 'none',
      }}
    >
      {/* Image area */}
      <div style={{ position: 'relative', aspectRatio: '4/5', background: '#0A0A0B' }}>
        {slide.isLoading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, border: '2px solid #2A2A35', borderTopColor: '#7C3AED',
              borderRadius: '50%', animation: 'spin 1s linear infinite',
            }} />
            <span style={{ fontSize: 10, color: '#55556A' }}>Generating…</span>
          </div>
        )}

        {slide.error && !slide.isLoading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 10 }}>
            <span style={{ fontSize: 18, marginBottom: 6 }}>⚠</span>
            <p style={{ fontSize: 9, color: '#F43F5E', textAlign: 'center', lineHeight: 1.4 }}>{slide.error.slice(0, 80)}</p>
          </div>
        )}

        {slide.imageUrl && !slide.isLoading && (
          <>
            <img src={slide.imageUrl} alt={`Slide ${index + 1}`}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            {/* Hover overlay */}
            {hovered && (
              <div style={{
                position: 'absolute', inset: 0, background: 'rgba(10,10,11,0.82)',
                display: 'flex', gap: 5, alignItems: 'center', justifyContent: 'center',
              }}>
                <button onClick={e => { e.stopPropagation(); onOpen(); }}
                  style={{ padding: '5px 10px', fontSize: 10, fontWeight: 600, borderRadius: 5, border: 'none', background: '#7C3AED', color: '#fff', cursor: 'pointer' }}>
                  Open
                </button>
                <button onClick={e => { e.stopPropagation(); onRegen(); }}
                  style={{ padding: '5px 10px', fontSize: 10, fontWeight: 600, borderRadius: 5, border: 'none', background: '#0D9488', color: '#fff', cursor: 'pointer' }}>
                  Regen
                </button>
                <a href={slide.imageUrl} download={`slide-${index + 1}-${Date.now()}.png`}
                  onClick={e => e.stopPropagation()}
                  style={{ padding: '5px 10px', fontSize: 10, fontWeight: 600, borderRadius: 5, border: '1px solid #2A2A35', background: '#1A1A1F', color: '#9090A8', cursor: 'pointer', textDecoration: 'none' }}>
                  Save
                </a>
              </div>
            )}
          </>
        )}

        {!slide.imageUrl && !slide.isLoading && !slide.error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, border: '1px dashed #2A2A35', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2A2A35', fontSize: 18 }}>✦</div>
            <span style={{ fontSize: 9, color: '#2A2A35' }}>Not generated</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '7px 9px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: isActive ? '#A78BFA' : '#9090A8' }}>Slide {index + 1}</span>
          {slide.imageUrl && !slide.isLoading && (
            <button onClick={e => { e.stopPropagation(); onRegen(); }}
              style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, border: '1px solid #0D948840', background: '#0D948811', color: '#0D9488', cursor: 'pointer' }}>
              ↻ Regen
            </button>
          )}
        </div>
        {slide.prompt && (
          <p style={{ fontSize: 9, color: '#55556A', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {slide.prompt}
          </p>
        )}
      </div>
    </div>
  );
}
