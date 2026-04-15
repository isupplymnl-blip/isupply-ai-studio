'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Edge, Node } from 'reactflow';

export interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  nodeId: string;
  createdAt: string;
  source?: 'local' | 'supabase';
  supabaseUrl?: string;
}

export interface Batch {
  id: string;
  name: string;
  createdAt: string;
  batchType?: 'standard' | 'automated';
  nodes: Node[];
  edges: Edge[];
  generatedImages: GeneratedImage[];
}

const STORAGE_KEY = 'isupply-studio-batches';
const ACTIVE_KEY  = 'isupply-studio-active-batch';
const LIBRARY_KEY = 'isupply-studio-library';

const DEFAULT_NODES: Node[] = [
  { id: 'upload-1',  type: 'uploadNode',  position: { x: 60,  y: 80  }, data: { label: 'Reference 1' } },
  { id: 'prompt-1',  type: 'promptNode',  position: { x: 440, y: 60  }, data: { label: 'Slide 1', slideNumber: 1 } },
  { id: 'output-1',  type: 'outputNode',  position: { x: 880, y: 60  }, data: { label: 'Output 1', slideNumber: 1, isLoading: false, imageUrl: '' } },
];
const DEFAULT_EDGES: Edge[] = [];

// Static initial batch — fixed ID and date so SSR and first client render match exactly
const INITIAL_BATCH_ID = 'batch-initial';
const INITIAL_BATCH: Batch = {
  id: INITIAL_BATCH_ID,
  name: 'First Batch',
  createdAt: '2024-01-01T00:00:00.000Z',
  batchType: 'standard',
  nodes: DEFAULT_NODES,
  edges: DEFAULT_EDGES,
  generatedImages: [],
};

function makeBatch(name: string, nodes = DEFAULT_NODES, edges = DEFAULT_EDGES): Batch {
  return { id: `batch-${Date.now()}`, name, createdAt: new Date().toISOString(), batchType: 'standard', nodes, edges, generatedImages: [] };
}

function makeAutomatedBatch(name: string): Batch {
  return { id: `batch-${Date.now()}`, name, createdAt: new Date().toISOString(), batchType: 'automated', nodes: [], edges: [], generatedImages: [] };
}

function load<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch { return fallback; }
}

