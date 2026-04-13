# Gemini Params Passthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up temperature (default 1.0), thinking mode, media resolution, safety threshold, and async toggle into both the Gemini and EccoAPI routes, and expose all controls in the right-panel node settings.

**Architecture:** Option A — unified pass-through. All new settings live in `NodeSettings`, get forwarded verbatim in the request body to EccoAPI (which proxies to Gemini backend), and are translated to typed Gemini SDK config for the direct Gemini route. The EccoAPI route gains a sync mode (default) where it waits for the result and returns it directly, avoiding the fire-and-forget async queue.

**Tech Stack:** Next.js App Router (Node.js runtime), `@google/genai` SDK, EccoAPI REST, React, inline styles (no CSS framework)

---

## File Map

| File | Change |
|------|--------|
| `app/context/StudioContext.ts` | Add 4 new fields to `NodeSettings`: `includeThoughts`, `mediaResolution`, `safetyThreshold`, `useAsync` |
| `app/api/generate/route.ts` | Read new settings, build proper Gemini config (temperature, thinkingConfig, mediaResolution, safetySettings) |
| `app/api/ecco/generate/route.ts` | Forward new params in EccoAPI body; add sync mode (blocking fetch, return 200 with imageUrl directly) |
| `app/page.tsx` | (1) Fix temperature default 0.7→1.0 in right panel labels, (2) Add new setting rows for promptNode and carouselNode sections, (3) Update `callEccoGenerate` to handle both sync `{imageUrl}` and async `{jobId}` responses |

---

### Task 1: Extend NodeSettings with new fields

**Files:**
- Modify: `app/context/StudioContext.ts`

- [ ] **Step 1: Add the four new fields to the `NodeSettings` interface**

Open `app/context/StudioContext.ts`. The current interface ends at line ~32. Replace the existing interface body with:

```typescript
export interface NodeSettings {
  // Image Prompt / Carousel
  temperature?: number;       // default 1.0
  guidanceScale?: number;
  negativePrompt?: string;
  seed?: string;
  safetyFilter?: string;      // legacy — kept for backward compat
  safetyThreshold?: 'BLOCK_NONE' | 'BLOCK_ONLY_HIGH' | 'BLOCK_MEDIUM_AND_ABOVE' | 'BLOCK_LOW_AND_ABOVE';
  includeThoughts?: boolean;  // default true
  mediaResolution?: 'media_resolution_high' | 'media_resolution_medium' | 'media_resolution_low';
  model?: string;
  count?: number;
  // EccoAPI-specific
  eccoModel?: 'nanobanana31' | 'nanobananapro';
  imageSize?: '1K' | '2K' | '4K';
  useGoogleSearch?: boolean;
  useAsync?: boolean;         // default false (sync mode)
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

- [ ] **Step 2: Commit**

```bash
cd C:/isupply-ai-studio-main/isupply-ai-studio-main
git add app/context/StudioContext.ts
git commit -m "feat: extend NodeSettings with thinking, mediaResolution, safetyThreshold, useAsync"
```

---

### Task 2: Update the Gemini route to use all new params

**Files:**
- Modify: `app/api/generate/route.ts`

- [ ] **Step 1: Add a safety-settings mapper helper after the `mimeFromUrl` function (around line 100)**

```typescript
// ─── Safety settings mapper ───────────────────────────────────────────────────

type SafetyThreshold = 'BLOCK_NONE' | 'BLOCK_ONLY_HIGH' | 'BLOCK_MEDIUM_AND_ABOVE' | 'BLOCK_LOW_AND_ABOVE';

function buildSafetySettings(threshold: SafetyThreshold) {
  const categories = [
    'HARM_CATEGORY_HARASSMENT',
    'HARM_CATEGORY_HATE_SPEECH',
    'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    'HARM_CATEGORY_DANGEROUS_CONTENT',
  ];
  return categories.map(category => ({ category, threshold }));
}
```

- [ ] **Step 2: Update the slide generation config block (around line 238)**

Find this block:

```typescript
    const response = await generateWithFallback(ai, {
      model,
      contents,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio, imageSize },
      } as Parameters<typeof ai.models.generateContent>[0]['config'],
    });
