'use client';

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Handle, NodeProps, Position } from 'reactflow';
import { StudioContext } from '../../context/StudioContext';
import { uploadReferenceImage } from '../../lib/uploadAsset';

interface Asset {
  id: string;
  name: string;
  url: string;
  tags: string[];
}

interface UploadNodeData {
  label: string;
  savedImage?: Asset;
  settings?: Record<string, unknown>;
}

export default function UploadNode({ id, data }: NodeProps<UploadNodeData>) {
  const { onSaveImage, onSelectNode, onDeleteNode, connectingFromId, onStartConnect, onCompleteConnect } = useContext(StudioContext);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<'upload' | 'asset'>('upload');
  const [assetsList, setAssetsList] = useState<Asset[]>([]);
  const [assetSearch, setAssetSearch] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [name, setName] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [allTags, setAllTags] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Fetch existing tags for autocomplete
  useEffect(() => {
    fetch('/api/assets')
      .then(r => r.json())
      .then((data: Asset[]) => {
        if (!Array.isArray(data)) return;
        setAllTags([...new Set(data.flatMap(a => a.tags))].sort());
      })
      .catch(() => {});
  }, []);

  // Fetch assets list when switching to "From Asset" mode
  useEffect(() => {
    if (mode !== 'asset') return;
    fetch('/api/assets')
      .then(r => r.json())
      .then((data: Asset[]) => setAssetsList(Array.isArray(data) ? data : []))
      .catch(() => setAssetsList([]));
  }, [mode]);

  const isSource = connectingFromId === id;
  const isTarget = connectingFromId !== null && connectingFromId !== id;

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    if (!name) setName(f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '));
  }, [name]);

  // Root-level drop handler: checks for asset JSON first, then file drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    // Asset dragged from the Assets panel
    const assetJson = e.dataTransfer.getData('application/json');
    if (assetJson) {
      try {
        const asset = JSON.parse(assetJson) as Asset;
        if (asset.id && asset.url) {
          onSaveImage(id, { id: asset.id, name: asset.name, url: asset.url, tags: asset.tags });
          return;
        }
      } catch { /* not valid asset data, fall through to file drop */ }
    }

    // File drop (upload mode only)
    const f = e.dataTransfer.files[0];
    if (f?.type.startsWith('image/')) handleFile(f);
  }, [handleFile, id, onSaveImage]);

  const parsedTags = tagsInput.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  const saved = Boolean(data.savedImage);

  const handleSave = useCallback(async () => {
    if (!file || !name.trim()) { setError('Image and name are required.'); return; }
    setError('');
    setIsSaving(true);
    try {
      const result = await uploadReferenceImage(file, name.trim(), parsedTags);
      if (!result.success) throw new Error(result.error ?? 'Upload failed');
      onSaveImage(id, { id: result.id!, name: result.name!, url: result.url!, tags: result.tags! });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Check the dev server console for details.');
    } finally {
      setIsSaving(false);
    }
  }, [file, name, parsedTags, id, onSaveImage]);

  const handleSelectAsset = (asset: Asset) => {
    onSaveImage(id, { id: asset.id, name: asset.name, url: asset.url, tags: asset.tags });
  };

  const handleRootClick = () => {
    if (isTarget) {
      onCompleteConnect(id);
    } else {
      onSelectNode(id, 'uploadNode');
    }
  };

  const borderColor = isSource ? '#0D9488' : isTarget ? 'var(--studio-accent)' : saved ? '#0D9488' : 'var(--studio-border)';
  const boxShadow = isSource
    ? '0 0 0 2px #0D948844, 0 4px 20px rgba(0,0,0,0.4)'
    : isTarget
    ? '0 0 0 2px color-mix(in srgb, var(--studio-accent) 27%, transparent), 0 4px 20px rgba(0,0,0,0.4)'
    : saved
    ? '0 0 0 1px #0D948830, 0 4px 20px #0D948820'
    : '0 4px 20px rgba(0,0,0,0.4)';

  const filteredAssets = assetsList.filter(a =>
    !assetSearch ||
    a.name.toLowerCase().includes(assetSearch.toLowerCase()) ||
    a.tags.some(t => t.includes(assetSearch.toLowerCase()))
  );

  return (
    <div
      onClick={handleRootClick}
      onDrop={handleDrop}
      onDragOver={e => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Element)) setIsDragging(false); }}
      style={{
        width: 300,
        background: 'var(--studio-elevated)',
        border: `1px solid ${isDragging ? 'var(--studio-accent)' : borderColor}`,
        borderRadius: 12,
        padding: 14,
        boxShadow: isDragging ? '0 0 0 2px color-mix(in srgb, var(--studio-accent) 27%, transparent), 0 4px 20px rgba(0,0,0,0.4)' : boxShadow,
        cursor: isTarget ? 'crosshair' : 'default',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        position: 'relative',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: saved ? '#0D9488' : 'var(--studio-text-muted)', boxShadow: saved ? '0 0 5px #0D9488' : 'none' }} />
        <span style={{ color: 'var(--studio-text)', fontWeight: 600, fontSize: 12 }}>Image Reference</span>
        {saved && <span style={{ fontSize: 10, color: '#0D9488', background: '#0D948818', padding: '2px 7px', borderRadius: 20, border: '1px solid #0D948840' }}>Saved</span>}

        {/* Connect button */}
        <button
          className="nodrag"
          title={isSource ? 'Cancel connect (click target node)' : 'Click to connect to another node'}
          onClick={e => { e.stopPropagation(); isSource ? onCompleteConnect(id) : onStartConnect(id); }}
          style={{
            marginLeft: 'auto',
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
        >
          ×
        </button>
      </div>

      {/* Connecting-mode hint */}
      {isSource && (
        <p style={{ fontSize: 10, color: '#0D9488', textAlign: 'center', marginBottom: 8, animation: 'pulse 1s infinite' }}>
          Now click another node to connect →
        </p>
      )}

      {/* Saved preview */}
      {saved ? (
        <>
          <div style={{ marginBottom: 10, borderRadius: 7, overflow: 'hidden', position: 'relative' }}>
            <img src={data.savedImage!.url} alt={data.savedImage!.name} style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, #0A0A0Bcc 0%, transparent 55%)' }} />
            <div style={{ position: 'absolute', bottom: 7, left: 9, color: 'var(--studio-text)', fontSize: 11, fontWeight: 500 }}>{data.savedImage!.name}</div>
          </div>
          {data.savedImage!.tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 4 }}>
              {data.savedImage!.tags.map(t => (
                <span key={t} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, background: '#0D948818', color: '#0D9488', border: '1px solid #0D948840' }}>{t}</span>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {/* Mode toggle */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 9 }}>
            {(['upload', 'asset'] as const).map(m => (
              <button key={m} className="nodrag" onClick={e => { e.stopPropagation(); setMode(m); }}
                style={{ flex: 1, padding: '4px', fontSize: 10, fontWeight: 600, borderRadius: 5, border: `1px solid ${mode === m ? 'var(--studio-accent)' : 'var(--studio-border)'}`, background: mode === m ? 'color-mix(in srgb, var(--studio-accent) 13%, transparent)' : 'var(--studio-surface)', color: mode === m ? 'var(--studio-accent)' : 'var(--studio-text-muted)', cursor: 'pointer' }}>
                {m === 'upload' ? 'Upload' : 'From Asset'}
              </button>
            ))}
          </div>

          {mode === 'upload' ? (
            <>
              {/* Drop zone — clicking opens file browser; actual drop handled by root div */}
              <div
                className="nodrag"
                onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
                style={{
                  border: `2px dashed ${isDragging ? 'var(--studio-accent)' : 'var(--studio-border)'}`,
                  borderRadius: 7,
                  padding: '16px 12px',
                  marginBottom: 10,
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: isDragging ? 'color-mix(in srgb, var(--studio-accent) 7%, transparent)' : 'var(--studio-surface)',
                  transition: 'all 0.2s',
                }}
              >
                {previewUrl
                  ? <img src={previewUrl} alt="preview" style={{ width: '100%', height: 90, objectFit: 'cover', borderRadius: 5 }} />
                  : <>
                      <div style={{ fontSize: 20, marginBottom: 5 }}>📂</div>
                      <div style={{ color: 'var(--studio-text-sec)', fontSize: 11 }}>
                        Drop image or <span style={{ color: 'var(--studio-accent)', textDecoration: 'underline' }}>browse</span>
                      </div>
                      {isDragging && <div style={{ fontSize: 10, color: 'var(--studio-accent)', marginTop: 4 }}>Release to drop</div>}
                    </>
                }
              </div>

              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

              <input type="text" placeholder="Asset name (e.g. Pro 2 White)" value={name} onChange={e => setName(e.target.value)}
                style={{ width: '100%', background: 'var(--studio-surface)', border: '1px solid var(--studio-border)', borderRadius: 6, padding: '6px 9px', color: 'var(--studio-text)', fontSize: 11, outline: 'none', marginBottom: 7, boxSizing: 'border-box' }} />

              {/* Tags input with autocomplete */}
              <div style={{ position: 'relative', marginBottom: 7 }}>
                <input type="text" placeholder="Tags: earbuds, white, stem-style" value={tagsInput}
                  onChange={e => { setTagsInput(e.target.value); setShowSuggestions(true); }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  style={{ width: '100%', background: 'var(--studio-surface)', border: '1px solid var(--studio-border)', borderRadius: 6, padding: '6px 9px', color: 'var(--studio-text)', fontSize: 11, outline: 'none', boxSizing: 'border-box' }} />
                {showSuggestions && (() => {
                  const lastTag = tagsInput.split(',').pop()?.trim() ?? '';
                  const suggestions = lastTag.length >= 1
                    ? allTags.filter(t => t.includes(lastTag) && !parsedTags.includes(t))
                    : [];
                  return suggestions.length > 0 ? (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--studio-elevated)', border: '1px solid var(--studio-border)', borderRadius: 6, zIndex: 10, maxHeight: 100, overflowY: 'auto' }}>
                      {suggestions.slice(0, 8).map(s => (
                        <div key={s} onMouseDown={() => {
                          const parts = tagsInput.split(',');
                          parts[parts.length - 1] = ` ${s}`;
                          setTagsInput(parts.join(',').trimStart() + ', ');
                        }} style={{ padding: '5px 9px', fontSize: 11, color: 'var(--studio-text-sec)', cursor: 'pointer', borderBottom: '1px solid var(--studio-border)' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--studio-surface)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >{s}</div>
                      ))}
                    </div>
                  ) : null;
                })()}
              </div>

              {parsedTags.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 8 }}>
                  {parsedTags.map(t => (
                    <span key={t} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, background: 'color-mix(in srgb, var(--studio-accent) 10%, transparent)', color: 'var(--studio-accent)', border: '1px solid color-mix(in srgb, var(--studio-accent) 20%, transparent)' }}>{t}</span>
                  ))}
                </div>
              )}
              {error && <p style={{ color: '#F43F5E', fontSize: 10, marginBottom: 7 }}>{error}</p>}

              <button onClick={e => { e.stopPropagation(); handleSave(); }} disabled={isSaving}
                style={{ width: '100%', padding: '7px', borderRadius: 6, border: 'none', cursor: isSaving ? 'not-allowed' : 'pointer', background: isSaving ? 'var(--studio-border)' : 'linear-gradient(135deg, #7C3AED, #0D9488)', color: isSaving ? 'var(--studio-text-muted)' : '#fff', fontSize: 12, fontWeight: 600 }}>
                {isSaving ? 'Saving…' : 'Save Reference'}
              </button>
            </>
          ) : (
            /* ── From Asset mode ── */
            <>
              <input
                type="text"
                placeholder="Search by name or tag…"
                value={assetSearch}
                onChange={e => setAssetSearch(e.target.value)}
                style={{ width: '100%', background: 'var(--studio-surface)', border: '1px solid var(--studio-border)', borderRadius: 6, padding: '6px 9px', color: 'var(--studio-text)', fontSize: 11, outline: 'none', marginBottom: 7, boxSizing: 'border-box' }}
              />
              {filteredAssets.length === 0 ? (
                <p style={{ fontSize: 11, color: 'var(--studio-text-muted)', textAlign: 'center', padding: '14px 0' }}>
                  {assetsList.length === 0 ? 'No saved assets yet — upload one first.' : 'No matching assets.'}
                </p>
              ) : (
                <div className="nodrag" style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {filteredAssets.map(a => (
                    <div key={a.id}
                      onClick={e => { e.stopPropagation(); handleSelectAsset(a); }}
                      style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--studio-surface)', border: '1px solid var(--studio-border)', borderRadius: 6, padding: 6, cursor: 'pointer', transition: 'border-color 0.15s' }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--studio-accent) 27%, transparent)')}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--studio-border)')}
                    >
                      <img src={a.url} alt={a.name} style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 11, color: 'var(--studio-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>{a.name}</p>
                        <p style={{ fontSize: 9, color: 'var(--studio-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.tags.join(', ') || 'no tags'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      <Handle type="source" position={Position.Right}
        style={{ width: 10, height: 10, background: 'var(--studio-accent)', border: '2px solid var(--studio-elevated)', boxShadow: '0 0 6px var(--studio-accent)' }} />
    </div>
  );
}