export function useBatchHistory() {
  // Static initial state — avoids SSR/client hydration mismatch
  const [batches, setBatches] = useState<Batch[]>([INITIAL_BATCH]);
  const [activeBatchId, setActiveBatchId] = useState<string>(INITIAL_BATCH_ID);
  const [globalLibrary, setGlobalLibrary] = useState<GeneratedImage[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Load real data from localStorage after mount (client-only)
  useEffect(() => {
    const stored = load<Batch[]>(STORAGE_KEY, []);
    const loadedBatches = stored.length ? stored : [makeBatch('First Batch')];
    const activeId = load<string>(ACTIVE_KEY, '') || loadedBatches[0].id;
    const library  = load<GeneratedImage[]>(LIBRARY_KEY, []);
    setBatches(loadedBatches);
    setActiveBatchId(activeId);
    setGlobalLibrary(library);
    setHydrated(true);
  }, []);

  // Persist — only after hydration to avoid overwriting real data with the static initial state
  useEffect(() => { if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(batches)); }, [batches, hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem(ACTIVE_KEY, activeBatchId); }, [activeBatchId, hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem(LIBRARY_KEY, JSON.stringify(globalLibrary)); }, [globalLibrary, hydrated]);

  const activeBatch = batches.find(b => b.id === activeBatchId) ?? batches[0];

  const batchesRef = useRef(batches);
  batchesRef.current = batches;

  const saveCurrentBatch = useCallback((nodes: Node[], edges: Edge[]) => {
    setBatches(prev => prev.map(b =>
      b.id === activeBatchId ? { ...b, nodes, edges } : b
    ));
  }, [activeBatchId]);

  const switchBatch = useCallback((targetId: string, currentNodes: Node[], currentEdges: Edge[]) => {
    setBatches(prev => prev.map(b =>
      b.id === activeBatchId ? { ...b, nodes: currentNodes, edges: currentEdges } : b
    ));
    setActiveBatchId(targetId);
  }, [activeBatchId]);

  const newBatch = useCallback((name: string, currentNodes: Node[], currentEdges: Edge[]) => {
    const fresh = makeBatch(name);
    setBatches(prev => {
      const updated = prev.map(b =>
        b.id === activeBatchId ? { ...b, nodes: currentNodes, edges: currentEdges } : b
      );
      return [...updated, fresh];
    });
    setActiveBatchId(fresh.id);
    return fresh;
  }, [activeBatchId]);

  const newAutomatedBatch = useCallback((name: string, currentNodes: Node[], currentEdges: Edge[]) => {
    const fresh = makeAutomatedBatch(name);
    setBatches(prev => {
      const updated = prev.map(b =>
        b.id === activeBatchId ? { ...b, nodes: currentNodes, edges: currentEdges } : b
      );
      return [...updated, fresh];
    });
    setActiveBatchId(fresh.id);
    return fresh;
  }, [activeBatchId]);

  const renameBatch = useCallback((batchId: string, name: string) => {
    setBatches(prev => prev.map(b => b.id === batchId ? { ...b, name } : b));
  }, []);

  const deleteBatch = useCallback((batchId: string, currentNodes: Node[], currentEdges: Edge[]) => {
    setBatches(prev => {
      if (prev.length === 1) return prev;
      return prev.filter(b => b.id !== batchId);
    });
    if (batchId === activeBatchId) {
      const remaining = batchesRef.current.filter(b => b.id !== batchId);
      if (remaining.length) setActiveBatchId(remaining[0].id);
    }
  }, [activeBatchId]);

  /** Add a generated image to both the active batch AND the persistent global library */
  const addGeneratedImage = useCallback((image: GeneratedImage) => {
    setBatches(prev => prev.map(b =>
      b.id === activeBatchId
        ? { ...b, generatedImages: [image, ...b.generatedImages] }
        : b
    ));
    setGlobalLibrary(prev => [image, ...prev]);
  }, [activeBatchId]);

  /** Add a generated image to a specific batch (for background EccoAPI completions) */
  const addGeneratedImageToBatch = useCallback((batchId: string, image: GeneratedImage) => {
    setBatches(prev => prev.map(b =>
      b.id === batchId
        ? { ...b, generatedImages: [image, ...b.generatedImages] }
        : b
    ));
    setGlobalLibrary(prev => [image, ...prev]);
  }, []);

  /** Remove from active batch only (image still in global library) */
  const removeGeneratedImage = useCallback((imageId: string) => {
    setBatches(prev => prev.map(b =>
      b.id === activeBatchId
        ? { ...b, generatedImages: b.generatedImages.filter(img => img.id !== imageId) }
        : b
    ));
  }, [activeBatchId]);

  /** Remove from the global persistent library */
  const removeFromGlobalLibrary = useCallback((imageId: string) => {
    setGlobalLibrary(prev => prev.filter(img => img.id !== imageId));
  }, []);

  /** Mark images as supabase-hosted after successful export */
  const updateGeneratedImageSource = useCallback((localUrl: string, supabaseUrl: string) => {
    const updater = (img: GeneratedImage) =>
      img.url === localUrl ? { ...img, source: 'supabase' as const, supabaseUrl } : img;
    setGlobalLibrary(prev => prev.map(updater));
    setBatches(prev => prev.map(b => ({ ...b, generatedImages: b.generatedImages.map(updater) })));
  }, []);

  return {
    batches, activeBatch, activeBatchId, globalLibrary,
    saveCurrentBatch, switchBatch, newBatch, newAutomatedBatch,
    renameBatch, deleteBatch,
    addGeneratedImage, addGeneratedImageToBatch, removeGeneratedImage, removeFromGlobalLibrary,
    updateGeneratedImageSource,
  };
}
