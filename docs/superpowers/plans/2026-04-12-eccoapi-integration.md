# EccoAPI (Nano Banana) Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add EccoAPI (Nano Banana) as a second image generation provider alongside Google Gemini, with background generation that survives batch switches, a credits display, Google Search grounding toggle, and a fix for automated batch reference images not being sent.

**Architecture:** Separate routes per provider. Existing Gemini route (`app/api/generate/route.ts`) is untouched. New EccoAPI routes use an in-memory job store so the server returns a `jobId` immediately (202) and processes in the background. The client polls every 3 seconds. Works for Electron (persistent Node.js process). The queue hook lives inside `StudioCanvas` so it naturally survives batch switches.

**Tech Stack:** Next.js App Router, TypeScript, React, Electron 35, EccoAPI REST API (`https://eccoapi.com/api/v1`)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `.env.local.example` | Modify | Add `ECCO_API_KEY`, `AI_PROVIDER` |
| `app/api/config/route.ts` | **Create** | Expose active provider to client |
| `app/api/ecco/generate/route.ts` | **Create** | EccoAPI generate — returns jobId immediately |
| `app/api/ecco/jobs/[jobId]/route.ts` | **Create** | Job status polling proxy |
| `app/api/generate/route.ts` | Modify | Accept `referenceUrls[]`, merge with `findMatchingImages` |
| `app/context/StudioContext.ts` | Modify | Add `activeProvider`, `eccoModel`, `imageSize`, `useGoogleSearch` to types |
| `app/hooks/useBatchHistory.ts` | Modify | Add `addGeneratedImageToBatch` |
| `app/hooks/useGenerationQueue.ts` | **Create** | Polls EccoAPI jobs, fires completion callbacks |
| `app/page.tsx` | Modify | Provider fetch, `callEccoGenerate`, queue, credits, batch dots, ref-image fix |
| `app/components/nodes/PromptNode.tsx` | Modify | EccoAPI model/size/grounding controls |
| `app/components/nodes/CarouselPromptNode.tsx` | Modify | EccoAPI controls; fix reference images in auto-batch |
| `app/components/nodes/ModelCreationNode.tsx` | Modify | EccoAPI model/size/grounding controls |
| `electron/main.cjs` | Modify | Provider-aware config, `startServer(config)`, `save-config` IPC |
| `electron/preload.cjs` | Modify | Expose `saveConfig`, `onPrefillConfig` |
| `electron/setup.html` | Modify | Provider toggle, provider-aware key validation |

---

## Task 1: Update `.env.local.example` and create `GET /api/config`

**Files:**
- Modify: `.env.local.example`
- Create: `app/api/config/route.ts`

- [ ] **Step 1: Add EccoAPI vars to `.env.local.example`**

Open `.env.local.example`. The current content ends at line 9. Replace with:

```
# Supabase — copy from your project's Settings > API page (optional, app works without it)
NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklmnop.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example

# AI Provider — set to "gemini" or "ecco" (default: gemini)
AI_PROVIDER=gemini

# Gemini API key — get yours at https://aistudio.google.com/app/apikey
# Format: starts with "AIzaSy" followed by ~33 characters
GEMINI_API_KEY=AIzaSyD4xQr8mN2pKvL9jH7wT5uE1cF3bA6sG0y

# EccoAPI key — get yours at https://eccoapi.com/dashboard
# Format: starts with "nk_live_"
ECCO_API_KEY=nk_live_your_key_here
```

- [ ] **Step 2: Create `app/api/config/route.ts`**

```typescript
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    provider: (process.env.AI_PROVIDER ?? 'gemini') as 'gemini' | 'ecco',
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    hasEccoKey:   !!process.env.ECCO_API_KEY,
  });
}
```

- [ ] **Step 3: Verify**

Start dev server (`npm run dev`) and run:
```bash
curl http://localhost:3000/api/config
```
Expected: `{"provider":"gemini","hasGeminiKey":true,"hasEccoKey":false}`

- [ ] **Step 4: Commit**
```bash
git add .env.local.example app/api/config/route.ts
git commit -m "feat: add provider config endpoint and ECCO_API_KEY env var"
```

---

## Task 2: Create `POST /api/ecco/generate`

**Files:**
- Create: `app/api/ecco/generate/route.ts`

This route accepts a generation request, immediately returns a `jobId` (202), and runs the actual EccoAPI call in the background using an in-memory job store (module-level Map — works because the Electron app runs a persistent Node.js process).

- [ ] **Step 1: Create `app/api/ecco/generate/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { readFile } from 'fs/promises';
import path from 'path';
import { getGeneratedDir, makeGeneratedUrl, urlToFilePath } from '../../../../lib/storage';

// ─── In-memory job store (works for persistent Node.js / Electron server) ─────
export type JobStatus = 'pending' | 'completed' | 'error';
export interface JobResult {
  status: JobStatus;
  imageUrl?: string;
  remaining_credits?: number;
  cost?: number;
  error?: string;
}
// Module-level singleton — survives across requests in the same process
const jobStore = new Map<string, JobResult>();

// Force Node.js runtime (not Edge) so background tasks and fs work
export const runtime = 'nodejs';

// ─── Error messages ───────────────────────────────────────────────────────────
const ECCO_ERRORS: Record<number, string> = {
  400: 'Invalid request — check prompt and settings',
  401: 'Invalid EccoAPI key — check your settings',
  402: 'Insufficient credits — top up at eccoapi.com/dashboard',
  403: 'Access denied for this job',
  404: 'Job not found — it may have expired',
  429: 'Rate limit reached — please wait a moment',
  500: 'EccoAPI server error — try again',
  503: 'EccoAPI model is temporarily unavailable',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getEccoKey(): string {
  const key = process.env.ECCO_API_KEY;
  if (!key) throw new Error('ECCO_API_KEY is not set');
  return key;
}

async function urlToBase64(urlOrPath: string): Promise<string> {
  if (urlOrPath.startsWith('/')) {
    const buf = await readFile(urlToFilePath(urlOrPath));
    return buf.toString('base64');
  }
  const res = await fetch(urlOrPath);
  if (!res.ok) throw new Error(`Failed to fetch reference: ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}

