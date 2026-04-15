'use client';

import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Handle, NodeProps, Position, useNodes } from 'reactflow';
import { StudioContext } from '../../context/StudioContext';
import type { NodeSettings, SavedImage } from '../../context/StudioContext';

interface PromptNodeData {
  label: string;
  slideNumber: number;
  settings?: NodeSettings;
}

interface TagStatus { name: string; tags: string[]; matched: boolean; }

export default function PromptNode({ id, data }: NodeProps<PromptNodeData>) {
  const { onGenerateSlide, onSelectNode, onDeleteNode, connectingFromId, onStartConnect, onCompleteConnect } = useContext(StudioContext);
  const allNodes = useNodes();

  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [tagStatuses, setTagStatuses] = useState<TagStatus[]>([]);
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);

  // Auto-expand textarea height to fit content
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [prompt]);

  const isSource = connectingFromId === id;
  const isTarget = connectingFromId !== null && connectingFromId !== id;

  const uploadAssets: SavedImage[] = allNodes
    .filter(n => n.type === 'uploadNode' && (n.data as Record<string, unknown>)?.savedImage)
    .map(n => (n.data as Record<string, unknown>).savedImage as SavedImage);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const lower = prompt.toLowerCase();
      setTagStatuses(uploadAssets.map(a => ({
        name: a.name, tags: a.tags,
        matched: a.tags.some(t => lower.includes(t.toLowerCase())),
      })));
    }, 500);
    return () => clearTimeout(debounceRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, allNodes]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    try {
      await onGenerateSlide(id, prompt.trim(), data.settings);
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, isGenerating, id, onGenerateSlide, data.settings]);

  const handleRootClick = () => {
    if (isTarget) {
      onCompleteConnect(id);
    } else {
      onSelectNode(id, 'promptNode');
    }
  };

  const borderColor = isSource ? '#0D9488' : isTarget ? '#7C3AED' : '#2A2A35';
  const boxShadow   = isSource
    ? '0 0 0 2px #0D948844, 0 4px 20px rgba(0,0,0,0.4)'
    : isTarget
    ? '0 0 0 2px #7C3AED44, 0 4px 20px rgba(0,0,0,0.4)'
    : '0 4px 20px rgba(0,0,0,0.4)';

  return (
    <div
      onClick={handleRootClick}
      style={{
        width: 360,
        background: '#1A1A1F',
        border: `1px solid ${borderColor}`,
        borderRadius: 12,
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
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: isGenerating ? '#F43F5E' : '#7C3AED', boxShadow: `0 0 6px ${isGenerating ? '#F43F5E' : '#7C3AED'}`, animation: isGenerating ? 'pulse 1s infinite' : 'none' }} />
        <span style={{ color: '#F1F0F5', fontWeight: 600, fontSize: 12 }}>Image Prompt</span>

        <span style={{ fontSize: 10, color: '#9090A8', background: '#111113', padding: '2px 8px', borderRadius: 20, border: '1px solid #2A2A35' }}>Slide {data.slideNumber}</span>

        {/* Connect button */}
        <button
          className="nodrag"
          title={isSource ? 'Cancel connect (click target node)' : 'Click to connect to another node'}
          onClick={e => { e.stopPropagation(); isSource ? onCompleteConnect(id) : onStartConnect(id); }}
          style={{
            marginLeft: 'auto',
            width: 20, height: 20, borderRadius: 5,
            border: `1px solid ${isSource ? '#0D9488' : '#2A2A35'}`,
            background: isSource ? '#0D948822' : '#111113',
            color: isSource ? '#0D9488' : '#55556A',
            cursor: 'pointer', fontSize: 14, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1, padding: 0,
          }}
        >
          {isSource ? '↗' : '+'}
        </button>

        {/* Delete button */}
        <button
          className="nodrag"
          title="Remove node"
          onClick={e => { e.stopPropagation(); onDeleteNode(id); }}
          style={{
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

      {/* Connecting-mode hint */}
      {isSource && (
        <p style={{ fontSize: 10, color: '#0D9488', textAlign: 'center', marginBottom: 8, animation: 'pulse 1s infinite' }}>
          Now click another node to connect →
        </p>
      )}

      <label style={{ color: '#55556A', fontSize: 10, display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Scene Description</label>
      <textarea ref={textareaRef} value={prompt} onChange={e => setPrompt(e.target.value)}
        placeholder="Extreme close-up of the iSupply Pro 2 earbuds on a marble surface, soft studio lighting, cinematic depth of field..."
        style={{ width: '100%', background: '#111113', border: '1px solid #2A2A35', borderRadius: 7, padding: '7px 9px', color: '#F1F0F5', fontSize: 11, resize: 'none', outline: 'none', lineHeight: 1.6, marginBottom: 9, boxSizing: 'border-box', fontFamily: 'inherit', minHeight: 88, overflow: 'hidden' }}
      />

      {/* Live reference detection */}
      {uploadAssets.length > 0 && (
        <div style={{ background: '#111113', border: '1px solid #2A2A35', borderRadius: 7, padding: '7px 9px', marginBottom: 9 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
            <p style={{ fontSize: 9, color: '#55556A', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Reference Detection</p>
            <span
              title="Generation uses up to 14 matched reference images per call"
              style={{
                fontSize: 9,
                color: tagStatuses.filter(s => s.matched).length > 14 ? '#F59E0B' : '#55556A',
                background: '#0A0A0B', padding: '1px 6px', borderRadius: 10,
                border: '1px solid #2A2A35', cursor: 'default',
              }}
            >
              {tagStatuses.filter(s => s.matched).length}/14
            </span>
          </div>
          {tagStatuses.map(s => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: s.matched ? '#0D9488' : '#2A2A35', boxShadow: s.matched ? '0 0 4px #0D9488' : 'none', flexShrink: 0, transition: 'all 0.2s' }} />
              <span style={{ fontSize: 11, color: s.matched ? '#F1F0F5' : '#55556A', flex: 1, transition: 'color 0.2s' }}>{s.name}</span>
              <span style={{ fontSize: 9, color: '#55556A' }}>{s.tags.slice(0, 3).join(', ')}</span>
            </div>
          ))}
        </div>
      )}

      <button onClick={e => { e.stopPropagation(); handleGenerate(); }} disabled={isGenerating || !prompt.trim()}
        style={{
          width: '100%', padding: '8px', borderRadius: 7, border: 'none',
          cursor: isGenerating || !prompt.trim() ? 'not-allowed' : 'pointer',
          background: isGenerating || !prompt.trim() ? '#2A2A35' : 'linear-gradient(135deg, #7C3AED, #0D9488)',
          color: isGenerating || !prompt.trim() ? '#55556A' : '#fff',
          fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
        }}>
        {isGenerating ? 'Generating…' : '✦ Generate Slide'}
      </button>

      <Handle type="source" position={Position.Right}
        style={{ width: 10, height: 10, background: '#7C3AED', border: '2px solid #1A1A1F', boxShadow: '0 0 6px #7C3AED' }} />
    </div>
  );
}
