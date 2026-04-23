'use client';

import { useCallback, useContext } from 'react';
import { Handle, NodeProps, Position } from 'reactflow';
import { StudioContext } from '../../context/StudioContext';
import type { NodeSettings } from '../../context/StudioContext';

interface OutputNodeData {
  label: string;
  slideNumber: number;
  isLoading: boolean;
  imageUrl: string;
  lastPrompt?: string;
  lastSettings?: NodeSettings;
  error?: string;
  settings?: {
    resolution: string;
    aspectRatio: string;
    format: string;
    count: number;
  };
}

export default function OutputNode({ id, data }: NodeProps<OutputNodeData>) {
  const { onRegenerate, onSelectNode, onAddToLibrary, onDeleteNode, connectingFromId, onCompleteConnect } = useContext(StudioContext);

  const isTarget = connectingFromId !== null && connectingFromId !== id;

  const handleRegenerate = useCallback(() => {
    if (data.lastPrompt) onRegenerate(id, data.lastPrompt, data.lastSettings ?? data.settings);
  }, [id, data.lastPrompt, data.lastSettings, data.settings, onRegenerate]);

  const handleRegenSeed = useCallback((seed: number) => {
    if (!data.lastPrompt) return;
    onRegenerate(id, data.lastPrompt, { ...(data.lastSettings ?? data.settings ?? {}), seed });
  }, [id, data.lastPrompt, data.lastSettings, data.settings, onRegenerate]);

  const canRegen = Boolean(data.lastPrompt) && !data.isLoading;
  const baseSeed = data.lastSettings?.seed;

  const handleDownload = useCallback(() => {
    if (!data.imageUrl) return;
    const a = document.createElement('a');
    a.href = data.imageUrl;
    a.download = `slide-${data.slideNumber}-${Date.now()}.png`;
    a.click();
  }, [data.imageUrl, data.slideNumber]);

  const handleRootClick = () => {
    if (isTarget) {
      onCompleteConnect(id);
    } else {
      onSelectNode(id, 'outputNode');
    }
  };

  const imgW = 288;
  const imgH = Math.round(imgW * 1.25);

  const borderColor = data.isLoading
    ? '#F43F5E44'
    : isTarget
    ? 'var(--studio-accent)'
    : data.imageUrl
    ? 'color-mix(in srgb, var(--studio-accent) 27%, transparent)'
    : 'var(--studio-border)';

  const boxShadow = isTarget
    ? '0 0 0 2px color-mix(in srgb, var(--studio-accent) 27%, transparent), 0 4px 20px rgba(0,0,0,0.4)'
    : '0 4px 20px rgba(0,0,0,0.4)';

  return (
    <div
      onClick={handleRootClick}
      style={{
        width: 320,
        background: 'var(--studio-elevated)',
        border: `1px solid ${borderColor}`,
        borderRadius: 12,
        padding: 14,
        boxShadow,
        cursor: isTarget ? 'crosshair' : 'default',
        transition: 'border-color 0.3s, box-shadow 0.2s',
      }}
    >
      <Handle type="target" position={Position.Left}
        style={{ width: 10, height: 10, background: '#0D9488', border: '2px solid var(--studio-elevated)', boxShadow: '0 0 6px #0D9488' }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: data.isLoading ? '#F43F5E' : data.imageUrl ? 'var(--studio-accent)' : 'var(--studio-text-muted)',
          boxShadow: data.isLoading ? '0 0 6px #F43F5E' : data.imageUrl ? '0 0 6px var(--studio-accent)' : 'none',
          animation: data.isLoading ? 'pulse 1s infinite' : 'none',
        }} />
        <span style={{ color: 'var(--studio-text)', fontWeight: 600, fontSize: 12 }}>Image Output</span>
        <span style={{ fontSize: 10, color: 'var(--studio-text-sec)', background: 'var(--studio-surface)', padding: '2px 8px', borderRadius: 20, border: '1px solid var(--studio-border)' }}>Slide {data.slideNumber}</span>

        {/* Delete button */}
        <button
          className="nodrag"
          title="Remove node"
          onClick={e => { e.stopPropagation(); onDeleteNode(id); }}
          style={{
            marginLeft: 'auto',
            width: 20, height: 20, borderRadius: 5,
            border: '1px solid var(--studio-border)', background: 'var(--studio-surface)', color: 'var(--studio-text-muted)',
            cursor: 'pointer', fontSize: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1, padding: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#F43F5E'; e.currentTarget.style.borderColor = '#F43F5E44'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--studio-text-muted)'; e.currentTarget.style.borderColor = 'var(--studio-border)'; }}
        >×</button>
      </div>

      {/* Connecting-mode hint */}
      {isTarget && (
        <p style={{ fontSize: 10, color: 'var(--studio-accent)', textAlign: 'center', marginBottom: 8 }}>
          Click to connect here
        </p>
      )}

      {/* Image area */}
      <div style={{ width: imgW, height: imgH, borderRadius: 7, overflow: 'hidden', background: 'var(--studio-surface)', marginBottom: 10, position: 'relative', border: '1px solid var(--studio-border)' }}>
        {data.isLoading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <div style={{ width: '70%', height: 3, borderRadius: 2, background: 'linear-gradient(90deg, #1A1A1F 25%, #7C3AED 50%, #1A1A1F 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.2s ease-in-out infinite' }} />
            <div style={{ width: '50%', height: 3, borderRadius: 2, background: 'linear-gradient(90deg, #1A1A1F 25%, #0D9488 50%, #1A1A1F 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.2s ease-in-out infinite 0.3s' }} />
            <p style={{ color: 'var(--studio-text-muted)', fontSize: 11, marginTop: 6 }}>Generating with Gemini…</p>
          </div>
        )}
        {!data.isLoading && data.error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
            <span style={{ fontSize: 18 }}>⚠️</span>
            <p style={{ color: '#F43F5E', fontSize: 11, textAlign: 'center', padding: '0 12px' }}>{data.error}</p>
          </div>
        )}
        {!data.isLoading && !data.error && data.imageUrl && (
          <>
            <img src={data.imageUrl} alt={`Slide ${data.slideNumber}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            <button
              onClick={e => { e.stopPropagation(); onAddToLibrary({ url: data.imageUrl, prompt: data.lastPrompt || '', nodeId: id, createdAt: new Date().toISOString() }); }}
              title="Save to Image Library"
              style={{ position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 6, border: 'none', background: '#111113cc', color: 'var(--studio-text-sec)', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              ⊕
            </button>
          </>
        )}
        {!data.isLoading && !data.error && !data.imageUrl && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
            <span style={{ fontSize: 24, opacity: 0.25 }}>🖼</span>
            <p style={{ color: 'var(--studio-text-muted)', fontSize: 11 }}>Output appears here</p>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 5 }}>
        <button onClick={e => { e.stopPropagation(); handleRegenerate(); }} disabled={!canRegen}
          style={{ flex: 1, padding: '6px', fontSize: 10, fontWeight: 600, borderRadius: 6, border: `1px solid ${data.error && canRegen ? '#F43F5E44' : 'var(--studio-border)'}`, background: 'var(--studio-surface)', color: !canRegen ? 'var(--studio-text-muted)' : data.error ? '#F43F5E' : 'var(--studio-text-sec)', cursor: !canRegen ? 'not-allowed' : 'pointer' }}>
          ↻ Regen
        </button>
        <button onClick={e => { e.stopPropagation(); handleDownload(); }} disabled={!data.imageUrl}
          style={{ flex: 1, padding: '6px', fontSize: 10, fontWeight: 600, borderRadius: 6, border: `1px solid ${data.imageUrl ? 'color-mix(in srgb, var(--studio-accent) 27%, transparent)' : 'var(--studio-border)'}`, background: data.imageUrl ? 'color-mix(in srgb, var(--studio-accent) 7%, transparent)' : 'var(--studio-surface)', color: data.imageUrl ? 'var(--studio-accent)' : 'var(--studio-text-muted)', cursor: data.imageUrl ? 'pointer' : 'not-allowed' }}>
          ↓ Save
        </button>
      </div>

      {/* Seed Explorer — shown after generation when a seed is known */}
      {data.imageUrl && baseSeed !== undefined && !data.isLoading && (
        <div style={{ marginTop: 8 }}>
          <p style={{ fontSize: 9, color: 'var(--studio-text-muted)', marginBottom: 4 }}>Seed variants</p>
          <div style={{ display: 'flex', gap: 3 }}>
            {([0, 1, 2, 7, 13] as const).map(offset => {
              const s = baseSeed + offset;
              return (
                <button
                  key={offset}
                  className="nodrag"
                  onClick={e => { e.stopPropagation(); handleRegenSeed(s); }}
                  disabled={data.isLoading}
                  title={offset === 0 ? 'Re-run exact seed' : `+${offset}: ${offset === 1 ? 'minor pose' : offset === 2 ? 'hair/wind' : offset === 7 ? 'background' : 'lighting'}`}
                  style={{ flex: 1, padding: '4px 2px', fontSize: 9, fontWeight: 600, borderRadius: 5, border: '1px solid var(--studio-border)', background: offset === 0 ? '#0D948811' : 'var(--studio-surface)', color: offset === 0 ? '#0D9488' : 'var(--studio-text-sec)', cursor: 'pointer', lineHeight: 1.2 }}
                >
                  {offset === 0 ? `${s}` : `+${offset}`}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