async function downloadAndPersist(assetUrl: string): Promise<string> {
  const res = await fetch(assetUrl);
  if (!res.ok) throw new Error(`Failed to download image from EccoAPI: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
  const outDir = getGeneratedDir();
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, filename), buf);
  return makeGeneratedUrl(filename);
}

// ─── Background generation (fire-and-forget) ──────────────────────────────────
async function runEccoGeneration(
  jobId: string,
  model: string,
  eccoBody: Record<string, unknown>,
  apiKey: string,
): Promise<void> {
  try {
    const endpoint = `https://eccoapi.com/api/v1/${model}/generate`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(eccoBody),
    });

    const data = await res.json() as {
      code?: number;
      msg?: string;
      data?: { assetUrl: string };
      meta?: { cost: number; remaining_credits: number };
    };

    if (!res.ok) {
      const msg = ECCO_ERRORS[res.status] ?? `EccoAPI error ${res.status}`;
      jobStore.set(jobId, { status: 'error', error: msg });
      return;
    }

    if (!data.data?.assetUrl) {
      jobStore.set(jobId, { status: 'error', error: 'EccoAPI returned no image URL' });
      return;
    }

    // Download image from signed URL (TTL: 900s) and persist locally
    const imageUrl = await downloadAndPersist(data.data.assetUrl);
    jobStore.set(jobId, {
      status: 'completed',
      imageUrl,
      remaining_credits: data.meta?.remaining_credits,
      cost: data.meta?.cost,
    });
    console.log(`[ecco/generate] job=${jobId} completed imageUrl=${imageUrl}`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ecco/generate] job=${jobId} error:`, msg);
    jobStore.set(jobId, { status: 'error', error: msg });
  }
}

// ─── POST /api/ecco/generate ──────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      prompt: string;
      nodeId: string;
      batchId: string;
      model?: string;
      aspectRatio?: string;
      imageSize?: string;
      useGoogleSearch?: boolean;
      referenceUrls?: string[];
      settings?: Record<string, unknown>;
    };

    const {
      prompt,
      nodeId,
      batchId,
      model = 'nanobanana31',
      aspectRatio = '1:1',
      imageSize = '1K',
      useGoogleSearch = false,
      referenceUrls = [],
      settings = {},
    } = body;

    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const apiKey = getEccoKey();

    // Convert local reference URLs to base64 (EccoAPI can't reach localhost)
    const imageBase64: string[] = [];
    for (const url of referenceUrls.slice(0, 14)) {
      try {
        imageBase64.push(await urlToBase64(url));
      } catch (e) {
        console.warn('[ecco/generate] skipping inaccessible reference:', url, e);
      }
    }

    // settings.useGoogleSearch takes precedence over the top-level param
    // (nodes persist it inside settings via onUpdateSettings)
    const resolvedSearch = (settings.useGoogleSearch as boolean | undefined) ?? useGoogleSearch;

    const eccoBody: Record<string, unknown> = {
      prompt: prompt.trim(),
      aspectRatio:    (settings.aspectRatio as string | undefined) ?? aspectRatio,
      imageSize:      (settings.imageSize   as string | undefined) ?? imageSize,
      useGoogleSearch: resolvedSearch,
    };
    if (imageBase64.length) eccoBody.imageBase64 = imageBase64;

    // Generate a local job ID and return 202 immediately
    const jobId = `ecco-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    jobStore.set(jobId, { status: 'pending' });

    console.log(`[ecco/generate] queued job=${jobId} model=${model} nodeId=${nodeId}`);

    // Fire-and-forget background task
    void runEccoGeneration(jobId, model, eccoBody, apiKey);

    return NextResponse.json({ jobId, nodeId, batchId }, { status: 202 });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ecco/generate] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify the file compiles**
```bash
npx tsc --noEmit
```
Expected: no errors for this file (ignore pre-existing errors if any).

- [ ] **Step 3: Commit**
```bash
git add app/api/ecco/generate/route.ts
git commit -m "feat: add EccoAPI generate route with background job processing"
```

---

## Task 3: Create `GET /api/ecco/jobs/[jobId]`

**Files:**
- Create: `app/lib/eccoJobStore.ts`
- Create: `app/api/ecco/jobs/[jobId]/route.ts`

Both the generate route and the jobs route must reference the **same** `Map` instance. The fix is a shared singleton module (`app/lib/eccoJobStore.ts`). Both routes import from it.

- [ ] **Step 1: Create `app/lib/eccoJobStore.ts`**

```typescript
export type JobStatus = 'pending' | 'completed' | 'error';

export interface JobResult {
  status: JobStatus;
  imageUrl?: string;
  remaining_credits?: number;
  cost?: number;
  error?: string;
}

// Module-level singleton — same Map instance across all imports in the same process
export const jobStore = new Map<string, JobResult>();
```

- [ ] **Step 2: Update `app/api/ecco/generate/route.ts` to import from the shared store**

In `app/api/ecco/generate/route.ts`, replace the inline `jobStore` declaration and types at the top with:

```typescript
import { jobStore } from '../../../lib/eccoJobStore';
import type { JobResult } from '../../../lib/eccoJobStore';
```

Remove the inline `jobStore`, `JobStatus`, and `JobResult` definitions (lines you originally wrote inline).

- [ ] **Step 3: Create `app/api/ecco/jobs/[jobId]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { jobStore } from '../../../../lib/eccoJobStore';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: { jobId: string } },
) {
  const { jobId } = params;
  const job = jobStore.get(jobId);

  if (!job) {
    // Job not found — return pending so the client keeps polling briefly
    return NextResponse.json({ status: 'pending' });
  }

  return NextResponse.json(job);
}
```

- [ ] **Step 4: Verify compilation**
```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**
```bash
git add app/lib/eccoJobStore.ts app/api/ecco/generate/route.ts app/api/ecco/jobs/[jobId]/route.ts
git commit -m "feat: add EccoAPI job polling route with shared in-memory job store"
```

---

## Task 4: Fix Gemini route to accept explicit `referenceUrls`

**Files:**
- Modify: `app/api/generate/route.ts` (lines 166–258, the POST handler and slide path)

This fixes the bug where automated batch carousel generation doesn't send connected reference images.

- [ ] **Step 1: Update the POST handler body destructure (line ~176)**

Find this block in `app/api/generate/route.ts`:
```typescript
    const { prompt, nodeId, type, settings = {} } = body;
```

Replace with:
```typescript
    const { prompt, nodeId, type, settings = {}, referenceUrls = [] } = body;
```

Also update the `body` type annotation above it:
```typescript
    const body = await request.json() as {
      prompt: string;
      nodeId: string;
      type?: 'slide' | 'model-creation';
      settings?: Record<string, unknown>;
      referenceUrls?: string[];
    };
```

- [ ] **Step 2: Update the slide generation path to merge explicit refs (line ~208)**

Find this block (around line 208):
```typescript
    // ── Slide generation path (text + optional reference images → output) ──────
    const matchedImages = await findMatchingImages(prompt);
    const aspectRatio   = (settings.aspectRatio as string | undefined) ?? '4:5';
```

Replace with:
```typescript
    // ── Slide generation path (text + optional reference images → output) ──────
    const matchedImages = await findMatchingImages(prompt);

    // Merge canvas-connected reference images (explicit) with tag-matched ones.
    // Explicit refs come first (they are directly connected on the canvas).
    const explicitRefs = (referenceUrls as string[])
      .filter(url => !matchedImages.find(m => m.url === url))
      .map(url => ({ url, name: 'canvas-reference', matchedTags: [] as string[] }));
    const allImages = [...explicitRefs, ...matchedImages].slice(0, 14);

    const aspectRatio = (settings.aspectRatio as string | undefined) ?? '4:5';
