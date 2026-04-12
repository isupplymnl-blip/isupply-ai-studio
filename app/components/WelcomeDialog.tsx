'use client';

import { useEffect, useState } from 'react';
import type { Batch } from '../hooks/useBatchHistory';

interface Props {
  batches: Batch[];
  onOpenBatch: (id: string) => void;
  onNewBatch: () => void;
  onNewAutomatedBatch: (slideCount: number) => void;
  onDismiss: () => void;
}

export default function WelcomeDialog({ batches, onOpenBatch, onNewBatch, onNewAutomatedBatch, onDismiss }: Props) {
  const [step, setStep]           = useState<'main' | 'open' | 'automated'>('main');
  const [slideCount, setSlideCount] = useState(6);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onDismiss]);

  return (
    <div
      onClick={onDismiss}
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#111113', border: '1px solid #2A2A35', borderRadius: 16,
          padding: 32, width: 480, maxWidth: '90vw',
          boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
        }}
      >
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: 'linear-gradient(135deg, #7C3AED, #0D9488)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: 15, color: '#fff',
          }}>iS</div>
          <div>
            <p style={{ fontWeight: 700, fontSize: 17, color: '#F1F0F5', margin: 0 }}>iSupply AI Studio</p>
            <p style={{ fontSize: 11, color: '#55556A', margin: 0 }}>How do you want to create your images?</p>
          </div>
        </div>

        {/* ── Main step ── */}
        {step === 'main' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <WelcomeCard
              icon="📂"
              title="Open Batch"
              desc={batches.length ? `Continue from ${batches.length} saved batch${batches.length > 1 ? 'es' : ''}` : 'No saved batches yet'}
              onClick={() => batches.length ? setStep('open') : undefined}
              disabled={!batches.length}
            />
            <WelcomeCard
              icon="✦"
              title="Create New Batch"
              desc="Start a blank canvas with nodes and edges"
              onClick={() => { onNewBatch(); }}
            />
            <WelcomeCard
              icon="⚡"
              title="Create New Automated Batch"
              desc="Multi-slide carousel with one-click bulk generation"
              onClick={() => setStep('automated')}
              accent
            />
          </div>
        )}

        {/* ── Open existing batch ── */}
        {step === 'open' && (
          <>
            <button onClick={() => setStep('main')}
              style={{ marginBottom: 16, background: 'none', border: 'none', color: '#55556A', cursor: 'pointer', fontSize: 11, padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
              ← Back
            </button>
            <p style={{ fontSize: 11, color: '#9090A8', marginBottom: 14 }}>Select a batch to open:</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
              {batches.map(b => (
                <button key={b.id} onClick={() => onOpenBatch(b.id)}
                  style={{
                    width: '100%', padding: '11px 14px', borderRadius: 9, border: '1px solid #2A2A35',
                    background: '#1A1A1F', color: '#F1F0F5', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    textAlign: 'left', transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#7C3AED44')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#2A2A35')}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{b.name}</span>
                      {b.batchType === 'automated' && (
                        <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 20, background: '#7C3AED22', color: '#7C3AED', border: '1px solid #7C3AED44' }}>Auto</span>
                      )}
                    </div>
                    <p style={{ fontSize: 10, color: '#55556A', margin: '2px 0 0' }}>
                      {new Date(b.createdAt).toLocaleDateString()} · {b.generatedImages.length} images
                      {b.batchType === 'automated' ? ' · Automated' : ''}
                    </p>
                  </div>
                  <span style={{ fontSize: 18, color: '#55556A' }}>→</span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* ── Automated batch setup ── */}
        {step === 'automated' && (
          <>
            <button onClick={() => setStep('main')}
              style={{ marginBottom: 16, background: 'none', border: 'none', color: '#55556A', cursor: 'pointer', fontSize: 11, padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
              ← Back
            </button>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#F1F0F5', marginBottom: 6 }}>How many slides?</p>
            <p style={{ fontSize: 11, color: '#55556A', marginBottom: 20, lineHeight: 1.6 }}>
              Each slide gets its own prompt box. You can add more later.
            </p>

            {/* Slide count picker */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
              <button
                onClick={() => setSlideCount(c => Math.max(1, c - 1))}
                style={{ width: 36, height: 36, borderRadius: 8, border: '1px solid #2A2A35', background: '#1A1A1F', color: '#9090A8', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                −
              </button>
              <div style={{ textAlign: 'center', flex: 1 }}>
                <span style={{ fontSize: 36, fontWeight: 800, color: '#7C3AED' }}>{slideCount}</span>
                <p style={{ fontSize: 11, color: '#55556A', margin: 0 }}>slide{slideCount !== 1 ? 's' : ''}</p>
              </div>
              <button
                onClick={() => setSlideCount(c => Math.min(20, c + 1))}
                style={{ width: 36, height: 36, borderRadius: 8, border: '1px solid #2A2A35', background: '#1A1A1F', color: '#9090A8', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                +
              </button>
            </div>

            {/* Quick count chips */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 24, flexWrap: 'wrap' }}>
              {[3, 4, 5, 6, 8, 10, 12].map(n => (
                <button key={n} onClick={() => setSlideCount(n)}
                  style={{
                    padding: '4px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
                    border: `1px solid ${slideCount === n ? '#7C3AED' : '#2A2A35'}`,
                    background: slideCount === n ? '#7C3AED' : '#1A1A1F',
                    color: slideCount === n ? '#fff' : '#9090A8',
                  }}>
                  {n}
                </button>
              ))}
            </div>

            <button
              onClick={() => onNewAutomatedBatch(slideCount)}
              style={{
                width: '100%', padding: '12px', borderRadius: 9, border: 'none',
                background: 'linear-gradient(135deg, #7C3AED, #0D9488)',
                color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>
              Create {slideCount}-Slide Automated Batch →
            </button>
          </>
        )}

        {/* Dismiss hint */}
        {step === 'main' && (
          <p style={{ fontSize: 10, color: '#55556A', textAlign: 'center', marginTop: 20 }}>
            Press Esc or click outside to continue with current batch
          </p>
        )}
      </div>
    </div>
  );
}

function WelcomeCard({ icon, title, desc, onClick, accent, disabled }: {
  icon: string; title: string; desc: string;
  onClick?: () => void; accent?: boolean; disabled?: boolean;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        width: '100%', padding: '14px 16px', borderRadius: 10, border: `1px solid ${accent ? '#7C3AED66' : '#2A2A35'}`,
        background: accent ? '#7C3AED11' : '#1A1A1F', cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left',
        opacity: disabled ? 0.4 : 1, transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.borderColor = accent ? '#7C3AED' : '#7C3AED44'; e.currentTarget.style.background = accent ? '#7C3AED22' : '#1E1E2A'; } }}
      onMouseLeave={e => { if (!disabled) { e.currentTarget.style.borderColor = accent ? '#7C3AED66' : '#2A2A35'; e.currentTarget.style.background = accent ? '#7C3AED11' : '#1A1A1F'; } }}
    >
      <span style={{ fontSize: 24, lineHeight: 1 }}>{icon}</span>
      <div>
        <p style={{ fontSize: 13, fontWeight: 600, color: accent ? '#A78BFA' : '#F1F0F5', margin: 0 }}>{title}</p>
        <p style={{ fontSize: 11, color: '#55556A', margin: '3px 0 0' }}>{desc}</p>
      </div>
    </button>
  );
}