```

Replace with:

```typescript
    const temperature    = typeof settings.temperature === 'number' ? settings.temperature : 1.0;
    const includeThoughts = settings.includeThoughts !== false; // default true
    const mediaRes       = (settings.mediaResolution as string | undefined) ?? 'media_resolution_high';
    const safetyThresh   = (settings.safetyThreshold as SafetyThreshold | undefined) ?? 'BLOCK_MEDIUM_AND_ABOVE';

    const response = await generateWithFallback(ai, {
      model,
      contents,
      config: {
        temperature,
        responseModalities: ['TEXT', 'IMAGE'],
        thinkingConfig: { includeThoughts },
        imageConfig: { aspectRatio, imageSize, mediaResolution: mediaRes },
        safetySettings: buildSafetySettings(safetyThresh),
      } as Parameters<typeof ai.models.generateContent>[0]['config'],
    });
```

- [ ] **Step 3: Update the model-creation config block (around line 194) the same way**

Find:

```typescript
      const response = await generateWithFallback(ai, {
        model,
        contents,
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: '16:9', imageSize: '1K' },
        } as Parameters<typeof ai.models.generateContent>[0]['config'],
      });
```

Replace with:

```typescript
      const temperature    = typeof settings.temperature === 'number' ? settings.temperature : 1.0;
      const includeThoughts = settings.includeThoughts !== false;
      const safetyThresh   = (settings.safetyThreshold as SafetyThreshold | undefined) ?? 'BLOCK_MEDIUM_AND_ABOVE';

      const response = await generateWithFallback(ai, {
        model,
        contents,
        config: {
          temperature,
          responseModalities: ['TEXT', 'IMAGE'],
          thinkingConfig: { includeThoughts },
          imageConfig: { aspectRatio: '16:9', imageSize: '1K', mediaResolution: 'media_resolution_high' },
          safetySettings: buildSafetySettings(safetyThresh),
        } as Parameters<typeof ai.models.generateContent>[0]['config'],
      });
```

- [ ] **Step 4: Commit**

```bash
git add app/api/generate/route.ts
git commit -m "feat: pass temperature=1.0, thinkingConfig, mediaResolution, safetySettings to Gemini"
```

---

### Task 3: Update the EccoAPI route — new params + sync mode

**Files:**
- Modify: `app/api/ecco/generate/route.ts`

- [ ] **Step 1: Update the POST handler body type to include new fields**

Find the body destructuring in `POST` (around line 116). Replace the type annotation and destructuring:

```typescript
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
      // new
      temperature?: number;
      includeThoughts?: boolean;
      mediaResolution?: string;
      safetyThreshold?: string;
      useAsync?: boolean;
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
      temperature,
      includeThoughts,
      mediaResolution,
      safetyThreshold,
      useAsync = false,
    } = body;
```

- [ ] **Step 2: Build the extended EccoAPI body (replace the `eccoBody` block around line 167)**

Find:

```typescript
    const eccoBody: Record<string, unknown> = {
      prompt: prompt.trim(),
      aspectRatio:     (settings.aspectRatio as string | undefined) ?? aspectRatio,
      imageSize:       (settings.imageSize   as string | undefined) ?? imageSize,
      useGoogleSearch: resolvedSearch,
    };
    if (imageBase64.length) eccoBody.imageBase64 = imageBase64;