```

- [ ] **Step 3: Update the reference image loop to use `allImages` instead of `matchedImages` (line ~217)**

Find:
```typescript
    for (const img of matchedImages.slice(0, 14)) {
```

Replace with:
```typescript
    for (const img of allImages) {
```

- [ ] **Step 4: Update the response to report all matched refs**

Find (around line 246–251):
```typescript
    return NextResponse.json({
      success: true,
      imageUrl,
      matchedRefs: matchedImages.map(m => m.name),
      nodeId,
    });
```

Replace with:
```typescript
    return NextResponse.json({
      success: true,
      imageUrl,
      matchedRefs: allImages.map(m => m.name),
      nodeId,
    });
```

- [ ] **Step 5: Verify compilation**
```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**
```bash
git add app/api/generate/route.ts
git commit -m "fix: accept explicit referenceUrls in Gemini route, merge with tag-matched refs"
```

---

## Task 5: Update `StudioContext.ts` types

**Files:**
- Modify: `app/context/StudioContext.ts`

- [ ] **Step 1: Add new fields to `NodeSettings` and `activeProvider` to `StudioContextType`**

Open `app/context/StudioContext.ts`. The current `NodeSettings` interface ends at line 30.

Add `eccoModel`, `imageSize`, and `useGoogleSearch` to `NodeSettings`:
```typescript
export interface NodeSettings {
  // Image Prompt / Carousel
  temperature?: number;
  guidanceScale?: number;
  negativePrompt?: string;
  seed?: string;
  safetyFilter?: string;
  model?: string;
  count?: number;
  // EccoAPI-specific
  eccoModel?: 'nanobanana31' | 'nanobananapro';
  imageSize?: '1K' | '2K' | '4K';
  useGoogleSearch?: boolean;
  // Image Output
  resolution?: string;
  aspectRatio?: string;
  format?: string;
  // Model Creation
  style?: string;
  lighting?: string;
  background?: string;
}
```

Add `activeProvider` to `StudioContextType` (after line 53, inside the interface):
```typescript
  activeProvider: 'gemini' | 'ecco';
```

Add the default value to the `createContext` call (after `onCompleteConnect: () => {},`):
```typescript
  activeProvider: 'gemini',
```

- [ ] **Step 2: Verify compilation**
```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**
```bash
git add app/context/StudioContext.ts
git commit -m "feat: add eccoModel, imageSize, useGoogleSearch to NodeSettings; add activeProvider to StudioContext"
```

---

## Task 6: Add `addGeneratedImageToBatch` to `useBatchHistory`

**Files:**
- Modify: `app/hooks/useBatchHistory.ts`

- [ ] **Step 1: Add `addGeneratedImageToBatch` to the hook**

In `app/hooks/useBatchHistory.ts`, after the `addGeneratedImage` function (around line 153), add:

```typescript
  /** Add a generated image to a specific batch (used for background EccoAPI completions) */
  const addGeneratedImageToBatch = useCallback((batchId: string, image: GeneratedImage) => {
    setBatches(prev => prev.map(b =>
      b.id === batchId
        ? { ...b, generatedImages: [image, ...b.generatedImages] }
        : b
    ));
    setGlobalLibrary(prev => [image, ...prev]);
  }, []);
```

- [ ] **Step 2: Add to the return object (around line 168)**

Find:
```typescript
  return {
    batches, activeBatch, activeBatchId, globalLibrary,
    saveCurrentBatch, switchBatch, newBatch, newAutomatedBatch,
    renameBatch, deleteBatch,
    addGeneratedImage, removeGeneratedImage, removeFromGlobalLibrary,
  };
```

Replace with:
```typescript
  return {
    batches, activeBatch, activeBatchId, globalLibrary,
    saveCurrentBatch, switchBatch, newBatch, newAutomatedBatch,
    renameBatch, deleteBatch,
    addGeneratedImage, addGeneratedImageToBatch, removeGeneratedImage, removeFromGlobalLibrary,
  };
```

- [ ] **Step 3: Verify compilation**
```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**
```bash
git add app/hooks/useBatchHistory.ts
git commit -m "feat: add addGeneratedImageToBatch to useBatchHistory for background job completions"
```

---

## Task 7: Create `useGenerationQueue` hook

**Files:**
- Create: `app/hooks/useGenerationQueue.ts`

- [ ] **Step 1: Create the hook**

```typescript
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface GenerationJob {
  id: string;           // EccoAPI jobId returned by /api/ecco/generate
  nodeId: string;
  batchId: string;
  status: 'polling' | 'completed' | 'error';
  imageUrl?: string;
  remaining_credits?: number;
  cost?: number;
  error?: string;
  seen: boolean;        // false = batch tab shows dot indicator
}

interface UseGenerationQueueOptions {
  onJobComplete: (job: GenerationJob) => void;
  onJobError:    (job: GenerationJob) => void;
}

export function useGenerationQueue({ onJobComplete, onJobError }: UseGenerationQueueOptions) {
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  /** Add a new job to the queue (starts as 'polling') */
  const addJob = useCallback((job: Omit<GenerationJob, 'status' | 'seen'>) => {
    setJobs(prev => [...prev, { ...job, status: 'polling', seen: false }]);
  }, []);

  /** Mark all jobs for a batch as seen (clears the dot indicator) */
  const markBatchSeen = useCallback((batchId: string) => {
    setJobs(prev => prev.map(j => j.batchId === batchId ? { ...j, seen: true } : j));
  }, []);

  // Poll active jobs every 3 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      const active = jobsRef.current.filter(j => j.status === 'polling');
      if (!active.length) return;

      for (const job of active) {
        try {
          const res  = await fetch(`/api/ecco/jobs/${job.id}`);
          if (!res.ok) continue;
          const data = await res.json() as {
            status: string;
            imageUrl?: string;
            remaining_credits?: number;
            cost?: number;
            error?: string;
          };

          if (data.status === 'completed' && data.imageUrl) {
            const updated: GenerationJob = {
              ...job,
              status: 'completed',
              imageUrl: data.imageUrl,
              remaining_credits: data.remaining_credits,
              cost: data.cost,
            };
            setJobs(prev => prev.map(j => j.id === job.id ? updated : j));
            onJobComplete(updated);

          } else if (data.status === 'error') {
            const updated: GenerationJob = {
              ...job,
              status: 'error',
              error: data.error ?? 'Generation failed',
            };
            setJobs(prev => prev.map(j => j.id === job.id ? updated : j));
            onJobError(updated);
          }
          // status === 'pending': keep polling
        } catch {
          // Network error — retry next tick silently
        }
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [onJobComplete, onJobError]);

  return { jobs, addJob, markBatchSeen };
}
```

- [ ] **Step 2: Verify compilation**
```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**
```bash
git add app/hooks/useGenerationQueue.ts
git commit -m "feat: add useGenerationQueue hook for EccoAPI client-side job polling"
```

---

## Task 8: Update `page.tsx` — Phase 1 (provider, credits, callEccoGenerate, ref-image fix)

**Files:**
- Modify: `app/page.tsx`

This is the largest task. Break it into clear steps.

- [ ] **Step 1: Add imports at the top of `page.tsx`**

After the existing imports (around line 28), add:
```typescript
import { useGenerationQueue } from './hooks/useGenerationQueue';
import type { GenerationJob } from './hooks/useGenerationQueue';
```

- [ ] **Step 2: Add `activeProvider` and `eccoCredits` state inside `StudioCanvas` (after line 88, near other state declarations)**

```typescript
  const [activeProvider, setActiveProvider] = useState<'gemini' | 'ecco'>('gemini');
  const [eccoCredits, setEccoCredits]       = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const saved = localStorage.getItem('isupply-ecco-credits');
    return saved ? parseFloat(saved) : null;
  });
```

- [ ] **Step 3: Add a ref to capture `activeBatchId` for async closures (after `nodesRef`)**

```typescript
  const activeBatchIdRef = useRef(activeBatchId);
  activeBatchIdRef.current = activeBatchId;
```

- [ ] **Step 4: Fetch the active provider on mount**

After the `refreshAssets` useEffect (around line 96–101), add:

```typescript
  // Fetch active provider from server config
  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then((data: { provider: 'gemini' | 'ecco' }) => setActiveProvider(data.provider ?? 'gemini'))
      .catch(() => {});
  }, []);
```

- [ ] **Step 5: Add the job completion handlers and the generation queue**

After `addGeneratedImage` and `addGeneratedImageToBatch` are destructured from `useBatchHistory` (update that destructure first):

Find the `useBatchHistory` destructure at the top of `StudioCanvas` (line 37):
```typescript
  const { batches, activeBatch, activeBatchId, globalLibrary, saveCurrentBatch, switchBatch, newBatch, newAutomatedBatch, renameBatch, deleteBatch, addGeneratedImage, removeGeneratedImage, removeFromGlobalLibrary } = useBatchHistory();
```

Replace with:
```typescript
  const { batches, activeBatch, activeBatchId, globalLibrary, saveCurrentBatch, switchBatch, newBatch, newAutomatedBatch, renameBatch, deleteBatch, addGeneratedImage, addGeneratedImageToBatch, removeGeneratedImage, removeFromGlobalLibrary } = useBatchHistory();
