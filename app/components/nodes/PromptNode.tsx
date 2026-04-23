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

type DetectedInfo = { source: 'explicit' | 'scene'; label: string };

function extractNum(text: string, key: string): number | undefined {
  const m = new RegExp(`${key}["']?\\s*:\\s*([\\d.]+)`, 'i').exec(text);
  return m ? parseFloat(m[1]) : undefined;
}

// Parses [API: model=gemini-3.1-flash-image-preview, temp=1.0, topP=0.97, topK=40, seed=67]
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

export default function PromptNode({ id, data }: NodeProps<PromptNodeData>) {
  const { onGenerateSlide, onUpdateSettings, onSelectNode, onDeleteNode, connectingFromId, onStartConnect, onCompleteConnect } = useContext(StudioContext);
  const allNodes = useNodes();

  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [tagStatuses, setTagStatuses] = useState<TagStatus[]>([]);
  const [detectedInfo, setDetectedInfo] = useState<DetectedInfo | null>(null);
  const debounceRef    = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const autoDetectRef  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tagStrippedRef = useRef(false);
  const textareaRef    = useRef<HTMLTextAreaElement>(null);

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

  // Auto-detect API params from Director prompt output
  useEffect(() => {
    clearTimeout(autoDetectRef.current);
    autoDetectRef.current = setTimeout(() => {
      if (!prompt.trim()) { setDetectedInfo(null); return; }

      // Skip one cycle after we stripped an [API:] tag (prevents re-trigger loop)
      if (tagStrippedRef.current) { tagStrippedRef.current = false; return; }

      // Priority 1: [API: model=..., temp=..., topP=..., topK=..., seed=...] tag on line 1
      const tagResult = parseApiTag(prompt);
      if (tagResult) {
        onUpdateSettings(id, tagResult.patch);
        tagStrippedRef.current = true;
        setPrompt(tagResult.cleanText);
        setDetectedInfo({ source: 'explicit', label: Object.keys(tagResult.patch).join(', ') });
        return;
      }

      // Priority 2: explicit key=value or JSON anywhere in text
      const seed        = extractNum(prompt, 'seed');
      const temperature = extractNum(prompt, 'temperature');
      const topP        = extractNum(prompt, 'top[_\\s-]?p');
      const topK        = extractNum(prompt, 'top[_\\s-]?k');
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

      // Priority 3: scene-type keyword presets
      const lower = prompt.toLowerCase();
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
  }, [prompt]);

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

  const borderColor = isSource ? '#0D9488' : isTarget ? 'var(--studio-accent)' : 'var(--studio-border)';
  const boxShadow   = isSource
    ? '0 0 0 2px #0D948844, 0 4px 20px rgba(0,0,0,0.4)'
    : isTarget
    ? '0 0 0 2px color-mix(in srgb, var(--studio-accent) 27%, transparent), 0 4px 20px rgba(0,0,0,0.4)'
    : '0 4px 20px rgba(0,0,0,0.4)';

  return (
    <div
      onClick={handleRootClick}
      style={{
        width: 360,
        background: 'var(--studio-elevated)',
        border: `1px solid ${borderColor}`,
        borderRadius: 12,
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
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: isGenerating ? '#F43F5E' : 'var(--studio-accent)', boxShadow: `0 0 6px ${isGenerating ? '#F43F5E' : 'var(--studio-accent)'}`, animation: isGenerating ? 'pulse 1s infinite' : 'none' }} />
        <span style={{ color: 'var(--studio-text)', fontWeight: 600, fontSize: 12 }}>Image Prompt</span>

        <span style={{ fontSize: 10, color: 'var(--studio-text-sec)', background: 'var(--studio-surface)', padding: '2px 8px', borderRadius: 20, border: '1px solid var(--studio-border)' }}>Slide {data.slideNumber}</span>

        {/* Collapse toggle */}
        <button
          className="nodrag"
          title={collapsed ? 'Expand' : 'Collapse'}
          onClick={e => { e.stopPropagation(); setCollapsed(v => !v); }}
          style={{
            marginLeft: 'auto',
            width: 20, height: 20, borderRadius: 5,
            border: '1px solid var(--studio-border)', background: 'var(--studio-surface)', color: 'var(--studio-text-muted)',
            cursor: 'pointer', fontSize: 11,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1, padding: 0,
          }}
        >
          <span className={`collapse-chevron ${collapsed ? 'collapsed' : ''}`}>⌄</span>
        </button>

        {/* Connect button */}
        <button
          className="nodrag"
          title={isSource ? 'Cancel connect (click target node)' : 'Click to connect to another node'}
          onClick={e => { e.stopPropagation(); isSource ? onCompleteConnect(id) : onStartConnect(id); }}
          style={{
            width: 20, height: 20, borderRadius: 5,
            border: `1px solid ${isSource ? '#0D9488' : 'var(--studio-border)'}`,
            background: isSource ? '#0D948822' : 'var(--studio-surface)',
            color: isSource ? '#0D9488' : 'var(--studio-text-muted)',
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
      {isSource && (
        <p style={{ fontSize: 10, color: '#0D9488', textAlign: 'center', marginBottom: 8, animation: 'pulse 1s infinite' }}>
          Now click another node to connect →
        </p>
      )}

      {collapsed && (
        <div style={{ fontSize: 11, color: 'var(--studio-text-muted)', fontStyle: 'italic', padding: '4px 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {prompt.trim() ? prompt.slice(0, 80) + (prompt.length > 80 ? '…' : '') : 'Empty prompt — click chevron to expand'}
        </div>
      )}

      {!collapsed && <>
      <label style={{ color: 'var(--studio-text-muted)', fontSize: 10, display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Scene Description</label>
      <textarea ref={textareaRef} value={prompt} onChange={e => setPrompt(e.target.value)}
        placeholder="Extreme close-up of the iSupply Pro 2 earbuds on a marble surface, soft studio lighting, cinematic depth of field..."
        style={{ width: '100%', background: 'var(--studio-surface)', border: '1px solid var(--studio-border)', borderRadius: 7, padding: '7px 9px', color: 'var(--studio-text)', fontSize: 11, resize: 'none', outline: 'none', lineHeight: 1.6, marginBottom: 9, boxSizing: 'border-box', fontFamily: 'inherit', minHeight: 88, overflow: 'hidden' }}
      />

      {/* Live reference detection */}
      {uploadAssets.length > 0 && (
        <div style={{ background: 'var(--studio-surface)', border: '1px solid var(--studio-border)', borderRadius: 7, padding: '7px 9px', marginBottom: 9 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
            <p style={{ fontSize: 9, color: 'var(--studio-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Reference Detection</p>
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

      <button onClick={e => { e.stopPropagation(); handleGenerate(); }} disabled={isGenerating || !prompt.trim()}
        style={{
          width: '100%', padding: '8px', borderRadius: 7, border: 'none',
          cursor: isGenerating || !prompt.trim() ? 'not-allowed' : 'pointer',
          background: isGenerating || !prompt.trim() ? 'var(--studio-border)' : 'linear-gradient(135deg, #7C3AED, #0D9488)',
          color: isGenerating || !prompt.trim() ? 'var(--studio-text-muted)' : '#fff',
          fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
        }}>
        {isGenerating ? 'Generating…' : '✦ Generate Slide'}
      </button>
      </>}

      <Handle type="source" position={Position.Right}
        style={{ width: 10, height: 10, background: 'var(--studio-accent)', border: '2px solid var(--studio-elevated)', boxShadow: '0 0 6px var(--studio-accent)' }} />
    </div>
  );
}
