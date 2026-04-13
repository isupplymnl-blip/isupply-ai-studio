'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Edge,
  Node,
  Connection,
} from 'reactflow';
import 'reactflow/dist/style.css';
import JSZip from 'jszip';
import { toPng } from 'html-to-image';

import UploadNode        from './components/nodes/UploadNode';
import PromptNode        from './components/nodes/PromptNode';
import OutputNode        from './components/nodes/OutputNode';
import ModelCreationNode from './components/nodes/ModelCreationNode';
import CarouselPromptNode from './components/nodes/CarouselPromptNode';
import GradientEdge      from './components/edges/GradientEdge';
import WelcomeDialog     from './components/WelcomeDialog';
import { StudioContext, SavedImage, NodeSettings, CarouselSlide } from './context/StudioContext';
import { useBatchHistory, GeneratedImage } from './hooks/useBatchHistory';
import { useGenerationQueue, GenerationJob } from './hooks/useGenerationQueue';

// Module-level constants — never re-registered between renders
const nodeTypes = { uploadNode: UploadNode, promptNode: PromptNode, outputNode: OutputNode, modelCreationNode: ModelCreationNode, carouselNode: CarouselPromptNode };
const edgeTypes = { gradient: GradientEdge };
const mkEdge = (id: string, src: string, tgt: string): Edge => ({ id, source: src, target: tgt, type: 'gradient', animated: true });