```

Then add the queue handlers (place after the `activeBatchIdRef` line from Step 3):

```typescript
  const handleJobComplete = useCallback((job: GenerationJob) => {
    if (!job.imageUrl) return;
    if (job.batchId === activeBatchIdRef.current) {
      setNodes(nds => nds.map(n =>
        n.id === job.nodeId
          ? { ...n, data: { ...n.data, isLoading: false, imageUrl: job.imageUrl, error: undefined } }
          : n
      ));
    }
    addGeneratedImageToBatch(job.batchId, {
      id: `img-${Date.now()}`,
      url: job.imageUrl,
      prompt: '',
      nodeId: job.nodeId,
      createdAt: new Date().toISOString(),
    });
    if (job.remaining_credits !== undefined) {
      setEccoCredits(job.remaining_credits);
      localStorage.setItem('isupply-ecco-credits', String(job.remaining_credits));
    }
  }, [addGeneratedImageToBatch]);

  const handleJobError = useCallback((job: GenerationJob) => {
    if (job.batchId !== activeBatchIdRef.current) return;
    setNodes(nds => nds.map(n =>
      n.id === job.nodeId
        ? { ...n, data: { ...n.data, isLoading: false, error: job.error ?? 'Generation failed' } }
        : n
    ));
  }, []);

  const { jobs: queueJobs, addJob, markBatchSeen } = useGenerationQueue({
    onJobComplete: handleJobComplete,
    onJobError:    handleJobError,
  });

  const queueJobsRef = useRef(queueJobs);
  queueJobsRef.current = queueJobs;
```

- [ ] **Step 6: Apply completed background jobs when switching to a batch**

After the `useEffect` that syncs nodes/edges when `activeBatchId` changes (around line 53–60), add:

```typescript
  // Apply completed EccoAPI background jobs when their batch becomes active
  useEffect(() => {
    const done = queueJobsRef.current.filter(
      j => j.batchId === activeBatchId && j.status === 'completed' && j.imageUrl,
    );
    if (!done.length) return;
    setNodes(nds => nds.map(n => {
      const job = done.find(j => j.nodeId === n.id);
      if (!job) return n;
      return { ...n, data: { ...n.data, isLoading: false, imageUrl: job.imageUrl, error: undefined } };
    }));
  }, [activeBatchId]); // only run on batch switch, not on every queue update
```

- [ ] **Step 7: Mark batch seen on switch**

Find `handleSwitchBatch` (around line 426):
```typescript
  const handleSwitchBatch = (id: string) => {
    saveCurrentBatch(nodes, edges);
    switchBatch(id, nodes, edges);
    setSelectedNodeId(null);
  };
```

Replace with:
```typescript
  const handleSwitchBatch = (id: string) => {
    saveCurrentBatch(nodes, edges);
    switchBatch(id, nodes, edges);
    setSelectedNodeId(null);
    markBatchSeen(id);
  };
```

- [ ] **Step 8: Add `callEccoGenerate` function**

Place this after the existing `callGenerate` function (around line 304):

```typescript
  /** EccoAPI: fire-and-forget, returns jobId immediately, queues polling */
  const callEccoGenerate = useCallback((
    outputNodeIds: string[],
    body: Record<string, unknown>,
  ) => {
    const capturedBatchId = activeBatchIdRef.current;

    setNodes(nds => nds.map(n =>
      outputNodeIds.includes(n.id)
        ? { ...n, data: { ...n.data, isLoading: true, error: undefined } }
        : n
    ));

    fetch('/api/ecco/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, batchId: capturedBatchId }),
    })
      .then(res => res.json())
      .then((data: { jobId?: string; error?: string }) => {
        if (data.error || !data.jobId) {
          const msg = data.error ?? 'EccoAPI did not return a job ID';
          if (capturedBatchId === activeBatchIdRef.current) {
            setNodes(nds => nds.map(n =>
              outputNodeIds.includes(n.id)
                ? { ...n, data: { ...n.data, isLoading: false, error: msg } }
                : n
            ));
          }
          return;
        }
        addJob({ id: data.jobId, nodeId: outputNodeIds[0], batchId: capturedBatchId });
      })
      .catch(err => {
        const msg = err instanceof Error ? err.message : 'Generation failed';
        if (capturedBatchId === activeBatchIdRef.current) {
          setNodes(nds => nds.map(n =>
            outputNodeIds.includes(n.id)
              ? { ...n, data: { ...n.data, isLoading: false, error: msg } }
              : n
          ));
        }
      });
  }, [addJob]);
```

- [ ] **Step 9: Update `onGenerateSlide` to pass `referenceUrls` and route to correct provider**

Find `onGenerateSlide` (around line 306). Replace the whole function:

```typescript
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

    // Collect connected UploadNode image URLs (explicit canvas references)
    const referenceUrls = edgesRef.current
      .filter(e => e.target === promptNodeId)
      .flatMap(e => {
        const n = nodesRef.current.find(nd => nd.id === e.source);
        if (n?.type !== 'uploadNode') return [];
        const img = (n.data as Record<string, unknown>)?.savedImage as { url: string } | undefined;
        return img?.url ? [img.url] : [];
      });

    const body = { prompt, nodeId: promptNodeId, type: 'slide', settings: settings ?? {}, referenceUrls };

    if (activeProvider === 'ecco') {
      const eccoModel = (settings?.eccoModel ?? 'nanobanana31') as string;
      allOutIds.forEach(outId => callEccoGenerate([outId], { ...body, model: eccoModel }));
    } else {
      await Promise.all(allOutIds.map(outId => callGenerate([outId], body)));
    }
  }, [callGenerate, callEccoGenerate, activeProvider]);
```

- [ ] **Step 10: Update `onGenerateCarousel` to pass `referenceUrls` and route to correct provider**

Find `onGenerateCarousel` (around line 340). Replace:

```typescript
  const onGenerateCarousel = useCallback(async (nodeId: string, slides: CarouselSlide[], settings?: NodeSettings) => {
    // Collect connected UploadNode image URLs (fixes automated batch reference image bug)
    const referenceUrls = edgesRef.current
      .filter(e => e.target === nodeId)
      .flatMap(e => {
        const n = nodesRef.current.find(nd => nd.id === e.source);
        if (n?.type !== 'uploadNode') return [];
        const img = (n.data as Record<string, unknown>)?.savedImage as { url: string } | undefined;
        return img?.url ? [img.url] : [];
      });

    const pending = slides.filter(s => s.prompt.trim() && s.outputNodeId);
    const eccoModel = (settings?.eccoModel ?? 'nanobanana31') as string;

    for (const slide of pending) {
      const body = { prompt: slide.prompt.trim(), nodeId, type: 'slide', settings: settings ?? {}, referenceUrls };
      if (activeProvider === 'ecco') {
        callEccoGenerate([slide.outputNodeId], { ...body, model: eccoModel });
      } else {
        await callGenerate([slide.outputNodeId], body);
      }
    }
  }, [callGenerate, callEccoGenerate, activeProvider]);
```

- [ ] **Step 11: Update `onCreateModel` to route to correct provider**

Find `onCreateModel` (around line 353). Replace:

```typescript
  const onCreateModel = useCallback(async (nodeId: string, description: string, settings: NodeSettings) => {
    if (activeProvider === 'ecco') {
      const eccoModel = (settings.eccoModel ?? 'nanobananapro') as string;
      callEccoGenerate([nodeId], {
        prompt: description,
        nodeId,
        model: eccoModel,
        aspectRatio: '16:9',
        imageSize: settings.imageSize ?? '1K',
        useGoogleSearch: settings.useGoogleSearch ?? false,
        settings,
      });
      return;
    }
    // Gemini path (unchanged)
    setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, isLoading: true, error: undefined } } : n));
    try {
      const res  = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: description, nodeId, type: 'model-creation', settings }) });
      const data = await res.json();
      if (!res.ok || !data.imageUrl) throw new Error(data.error ?? 'No image returned');
      setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, isLoading: false, imageUrl: data.imageUrl, error: undefined } } : n));
      addGeneratedImage({ id: `img-${Date.now()}`, url: data.imageUrl, prompt: description, nodeId, createdAt: new Date().toISOString() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Generation failed';
      setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, isLoading: false, error: msg } } : n));
    }
  }, [addGeneratedImage, activeProvider, callEccoGenerate]);