```

Replace with:

```typescript
    const resolvedTemperature    = (settings.temperature    as number  | undefined) ?? temperature ?? 1.0;
    const resolvedThoughts       = (settings.includeThoughts as boolean | undefined) ?? includeThoughts ?? true;
    const resolvedMediaRes       = (settings.mediaResolution as string  | undefined) ?? mediaResolution ?? 'media_resolution_high';
    const resolvedSafetyThresh   = (settings.safetyThreshold as string  | undefined) ?? safetyThreshold ?? 'BLOCK_MEDIUM_AND_ABOVE';
    const resolvedAsync          = (settings.useAsync        as boolean | undefined) ?? useAsync;

    const safetyCategories = [
      'HARM_CATEGORY_HARASSMENT',
      'HARM_CATEGORY_HATE_SPEECH',
      'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      'HARM_CATEGORY_DANGEROUS_CONTENT',
    ];

    const eccoBody: Record<string, unknown> = {
      prompt:          prompt.trim(),
      aspectRatio:     (settings.aspectRatio as string | undefined) ?? aspectRatio,
      imageSize:       (settings.imageSize   as string | undefined) ?? imageSize,
      useGoogleSearch: resolvedSearch,
      // Extended Gemini pass-through params
      temperature:        resolvedTemperature,
      thinkingConfig:     { includeThoughts: resolvedThoughts },
      mediaResolution:    resolvedMediaRes,
      responseModalities: ['TEXT', 'IMAGE'],
      safetySettings:     safetyCategories.map(category => ({ category, threshold: resolvedSafetyThresh })),
    };
    if (imageBase64.length) eccoBody.imageBase64 = imageBase64;
```

- [ ] **Step 3: Add sync mode — replace the fire-and-forget block at the end of POST (around line 175)**

Find:

```typescript
    // Generate a local job ID and return 202 immediately
    const jobId = `ecco-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    jobStore.set(jobId, { status: 'pending' });

    console.log(`[ecco/generate] queued job=${jobId} model=${model} nodeId=${nodeId}`);

    // Fire-and-forget background task
    void runEccoGeneration(jobId, model, eccoBody, apiKey);

    return NextResponse.json({ jobId, nodeId, batchId }, { status: 202 });
```

Replace with:

```typescript
    // ── Sync mode (default): block until EccoAPI responds, return imageUrl directly ──
    if (!resolvedAsync) {
      console.log(`[ecco/generate] sync mode model=${model} nodeId=${nodeId}`);
      try {
        const endpoint = `https://eccoapi.com/api/v1/${model}/generate`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(eccoBody),
        });
        const data = await res.json() as {
          code?: number;
          data?: { assetUrl: string };
          meta?: { cost: number; remaining_credits: number };
        };
        if (!res.ok || !data.data?.assetUrl) {
          const msg = ECCO_ERRORS[res.status] ?? `EccoAPI error ${res.status}`;
          return NextResponse.json({ error: msg }, { status: res.status });
        }
        const imageUrl = await downloadAndPersist(data.data.assetUrl);
        console.log(`[ecco/generate] sync completed imageUrl=${imageUrl}`);
        return NextResponse.json({
          imageUrl,
          nodeId,
          batchId,
          remaining_credits: data.meta?.remaining_credits,
          cost: data.meta?.cost,
        }, { status: 200 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[ecco/generate] sync error:', msg);
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }

    // ── Async mode (opt-in): fire-and-forget, return 202 + jobId for polling ──
    const jobId = `ecco-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    jobStore.set(jobId, { status: 'pending' });

    console.log(`[ecco/generate] async queued job=${jobId} model=${model} nodeId=${nodeId}`);
    void runEccoGeneration(jobId, model, eccoBody, apiKey);

    return NextResponse.json({ jobId, nodeId, batchId }, { status: 202 });
```

- [ ] **Step 4: Commit**

```bash
git add app/api/ecco/generate/route.ts
git commit -m "feat: pass Gemini params to EccoAPI body; add sync mode (default) vs async toggle"
```

---

### Task 4: Update `callEccoGenerate` in page.tsx to handle sync responses

The current `callEccoGenerate` always expects a `{ jobId }` response and calls `addJob`. In sync mode the server returns `{ imageUrl, remaining_credits, cost }` with status 200. We need to handle both.

**Files:**
- Modify: `app/page.tsx` (around line 145–170)

- [ ] **Step 1: Update `callEccoGenerate` to pass new settings and branch on response type**

Find the full `callEccoGenerate` function (lines 145–170). Replace with:

```typescript
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
        if (!res.ok || !data.jobId) throw new Error(data.error ?? 'EccoAPI request failed');
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
```

- [ ] **Step 2: Pass new settings through `onGenerateSlide`, `onRegenerate`, and `onGenerateCarousel`**

Find `onGenerateSlide` (around line 441–447). In the `ecco` branch, update the `callEccoGenerate` call to forward new settings:

```typescript
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
```

Find `onRegenerate` (around line 457–459). Update the ecco branch:

```typescript
    if (activeProviderRef.current === 'ecco') {
      const model = (settings?.eccoModel as string | undefined) ?? 'nanobanana31';
      await callEccoGenerate(outputNodeId, {
        prompt: lastPrompt, nodeId: outputNodeId, model,
        aspectRatio:      settings?.aspectRatio     ?? '4:5',
        imageSize:        settings?.imageSize        ?? '1K',
        useGoogleSearch:  settings?.useGoogleSearch  ?? false,
        temperature:      settings?.temperature      ?? 1.0,
        includeThoughts:  settings?.includeThoughts  ?? true,
        mediaResolution:  settings?.mediaResolution  ?? 'media_resolution_high',
        safetyThreshold:  settings?.safetyThreshold  ?? 'BLOCK_MEDIUM_AND_ABOVE',
        useAsync:         settings?.useAsync         ?? false,
        referenceUrls,
      });
```

Find `onGenerateCarousel` (around line 471–473). Update the ecco branch:

```typescript
        await callEccoGenerate(slide.outputNodeId, {
          prompt: slide.prompt.trim(), nodeId, model,
          aspectRatio:      settings?.aspectRatio     ?? '4:5',
          imageSize:        settings?.imageSize        ?? '1K',
          useGoogleSearch:  settings?.useGoogleSearch  ?? false,
          temperature:      settings?.temperature      ?? 1.0,
          includeThoughts:  settings?.includeThoughts  ?? true,
          mediaResolution:  settings?.mediaResolution  ?? 'media_resolution_high',
          safetyThreshold:  settings?.safetyThreshold  ?? 'BLOCK_MEDIUM_AND_ABOVE',
          useAsync:         settings?.useAsync         ?? false,
          referenceUrls,
        });
```

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat: callEccoGenerate handles sync (200) and async (202) modes; forwards new params"
```

---

### Task 5: Add new settings controls to the right panel UI

The right panel has settings sections for `promptNode`, `carouselNode`, and `modelCreationNode`. We need to add the new controls to each, and fix the temperature default label from `0.7` to `1.0`.

**Files:**
- Modify: `app/page.tsx` (right panel sections, lines ~1021–1210)

- [ ] **Step 1: Fix temperature default in the `promptNode` section (line ~1024)**

Find:
```typescript
                <Sec label={`Temperature — ${(settingsOf.temperature ?? 0.7).toFixed(1)}`}>
                  <SliderRow value={settingsOf.temperature ?? 0.7} min={0} max={1} step={0.05} onChange={v => setSetting('temperature', v)} />
                  <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>Higher = more creative / unexpected</p>
                </Sec>
```

Replace with:
```typescript
                <Sec label={`Temperature — ${(settingsOf.temperature ?? 1.0).toFixed(1)}`}>
                  <SliderRow value={settingsOf.temperature ?? 1.0} min={0} max={2} step={0.05} onChange={v => setSetting('temperature', v)} />
                  <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>Google recommends 1.0 for image models — lower values degrade reference adherence</p>
                </Sec>
```

- [ ] **Step 2: Replace the `safetyFilter` Chips in `promptNode` with the new `safetyThreshold` control, and add Thinking + Media Resolution below it**

Find (in the promptNode section):
```typescript
                <Sec label="Safety Filter">
                  <Chips opts={['Standard', 'Low', 'High']} value={settingsOf.safetyFilter ?? 'Standard'} onChange={v => setSetting('safetyFilter', v)} />
                </Sec>
```

Replace with:
```typescript
                <Sec label="Safety Threshold">
                  <Chips opts={['Off', 'Low Block', 'Medium', 'High Block']} value={
                    settingsOf.safetyThreshold === 'BLOCK_NONE'              ? 'Off' :
                    settingsOf.safetyThreshold === 'BLOCK_ONLY_HIGH'         ? 'Low Block' :
                    settingsOf.safetyThreshold === 'BLOCK_LOW_AND_ABOVE'     ? 'High Block' : 'Medium'
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
                  <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>High = more input tokens for reference details</p>
                </Sec>
```

- [ ] **Step 3: Add Async Mode toggle inside the EccoAPI block in the `promptNode` section**

Find (inside the `activeProvider === 'ecco'` block in promptNode, after the Google Search Grounding checkbox):
```typescript
                    <Sec label="Google Search Grounding">
                      <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                        <input type="checkbox" checked={settingsOf.useGoogleSearch ?? false} onChange={e => setSetting('useGoogleSearch', e.target.checked)} style={{ accentColor: '#7C3AED' }} />
                        <span style={{ fontSize: 10, color: '#9090A8' }}>Enable real-time search</span>
                      </label>
                    </Sec>
                  </>
                ) : (
                  <Sec label="Model">
                    <Chips opts={['Flash', 'Pro', 'Standard']} value={settingsOf.model ?? 'Flash'} onChange={v => setSetting('model', v)} cols={3} />
```

Replace with:
```typescript
                    <Sec label="Google Search Grounding">
                      <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                        <input type="checkbox" checked={settingsOf.useGoogleSearch ?? false} onChange={e => setSetting('useGoogleSearch', e.target.checked)} style={{ accentColor: '#7C3AED' }} />
                        <span style={{ fontSize: 10, color: '#9090A8' }}>Enable real-time search</span>
                      </label>
                    </Sec>
                    <Sec label="Async Mode">
                      <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                        <input type="checkbox" checked={settingsOf.useAsync ?? false} onChange={e => setSetting('useAsync', e.target.checked)} style={{ accentColor: '#7C3AED' }} />
                        <span style={{ fontSize: 10, color: '#9090A8' }}>Use async queue (off = sync, better quality)</span>
                      </label>
                      <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>Sync mode waits for the result directly — avoids model swapping and reference stripping in async queues</p>
                    </Sec>
                  </>
                ) : (
                  <Sec label="Model">
                    <Chips opts={['Flash', 'Pro', 'Standard']} value={settingsOf.model ?? 'Flash'} onChange={v => setSetting('model', v)} cols={3} />
```

- [ ] **Step 4: Apply identical changes to the `carouselNode` section (lines ~1094–1146)**

The carousel section has an identical structure to promptNode. Apply the same changes:

4a. Fix temperature default `0.7` → `1.0` (same replacement as Step 1).

Find in carousel section:
```typescript
                  <Sec label={`Temperature — ${(settingsOf.temperature ?? 0.7).toFixed(1)}`}>
                    <SliderRow value={settingsOf.temperature ?? 0.7} min={0} max={1} step={0.05} onChange={v => setSetting('temperature', v)} />
                    <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>Higher = more creative</p>
                  </Sec>
```
Replace with:
```typescript
                  <Sec label={`Temperature — ${(settingsOf.temperature ?? 1.0).toFixed(1)}`}>
                    <SliderRow value={settingsOf.temperature ?? 1.0} min={0} max={2} step={0.05} onChange={v => setSetting('temperature', v)} />
                    <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>Google recommends 1.0 for image models</p>
                  </Sec>
```

4b. Replace safety filter with safety threshold + add Thinking + Media Resolution. Find in carousel section:
```typescript
                  <Sec label="Safety Filter">
                    <Chips opts={['Standard', 'Low', 'High']} value={settingsOf.safetyFilter ?? 'Standard'} onChange={v => setSetting('safetyFilter', v)} />
                  </Sec>
```
Replace with the exact same block from Step 2 above (safetyThreshold + Thinking Mode + Media Resolution).

4c. Add Async Mode toggle after Google Search Grounding in the carousel's EccoAPI block — same block as Step 3 above.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat: add thinking, media resolution, safety threshold, async toggle to right panel; fix temperature default to 1.0"
```

---

### Task 6: Verify the full flow works end-to-end

- [ ] **Step 1: Start the dev server**

```bash
cd C:/isupply-ai-studio-main/isupply-ai-studio-main
npm run dev
```

Expected: server starts on http://localhost:3000 with no TypeScript errors.

- [ ] **Step 2: Check for TypeScript errors**

```bash
npx tsc --noEmit
```

Expected: no errors. If you see errors about unknown properties on the Gemini config (e.g. `thinkingConfig`), they are suppressed by the existing `as Parameters<...>['config']` cast — that's intentional.

- [ ] **Step 3: Verify Gemini route passes new params (manual check)**

Open the app, select a PromptNode, set:
- Temperature: 1.0
- Thinking Mode: checked
- Media Resolution: High
- Safety Threshold: Low Block

Generate an image with a reference image connected. Check the server console for:
```
[generate] model=gemini-3.1-flash-image-preview type=slide nodeId=...
```
No errors = config is being accepted by the Gemini SDK.

- [ ] **Step 4: Verify EccoAPI sync mode (manual check)**

Switch provider to EccoAPI. Confirm Async Mode is unchecked. Generate an image.

Check server console for:
```
[ecco/generate] sync mode model=nanobanana31 nodeId=...
[ecco/generate] sync completed imageUrl=/generated/...
```

The image should appear in the output node without the loading spinner cycling through job polling.

- [ ] **Step 5: Verify EccoAPI async mode still works**

Enable Async Mode checkbox, generate. Server console should show:
```
[ecco/generate] async queued job=ecco-... model=nanobanana31 nodeId=...
```

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: verify Gemini params passthrough and EccoAPI sync/async modes working"
```

---

## Self-Review

**Spec coverage:**
- ✅ Temperature default 1.0 — Task 2 (route), Task 5 (UI label)
- ✅ Thinking mode toggle (default ON) — Task 1 (type), Task 2 (Gemini), Task 3 (Ecco), Task 5 (UI)
- ✅ `media_resolution_high` (default) — Task 2 (Gemini), Task 3 (Ecco), Task 5 (UI)
- ✅ Safety threshold with proper Gemini category strings — Task 2 (Gemini), Task 3 (Ecco), Task 5 (UI)
- ✅ EccoAPI async toggle (default OFF = sync) — Task 3 (route), Task 4 (callEccoGenerate), Task 5 (UI)
- ✅ New params forwarded through onGenerateSlide, onRegenerate, onGenerateCarousel — Task 4 Step 2
- ✅ Sync mode returns `imageUrl` directly; callEccoGenerate branches on status 200 vs 202 — Task 4 Step 1

**Type consistency check:**
- `safetyThreshold` field used in NodeSettings (Task 1), Gemini route (Task 2), Ecco route (Task 3), UI (Task 5) — consistent
- `includeThoughts` used in NodeSettings (Task 1), routes (Tasks 2-3), UI (Task 5) — consistent
- `mediaResolution` used in NodeSettings (Task 1), routes (Tasks 2-3), UI (Task 5) — consistent
- `useAsync` used in NodeSettings (Task 1), Ecco route (Task 3), callEccoGenerate forward (Task 4), UI (Task 5) — consistent
- Sync response shape `{ imageUrl, remaining_credits, cost, nodeId, batchId }` — produced in Task 3 Step 3, consumed in Task 4 Step 1 — consistent

**No placeholders — all steps contain complete code.**