// ─── Main canvas component ────────────────────────────────────────────────────
function StudioCanvas() {
  const { batches, activeBatch, activeBatchId, globalLibrary, saveCurrentBatch, switchBatch, newBatch, newAutomatedBatch, renameBatch, deleteBatch, addGeneratedImage, addGeneratedImageToBatch, removeGeneratedImage, removeFromGlobalLibrary } = useBatchHistory();
  const libraryImages = globalLibrary;

  const [nodes, setNodes] = useState<Node[]>(activeBatch?.nodes ?? []);
  const [edges, setEdges] = useState<Edge[]>(activeBatch?.edges ?? []);

  // Welcome dialog — show on every page load
  const [showWelcome, setShowWelcome] = useState(true);

  // Carousel slide count picker state
  const [carouselPicker, setCarouselPicker] = useState<{ visible: boolean; count: number }>({ visible: false, count: 6 });

  // Sidebar batch-type dropdown
  const [showBatchTypeMenu, setShowBatchTypeMenu] = useState(false);

  // Sync nodes/edges when active batch changes
  const prevBatchId = useRef(activeBatchId);
  useEffect(() => {
    if (activeBatchId !== prevBatchId.current) {
      setNodes(activeBatch?.nodes ?? []);
      setEdges(activeBatch?.edges ?? []);
      prevBatchId.current = activeBatchId;
    }
  }, [activeBatchId, activeBatch]);

  // Auto-save canvas state every 3s
  useEffect(() => {
    const t = setInterval(() => saveCurrentBatch(nodes, edges), 3000);
    return () => clearInterval(t);
  }, [nodes, edges, saveCurrentBatch]);

  // ── Provider & credits state ──────────────────────────────────────────────
  const [activeProvider, setActiveProvider] = useState<'gemini' | 'ecco'>('gemini');
  const [eccoCredits, setEccoCredits] = useState<number | null>(null);
  const activeProviderRef = useRef<'gemini' | 'ecco'>('gemini');
  activeProviderRef.current = activeProvider;
  const activeBatchIdRef = useRef(activeBatchId);
  activeBatchIdRef.current = activeBatchId;
  // Map outputNodeId → prompt text for background-completed jobs
  const pendingPromptsRef = useRef(new Map<string, string>());

  useEffect(() => {
    // localStorage override takes priority over server env var
    const saved = localStorage.getItem('isupply-provider') as 'gemini' | 'ecco' | null;
    if (saved) {
      setActiveProvider(saved);
    } else {
      fetch('/api/config')
        .then(r => r.json())
        .then(d => { setActiveProvider(d.provider ?? 'gemini'); })
        .catch(() => {});
    }
    const savedCredits = localStorage.getItem('isupply-ecco-credits');
    if (savedCredits !== null) setEccoCredits(parseFloat(savedCredits));
  }, []);

  const toggleProvider = useCallback(() => {
    const next = activeProvider === 'gemini' ? 'ecco' : 'gemini';
    setActiveProvider(next);
    localStorage.setItem('isupply-provider', next);
  }, [activeProvider]);

  const edgesRef = useRef<Edge[]>(edges);
  edgesRef.current = edges;
  const nodesRef = useRef<Node[]>(nodes);
  nodesRef.current = nodes;

  // ── EccoAPI generation queue ──────────────────────────────────────────────

  const handleJobComplete = useCallback((job: GenerationJob) => {
    const imageUrl = job.imageUrl!;
    const prompt = pendingPromptsRef.current.get(job.nodeId) ?? '';
    pendingPromptsRef.current.delete(job.nodeId);

    // Update canvas node only if the batch is still active
    if (job.batchId === activeBatchIdRef.current) {
      setNodes(nds => nds.map(n =>
        n.id === job.nodeId ? { ...n, data: { ...n.data, isLoading: false, imageUrl, error: undefined } } : n
      ));
    }
    addGeneratedImageToBatch(job.batchId, {
      id: `img-${Date.now()}`,
      url: imageUrl,
      prompt,
      nodeId: job.nodeId,
      createdAt: new Date().toISOString(),
    });
    if (job.remaining_credits !== undefined) {
      setEccoCredits(job.remaining_credits);
      localStorage.setItem('isupply-ecco-credits', String(job.remaining_credits));
    }
  }, [addGeneratedImageToBatch]);

  const handleJobError = useCallback((job: GenerationJob) => {
    if (job.batchId === activeBatchIdRef.current) {
      setNodes(nds => nds.map(n =>
        n.id === job.nodeId ? { ...n, data: { ...n.data, isLoading: false, error: job.error ?? 'Generation failed' } } : n
      ));
    }
  }, []);

  const { jobs, addJob, markBatchSeen } = useGenerationQueue({
    onJobComplete: handleJobComplete,
    onJobError:    handleJobError,
  });

  const callEccoGenerate = useCallback(async (
    outputNodeId: string,
    body: Record<string, unknown>,
  ) => {
    const currentBatchId = activeBatchIdRef.current;
    pendingPromptsRef.current.set(outputNodeId, (body.prompt as string) ?? '');
    setNodes(nds => nds.map(n =>
      n.id === outputNodeId ? { ...n, data: { ...n.data, isLoading: true, error: undefined } } : n
    ));
    try {
      const res = await fetch('/api/ecco/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, batchId: currentBatchId }),
      });

      if (res.status === 200) {
        // Sync mode — result is immediate
        const data = await res.json() as { imageUrl?: string; error?: string; remaining_credits?: number; cost?: number };
        if (!data.imageUrl) throw new Error(data.error ?? 'EccoAPI returned no image');
        const prompt = pendingPromptsRef.current.get(outputNodeId) ?? '';
        pendingPromptsRef.current.delete(outputNodeId);
        setNodes(nds => nds.map(n =>
          n.id === outputNodeId ? { ...n, data: { ...n.data, isLoading: false, imageUrl: data.imageUrl, error: undefined } } : n
        ));
        addGeneratedImageToBatch(currentBatchId, {
          id: `img-${Date.now()}`,
          url: data.imageUrl,
          prompt,
          nodeId: outputNodeId,
          createdAt: new Date().toISOString(),
        });
        if (data.remaining_credits !== undefined) {
          setEccoCredits(data.remaining_credits);
          localStorage.setItem('isupply-ecco-credits', String(data.remaining_credits));
        }
      } else if (res.status === 202) {
        // Async mode — poll for result
        const data = await res.json() as { jobId?: string; error?: string };
        if (!data.jobId) throw new Error(data.error ?? 'EccoAPI request failed');
        addJob({ id: data.jobId, nodeId: outputNodeId, batchId: currentBatchId });
      } else {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? `EccoAPI error ${res.status}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Generation failed';
      pendingPromptsRef.current.delete(outputNodeId);
      setNodes(nds => nds.map(n =>
        n.id === outputNodeId ? { ...n, data: { ...n.data, isLoading: false, error: msg } } : n
      ));
    }
  }, [addJob, addGeneratedImageToBatch]);

  // UI state
  const [selectedNodeId,    setSelectedNodeId]   = useState<string | null>(null);
  const [selectedNodeType,  setSelectedNodeType] = useState<string | null>(null);
  const [connectingFromId,  setConnectingFromId] = useState<string | null>(null);
  const [modalImageUrl,     setModalImageUrl]    = useState<string | null>(null);
  const [contextMenu,       setContextMenu]      = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [isExporting,       setIsExporting]      = useState(false);
  const [leftTab,  setLeftTab]  = useState<'batches' | 'assets' | 'library'>('batches');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [assetsList,       setAssetsList]       = useState<Array<{ id: string; name: string; url: string; tags: string[] }>>([]);
  const [selectedAssetId,  setSelectedAssetId]  = useState<string | null>(null);
  const [editAssetName,    setEditAssetName]    = useState('');
  const [editAssetTags,    setEditAssetTags]    = useState('');
  const [isSavingAsset,    setIsSavingAsset]    = useState(false);
  const [selectedLibImgId, setSelectedLibImgId] = useState<string | null>(null);

  const refreshAssets = () =>
    fetch('/api/assets')
      .then(r => r.json())
      .then(data => setAssetsList(Array.isArray(data) ? data : []))
      .catch(() => setAssetsList([]));

  // Fetch assets whenever Assets tab is opened
  useEffect(() => {
    if (leftTab !== 'assets') return;
    refreshAssets();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftTab]);

  const handleSelectAsset = (id: string) => {
    const a = assetsList.find(x => x.id === id);
    if (!a) return;
    setSelectedAssetId(id);
    setEditAssetName(a.name);
    setEditAssetTags(a.tags.join(', '));
    // Clear node selection so right panel shows asset editor
    setSelectedNodeId(null);
    setSelectedNodeType(null);
  };

  const handleSaveAsset = async () => {
    if (!selectedAssetId) return;
    setIsSavingAsset(true);
    const tags = editAssetTags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    await fetch(`/api/assets/${selectedAssetId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editAssetName, tags }),
    });
    await refreshAssets();
    setIsSavingAsset(false);
  };

  const handleRemoveAsset = async (id: string) => {
    await fetch(`/api/assets/${id}`, { method: 'DELETE' });
    if (selectedAssetId === id) setSelectedAssetId(null);
    await refreshAssets();
  };
  const [renameVal,  setRenameVal]  = useState('');
  const [newBatchName, setNewBatchName] = useState('');

  const selectedNode = nodes.find(n => n.id === selectedNodeId) ?? null;

  // ── React Flow handlers ──────────────────────────────────────────────────
  const onNodesChange = useCallback((changes: Parameters<typeof applyNodeChanges>[0]) =>
    setNodes(nds => applyNodeChanges(changes, nds)), []);
  const onEdgesChange = useCallback((changes: Parameters<typeof applyEdgeChanges>[0]) =>
    setEdges(eds => applyEdgeChanges(changes, eds)), []);
  const onConnect = useCallback((params: Connection) =>
    setEdges(eds => addEdge({ ...params, type: 'gradient', animated: true }, eds)), []);
  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedNodeType(null);
    setConnectingFromId(null);
    setContextMenu(null);
  }, []);

  // Right-click context menu on nodes
  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    setContextMenu({ nodeId: node.id, x: e.clientX, y: e.clientY });
  }, []);

  // ── Studio context callbacks ─────────────────────────────────────────────

  const onSelectNode = useCallback((nodeId: string, nodeType: string) => {
    setSelectedNodeId(nodeId);
    setSelectedNodeType(nodeType);
    setSelectedAssetId(null);
    setSelectedLibImgId(null);
  }, []);

  const onSaveImage = useCallback((nodeId: string, image: SavedImage) => {
    setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, savedImage: image } } : n));
  }, []);

  const onUpdateSettings = useCallback((nodeId: string, settings: Partial<NodeSettings>) => {
    setNodes(nds => nds.map(n =>
      n.id === nodeId ? { ...n, data: { ...n.data, settings: { ...(n.data as { settings?: NodeSettings }).settings, ...settings } } } : n
    ));
  }, []);

  const onAddToLibrary = useCallback((image: Omit<GeneratedImage, 'id'>) => {
    addGeneratedImage({ ...image, id: `img-${Date.now()}` });
  }, [addGeneratedImage]);

  const onDeleteNode = useCallback((nodeId: string) => {
    setNodes(nds => nds.filter(n => n.id !== nodeId));
    setEdges(eds => eds.filter(e => e.source !== nodeId && e.target !== nodeId));
    if (selectedNodeId === nodeId) { setSelectedNodeId(null); setSelectedNodeType(null); }
    setConnectingFromId(prev => prev === nodeId ? null : prev);
  }, [selectedNodeId]);

  const onStartConnect = useCallback((nodeId: string) => {
    setConnectingFromId(nodeId);
  }, []);

  // Duplicate a node (offset by 60px, clear generated content)
  const onDuplicateNode = useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    const newId = `${node.type}-${Date.now()}`;
    setNodes(nds => [...nds, {
      ...node, id: newId,
      position: { x: node.position.x + 60, y: node.position.y + 60 },
      selected: false,
      data: { ...node.data, imageUrl: '', isLoading: false, error: undefined, promptHistory: [] },
    }]);
    setContextMenu(null);
  }, [nodes]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setConnectingFromId(null); setContextMenu(null); }
      if (e.key === 'Delete' && selectedNodeId && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        setNodes(nds => nds.filter(n => n.id !== selectedNodeId));
        setEdges(eds => eds.filter(ed => ed.source !== selectedNodeId && ed.target !== selectedNodeId));
        setSelectedNodeId(null); setSelectedNodeType(null);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && selectedNodeId) {
        e.preventDefault();
        onDuplicateNode(selectedNodeId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedNodeId, onDuplicateNode]);

  // Download all library images as ZIP
  const handleDownloadAll = useCallback(async () => {
    if (!libraryImages.length) return;
    const zip  = new JSZip();
    const folder = zip.folder('library')!;
    for (const img of libraryImages) {
      try {
        const res  = await fetch(img.url);
        const blob = await res.blob();
        folder.file(`${img.id}.png`, blob);
      } catch { /* skip */ }
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `library-${Date.now()}.zip`;
    a.click();
  }, [libraryImages]);

  // Export canvas as PNG
  const handleExportCanvas = useCallback(async () => {
    const el = document.querySelector('.react-flow') as HTMLElement | null;
    if (!el) return;
    setIsExporting(true);
    try {
      const dataUrl = await toPng(el, { backgroundColor: '#0A0A0B', pixelRatio: 2 });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `canvas-${Date.now()}.png`;
      a.click();
    } finally {
      setIsExporting(false);
    }
  }, []);

  const onCompleteConnect = useCallback((targetNodeId: string) => {
    setConnectingFromId(prev => {
      if (!prev || prev === targetNodeId) return null;
      const newEdge: Edge = {
        id: `e-${prev}-${targetNodeId}-${Date.now()}`,
        source: prev,
        target: targetNodeId,
        type: 'gradient',
        animated: true,
      };
      setEdges(eds => [...eds, newEdge]);
      return null;
    });
  }, []);

  const callGenerate = useCallback(async (
    outputNodeIds: string[],
    body: Record<string, unknown>,
  ) => {
    setNodes(nds => nds.map(n =>
      outputNodeIds.includes(n.id) ? { ...n, data: { ...n.data, isLoading: true, error: undefined } } : n
    ));
    try {
      const res  = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json() as { imageUrl?: string; error?: string };
      if (!res.ok || !data.imageUrl) throw new Error(data.error ?? 'No image returned');
      const promptText = body.prompt as string;
      const historyEntry = { prompt: promptText, ts: new Date().toISOString() };
      setNodes(nds => nds.map(n => {
        if (outputNodeIds.includes(n.id))
          return { ...n, data: { ...n.data, isLoading: false, imageUrl: data.imageUrl, lastPrompt: promptText, error: undefined } };
        // Save prompt history on the originating prompt node
        if (body.type === 'slide' && n.id === body.nodeId) {
          type H = { prompt: string; ts: string };
          const prev = (n.data as { promptHistory?: H[] }).promptHistory ?? [];
          return { ...n, data: { ...n.data, promptHistory: [historyEntry, ...prev].slice(0, 10) } };
        }
        return n;
      }));
      addGeneratedImage({ id: `img-${Date.now()}`, url: data.imageUrl, prompt: promptText, nodeId: outputNodeIds[0], createdAt: new Date().toISOString() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Generation failed';
      setNodes(nds => nds.map(n =>
        outputNodeIds.includes(n.id) ? { ...n, data: { ...n.data, isLoading: false, error: msg } } : n
      ));
    }
  }, [addGeneratedImage]);

  /** Collect URLs of UploadNodes connected as inputs to a given node */
  const getConnectedUploadUrls = useCallback((nodeId: string): string[] =>
    edgesRef.current
      .filter(e => e.target === nodeId)
      .map(e => nodesRef.current.find(n => n.id === e.source))
      .filter(n => n?.type === 'uploadNode')
      .map(n => (n?.data as { savedImage?: { url: string } })?.savedImage?.url)
      .filter((url): url is string => !!url),
  []);

  const onGenerateSlide = useCallback(async (promptNodeId: string, prompt: string, settings?: NodeSettings) => {
    const count = Math.max(1, settings?.count ?? 1);
    const existingOutIds = edgesRef.current.filter(e => e.source === promptNodeId).map(e => e.target);
    const allOutIds = [...existingOutIds];

    if (count > existingOutIds.length) {
      const promptNode = nodesRef.current.find(n => n.id === promptNodeId);
      const baseX = (promptNode?.position.x ?? 440) + 440;
      const baseY = promptNode?.position.y ?? 60;
      const outputCount = nodesRef.current.filter(n => n.type === 'outputNode').length;
      const newNodes: Node[] = [];
      const newEdges: Edge[] = [];
      for (let i = existingOutIds.length; i < count; i++) {
        const oid = `output-${Date.now()}-${i}`;
        const slideNum = outputCount + (i - existingOutIds.length) + 1;
        newNodes.push({ id: oid, type: 'outputNode', position: { x: baseX, y: baseY + (i - existingOutIds.length) * 320 }, data: { label: `Output ${slideNum}`, slideNumber: slideNum, isLoading: false, imageUrl: '' } });
        newEdges.push(mkEdge(`e-${promptNodeId}-${oid}`, promptNodeId, oid));
        allOutIds.push(oid);
      }
      setNodes(nds => [...nds, ...newNodes]);
      setEdges(eds => [...eds, ...newEdges]);
    }

    if (!allOutIds.length) return;

    const referenceUrls = getConnectedUploadUrls(promptNodeId);

    if (activeProviderRef.current === 'ecco') {
      const model = (settings?.eccoModel as string | undefined) ?? 'nanobanana31';
      const aspectRatio = settings?.aspectRatio ?? '4:5';
      const imageSize = settings?.imageSize ?? '1K';
      await Promise.all(allOutIds.map(outId =>
        callEccoGenerate(outId, {
          prompt, nodeId: promptNodeId, model, aspectRatio, imageSize,
          useGoogleSearch:  settings?.useGoogleSearch  ?? false,
          temperature:      settings?.temperature      ?? 1.0,
          includeThoughts:  settings?.includeThoughts  ?? true,
          mediaResolution:  settings?.mediaResolution  ?? 'media_resolution_high',
          safetyThreshold:  settings?.safetyThreshold  ?? 'BLOCK_MEDIUM_AND_ABOVE',
          useAsync:         settings?.useAsync         ?? false,
          referenceUrls,
        })
      ));
    } else {
      await Promise.all(allOutIds.map(outId =>
        callGenerate([outId], { prompt, nodeId: promptNodeId, type: 'slide', settings: settings ?? {}, referenceUrls })
      ));
    }
  }, [callGenerate, callEccoGenerate, getConnectedUploadUrls]);

  const onRegenerate = useCallback(async (outputNodeId: string, lastPrompt: string, settings?: NodeSettings) => {
    const referenceUrls = getConnectedUploadUrls(outputNodeId);
    if (activeProviderRef.current === 'ecco') {
      const model = (settings?.eccoModel as string | undefined) ?? 'nanobanana31';
      await callEccoGenerate(outputNodeId, {
        prompt: lastPrompt, nodeId: outputNodeId, model,
        aspectRatio:      settings?.aspectRatio     ?? '4:5',
        imageSize:        settings?.imageSize       ?? '1K',
        useGoogleSearch:  settings?.useGoogleSearch ?? false,
        temperature:      settings?.temperature     ?? 1.0,
        includeThoughts:  settings?.includeThoughts ?? true,
        mediaResolution:  settings?.mediaResolution ?? 'media_resolution_high',
        safetyThreshold:  settings?.safetyThreshold ?? 'BLOCK_MEDIUM_AND_ABOVE',
        useAsync:         settings?.useAsync        ?? false,
        referenceUrls,
      });
    } else {
      await callGenerate([outputNodeId], { prompt: lastPrompt, nodeId: outputNodeId, type: 'slide', settings: settings ?? {}, referenceUrls });
    }
  }, [callGenerate, callEccoGenerate, getConnectedUploadUrls]);

  // Sequential generation for carousel nodes (avoids rate-limit errors)
  const onGenerateCarousel = useCallback(async (nodeId: string, slides: CarouselSlide[], settings?: NodeSettings) => {
    const pending = slides.filter(s => s.prompt.trim() && s.outputNodeId);
    // Collect reference URLs from UploadNodes connected to this carousel node (fixes the bug where ref images were dropped)
    const referenceUrls = getConnectedUploadUrls(nodeId);
    for (const slide of pending) {
      if (activeProviderRef.current === 'ecco') {
        const model = (settings?.eccoModel as string | undefined) ?? 'nanobanana31';
        await callEccoGenerate(slide.outputNodeId, {
          prompt: slide.prompt.trim(), nodeId, model,
          aspectRatio:      settings?.aspectRatio     ?? '4:5',
          imageSize:        settings?.imageSize       ?? '1K',
          useGoogleSearch:  settings?.useGoogleSearch ?? false,
          temperature:      settings?.temperature     ?? 1.0,
          includeThoughts:  settings?.includeThoughts ?? true,
          mediaResolution:  settings?.mediaResolution ?? 'media_resolution_high',
          safetyThreshold:  settings?.safetyThreshold ?? 'BLOCK_MEDIUM_AND_ABOVE',
          useAsync:         settings?.useAsync        ?? false,
          referenceUrls,
        });
      } else {
        await callGenerate([slide.outputNodeId], { prompt: slide.prompt.trim(), nodeId, type: 'slide', settings: settings ?? {}, referenceUrls });
      }
    }
  }, [callGenerate, callEccoGenerate, getConnectedUploadUrls]);

  const onUpdateData = useCallback((nodeId: string, data: Record<string, unknown>) => {
    setNodes(nds => nds.map(n =>
      n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
    ));
  }, []);

  const onCreateModel = useCallback(async (nodeId: string, description: string, settings: NodeSettings) => {
    setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, isLoading: true, error: undefined } } : n));
    if (activeProviderRef.current === 'ecco') {
      const style  = (settings?.style      as string | undefined) ?? 'realistic commercial photography';
      const light  = (settings?.lighting   as string | undefined) ?? 'professional studio lighting';
      const bg     = (settings?.background as string | undefined) ?? 'pure white';
      const lower  = description.toLowerCase();
      const isTwoModels = /\b(two models?|2 models?|both models?|model 1\b[\s\S]{0,80}\bmodel 2\b|(male|man|boy)[\s\S]{0,80}(female|woman|girl)|(female|woman|girl)[\s\S]{0,80}(male|man|boy)|first model\b[\s\S]{0,80}\bsecond model\b)\b/.test(lower);
      const compositePrompt = isTwoModels
        ? `Create a professional composite image with FOUR panels in a single 16:9 frame showing TWO models, each from two angles. ` +
          `Panels layout (left to right): [Model 1 Front view] [Model 1 Back view] [Model 2 Front view] [Model 2 Back view]. ` +
          `Models: ${description}. ` +
          `Style: ${style}. Lighting: ${light}. Background: ${bg}. ` +
          `Each model must be visually consistent across their two panels. Ultra high quality, sharp details, professional fashion photography.`
        : `Create a professional composite image with FOUR panels in a single 16:9 frame showing the same model from four angles. ` +
          `Panels layout (left to right): [Front view] [3/4 angle] [Side profile] [Rear view]. ` +
          `Model: ${description}. ` +
          `Style: ${style}. Lighting: ${light}. Background: ${bg}. ` +
          `All panels must show the same person with consistent appearance. Ultra high quality, sharp details, professional fashion photography.`;
      const referenceUrls = getConnectedUploadUrls(nodeId);
      await callEccoGenerate(nodeId, {
        prompt: compositePrompt,
        nodeId,
        model:           (settings?.eccoModel as string | undefined) ?? 'nanobananapro',
        aspectRatio:     '16:9',
        imageSize:       settings?.imageSize       ?? '1K',
        useGoogleSearch: settings?.useGoogleSearch ?? false,
        temperature:     settings?.temperature     ?? 1.0,
        includeThoughts: settings?.includeThoughts ?? true,
        mediaResolution: settings?.mediaResolution ?? 'media_resolution_high',
        safetyThreshold: settings?.safetyThreshold ?? 'BLOCK_MEDIUM_AND_ABOVE',
        useAsync:        settings?.useAsync        ?? false,
        referenceUrls,
      });
    } else {
      try {
        const res  = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: description, nodeId, type: 'model-creation', settings }) });
        const data = await res.json() as { imageUrl?: string; error?: string };
        if (!res.ok || !data.imageUrl) throw new Error(data.error ?? 'No image returned');
        setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, isLoading: false, imageUrl: data.imageUrl, error: undefined } } : n));
        addGeneratedImage({ id: `img-${Date.now()}`, url: data.imageUrl, prompt: description, nodeId, createdAt: new Date().toISOString() });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Generation failed';
        setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, isLoading: false, error: msg } } : n));
      }
    }
  }, [addGeneratedImage, callEccoGenerate, getConnectedUploadUrls]);

  const studioCtx = useMemo(() => ({
    onSaveImage, onGenerateSlide, onGenerateCarousel, onRegenerate, onCreateModel,
    onUpdateSettings, onUpdateData, onSelectNode, onAddToLibrary,
    onDeleteNode, connectingFromId, onStartConnect, onCompleteConnect,
    activeProvider,
  }), [onSaveImage, onGenerateSlide, onGenerateCarousel, onRegenerate, onCreateModel,
      onUpdateSettings, onUpdateData, onSelectNode, onAddToLibrary,
      onDeleteNode, connectingFromId, onStartConnect, onCompleteConnect, activeProvider]);

  // ── Node helpers ─────────────────────────────────────────────────────────
  const nextY = (nds: Node[], type: string, h: number) => {
    const same = nds.filter(n => n.type === type);
    return same.length ? Math.max(...same.map(n => n.position.y)) + h + 30 : 80;
  };

  const addUploadNode = () => setNodes(nds => [...nds, { id: `upload-${Date.now()}`, type: 'uploadNode', position: { x: 60, y: nextY(nds, 'uploadNode', 300) }, data: { label: `Reference ${nds.filter(n => n.type === 'uploadNode').length + 1}` } }]);
  const addPromptNode = () => {
    const pid = `prompt-${Date.now()}`; const oid = `output-${Date.now() + 1}`;
    setNodes(nds => { const c = nds.filter(n => n.type === 'promptNode').length; const y = nextY(nds, 'promptNode', 280); return [...nds,
      { id: pid, type: 'promptNode',  position: { x: 440, y }, data: { label: `Slide ${c + 1}`, slideNumber: c + 1 } },
      { id: oid, type: 'outputNode',  position: { x: 880, y }, data: { label: `Output ${c + 1}`, slideNumber: c + 1, isLoading: false, imageUrl: '' } },
    ]; });
    setEdges(eds => [...eds, mkEdge(`e-${pid}-${oid}`, pid, oid)]);
  };
  const addModelNode  = () => setNodes(nds => [...nds, { id: `model-${Date.now()}`, type: 'modelCreationNode', position: { x: 200, y: nextY(nds, 'modelCreationNode', 320) }, data: { label: 'Model' } }]);

  // Opens the count picker — actual creation happens in createCarouselNode
  const addCarouselSlide = () => setCarouselPicker({ visible: true, count: 6 });

  const createCarouselNode = (count: number) => {
    const cid    = `carousel-${Date.now()}`;
    const baseY  = nextY(nodesRef.current, 'carouselNode', 400);
    const outCount = nodesRef.current.filter(n => n.type === 'outputNode').length;

    const outputNodes: Node[] = Array.from({ length: count }, (_, i) => ({
      id: `output-${Date.now()}-${i}`,
      type: 'outputNode',
      position: { x: 900, y: baseY + i * 310 },
      data: { label: `Output ${outCount + i + 1}`, slideNumber: outCount + i + 1, isLoading: false, imageUrl: '' },
    }));

    const slides: CarouselSlide[] = outputNodes.map((on, i) => ({
      id: `cs-${Date.now()}-${i}`,
      prompt: '',
      outputNodeId: on.id,
    }));

    const carouselNode: Node = {
      id: cid, type: 'carouselNode',
      position: { x: 440, y: baseY },
      data: { label: 'Carousel', slides },
    };

    const newEdges = outputNodes.map(on => mkEdge(`e-${cid}-${on.id}`, cid, on.id));
    setNodes(nds => [...nds, carouselNode, ...outputNodes]);
    setEdges(eds => [...eds, ...newEdges]);
    setCarouselPicker({ visible: false, count: 6 });
  };

  // ── Batch UI helpers ─────────────────────────────────────────────────────
  const getBatchJobStatus = (batchId: string): 'polling' | 'error' | 'completed' | null => {
    const batchJobs = jobs.filter(j => j.batchId === batchId);
    if (batchJobs.some(j => j.status === 'polling'))                      return 'polling';
    if (batchJobs.some(j => j.status === 'error'     && !j.seen))         return 'error';
    if (batchJobs.some(j => j.status === 'completed' && !j.seen))         return 'completed';
    return null;
  };

  const handleSwitchBatch = (id: string) => {
    saveCurrentBatch(nodes, edges);
    switchBatch(id, nodes, edges);
    setSelectedNodeId(null);
    markBatchSeen(id);
  };
  const handleNewBatch = () => {
    const name = newBatchName.trim() || `Batch ${batches.length + 1}`;
    newBatch(name, nodes, edges);
    setNewBatchName('');
    setShowBatchTypeMenu(false);
  };
  const handleNewAutomatedBatch = () => {
    const name = `Auto Batch ${batches.length + 1}`;
    newAutomatedBatch(name, nodes, edges);
    setNewBatchName('');
    setShowBatchTypeMenu(false);
  };

  // ── Welcome dialog actions ────────────────────────────────────────────────
  const handleWelcomeOpenBatch = (id: string) => {
    handleSwitchBatch(id);
    setShowWelcome(false);
  };
  const handleWelcomeNewBatch = () => {
    const name = `Batch ${batches.length + 1}`;
    newBatch(name, nodes, edges);
    setShowWelcome(false);
  };
  const handleWelcomeNewAutomated = (slideCount: number) => {
    // Create the automated batch then immediately pre-add a carousel node
    const name = `Auto Batch ${batches.length + 1}`;
    newAutomatedBatch(name, nodes, edges);
    setShowWelcome(false);
    // Trigger the carousel node creation after the batch is switched
    setTimeout(() => createCarouselNode(slideCount), 50);
  };

  // ── Right sidebar content (context-sensitive) ────────────────────────────
  const settingsOf = (selectedNode?.data as { settings?: NodeSettings })?.settings ?? {};

  const setSetting = (key: keyof NodeSettings, val: unknown) => {
    if (!selectedNodeId) return;
    onUpdateSettings(selectedNodeId, { [key]: val });
  };

  return (
    <StudioContext.Provider value={studioCtx}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0A0A0B', color: '#F1F0F5', overflow: 'hidden' }}>

        {/* ── Header ── */}
        <header style={{ height: 50, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px', background: '#111113', borderBottom: '1px solid #2A2A35', zIndex: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 26, height: 26, borderRadius: 7, background: 'linear-gradient(135deg, #7C3AED, #0D9488)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 10, color: '#fff' }}>iS</div>
            <span style={{ fontWeight: 700, fontSize: 13, color: '#F1F0F5' }}>iSupply AI Studio</span>
            <span style={{ fontSize: 9, color: '#55556A', background: '#1A1A1F', padding: '2px 7px', borderRadius: 20, border: '1px solid #2A2A35' }}>Beta</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11, color: '#9090A8' }}>
            {activeProvider === 'ecco' && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: eccoCredits !== null && eccoCredits < 2 ? '#F59E0B' : '#9090A8' }}>
                {eccoCredits !== null && eccoCredits < 2 && <span title="Low credits">⚠</span>}
                {eccoCredits !== null
                  ? `${eccoCredits < 2 ? 'Low credits' : 'Credits'}: $${eccoCredits.toFixed(2)}`
                  : 'Credits: —'}
              </span>
            )}
            {/* Provider toggle */}
            <button
              onClick={toggleProvider}
              title={`Switch to ${activeProvider === 'gemini' ? 'EccoAPI' : 'Google Gemini'}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600,
                border: `1px solid ${activeProvider === 'ecco' ? '#7C3AED44' : '#0D948844'}`,
                background: activeProvider === 'ecco' ? '#7C3AED11' : '#0D948811',
                color: activeProvider === 'ecco' ? '#A78BFA' : '#0D9488',
                cursor: 'pointer',
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: activeProvider === 'ecco' ? '#A78BFA' : '#0D9488', display: 'inline-block' }} />
              {activeProvider === 'ecco' ? 'EccoAPI' : 'Gemini'}
            </button>
            <span>Active batch:</span>
            <span style={{ color: '#F1F0F5', fontWeight: 600 }}>{activeBatch?.name}</span>
          </div>
        </header>

        {/* ── Main row ── */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

          {/* ── Left panel ── */}
          <aside style={{ width: 230, flexShrink: 0, background: '#111113', borderRight: '1px solid #2A2A35', display: 'flex', flexDirection: 'column' }}>
            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid #2A2A35', flexShrink: 0 }}>
              {(['batches', 'assets', 'library'] as const).map(tab => (
                <button key={tab} onClick={() => setLeftTab(tab)}
                  style={{ flex: 1, padding: '9px 4px', fontSize: 10, fontWeight: 600, border: 'none', cursor: 'pointer', textTransform: 'capitalize', background: leftTab === tab ? '#1A1A1F' : 'transparent', color: leftTab === tab ? '#F1F0F5' : '#55556A', borderBottom: leftTab === tab ? '2px solid #7C3AED' : '2px solid transparent' }}>
                  {tab === 'library' ? 'Library' : tab === 'assets' ? 'Assets' : 'Batches'}
                </button>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>

              {/* ── Batches tab ── */}
              {leftTab === 'batches' && (
                <>
                  {/* New batch with dropdown */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <input value={newBatchName} onChange={e => setNewBatchName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleNewBatch()}
                        placeholder="Batch name…"
                        style={{ flex: 1, background: '#1A1A1F', border: '1px solid #2A2A35', borderRadius: 6, padding: '5px 8px', color: '#F1F0F5', fontSize: 11, outline: 'none', minWidth: 0 }} />
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        <button
                          onClick={() => setShowBatchTypeMenu(v => !v)}
                          style={{ padding: '5px 10px', background: '#7C3AED', border: 'none', borderRadius: 6, color: '#fff', fontSize: 11, cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap' }}>
                          + ▾
                        </button>
                        {showBatchTypeMenu && (
                          <>
                            <div onClick={() => setShowBatchTypeMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
                            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#1A1A1F', border: '1px solid #2A2A35', borderRadius: 8, overflow: 'hidden', zIndex: 51, minWidth: 160, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                              <button onClick={handleNewBatch}
                                style={{ display: 'block', width: '100%', padding: '8px 12px', fontSize: 11, textAlign: 'left', background: 'none', border: 'none', color: '#F1F0F5', cursor: 'pointer', borderBottom: '1px solid #2A2A35' }}
                                onMouseEnter={e => (e.currentTarget.style.background = '#111113')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                                ✦ Create Batch
                              </button>
                              <button onClick={handleNewAutomatedBatch}
                                style={{ display: 'block', width: '100%', padding: '8px 12px', fontSize: 11, textAlign: 'left', background: 'none', border: 'none', color: '#A78BFA', cursor: 'pointer' }}
                                onMouseEnter={e => (e.currentTarget.style.background = '#111113')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                                ⚡ Create Automated Batch
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {batches.map(b => (
                    <div key={b.id} onClick={() => handleSwitchBatch(b.id)}
                      style={{ background: b.id === activeBatchId ? '#1A1A1F' : 'transparent', border: `1px solid ${b.id === activeBatchId ? '#7C3AED44' : '#2A2A35'}`, borderRadius: 8, padding: '8px 10px', marginBottom: 5, cursor: 'pointer', transition: 'all 0.15s' }}>
                      {renamingId === b.id ? (
                        <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)}
                          onBlur={() => { renameBatch(b.id, renameVal.trim() || b.name); setRenamingId(null); }}
                          onKeyDown={e => { if (e.key === 'Enter') { renameBatch(b.id, renameVal.trim() || b.name); setRenamingId(null); } }}
                          onClick={e => e.stopPropagation()}
                          style={{ width: '100%', background: '#111113', border: '1px solid #7C3AED', borderRadius: 4, padding: '2px 6px', color: '#F1F0F5', fontSize: 11, outline: 'none' }} />
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          {/* Batch job status dot (EccoAPI background generation) */}
                          {(() => {
                            const st = getBatchJobStatus(b.id);
                            if (!st) return null;
                            const dotColor = st === 'polling' ? '#F59E0B' : st === 'error' ? '#F43F5E' : '#10B981';
                            return (
                              <div style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, boxShadow: `0 0 4px ${dotColor}`, flexShrink: 0, animation: st === 'polling' ? 'pulse 1s infinite' : 'none' }} title={st === 'polling' ? 'Generating…' : st === 'error' ? 'Error' : 'Done'} />
                            );
                          })()}
                          <span style={{ flex: 1, fontSize: 11, color: b.id === activeBatchId ? '#F1F0F5' : '#9090A8', fontWeight: b.id === activeBatchId ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                          <button onClick={e => { e.stopPropagation(); setRenamingId(b.id); setRenameVal(b.name); }} style={{ background: 'none', border: 'none', color: '#55556A', cursor: 'pointer', padding: '0 2px', fontSize: 11 }} title="Rename">✎</button>
                          {batches.length > 1 && (
                            <button onClick={e => { e.stopPropagation(); deleteBatch(b.id, nodes, edges); }} style={{ background: 'none', border: 'none', color: '#55556A', cursor: 'pointer', padding: '0 2px', fontSize: 11 }} title="Delete">✕</button>
                          )}
                        </div>
                      )}
                      <p style={{ fontSize: 9, color: '#55556A', marginTop: 3 }}>{new Date(b.createdAt).toLocaleDateString()} · {b.generatedImages.length} images</p>
                    </div>
                  ))}
                </>
              )}

              {/* ── Assets tab ── */}
              {leftTab === 'assets' && (
                assetsList.length === 0
                  ? <p style={{ fontSize: 11, color: '#55556A', lineHeight: 1.6 }}>No saved reference images yet. Upload one using an Image Reference node.</p>
                  : assetsList.map(a => (
                      <div key={a.id}
                        draggable
                        onDragStart={e => { e.dataTransfer.setData('application/json', JSON.stringify(a)); e.dataTransfer.effectAllowed = 'copy'; }}
                        onClick={() => handleSelectAsset(a.id)}
                        style={{ background: selectedAssetId === a.id ? '#1E1E2A' : '#1A1A1F', border: `1px solid ${selectedAssetId === a.id ? '#7C3AED88' : '#0D948840'}`, borderRadius: 8, padding: 8, marginBottom: 8, cursor: 'pointer', transition: 'border-color 0.15s' }}>
                        <div style={{ position: 'relative', marginBottom: 5 }}>
                          <img src={a.url} alt={a.name} draggable={false} style={{ width: '100%', height: 70, objectFit: 'cover', borderRadius: 5, display: 'block' }} />
                          {/* Open / Remove overlay */}
                          <div
                            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                            onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
                            style={{ position: 'absolute', inset: 0, borderRadius: 5, background: 'rgba(10,10,11,0.82)', display: 'flex', gap: 5, alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.15s' }}
                          >
                            <button onClick={e => { e.stopPropagation(); setModalImageUrl(a.url); }}
                              style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 5, border: 'none', background: '#7C3AED', color: '#fff', cursor: 'pointer' }}>
                              Open
                            </button>
                            <button onClick={e => { e.stopPropagation(); handleRemoveAsset(a.id); }}
                              style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 5, border: 'none', background: '#F43F5E', color: '#fff', cursor: 'pointer' }}>
                              Remove
                            </button>
                          </div>
                        </div>
                        <p style={{ fontSize: 11, color: '#F1F0F5', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                          {a.tags.map(t => (
                            <span key={t} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 20, background: '#0D948818', color: '#0D9488', border: '1px solid #0D948840' }}>{t}</span>
                          ))}
                        </div>
                      </div>
                    ))
              )}

              {/* ── Image Library tab ── */}
              {leftTab === 'library' && (
                libraryImages.length === 0
                  ? <p style={{ fontSize: 11, color: '#55556A', lineHeight: 1.6 }}>Generated images appear here. Click ⊕ on any output node to save.</p>
                  : libraryImages.map(img => (
                      <div key={img.id}
                        onClick={() => { setSelectedLibImgId(img.id); setSelectedNodeId(null); setSelectedNodeType(null); setSelectedAssetId(null); }}
                        style={{ marginBottom: 8, cursor: 'pointer', borderRadius: 8, border: `1px solid ${selectedLibImgId === img.id ? '#7C3AED88' : 'transparent'}`, padding: 4 }}>
                        <div style={{ position: 'relative' }}>
                          <img src={img.url} alt="generated" style={{ width: '100%', borderRadius: 5, display: 'block' }} />
                          <div
                            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                            onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
                            style={{ position: 'absolute', inset: 0, borderRadius: 5, background: 'rgba(10,10,11,0.82)', display: 'flex', gap: 5, alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.15s' }}
                          >
                            <button onClick={e => { e.stopPropagation(); setModalImageUrl(img.url); }}
                              style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 5, border: 'none', background: '#7C3AED', color: '#fff', cursor: 'pointer' }}>
                              Open
                            </button>
                            <button onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(img.prompt); }}
                              style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 5, border: 'none', background: '#0D9488', color: '#fff', cursor: 'pointer' }}>
                              Copy
                            </button>
                            <button onClick={e => { e.stopPropagation(); removeFromGlobalLibrary(img.id); if (selectedLibImgId === img.id) setSelectedLibImgId(null); }}
                              style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 5, border: 'none', background: '#F43F5E', color: '#fff', cursor: 'pointer' }}>
                              Remove
                            </button>
                          </div>
                        </div>
                        <p style={{ fontSize: 9, color: '#55556A', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{img.prompt.slice(0, 55)}{img.prompt.length > 55 ? '…' : ''}</p>
                        <p style={{ fontSize: 9, color: '#55556A' }}>{new Date(img.createdAt).toLocaleString()}</p>
                      </div>
                    ))
              )}
            </div>
          </aside>

          {/* ── Canvas area ── */}
          <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Toolbar */}
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', background: '#111113', borderBottom: '1px solid #2A2A35', flexWrap: 'wrap' }}>
              <TB onClick={addUploadNode}>+ Image Reference</TB>
              <TB onClick={addPromptNode}>+ Image Prompt</TB>
              <Div />
              <TB onClick={addCarouselSlide} accent>+ Carousel Slide</TB>
              <Div />
              <TB onClick={addModelNode} coral>+ Model Creation</TB>
              <Div />
              <TB onClick={handleExportCanvas}>{isExporting ? 'Exporting…' : '↓ Canvas PNG'}</TB>
              {libraryImages.length > 0 && <TB onClick={handleDownloadAll}>↓ Library ZIP</TB>}
              {activeBatch?.batchType === 'automated' && (
                <span style={{ fontSize: 9, color: '#7C3AED', fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: '#7C3AED11', border: '1px solid #7C3AED44', marginLeft: 4 }}>
                  ⚡ Automated
                </span>
              )}
            </div>

            {/* React Flow canvas */}
            <div style={{ flex: 1, width: '100%' }}>
              <ReactFlow
                nodes={nodes} edges={edges}
                onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
                onPaneClick={onPaneClick} onNodeContextMenu={onNodeContextMenu}
                nodeTypes={nodeTypes} edgeTypes={edgeTypes}
                fitView fitViewOptions={{ padding: 0.15 }}
                connectionRadius={60}
                attributionPosition="bottom-right"
              >
                <Background variant={BackgroundVariant.Dots} color="#2A2A35" gap={24} size={1} />
                <Controls style={{ background: '#111113', border: '1px solid #2A2A35', borderRadius: 8 }} />
                <MiniMap nodeColor={() => '#7C3AED'} maskColor="rgba(10,10,11,0.75)" style={{ background: '#111113', border: '1px solid #2A2A35', borderRadius: 8 }} />
              </ReactFlow>
            </div>

            {/* Carousel count picker modal */}
            {carouselPicker.visible && (
              <div onClick={() => setCarouselPicker(p => ({ ...p, visible: false }))}
                style={{ position: 'absolute', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
                <div onClick={e => e.stopPropagation()}
                  style={{ background: '#111113', border: '1px solid #2A2A35', borderRadius: 14, padding: 28, width: 360, boxShadow: '0 20px 50px rgba(0,0,0,0.7)' }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: '#F1F0F5', marginBottom: 6 }}>How many slides?</p>
                  <p style={{ fontSize: 11, color: '#55556A', marginBottom: 20, lineHeight: 1.6 }}>
                    Creates a single carousel node with {carouselPicker.count} prompt slots and {carouselPicker.count} connected output nodes.
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
                    <button onClick={() => setCarouselPicker(p => ({ ...p, count: Math.max(2, p.count - 1) }))}
                      style={{ width: 34, height: 34, borderRadius: 8, border: '1px solid #2A2A35', background: '#1A1A1F', color: '#9090A8', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                    <div style={{ flex: 1, textAlign: 'center' }}>
                      <span style={{ fontSize: 38, fontWeight: 800, color: '#7C3AED' }}>{carouselPicker.count}</span>
                      <p style={{ fontSize: 10, color: '#55556A', margin: 0 }}>slides</p>
                    </div>
                    <button onClick={() => setCarouselPicker(p => ({ ...p, count: Math.min(20, p.count + 1) }))}
                      style={{ width: 34, height: 34, borderRadius: 8, border: '1px solid #2A2A35', background: '#1A1A1F', color: '#9090A8', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                  </div>
                  <div style={{ display: 'flex', gap: 5, marginBottom: 18, flexWrap: 'wrap' }}>
                    {[3, 4, 5, 6, 8, 10, 12].map(n => (
                      <button key={n} onClick={() => setCarouselPicker(p => ({ ...p, count: n }))}
                        style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer', border: `1px solid ${carouselPicker.count === n ? '#7C3AED' : '#2A2A35'}`, background: carouselPicker.count === n ? '#7C3AED' : '#1A1A1F', color: carouselPicker.count === n ? '#fff' : '#9090A8' }}>
                        {n}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setCarouselPicker(p => ({ ...p, visible: false }))}
                      style={{ flex: 1, padding: '9px', borderRadius: 8, border: '1px solid #2A2A35', background: '#1A1A1F', color: '#9090A8', fontSize: 12, cursor: 'pointer' }}>
                      Cancel
                    </button>
                    <button onClick={() => createCarouselNode(carouselPicker.count)}
                      style={{ flex: 2, padding: '9px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #7C3AED, #0D9488)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                      ⚡ Create {carouselPicker.count}-Slide Carousel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </main>

          {/* ── Right panel (context-sensitive) ── */}
          <aside style={{ width: 250, flexShrink: 0, background: '#111113', borderLeft: '1px solid #2A2A35', overflowY: 'auto', padding: 14 }}>

            {/* ── Asset editor ── */}
            {selectedAssetId && leftTab === 'assets' && (() => {
              const asset = assetsList.find(a => a.id === selectedAssetId);
              if (!asset) return null;
              return (
                <>
                  <SideLabel>Reference Image</SideLabel>
                  <img src={asset.url} alt={asset.name} style={{ width: '100%', borderRadius: 7, marginBottom: 10, display: 'block' }} />
                  <Sec label="Name">
                    <input value={editAssetName} onChange={e => setEditAssetName(e.target.value)}
                      style={{ width: '100%', background: '#1A1A1F', border: '1px solid #2A2A35', borderRadius: 6, padding: '5px 8px', color: '#F1F0F5', fontSize: 11, outline: 'none', boxSizing: 'border-box' }} />
                  </Sec>
                  <Sec label="Tags (comma-separated)">
                    <textarea rows={3} value={editAssetTags} onChange={e => setEditAssetTags(e.target.value)}
                      placeholder="earbuds, white, pro-2, stem-style"
                      style={{ width: '100%', background: '#1A1A1F', border: '1px solid #2A2A35', borderRadius: 6, padding: '5px 8px', color: '#F1F0F5', fontSize: 11, outline: 'none', resize: 'none', boxSizing: 'border-box', fontFamily: 'inherit', lineHeight: 1.5 }} />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 5 }}>
                      {editAssetTags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean).map(t => (
                        <span key={t} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 20, background: '#0D948818', color: '#0D9488', border: '1px solid #0D948840' }}>{t}</span>
                      ))}
                    </div>
                  </Sec>
                  <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
                    <button onClick={handleSaveAsset} disabled={isSavingAsset}
                      style={{ flex: 1, padding: '6px', fontSize: 10, fontWeight: 700, borderRadius: 6, border: 'none', background: isSavingAsset ? '#2A2A35' : 'linear-gradient(135deg,#7C3AED,#0D9488)', color: isSavingAsset ? '#55556A' : '#fff', cursor: isSavingAsset ? 'not-allowed' : 'pointer' }}>
                      {isSavingAsset ? 'Saving…' : 'Save Changes'}
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 5 }}>
                    <button onClick={() => setModalImageUrl(asset.url)}
                      style={{ flex: 1, padding: '6px', fontSize: 10, fontWeight: 600, borderRadius: 6, border: '1px solid #7C3AED44', background: '#7C3AED11', color: '#7C3AED', cursor: 'pointer' }}>
                      Open Image
                    </button>
                    <button onClick={() => handleRemoveAsset(asset.id)}
                      style={{ flex: 1, padding: '6px', fontSize: 10, fontWeight: 600, borderRadius: 6, border: '1px solid #F43F5E44', background: '#F43F5E11', color: '#F43F5E', cursor: 'pointer' }}>
                      Remove
                    </button>
                  </div>
                </>
              );
            })()}

            {/* ── Library image viewer ── */}
            {selectedLibImgId && leftTab === 'library' && (() => {
              const img = libraryImages.find(i => i.id === selectedLibImgId);
              if (!img) return null;
              return (
                <>
                  <SideLabel>Generated Image</SideLabel>
                  <img src={img.url} alt="generated" style={{ width: '100%', borderRadius: 7, marginBottom: 10, display: 'block' }} />
                  <Sec label="Prompt">
                    <p style={{ fontSize: 10, color: '#9090A8', lineHeight: 1.6 }}>{img.prompt}</p>
                  </Sec>
                  <Sec label="Created">
                    <p style={{ fontSize: 10, color: '#55556A' }}>{new Date(img.createdAt).toLocaleString()}</p>
                  </Sec>
                  <div style={{ display: 'flex', gap: 5 }}>
                    <button onClick={() => setModalImageUrl(img.url)}
                      style={{ flex: 1, padding: '6px', fontSize: 10, fontWeight: 600, borderRadius: 6, border: '1px solid #7C3AED44', background: '#7C3AED11', color: '#7C3AED', cursor: 'pointer' }}>
                      Open Image
                    </button>
                    <button onClick={() => { removeFromGlobalLibrary(img.id); setSelectedLibImgId(null); }}
                      style={{ flex: 1, padding: '6px', fontSize: 10, fontWeight: 600, borderRadius: 6, border: '1px solid #F43F5E44', background: '#F43F5E11', color: '#F43F5E', cursor: 'pointer' }}>
                      Remove
                    </button>
                  </div>
                </>
              );
            })()}

            {/* ── Node settings (only when no asset/library item is selected) ── */}
            {!selectedAssetId && !selectedLibImgId && !selectedNodeId && <GlobalSettings activeProvider={activeProvider} />}

            {!selectedAssetId && !selectedLibImgId && selectedNodeType === 'uploadNode' && (
              <>
                <SideLabel>Image Reference Settings</SideLabel>
                <Sec label="Node">
                  <p style={{ fontSize: 11, color: '#9090A8' }}>
                    {(selectedNode?.data as { savedImage?: SavedImage })?.savedImage
                      ? `Saved as "${(selectedNode?.data as { savedImage: SavedImage }).savedImage.name}"`
                      : 'Not saved yet'}
                  </p>
                  <p style={{ fontSize: 10, color: '#55556A', marginTop: 5 }}>Upload the image on the node, add tags that describe the product (e.g. earbuds, white, pro-2), then click Save Reference.</p>
                </Sec>
                <Sec label="Tag Tips">
                  <p style={{ fontSize: 10, color: '#55556A', lineHeight: 1.6 }}>Tags are matched against prompt text. Use descriptive single words: <span style={{ color: '#0D9488' }}>earbuds, white, charging-case, red, stem-style</span></p>
                </Sec>
              </>
            )}

            {!selectedAssetId && !selectedLibImgId && selectedNodeType === 'promptNode' && (
              <>
                <SideLabel>Image Prompt Settings</SideLabel>
                <Sec label={`Temperature — ${(settingsOf.temperature ?? 1.0).toFixed(1)}`}>
                  <SliderRow value={settingsOf.temperature ?? 1.0} min={0} max={2} step={0.05} onChange={v => setSetting('temperature', v)} />
                  <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>Google recommends 1.0 for image models — lower values degrade reference adherence</p>
                </Sec>
                <Sec label={`Guidance Scale — ${settingsOf.guidanceScale ?? 7}`}>
                  <SliderRow value={settingsOf.guidanceScale ?? 7} min={1} max={15} step={1} onChange={v => setSetting('guidanceScale', v)} />
                  <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>Higher = follows prompt more strictly</p>
                </Sec>
                <Sec label="Safety Threshold">
                  <Chips opts={['Off', 'Low Block', 'Medium', 'High Block']} value={
                    settingsOf.safetyThreshold === 'BLOCK_NONE'          ? 'Off' :
                    settingsOf.safetyThreshold === 'BLOCK_ONLY_HIGH'     ? 'Low Block' :
                    settingsOf.safetyThreshold === 'BLOCK_LOW_AND_ABOVE' ? 'High Block' : 'Medium'
                  } onChange={v => setSetting('safetyThreshold',
                    v === 'Off'        ? 'BLOCK_NONE' :
                    v === 'Low Block'  ? 'BLOCK_ONLY_HIGH' :
                    v === 'High Block' ? 'BLOCK_LOW_AND_ABOVE' :
                                        'BLOCK_MEDIUM_AND_ABOVE'
                  )} cols={2} />
                  <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>Lower = fewer false-positive blocks on safe product images</p>
                </Sec>
                <Sec label="Thinking Mode">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                    <input type="checkbox" checked={settingsOf.includeThoughts !== false} onChange={e => setSetting('includeThoughts', e.target.checked)} style={{ accentColor: '#7C3AED' }} />
                    <span style={{ fontSize: 10, color: '#9090A8' }}>Enable (improves reference adherence)</span>
                  </label>
                </Sec>
                <Sec label="Media Resolution">
                  <Chips opts={['High', 'Medium', 'Low']} value={
                    settingsOf.mediaResolution === 'media_resolution_low'    ? 'Low' :
                    settingsOf.mediaResolution === 'media_resolution_medium' ? 'Medium' : 'High'
                  } onChange={v => setSetting('mediaResolution',
                    v === 'Low' ? 'media_resolution_low' : v === 'Medium' ? 'media_resolution_medium' : 'media_resolution_high'
                  )} cols={3} />
                  <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>High = more input tokens for reference image details</p>
                </Sec>
                <Sec label="Seed (empty = random)">
                  <input type="text" placeholder="e.g. 42" value={settingsOf.seed ?? ''} onChange={e => setSetting('seed', e.target.value)}
                    style={{ width: '100%', background: '#1A1A1F', border: '1px solid #2A2A35', borderRadius: 6, padding: '5px 8px', color: '#F1F0F5', fontSize: 11, outline: 'none', boxSizing: 'border-box' }} />
                </Sec>
                <Sec label="Negative Prompt">
                  <textarea rows={3} value={settingsOf.negativePrompt ?? ''} onChange={e => setSetting('negativePrompt', e.target.value)}
                    placeholder="blur, noise, artifacts, low quality…"
                    style={{ width: '100%', background: '#1A1A1F', border: '1px solid #2A2A35', borderRadius: 6, padding: '5px 8px', color: '#F1F0F5', fontSize: 11, outline: 'none', resize: 'none', boxSizing: 'border-box', fontFamily: 'inherit', lineHeight: 1.5 }} />
                </Sec>
                {activeProvider === 'ecco' ? (
                  <>
                    <Sec label="Model">
                      <Chips opts={['NanoBanana 3.1', 'NanaBanana Pro']} value={settingsOf.eccoModel === 'nanobananapro' ? 'NanaBanana Pro' : 'NanoBanana 3.1'} onChange={v => setSetting('eccoModel', v === 'NanaBanana Pro' ? 'nanobananapro' : 'nanobanana31')} cols={2} />
                    </Sec>
                    <Sec label="Image Size">
                      <Chips opts={['1K', '2K', '4K']} value={settingsOf.imageSize ?? '1K'} onChange={v => setSetting('imageSize', v)} cols={3} />
                    </Sec>
                    <Sec label="Google Search Grounding">
                      <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                        <input type="checkbox" checked={settingsOf.useGoogleSearch ?? false} onChange={e => setSetting('useGoogleSearch', e.target.checked)} style={{ accentColor: '#7C3AED' }} />
                        <span style={{ fontSize: 10, color: '#9090A8' }}>Enable real-time search</span>
                      </label>
                    </Sec>
                    <Sec label="Async Mode">
                      <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                        <input type="checkbox" checked={settingsOf.useAsync ?? false} onChange={e => setSetting('useAsync', e.target.checked)} style={{ accentColor: '#7C3AED' }} />
                        <span style={{ fontSize: 10, color: '#9090A8' }}>Use async queue (off = sync)</span>
                      </label>
                      <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>Sync mode (default) waits for the result directly — avoids model swapping and reference image stripping in async queues</p>
                    </Sec>
                  </>
                ) : (
                  <Sec label="Model">
                    <Chips opts={['Flash', 'Pro', 'Standard']} value={settingsOf.model ?? 'Flash'} onChange={v => setSetting('model', v)} cols={3} />
                    <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>Flash = gemini-3.1-flash-image-preview</p>
                  </Sec>
                )}
                <Sec label="Generation Count">
                  <Chips opts={['1', '2', '3', '4']} value={String(settingsOf.count ?? 1)} onChange={v => setSetting('count', Number(v))} cols={4} />
                  <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>Creates extra output nodes as needed</p>
                </Sec>
                {/* Prompt history */}
                {(() => {
                  type H = { prompt: string; ts: string };
                  const history = (selectedNode?.data as { promptHistory?: H[] })?.promptHistory ?? [];
                  if (!history.length) return null;
                  return (
                    <Sec label="Generation History">
                      {history.map((h, i) => (
                        <div key={i} style={{ background: '#0D0D0F', border: '1px solid #2A2A35', borderRadius: 6, padding: '6px 8px', marginBottom: 5 }}>
                          <p style={{ fontSize: 10, color: '#9090A8', lineHeight: 1.5, marginBottom: 4 }}>{h.prompt.slice(0, 90)}{h.prompt.length > 90 ? '…' : ''}</p>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={() => navigator.clipboard.writeText(h.prompt)}
                              style={{ flex: 1, padding: '3px 0', fontSize: 9, fontWeight: 600, borderRadius: 4, border: '1px solid #2A2A35', background: '#1A1A1F', color: '#9090A8', cursor: 'pointer' }}>
                              Copy
                            </button>
                            <p style={{ fontSize: 8, color: '#55556A', lineHeight: '22px', margin: 0 }}>{new Date(h.ts).toLocaleTimeString()}</p>
                          </div>
                        </div>
                      ))}
                    </Sec>
                  );
                })()}
              </>
            )}

            {/* ── Carousel node settings (same as prompt but shows slide count info) ── */}
            {!selectedAssetId && !selectedLibImgId && selectedNodeType === 'carouselNode' && (() => {
              const slides = (selectedNode?.data as { slides?: CarouselSlide[] })?.slides ?? [];
              return (
                <>
                  <SideLabel>Carousel Settings</SideLabel>
                  <Sec label="Slides">
                    <p style={{ fontSize: 11, color: '#9090A8' }}>{slides.length} slides · {slides.filter(s => s.prompt.trim()).length} filled</p>
                    <p style={{ fontSize: 10, color: '#55556A', marginTop: 4, lineHeight: 1.5 }}>Settings below apply to all slides in this carousel.</p>
                  </Sec>
                  <Sec label={`Temperature — ${(settingsOf.temperature ?? 1.0).toFixed(1)}`}>
                    <SliderRow value={settingsOf.temperature ?? 1.0} min={0} max={2} step={0.05} onChange={v => setSetting('temperature', v)} />
                    <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>Google recommends 1.0 for image models</p>
                  </Sec>
                  <Sec label={`Guidance Scale — ${settingsOf.guidanceScale ?? 7}`}>
                    <SliderRow value={settingsOf.guidanceScale ?? 7} min={1} max={15} step={1} onChange={v => setSetting('guidanceScale', v)} />
                  </Sec>
                  <Sec label="Safety Threshold">
                    <Chips opts={['Off', 'Low Block', 'Medium', 'High Block']} value={
                      settingsOf.safetyThreshold === 'BLOCK_NONE'          ? 'Off' :
                      settingsOf.safetyThreshold === 'BLOCK_ONLY_HIGH'     ? 'Low Block' :
                      settingsOf.safetyThreshold === 'BLOCK_LOW_AND_ABOVE' ? 'High Block' : 'Medium'
                    } onChange={v => setSetting('safetyThreshold',
                      v === 'Off'        ? 'BLOCK_NONE' :
                      v === 'Low Block'  ? 'BLOCK_ONLY_HIGH' :
                      v === 'High Block' ? 'BLOCK_LOW_AND_ABOVE' :
                                          'BLOCK_MEDIUM_AND_ABOVE'
                    )} cols={2} />
                    <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>Lower = fewer false-positive blocks on safe product images</p>
                  </Sec>
                  <Sec label="Thinking Mode">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                      <input type="checkbox" checked={settingsOf.includeThoughts !== false} onChange={e => setSetting('includeThoughts', e.target.checked)} style={{ accentColor: '#7C3AED' }} />
                      <span style={{ fontSize: 10, color: '#9090A8' }}>Enable (improves reference adherence)</span>
                    </label>
                  </Sec>
                  <Sec label="Media Resolution">
                    <Chips opts={['High', 'Medium', 'Low']} value={
                      settingsOf.mediaResolution === 'media_resolution_low'    ? 'Low' :
                      settingsOf.mediaResolution === 'media_resolution_medium' ? 'Medium' : 'High'
                    } onChange={v => setSetting('mediaResolution',
                      v === 'Low' ? 'media_resolution_low' : v === 'Medium' ? 'media_resolution_medium' : 'media_resolution_high'
                    )} cols={3} />
                    <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>High = more input tokens for reference image details</p>
                  </Sec>
                  <Sec label="Seed (empty = random)">
                    <input type="text" placeholder="e.g. 42" value={settingsOf.seed ?? ''} onChange={e => setSetting('seed', e.target.value)}
                      style={{ width: '100%', background: '#1A1A1F', border: '1px solid #2A2A35', borderRadius: 6, padding: '5px 8px', color: '#F1F0F5', fontSize: 11, outline: 'none', boxSizing: 'border-box' }} />
                  </Sec>
                  <Sec label="Negative Prompt">
                    <textarea rows={3} value={settingsOf.negativePrompt ?? ''} onChange={e => setSetting('negativePrompt', e.target.value)}
                      placeholder="blur, noise, artifacts…"
                      style={{ width: '100%', background: '#1A1A1F', border: '1px solid #2A2A35', borderRadius: 6, padding: '5px 8px', color: '#F1F0F5', fontSize: 11, outline: 'none', resize: 'none', boxSizing: 'border-box', fontFamily: 'inherit', lineHeight: 1.5 }} />
                  </Sec>
                  {activeProvider === 'ecco' ? (
                    <>
                      <Sec label="Model">
                        <Chips opts={['NanoBanana 3.1', 'NanaBanana Pro']} value={settingsOf.eccoModel === 'nanobananapro' ? 'NanaBanana Pro' : 'NanoBanana 3.1'} onChange={v => setSetting('eccoModel', v === 'NanaBanana Pro' ? 'nanobananapro' : 'nanobanana31')} cols={2} />
                      </Sec>
                      <Sec label="Image Size">
                        <Chips opts={['1K', '2K', '4K']} value={settingsOf.imageSize ?? '1K'} onChange={v => setSetting('imageSize', v)} cols={3} />
                      </Sec>
                      <Sec label="Google Search Grounding">
                        <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                          <input type="checkbox" checked={settingsOf.useGoogleSearch ?? false} onChange={e => setSetting('useGoogleSearch', e.target.checked)} style={{ accentColor: '#7C3AED' }} />
                          <span style={{ fontSize: 10, color: '#9090A8' }}>Enable real-time search</span>
                        </label>
                      </Sec>
                      <Sec label="Async Mode">
                        <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                          <input type="checkbox" checked={settingsOf.useAsync ?? false} onChange={e => setSetting('useAsync', e.target.checked)} style={{ accentColor: '#7C3AED' }} />
                          <span style={{ fontSize: 10, color: '#9090A8' }}>Use async queue (off = sync)</span>
                        </label>
                        <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>Sync mode (default) waits for the result directly — avoids model swapping and reference image stripping in async queues</p>
                      </Sec>
                    </>
                  ) : (
                    <Sec label="Model">
                      <Chips opts={['Flash', 'Flash 2.5']} value={settingsOf.model ?? 'Flash'} onChange={v => setSetting('model', v)} cols={2} />
                      <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>Flash = gemini-3.1-flash-image-preview</p>
                    </Sec>
                  )}
                </>
              );
            })()}

            {!selectedAssetId && !selectedLibImgId && selectedNodeType === 'outputNode' && (
              <>
                <SideLabel>Image Output Settings</SideLabel>
                <Sec label="Resolution">
                  <Chips opts={['512px', '1K', '2K', '4K']} value={settingsOf.resolution ?? '1K'} onChange={v => setSetting('resolution', v)} cols={4} />
                </Sec>
                <Sec label="Aspect Ratio">
                  <Chips opts={['4:5', '1:1', '16:9', '9:16', 'Auto']} value={settingsOf.aspectRatio ?? '4:5'} onChange={v => setSetting('aspectRatio', v)} cols={3} />
                </Sec>
                <Sec label="Format">
                  <Chips opts={['PNG', 'JPEG']} value={settingsOf.format ?? 'PNG'} onChange={v => setSetting('format', v)} />
                </Sec>
                <Sec label="Generation Count">
                  <Chips opts={['1', '2', '3', '4']} value={String(settingsOf.count ?? 1)} onChange={v => setSetting('count', Number(v))} cols={4} />
                </Sec>
                <Sec label="Actions">
                  {(selectedNode?.data as { imageUrl?: string })?.imageUrl && (
                    <a href={(selectedNode?.data as { imageUrl: string }).imageUrl} download={`output-${Date.now()}.png`}
                      style={{ display: 'block', textAlign: 'center', padding: '6px', borderRadius: 6, background: '#7C3AED', color: '#fff', fontSize: 11, fontWeight: 600, textDecoration: 'none', marginBottom: 6 }}>
                      ↓ Download Image
                    </a>
                  )}
                </Sec>
              </>
            )}

            {!selectedAssetId && !selectedLibImgId && selectedNodeType === 'modelCreationNode' && (
              <>
                <SideLabel>Model Creation Settings</SideLabel>
                <Sec label="Output">
                  <p style={{ fontSize: 10, color: '#55556A', lineHeight: 1.6 }}>Always outputs a single 16:9 composite image with 4 panels: front, 3/4 angle, side profile, and rear view of the model.</p>
                </Sec>
                <Sec label={`Temperature — ${(settingsOf.temperature ?? 1.0).toFixed(1)}`}>
                  <SliderRow value={settingsOf.temperature ?? 1.0} min={0} max={2} step={0.05} onChange={v => setSetting('temperature', v)} />
                  <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>Google recommends 1.0 for image models</p>
                </Sec>
                <Sec label="Safety Threshold">
                  <Chips opts={['Off', 'Low Block', 'Medium', 'High Block']} value={
                    settingsOf.safetyThreshold === 'BLOCK_NONE'          ? 'Off' :
                    settingsOf.safetyThreshold === 'BLOCK_ONLY_HIGH'     ? 'Low Block' :
                    settingsOf.safetyThreshold === 'BLOCK_LOW_AND_ABOVE' ? 'High Block' : 'Medium'
                  } onChange={v => setSetting('safetyThreshold',
                    v === 'Off'        ? 'BLOCK_NONE' :
                    v === 'Low Block'  ? 'BLOCK_ONLY_HIGH' :
                    v === 'High Block' ? 'BLOCK_LOW_AND_ABOVE' :
                                        'BLOCK_MEDIUM_AND_ABOVE'
                  )} cols={2} />
                  <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>Lower = fewer false-positive blocks on safe content</p>
                </Sec>
                <Sec label="Thinking Mode">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                    <input type="checkbox" checked={settingsOf.includeThoughts !== false} onChange={e => setSetting('includeThoughts', e.target.checked)} style={{ accentColor: '#7C3AED' }} />
                    <span style={{ fontSize: 10, color: '#9090A8' }}>Enable (improves consistency)</span>
                  </label>
                </Sec>
                <Sec label="Media Resolution">
                  <Chips opts={['High', 'Medium', 'Low']} value={
                    settingsOf.mediaResolution === 'media_resolution_low'    ? 'Low' :
                    settingsOf.mediaResolution === 'media_resolution_medium' ? 'Medium' : 'High'
                  } onChange={v => setSetting('mediaResolution',
                    v === 'Low' ? 'media_resolution_low' : v === 'Medium' ? 'media_resolution_medium' : 'media_resolution_high'
                  )} cols={3} />
                  <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>High = more input tokens for reference image details</p>
                </Sec>
                {activeProvider === 'ecco' && (
                  <>
                    <Sec label="Model">
                      <Chips opts={['NanoBanana 3.1', 'NanaBanana Pro']} value={settingsOf.eccoModel === 'nanobananapro' ? 'NanaBanana Pro' : 'NanoBanana 3.1'} onChange={v => setSetting('eccoModel', v === 'NanaBanana Pro' ? 'nanobananapro' : 'nanobanana31')} cols={2} />
                    </Sec>
                    <Sec label="Image Size">
                      <Chips opts={['1K', '2K', '4K']} value={settingsOf.imageSize ?? '1K'} onChange={v => setSetting('imageSize', v)} cols={3} />
                    </Sec>
                    <Sec label="Google Search Grounding">
                      <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                        <input type="checkbox" checked={settingsOf.useGoogleSearch ?? false} onChange={e => setSetting('useGoogleSearch', e.target.checked)} style={{ accentColor: '#7C3AED' }} />
                        <span style={{ fontSize: 10, color: '#9090A8' }}>Enable real-time search</span>
                      </label>
                    </Sec>
                    <Sec label="Async Mode">
                      <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                        <input type="checkbox" checked={settingsOf.useAsync ?? false} onChange={e => setSetting('useAsync', e.target.checked)} style={{ accentColor: '#7C3AED' }} />
                        <span style={{ fontSize: 10, color: '#9090A8' }}>Use async queue (off = sync)</span>
                      </label>
                      <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>Sync mode (default) waits for the result directly — avoids model swapping in async queues</p>
                    </Sec>
                  </>
                )}
                <Sec label="Style">
                  <Chips opts={['Realistic', 'Editorial', 'Commercial', 'Artistic']} value={settingsOf.style ?? 'Realistic'} onChange={v => setSetting('style', v)} cols={2} />
                </Sec>
                <Sec label="Lighting">
                  <Chips opts={['Studio White', 'Natural', 'Dramatic', 'Soft Box']} value={settingsOf.lighting ?? 'Studio White'} onChange={v => setSetting('lighting', v)} cols={2} />
                </Sec>
                <Sec label="Background">
                  <Chips opts={['Pure White', 'Light Gray', 'Gradient', 'Scene']} value={settingsOf.background ?? 'Pure White'} onChange={v => setSetting('background', v)} cols={2} />
                </Sec>
                <Sec label="How it works">
                  <p style={{ fontSize: 10, color: '#55556A', lineHeight: 1.6 }}>This node is text-to-image only — no reference images. Describe the model in detail in the node's text area, then click "Create Model".</p>
                </Sec>
              </>
            )}
          </aside>
        </div>
      </div>

      {/* ── Right-click context menu ── */}
      {contextMenu && (
        <div
          onClick={() => setContextMenu(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 200 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'fixed', top: contextMenu.y, left: contextMenu.x,
              background: '#1A1A1F', border: '1px solid #2A2A35', borderRadius: 8,
              padding: 4, zIndex: 201, minWidth: 140,
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            }}
          >
            {[
              { label: 'Duplicate  Ctrl+D', action: () => onDuplicateNode(contextMenu.nodeId) },
              { label: 'Delete  Del', action: () => { onDeleteNode(contextMenu.nodeId); setContextMenu(null); }, red: true },
            ].map(item => (
              <button key={item.label} onClick={item.action}
                style={{ display: 'block', width: '100%', padding: '7px 12px', fontSize: 11, textAlign: 'left', background: 'none', border: 'none', color: item.red ? '#F43F5E' : '#9090A8', cursor: 'pointer', borderRadius: 5 }}
                onMouseEnter={e => (e.currentTarget.style.background = '#111113')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >{item.label}</button>
            ))}
          </div>
        </div>
      )}

      {/* ── Image preview modal ── */}
      {modalImageUrl && <ImageModal url={modalImageUrl} onClose={() => setModalImageUrl(null)} />}

      {/* ── Welcome dialog ── */}
      {showWelcome && (
        <WelcomeDialog
          batches={batches}
          onOpenBatch={handleWelcomeOpenBatch}
          onNewBatch={handleWelcomeNewBatch}
          onNewAutomatedBatch={handleWelcomeNewAutomated}
          onDismiss={() => setShowWelcome(false)}
        />
      )}

    </StudioContext.Provider>
  );
}

// ─── Global (no selection) settings panel ────────────────────────────────────
function GlobalSettings({ activeProvider }: { activeProvider: 'gemini' | 'ecco' }) {
  return (
    <>
      <SideLabel>Global Defaults</SideLabel>
      <p style={{ fontSize: 11, color: '#55556A', lineHeight: 1.6, marginBottom: 12 }}>
        Click any node on the canvas to see and configure its settings here.
      </p>
      <Sec label="How to get started">
        <ol style={{ paddingLeft: 14, color: '#9090A8', fontSize: 11, lineHeight: 1.8, margin: 0 }}>
          <li>Add an <strong style={{ color: '#F1F0F5' }}>Image Reference</strong> node and upload a product photo with tags</li>
          <li>Add an <strong style={{ color: '#F1F0F5' }}>Image Prompt</strong> node and write your scene description</li>
          <li>Connect them with an edge, then hit <strong style={{ color: '#7C3AED' }}>Generate Slide</strong></li>
          <li>View the result in the connected <strong style={{ color: '#F1F0F5' }}>Image Output</strong> node</li>
        </ol>
      </Sec>
      <Sec label="Provider">
        <p style={{ fontSize: 11, color: '#0D9488' }}>
          {activeProvider === 'ecco' ? 'EccoAPI (Nano Banana)' : 'Google Gemini'}
        </p>
        <p style={{ fontSize: 9, color: '#55556A', marginTop: 3 }}>
          {activeProvider === 'ecco' ? 'nk_live_... key configured' : 'GEMINI_API_KEY configured'}
        </p>
      </Sec>
      <Sec label="Keyboard Shortcuts">
        {[
          ['Del', 'Delete selected node'],
          ['Ctrl+D', 'Duplicate selected node'],
          ['Esc', 'Cancel connect / close menu'],
          ['Right-click node', 'Context menu'],
        ].map(([k, d]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 3, background: '#1A1A1F', border: '1px solid #2A2A35', color: '#9090A8', fontFamily: 'monospace' }}>{k}</span>
            <span style={{ fontSize: 9, color: '#55556A' }}>{d}</span>
          </div>
        ))}
      </Sec>
    </>
  );
}

// ─── Micro helpers ────────────────────────────────────────────────────────────
function TB({ onClick, children, accent, coral }: { onClick: () => void; children: React.ReactNode; accent?: boolean; coral?: boolean }) {
  const bg    = accent ? '#7C3AED22' : coral ? '#F43F5E22' : '#1A1A1F';
  const color = accent ? '#7C3AED'   : coral ? '#F43F5E'   : '#9090A8';
  const border= accent ? '#7C3AED44' : coral ? '#F43F5E44' : '#2A2A35';
  return <button onClick={onClick} style={{ padding: '5px 11px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: `1px solid ${border}`, background: bg, color, cursor: 'pointer', whiteSpace: 'nowrap' }}>{children}</button>;
}
function Div() { return <div style={{ width: 1, height: 14, background: '#2A2A35', margin: '0 2px' }} />; }
function SideLabel({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#55556A', marginBottom: 12 }}>{children}</p>;
}
function Sec({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 14 }}><p style={{ fontSize: 10, color: '#9090A8', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>{children}</div>;
}
function SliderRow({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} style={{ width: '100%', accentColor: '#7C3AED', cursor: 'pointer' }} />;
}
function Chips({ opts, value, onChange, cols = 3 }: { opts: string[]; value: string; onChange: (v: string) => void; cols?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 4 }}>
      {opts.map(o => {
        const active = value === o || value.toLowerCase() === o.toLowerCase();
        return <button key={o} onClick={() => onChange(o)} style={{ padding: '4px 0', fontSize: 9, borderRadius: 5, border: `1px solid ${active ? '#7C3AED' : '#2A2A35'}`, background: active ? '#7C3AED' : '#1A1A1F', color: active ? '#fff' : '#9090A8', cursor: 'pointer' }}>{o}</button>;
      })}
    </div>
  );
}

// ─── Image preview modal ─────────────────────────────────────────────────────
function ImageModal({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.88)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
        <img src={url} alt="preview"
          style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 10, display: 'block', objectFit: 'contain', boxShadow: '0 20px 60px rgba(0,0,0,0.7)' }} />
        {/* Close */}
        <button onClick={onClose} style={{
          position: 'absolute', top: -14, right: -14,
          width: 30, height: 30, borderRadius: '50%',
          border: '1px solid #2A2A35', background: '#111113', color: '#F1F0F5',
          cursor: 'pointer', fontSize: 16, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        }}>×</button>
        {/* Download from modal */}
        <a href={url} download={`image-${Date.now()}.png`} onClick={e => e.stopPropagation()}
          style={{
            position: 'absolute', bottom: 10, right: 10,
            padding: '5px 12px', borderRadius: 6, background: '#111113cc',
            color: '#9090A8', fontSize: 11, fontWeight: 600, textDecoration: 'none',
            border: '1px solid #2A2A35',
          }}>
          ↓ Download
        </a>
        <p style={{ position: 'absolute', bottom: 10, left: 10, fontSize: 10, color: '#55556A', margin: 0 }}>
          Click outside or press Esc to close
        </p>
      </div>
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────
export default function Page() {
  return (
    <ReactFlowProvider>
      <StudioCanvas />
    </ReactFlowProvider>
  );
}