```

- [ ] **Step 12: Add `activeProvider` to `studioCtx`**

Find the `studioCtx` useMemo (around line 367):
```typescript
  const studioCtx = useMemo(() => ({
    onSaveImage, onGenerateSlide, onGenerateCarousel, onRegenerate, onCreateModel,
    onUpdateSettings, onUpdateData, onSelectNode, onAddToLibrary,
    onDeleteNode, connectingFromId, onStartConnect, onCompleteConnect,
  }), [...]);
```

Replace with:
```typescript
  const studioCtx = useMemo(() => ({
    onSaveImage, onGenerateSlide, onGenerateCarousel, onRegenerate, onCreateModel,
    onUpdateSettings, onUpdateData, onSelectNode, onAddToLibrary,
    onDeleteNode, connectingFromId, onStartConnect, onCompleteConnect,
    activeProvider,
  }), [onSaveImage, onGenerateSlide, onGenerateCarousel, onRegenerate, onCreateModel,
      onUpdateSettings, onUpdateData, onSelectNode, onAddToLibrary,
      onDeleteNode, connectingFromId, onStartConnect, onCompleteConnect, activeProvider]);
```

- [ ] **Step 13: Verify compilation**
```bash
npx tsc --noEmit
```

Fix any type errors before committing.

- [ ] **Step 14: Commit**
```bash
git add app/page.tsx
git commit -m "feat: add EccoAPI provider routing, generation queue, reference image fix in page.tsx"
```

---

## Task 9: Update `page.tsx` — Phase 2 (UI: credits display + batch tab dots)

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add credits display to the header**

Find the header's right-side content (around line 482–486):
```tsx
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#9090A8' }}>
            <span>Active batch:</span>
            <span style={{ color: '#F1F0F5', fontWeight: 600 }}>{activeBatch?.name}</span>
          </div>
```

Replace with:
```tsx
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 11, color: '#9090A8' }}>
            {activeProvider === 'ecco' && eccoCredits !== null && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 5,
                color: eccoCredits < 2 ? '#F59E0B' : '#9090A8',
              }}>
                {eccoCredits < 2 && (
                  <span style={{ fontSize: 12 }}>⚠</span>
                )}
                <span style={{ color: eccoCredits < 2 ? '#F59E0B' : '#0D9488', fontWeight: 600 }}>
                  Credits: ${eccoCredits.toFixed(2)}
                </span>
                {eccoCredits < 2 && (
                  <span style={{ color: '#F59E0B', fontSize: 10 }}>Low credits</span>
                )}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Active batch:</span>
              <span style={{ color: '#F1F0F5', fontWeight: 600 }}>{activeBatch?.name}</span>
            </div>
          </div>
```

- [ ] **Step 2: Add a helper to get job status per batch**

Inside `StudioCanvas`, before the JSX return (around line 471), add:

```typescript
  /** Returns the most actionable job status for a given batch tab */
  const getBatchJobStatus = (batchId: string): 'polling' | 'completed' | 'error' | null => {
    const batchJobs = queueJobs.filter(j => j.batchId === batchId);
    if (batchJobs.some(j => j.status === 'polling'))                       return 'polling';
    if (batchJobs.some(j => j.status === 'error'     && !j.seen))          return 'error';
    if (batchJobs.some(j => j.status === 'completed' && !j.seen))          return 'completed';
    return null;
  };
```

- [ ] **Step 3: Add the dot indicator to each batch tab in the batch list**

Find the batch list item render (around line 544–546):
```tsx
                  {batches.map(b => (
                    <div key={b.id} onClick={() => handleSwitchBatch(b.id)}
                      style={{ background: b.id === activeBatchId ? '#1A1A1F' : 'transparent', border: `1px solid ${b.id === activeBatchId ? '#7C3AED44' : '#2A2A35'}`, borderRadius: 8, padding: '8px 10px', marginBottom: 5, cursor: 'pointer', transition: 'all 0.15s' }}>
```

Replace with:
```tsx
                  {batches.map(b => {
                    const jobStatus = getBatchJobStatus(b.id);
                    return (
                    <div key={b.id} onClick={() => handleSwitchBatch(b.id)}
                      style={{ background: b.id === activeBatchId ? '#1A1A1F' : 'transparent', border: `1px solid ${b.id === activeBatchId ? '#7C3AED44' : '#2A2A35'}`, borderRadius: 8, padding: '8px 10px', marginBottom: 5, cursor: 'pointer', transition: 'all 0.15s', position: 'relative' }}>
                      {jobStatus && (
                        <span style={{
                          position: 'absolute', top: 6, right: 8,
                          width: 7, height: 7, borderRadius: '50%',
                          background: jobStatus === 'polling' ? '#F59E0B' : jobStatus === 'error' ? '#F43F5E' : '#0D9488',
                          boxShadow: `0 0 5px ${jobStatus === 'polling' ? '#F59E0B' : jobStatus === 'error' ? '#F43F5E' : '#0D9488'}`,
                          animation: jobStatus === 'polling' ? 'pulse 1s infinite' : 'none',
                        }} />
                      )}
```

Note: You will also need to close the map with `);` and `})}` instead of the original `})}`. Find the closing `</div>` and extra `)` for the batch item and update accordingly. The batch item renders a rename input and batch info — keep all that content, just wrap the outer `<div>` open tag as shown above and add the dot `<span>` right after it.

- [ ] **Step 4: Verify compilation and spot check in browser**

```bash
npx tsc --noEmit
npm run dev
```

Open the app, check the header shows no credits section when using Gemini. Switch to EccoAPI (by setting `AI_PROVIDER=ecco` in `.env.local`), verify credits area appears.

- [ ] **Step 5: Commit**
```bash
git add app/page.tsx
git commit -m "feat: add credits display in header and batch tab job status indicators"
```

---

## Task 10: Add EccoAPI controls to `PromptNode`

**Files:**
- Modify: `app/components/nodes/PromptNode.tsx`

- [ ] **Step 1: Add `activeProvider` to the context destructure**

Find:
```typescript
  const { onGenerateSlide, onSelectNode, onDeleteNode, connectingFromId, onStartConnect, onCompleteConnect } = useContext(StudioContext);
```

Replace with:
```typescript
  const { onGenerateSlide, onSelectNode, onDeleteNode, connectingFromId, onStartConnect, onCompleteConnect, activeProvider, onUpdateSettings } = useContext(StudioContext);
```

- [ ] **Step 2: Add local model/size/grounding state that syncs to node settings**

After the existing `useState` declarations (around line 28–30), add:

```typescript
  const eccoModel      = (data.settings?.eccoModel    ?? 'nanobanana31')  as 'nanobanana31' | 'nanobananapro';
  const imageSize      = (data.settings?.imageSize    ?? '1K')            as '1K' | '2K' | '4K';
  const useGoogleSearch = data.settings?.useGoogleSearch ?? false;
  const geminiModel    = data.settings?.model ?? 'Flash';

  const showGrounding = activeProvider === 'ecco' || geminiModel === 'Flash';
```

- [ ] **Step 3: Add EccoAPI controls JSX above the generate button**

Find the generate button (around line 172):
```tsx
      <button onClick={e => { e.stopPropagation(); handleGenerate(); }} disabled={isGenerating || !prompt.trim()}
