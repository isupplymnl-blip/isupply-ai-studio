'use client';

import { useCallback, useContext, useLayoutEffect, useRef, useState } from 'react';
import { NodeProps } from 'reactflow';
import { StudioContext } from '../../context/StudioContext';

import type { NodeSettings } from '../../context/StudioContext';

interface ModelCreationData {
  label: string;
  isLoading?: boolean;
  imageUrl?: string;
  error?: string;
  settings?: NodeSettings;
}

const STYLES = ['Realistic', 'Editorial', 'Commercial', 'Artistic'];

export default function ModelCreationNode({ id, data }: NodeProps<ModelCreationData>) {
  const { onCreateModel, onUpdateSettings, onSelectNode, onAddToLibrary, onDeleteNode, activeProvider } = useContext(StudioContext);
  const [description, setDescription] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [description]);

  const settings = data.settings ?? {};
  const { isLoading, imageUrl, error } = data;

  const handleGenerate = useCallback(async () => {
    if (!description.trim() || isLoading) return;
    await onCreateModel(id, description.trim(), settings);
  }, [description, isLoading, id, settings, onCreateModel]);

  return (
    <div
      onClick={() => onSelectNode(id, 'modelCreationNode')}
      style={{
        width: 320,
        background: '#1A1A1F',
        border: `1px solid ${imageUrl ? '#F43F5E44' : '#2A2A35'}`,
        borderRadius: 12,
        padding: 14,
        boxShadow: imageUrl ? '0 0 0 1px #F43F5E22, 0 4px 20px rgba(0,0,0,0.4)' : '0 4px 20px rgba(0,0,0,0.4)',
        cursor: 'default',
        transition: 'border-color 0.3s',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#F43F5E', boxShadow: '0 0 5px #F43F5E', animation: isLoading ? 'pulse 1s infinite' : 'none' }} />
        <span style={{ color: '#F1F0F5', fontWeight: 600, fontSize: 12 }}>Model Creation</span>
        <span style={{ fontSize: 9, color: '#F43F5E', background: '#F43F5E18', padding: '2px 7px', borderRadius: 20, border: '1px solid #F43F5E33' }}>16:9 Composite</span>

        {/* Delete button */}
        <button
          className="nodrag"
          title="Remove node"
          onClick={e => { e.stopPropagation(); onDeleteNode(id); }}
          style={{
            marginLeft: 'auto',
            width: 20, height: 20, borderRadius: 5,
            border: '1px solid #2A2A35', background: '#111113', color: '#55556A',
            cursor: 'pointer', fontSize: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1, padding: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#F43F5E'; e.currentTarget.style.borderColor = '#F43F5E44'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#55556A'; e.currentTarget.style.borderColor = '#2A2A35'; }}
        >×</button>
      </div>

      {/* Description */}
      <label style={{ color: '#55556A', fontSize: 10, display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Model Description</label>
      <textarea ref={textareaRef} value={description} onChange={e => setDescription(e.target.value)}
        placeholder="Filipina fashion model, 25-30 years old, professional appearance, wearing iSupply earbuds..."
        style={{ width: '100%', background: '#111113', border: '1px solid #2A2A35', borderRadius: 7, padding: '6px 9px', color: '#F1F0F5', fontSize: 11, resize: 'none', outline: 'none', lineHeight: 1.6, marginBottom: 9, boxSizing: 'border-box', fontFamily: 'inherit', minHeight: 66, overflow: 'hidden' }}
      />

      {/* Style chips */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 9, flexWrap: 'wrap' }}>
        {STYLES.map(s => (
          <span key={s} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, background: settings.style === s ? '#F43F5E' : '#111113', color: settings.style === s ? '#fff' : '#55556A', border: `1px solid ${settings.style === s ? '#F43F5E' : '#2A2A35'}`, cursor: 'pointer' }}
            onClick={e => { e.stopPropagation(); onSelectNode(id, 'modelCreationNode'); }}
          >{s}</span>
        ))}
      </div>

      {/* Generated image */}
      <div style={{ width: '100%', aspectRatio: '16/9', borderRadius: 7, overflow: 'hidden', background: '#111113', marginBottom: 10, position: 'relative', border: '1px solid #2A2A35' }}>
        {isLoading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <div style={{ width: '70%', height: 3, borderRadius: 2, background: 'linear-gradient(90deg, #1A1A1F 25%, #F43F5E 50%, #1A1A1F 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.2s ease-in-out infinite' }} />
            <p style={{ color: '#55556A', fontSize: 11 }}>Creating model composite…</p>
          </div>
        )}
        {!isLoading && error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
            <span style={{ fontSize: 18 }}>⚠️</span>
            <p style={{ color: '#F43F5E', fontSize: 11, textAlign: 'center', padding: '0 12px' }}>{error}</p>
          </div>
        )}
        {!isLoading && !error && imageUrl && (
          <>
            <img src={imageUrl} alt="Model composite" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            <button
              onClick={e => { e.stopPropagation(); onAddToLibrary({ url: imageUrl, prompt: description, nodeId: id, createdAt: new Date().toISOString() }); }}
              title="Save to Image Library"
              style={{ position: 'absolute', top: 5, right: 5, width: 22, height: 22, borderRadius: 5, border: 'none', background: '#111113cc', color: '#9090A8', cursor: 'pointer', fontSize: 11 }}
            >⊕</button>
          </>
        )}
        {!isLoading && !error && !imageUrl && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
            <span style={{ fontSize: 24, opacity: 0.25 }}>👤</span>
            <p style={{ color: '#55556A', fontSize: 11 }}>16:9 composite appears here</p>
            <p style={{ color: '#55556A', fontSize: 10 }}>
              {/\b(two models?|2 models?|both models?|model 1\b[\s\S]{0,80}\bmodel 2\b|(male|man|boy)[\s\S]{0,80}(female|woman|girl)|(female|woman|girl)[\s\S]{0,80}(male|man|boy))\b/i.test(description)
                ? 'M1 Front · M1 Back · M2 Front · M2 Back'
                : 'Front · 3/4 · Side · Back'}
            </p>
          </div>
        )}
      </div>

      {/* EccoAPI inline controls */}
      {activeProvider === 'ecco' && (
        <div style={{ background: '#111113', border: '1px solid #2A2A35', borderRadius: 7, padding: '7px 9px', marginBottom: 9 }}>
          <p style={{ fontSize: 9, color: '#55556A', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>EccoAPI Settings</p>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            {(['nanobanana31', 'nanobananapro'] as const).map(m => {
              const active = (data.settings?.eccoModel ?? 'nanobananapro') === m;
              return (
                <button key={m} onClick={e => { e.stopPropagation(); onUpdateSettings(id, { eccoModel: m }); }}
                  style={{ flex: 1, padding: '3px 0', fontSize: 9, borderRadius: 5, border: `1px solid ${active ? '#F43F5E' : '#2A2A35'}`, background: active ? '#F43F5E' : '#1A1A1F', color: active ? '#fff' : '#9090A8', cursor: 'pointer' }}>
                  {m === 'nanobanana31' ? 'NB 3.1' : 'NB Pro'}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['1K', '2K', '4K'] as const).map(s => {
              const active = (data.settings?.imageSize ?? '1K') === s;
              return (
                <button key={s} onClick={e => { e.stopPropagation(); onUpdateSettings(id, { imageSize: s }); }}
                  style={{ flex: 1, padding: '3px 0', fontSize: 9, borderRadius: 5, border: `1px solid ${active ? '#F43F5E' : '#2A2A35'}`, background: active ? '#F43F5E' : '#1A1A1F', color: active ? '#fff' : '#9090A8', cursor: 'pointer' }}>
                  {s}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <button onClick={e => { e.stopPropagation(); handleGenerate(); }} disabled={!description.trim() || Boolean(isLoading)}
        style={{
          width: '100%', padding: '8px', borderRadius: 7, border: 'none',
          cursor: !description.trim() || isLoading ? 'not-allowed' : 'pointer',
          background: !description.trim() || isLoading ? '#2A2A35' : 'linear-gradient(135deg, #F43F5E, #7C3AED)',
          color: !description.trim() || isLoading ? '#55556A' : '#fff',
          fontSize: 12, fontWeight: 700,
        }}>
        {isLoading ? 'Generating…' : '✦ Create Model'}
      </button>
    </div>
  );
}