```

Before that button, insert the provider controls:

```tsx
      {/* Provider-specific controls */}
      {activeProvider === 'ecco' && (
        <div className="nodrag" style={{ marginBottom: 8 }}>
          {/* EccoAPI Model selector */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            {(['nanobanana31', 'nanobananapro'] as const).map(m => (
              <button key={m} className="nodrag"
                onClick={e => { e.stopPropagation(); onUpdateSettings(id, { eccoModel: m }); }}
                style={{
                  flex: 1, padding: '4px 0', fontSize: 9, borderRadius: 5, border: 'none', cursor: 'pointer',
                  background: eccoModel === m ? '#7C3AED' : '#111113',
                  color: eccoModel === m ? '#fff' : '#55556A',
                  fontWeight: 600,
                }}>
                {m === 'nanobanana31' ? 'NanoBanana 3.1' : 'NanoBanana Pro'}
              </button>
            ))}
          </div>
          {/* Image size */}
          <div style={{ display: 'flex', gap: 4 }}>
            {(['1K', '2K', '4K'] as const).map(s => (
              <button key={s} className="nodrag"
                onClick={e => { e.stopPropagation(); onUpdateSettings(id, { imageSize: s }); }}
                style={{
                  flex: 1, padding: '3px 0', fontSize: 9, borderRadius: 5, border: 'none', cursor: 'pointer',
                  background: imageSize === s ? '#0D9488' : '#111113',
                  color: imageSize === s ? '#fff' : '#55556A',
                  fontWeight: 600,
                }}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Google Search grounding toggle (Gemini Flash or any EccoAPI model) */}
      {showGrounding && (
        <div className="nodrag" onClick={e => e.stopPropagation()}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 10, color: '#55556A' }}>Search grounding</span>
          <button
            className="nodrag"
            onClick={e => { e.stopPropagation(); onUpdateSettings(id, { useGoogleSearch: !useGoogleSearch }); }}
            style={{
              width: 32, height: 16, borderRadius: 8, border: 'none', cursor: 'pointer', padding: 0,
              background: useGoogleSearch ? '#0D9488' : '#2A2A35',
              position: 'relative', transition: 'background 0.2s',
            }}>
            <span style={{
              position: 'absolute', top: 2, left: useGoogleSearch ? 18 : 2, width: 12, height: 12,
              borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
            }} />
          </button>
        </div>
      )}
```

- [ ] **Step 4: Update `handleGenerate` to pass EccoAPI settings**

The existing `handleGenerate` calls `onGenerateSlide(id, prompt.trim(), data.settings)`. This is already correct — `data.settings` will now include `eccoModel`, `imageSize`, `useGoogleSearch` since we're persisting them via `onUpdateSettings`. No change needed here.

- [ ] **Step 5: Verify compilation**
```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**
```bash
git add app/components/nodes/PromptNode.tsx
git commit -m "feat: add EccoAPI model/size/grounding controls to PromptNode"
```

---

## Task 11: Add EccoAPI controls to `CarouselPromptNode`

**Files:**
- Modify: `app/components/nodes/CarouselPromptNode.tsx`

- [ ] **Step 1: Add `activeProvider` and `onUpdateSettings` to context destructure**

Find:
```typescript
  const { onGenerateCarousel, onUpdateData, onSelectNode, onDeleteNode, connectingFromId, onStartConnect, onCompleteConnect } = useContext(StudioContext);
```

Replace with:
```typescript
  const { onGenerateCarousel, onUpdateData, onSelectNode, onDeleteNode, connectingFromId, onStartConnect, onCompleteConnect, activeProvider, onUpdateSettings } = useContext(StudioContext);
```

- [ ] **Step 2: Derive model/size/grounding from `data.settings`**

After existing state declarations (around line 23–27), add:

```typescript
  const eccoModel      = (data.settings?.eccoModel    ?? 'nanobanana31')  as 'nanobanana31' | 'nanobananapro';
  const imageSize      = (data.settings?.imageSize    ?? '1K')            as '1K' | '2K' | '4K';
  const useGoogleSearch = data.settings?.useGoogleSearch ?? false;
  const geminiModel    = data.settings?.model ?? 'Flash';
  const showGrounding  = activeProvider === 'ecco' || geminiModel === 'Flash';
```

- [ ] **Step 3: Add EccoAPI controls JSX above the generate button**

Find the generate button (around line 254):
```tsx
      <button
        className="nodrag"
        onClick={e => { e.stopPropagation(); handleGenerate(); }}
```

Before that button, insert (same pattern as PromptNode but with `id` as the nodeId):

```tsx
      {/* Provider-specific controls */}
      {activeProvider === 'ecco' && (
        <div className="nodrag" style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            {(['nanobanana31', 'nanobananapro'] as const).map(m => (
              <button key={m} className="nodrag"
                onClick={e => { e.stopPropagation(); onUpdateSettings(id, { eccoModel: m }); }}
                style={{
                  flex: 1, padding: '4px 0', fontSize: 9, borderRadius: 5, border: 'none', cursor: 'pointer',
                  background: eccoModel === m ? '#7C3AED' : '#111113',
                  color: eccoModel === m ? '#fff' : '#55556A', fontWeight: 600,
                }}>
                {m === 'nanobanana31' ? 'NanoBanana 3.1' : 'NanoBanana Pro'}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['1K', '2K', '4K'] as const).map(s => (
              <button key={s} className="nodrag"
                onClick={e => { e.stopPropagation(); onUpdateSettings(id, { imageSize: s }); }}
                style={{
                  flex: 1, padding: '3px 0', fontSize: 9, borderRadius: 5, border: 'none', cursor: 'pointer',
                  background: imageSize === s ? '#0D9488' : '#111113',
                  color: imageSize === s ? '#fff' : '#55556A', fontWeight: 600,
                }}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      {showGrounding && (
        <div className="nodrag" onClick={e => e.stopPropagation()}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 10, color: '#55556A' }}>Search grounding</span>
          <button className="nodrag"
            onClick={e => { e.stopPropagation(); onUpdateSettings(id, { useGoogleSearch: !useGoogleSearch }); }}
            style={{
              width: 32, height: 16, borderRadius: 8, border: 'none', cursor: 'pointer', padding: 0,
              background: useGoogleSearch ? '#0D9488' : '#2A2A35', position: 'relative', transition: 'background 0.2s',
            }}>
            <span style={{
              position: 'absolute', top: 2, left: useGoogleSearch ? 18 : 2, width: 12, height: 12,
              borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
            }} />
          </button>
        </div>
      )}
```

- [ ] **Step 4: Verify compilation**
```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**
```bash
git add app/components/nodes/CarouselPromptNode.tsx
git commit -m "feat: add EccoAPI controls to CarouselPromptNode"
```

---

## Task 12: Add EccoAPI controls to `ModelCreationNode`

**Files:**
- Modify: `app/components/nodes/ModelCreationNode.tsx`

- [ ] **Step 1: Add `activeProvider` and `onUpdateSettings` to context destructure**

Find:
```typescript
  const { onCreateModel, onSelectNode, onAddToLibrary, onDeleteNode } = useContext(StudioContext);
```

Replace with:
```typescript
  const { onCreateModel, onSelectNode, onAddToLibrary, onDeleteNode, activeProvider, onUpdateSettings } = useContext(StudioContext);
```

- [ ] **Step 2: Derive model/size/grounding**

After `const settings = data.settings ?? ...` (around line 33), add:

```typescript
  const eccoModel      = (settings.eccoModel    ?? 'nanobananapro')  as 'nanobanana31' | 'nanobananapro';
  const imageSize      = (settings.imageSize    ?? '1K')             as '1K' | '2K' | '4K';
  const useGoogleSearch = (settings as Record<string, unknown>)?.useGoogleSearch as boolean ?? false;
```

Note: `ModelCreationData.settings` uses a narrower type. Update it to use `NodeSettings` from context:

Find:
```typescript
interface ModelCreationData {
  label: string;
  isLoading?: boolean;
  imageUrl?: string;
  error?: string;
  settings?: {
    style: string;
    lighting: string;
    background: string;
  };
}
```

Replace with:
```typescript
import type { NodeSettings } from '../../context/StudioContext';

interface ModelCreationData {
  label: string;
  isLoading?: boolean;
  imageUrl?: string;
  error?: string;
  settings?: NodeSettings & { style?: string; lighting?: string; background?: string };
}
```

Then simplify the derived fields:
```typescript
  const eccoModel      = (settings.eccoModel    ?? 'nanobananapro') as 'nanobanana31' | 'nanobananapro';
  const imageSize      = (settings.imageSize    ?? '1K')            as '1K' | '2K' | '4K';
  const useGoogleSearch = settings.useGoogleSearch ?? false;
```

- [ ] **Step 3: Add controls JSX above the generate button (around line 128)**

Find:
```tsx
      <button onClick={e => { e.stopPropagation(); handleGenerate(); }} disabled={!description.trim() || Boolean(isLoading)}
```

Before it, add:

```tsx
      {activeProvider === 'ecco' && (
        <div className="nodrag" style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            {(['nanobanana31', 'nanobananapro'] as const).map(m => (
              <button key={m} className="nodrag"
                onClick={e => { e.stopPropagation(); onUpdateSettings(id, { eccoModel: m }); }}
                style={{
                  flex: 1, padding: '4px 0', fontSize: 9, borderRadius: 5, border: 'none', cursor: 'pointer',
                  background: eccoModel === m ? '#F43F5E' : '#111113',
                  color: eccoModel === m ? '#fff' : '#55556A', fontWeight: 600,
                }}>
                {m === 'nanobanana31' ? 'NanoBanana 3.1' : 'NanoBanana Pro'}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            {(['1K', '2K', '4K'] as const).map(s => (
              <button key={s} className="nodrag"
                onClick={e => { e.stopPropagation(); onUpdateSettings(id, { imageSize: s }); }}
                style={{
                  flex: 1, padding: '3px 0', fontSize: 9, borderRadius: 5, border: 'none', cursor: 'pointer',
                  background: imageSize === s ? '#0D9488' : '#111113',
                  color: imageSize === s ? '#fff' : '#55556A', fontWeight: 600,
                }}>
                {s}
              </button>
            ))}
          </div>
          <div onClick={e => e.stopPropagation()}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, color: '#55556A' }}>Search grounding</span>
            <button className="nodrag"
              onClick={e => { e.stopPropagation(); onUpdateSettings(id, { useGoogleSearch: !useGoogleSearch }); }}
              style={{
                width: 32, height: 16, borderRadius: 8, border: 'none', cursor: 'pointer', padding: 0,
                background: useGoogleSearch ? '#0D9488' : '#2A2A35', position: 'relative', transition: 'background 0.2s',
              }}>
              <span style={{
                position: 'absolute', top: 2, left: useGoogleSearch ? 18 : 2, width: 12, height: 12,
                borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
              }} />
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 4: Verify compilation**
```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**
```bash
git add app/components/nodes/ModelCreationNode.tsx
git commit -m "feat: add EccoAPI controls to ModelCreationNode"
```

---

## Task 13: Update Electron `main.cjs`, `preload.cjs`, and `setup.html`

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `electron/setup.html`

- [ ] **Step 1: Update `startServer` in `electron/main.cjs` to accept full config**

Find:
```javascript
function startServer(apiKey) {
  const serverDir = getServerDir();

  const env = {
    ...process.env,
    GEMINI_API_KEY:               apiKey,
```

Replace with:
```javascript
function startServer(config) {
  const serverDir = getServerDir();
  const env = {
    ...process.env,
    GEMINI_API_KEY:               config.geminiApiKey ?? '',
    ECCO_API_KEY:                 config.eccoApiKey   ?? '',
    AI_PROVIDER:                  config.provider     ?? 'gemini',
```

- [ ] **Step 2: Update `buildAppMenu` to open setup with full config**

Find:
```javascript
          label: 'Settings — Change API Key',
          click: () => openSetupWindow(config.geminiApiKey ?? ''),
```

Replace with:
```javascript
          label: 'Settings — Change API Key / Provider',
          click: () => openSetupWindow(),
```

- [ ] **Step 3: Update `openSetupWindow` to send full config on load**

Find:
```javascript
function openSetupWindow(prefill = '') {
  if (setupWindow) { setupWindow.focus(); return; }

  setupWindow = new BrowserWindow({
    width: 520, height: 500,
```

Replace the whole function:
```javascript
function openSetupWindow() {
  if (setupWindow) { setupWindow.focus(); return; }

  setupWindow = new BrowserWindow({
    width: 520, height: 540,
    resizable: false,
    title: 'iSupply AI Studio — Setup',
    backgroundColor: '#0A0A0B',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  setupWindow.setMenuBarVisibility(false);
  setupWindow.loadFile(path.join(__dirname, 'setup.html'));

  setupWindow.webContents.on('did-finish-load', () => {
    const cfg = readConfig();
    setupWindow?.webContents.send('prefill-config', {
      provider:      cfg.provider      ?? 'gemini',
      geminiApiKey:  cfg.geminiApiKey  ?? '',
      eccoApiKey:    cfg.eccoApiKey    ?? '',
    });
  });

  setupWindow.on('closed', () => { setupWindow = null; });
}
```

- [ ] **Step 4: Replace `save-api-key` IPC handler with `save-config`**

Find and replace the entire `ipcMain.handle('save-api-key', ...)` block:

```javascript
ipcMain.handle('save-config', async (_e, { provider, apiKey }) => {
  if (!apiKey?.trim()) return { error: 'API key cannot be empty.' };

  const config     = readConfig();
  const isFirstRun = !config.geminiApiKey && !config.eccoApiKey;
  const keyField   = provider === 'ecco' ? 'eccoApiKey' : 'geminiApiKey';
  const newConfig  = { ...config, provider, [keyField]: apiKey.trim() };
  writeConfig(newConfig);

  if (isFirstRun) {
    startServer(newConfig);
    setupWindow?.close();
    await openMainWindow();
  } else {
    serverProcess?.kill();
    await new Promise(r => setTimeout(r, 1200));
    startServer(newConfig);
    setupWindow?.close();
    mainWindow?.webContents.reload();
  }
  return { ok: true };
});
```

- [ ] **Step 5: Update app lifecycle to use full config**

Find:
```javascript
app.whenReady().then(async () => {
  serverPort = await findFreePort(3000);

  const config = readConfig();
  if (config.geminiApiKey) {
    startServer(config.geminiApiKey);
    await openMainWindow();
  } else {
    openSetupWindow();
  }
});
```

Replace with:
```javascript
app.whenReady().then(async () => {
  serverPort = await findFreePort(3000);

  const config  = readConfig();
  const hasKey  = config.provider === 'ecco' ? !!config.eccoApiKey : !!config.geminiApiKey;
  if (hasKey) {
    startServer(config);
    await openMainWindow();
  } else {
    openSetupWindow();
  }
});
```

Also update the `activate` handler:
```javascript
app.on('activate', async () => {
  if (!mainWindow && !setupWindow) {
    const config = readConfig();
    const hasKey = config.provider === 'ecco' ? !!config.eccoApiKey : !!config.geminiApiKey;
    if (hasKey) {
      await openMainWindow();
    } else {
      openSetupWindow();
    }
  }
});
```

- [ ] **Step 6: Update `electron/preload.cjs`**

Replace the entire file content:
```javascript
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studio', {
  /** Returns the saved config object */
  getConfig: () => ipcRenderer.invoke('get-config'),

  /** Save provider + API key and (re)start the server */
  saveConfig: (data) => ipcRenderer.invoke('save-config', data),

  /** Listen for prefill-config messages from the main process */
  onPrefillConfig: (cb) => ipcRenderer.on('prefill-config', (_e, config) => cb(config)),
});
```

- [ ] **Step 7: Rewrite `electron/setup.html`**

Replace the entire `<script>` block and the form card HTML. The card HTML changes as follows — replace everything inside `<div class="card">` with:

```html
<div class="card">
  <div class="logo">iS</div>
  <h1>iSupply AI Studio</h1>
  <p class="sub">Choose your AI provider and enter your API key. Stored locally, never uploaded.</p>

  <!-- Provider toggle -->
  <label>AI Provider</label>
  <div style="display:flex;gap:6px;margin-bottom:18px;">
    <button id="btnGemini" class="provider-btn active" onclick="selectProvider('gemini')">Google Gemini</button>
    <button id="btnEcco"   class="provider-btn"        onclick="selectProvider('ecco')">EccoAPI (Nano Banana)</button>
  </div>

  <label id="keyLabel">Gemini API Key</label>
  <div class="input-wrap">
    <input type="password" id="apiKey" placeholder="AIza…" autocomplete="off" spellcheck="false" />
    <button class="toggle-vis" id="toggleVis" title="Show / hide key">👁</button>
  </div>

  <div class="hint">
    Don't have a key?
    <a href="#" id="linkProvider">Get one free →</a>
  </div>

  <div class="error-msg" id="errorMsg"></div>

  <button class="primary" id="saveBtn">Save &amp; Launch</button>

  <div class="loading" id="loading">
    <div class="spinner"></div>
    <p>Starting iSupply AI Studio…</p>
  </div>

  <hr class="divider" />
  <p class="footer">Your key is stored in your system's user-data folder and is never shared.</p>
</div>
```

Add `.provider-btn` CSS inside `<style>`:
```css
  .provider-btn {
    flex: 1; padding: 8px; border-radius: 7px; border: 1px solid #2A2A35;
    background: #1A1A1F; color: #55556A; font-size: 11px; font-weight: 600;
    cursor: pointer; transition: all .15s;
  }
  .provider-btn.active {
    background: #7C3AED22; border-color: #7C3AED; color: #F1F0F5;
  }
```

Replace the entire `<script>` block:
```html
<script>
  const input     = document.getElementById('apiKey');
  const saveBtn   = document.getElementById('saveBtn');
  const errorMsg  = document.getElementById('errorMsg');
  const loading   = document.getElementById('loading');
  const toggleBtn = document.getElementById('toggleVis');
  const keyLabel  = document.getElementById('keyLabel');
  const linkProv  = document.getElementById('linkProvider');
  let visible     = false;
  let provider    = 'gemini';

  const PROVIDERS = {
    gemini: {
      label:       'Gemini API Key',
      placeholder: 'AIza…',
      hint:        'Get one free at Google AI Studio →',
      url:         'https://aistudio.google.com/app/apikey',
      validate:    k => k.startsWith('AIza') && k.length >= 20,
      errMsg:      'Should start with "AIza" and be at least 20 characters.',
    },
    ecco: {
      label:       'EccoAPI Key',
      placeholder: 'nk_live_…',
      hint:        'Get one free at EccoAPI Dashboard →',
      url:         'https://eccoapi.com/dashboard',
      validate:    k => k.startsWith('nk_live_') && k.length >= 20,
      errMsg:      'Should start with "nk_live_" and be at least 20 characters.',
    },
  };

  function selectProvider(p) {
    provider = p;
    document.getElementById('btnGemini').classList.toggle('active', p === 'gemini');
    document.getElementById('btnEcco').classList.toggle('active',   p === 'ecco');
    const cfg = PROVIDERS[p];
    keyLabel.textContent     = cfg.label;
    input.placeholder        = cfg.placeholder;
    linkProv.textContent     = cfg.hint;
    input.value              = '';
    clearError();
  }

  // Receive pre-filled config from main process
  if (window.studio?.onPrefillConfig) {
    window.studio.onPrefillConfig(cfg => {
      selectProvider(cfg.provider ?? 'gemini');
      input.value = cfg.provider === 'ecco' ? (cfg.eccoApiKey ?? '') : (cfg.geminiApiKey ?? '');
    });
  }

  linkProv.addEventListener('click', e => {
    e.preventDefault();
    window.open(PROVIDERS[provider].url, '_blank');
  });

  toggleBtn.addEventListener('click', () => {
    visible = !visible;
    input.type = visible ? 'text' : 'password';
    toggleBtn.textContent = visible ? '🙈' : '👁';
  });

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.add('visible');
    input.classList.add('error');
  }
  function clearError() {
    errorMsg.classList.remove('visible');
    input.classList.remove('error');
  }

  saveBtn.addEventListener('click', async () => {
    clearError();
    const key = input.value.trim();
    if (!key) { showError('Please enter an API key.'); return; }
    if (!PROVIDERS[provider].validate(key)) {
      showError(PROVIDERS[provider].errMsg);
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    loading.classList.add('visible');

    const result = await window.studio.saveConfig({ provider, apiKey: key });

    if (result?.error) {
      showError(result.error);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save & Launch';
      loading.classList.remove('visible');
    }
  });

  input.addEventListener('keydown', e => { if (e.key === 'Enter') saveBtn.click(); });
</script>
```

- [ ] **Step 8: Verify Electron still launches**

```bash
npm run electron
```

Expected: setup window opens with provider toggle, app launches normally on key entry.

- [ ] **Step 9: Commit**
```bash
git add electron/main.cjs electron/preload.cjs electron/setup.html
git commit -m "feat: update Electron setup with provider toggle, EccoAPI key support, save-config IPC"
```

---

## Task 14: Self-review and smoke test

- [ ] **Step 1: Run TypeScript compilation across the whole project**
```bash
npx tsc --noEmit
```
Fix any remaining type errors.

- [ ] **Step 2: Smoke test Gemini path (no regression)**

Set `.env.local`:
```
AI_PROVIDER=gemini
GEMINI_API_KEY=your-real-key
```

Run `npm run dev`, open the app, generate an image with a PromptNode. Verify it works identically to before.

- [ ] **Step 3: Smoke test EccoAPI path**

Set `.env.local`:
```
AI_PROVIDER=ecco
ECCO_API_KEY=nk_live_your-real-key
```

Run `npm run dev`, open the app:
1. Check header shows "Credits: $X.XX"
2. Check PromptNode shows NanoBanana 3.1/Pro toggle and 1K/2K/4K selector
3. Generate an image — verify it completes and appears in the output node
4. Check credits update after generation

- [ ] **Step 4: Smoke test background generation**

With EccoAPI active:
1. Start a generation on Batch A
2. Immediately switch to Batch B — verify the amber dot appears on Batch A's tab
3. When generation completes, verify the dot turns green
4. Switch back to Batch A — verify the image appears and dot clears

- [ ] **Step 5: Smoke test reference image fix**

Create an automated carousel batch with a UploadNode connected to it. Fill in slide prompts. Generate. Verify the reference images appear in the API logs (`[generate] model=... matchedRefs=[...]` in the server console).

- [ ] **Step 6: Final commit**
```bash
git add -A
git commit -m "feat: complete EccoAPI integration with Nano Banana, background generation, credits display, and reference image fix"
```

---

## Quick Reference: EccoAPI Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `https://eccoapi.com/api/v1/nanobanana31/generate` | POST | NanoBanana 3.1 generation |
| `https://eccoapi.com/api/v1/nanobananapro/generate` | POST | NanoBanana Pro generation |

**Auth header:** `Authorization: Bearer nk_live_...`

**Key request fields:** `prompt`, `aspectRatio`, `imageSize` (1K/2K/4K), `useGoogleSearch`, `imageBase64[]`

**Key response fields:** `data.assetUrl` (signed URL, 900s TTL), `meta.remaining_credits`, `meta.cost`

**Low credits threshold:** < $2.00 → show amber warning in header
