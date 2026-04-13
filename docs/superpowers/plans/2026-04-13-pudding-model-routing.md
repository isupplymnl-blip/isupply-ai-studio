# PuddingAPI Model Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken Gemini-named model IDs in the PuddingAPI route with a two-key lookup (tier × resolution) that maps to the correct PuddingAPI model names, and add matching UI controls to all three settings panels.

**Architecture:** The pudding API route derives the model name from two settings already in `NodeSettings` — `model` (Flash/Pro) and `imageSize` (1K/2K) — using a 4-entry lookup table. The model name is URL-encoded before reaching the SDK. The 503 fallback is removed entirely. Three right-panel settings sections in `page.tsx` each get a Pudding branch showing Flash/Pro + 1K/2K selectors.

**Tech Stack:** TypeScript, Next.js App Router, `@google/genai` SDK, React inline styles

---

## File Map

| File | What changes |
|------|-------------|
| `app/api/pudding/generate/route.ts` | Replace model resolution + remove 503 fallback |
| `app/page.tsx` | Add Pudding branch to 3 settings panel sections |

---

### Task 1: Replace model resolution in the Pudding route

**Files:**
- Modify: `app/api/pudding/generate/route.ts`

- [ ] **Step 1: Replace the model map block**

In `app/api/pudding/generate/route.ts`, find and replace everything from the comment `// ─── Model map` through the closing brace of `resolveModel` (lines 8–20). Replace with:

```typescript
// ─── Model resolution ────────────────────────────────────────────────────────
// PuddingAPI bills per resolution — tier + resolution determine the model name.
// Model names contain Chinese characters and brackets so must be URL-encoded.
function resolvePuddingModel(model: string | undefined, imageSize: string | undefined): string {
  const tier = (model ?? 'Flash').toLowerCase().startsWith('pro') ? 'pro' : 'flash';
  const res  = (imageSize ?? '1K') === '2K' ? '2k' : '1k';
  const map: Record<string, string> = {
    'flash-1k': '[官逆C]Nano banana 2',
    'flash-2k': '[官逆C]Nano banana 2-2k',
    'pro-1k':   '[官逆C]Nano banana pro(大香蕉)',
    'pro-2k':   '[官逆C]Nano banana pro-2k',
  };
  return encodeURIComponent(map[`${tier}-${res}`]);
}
```

- [ ] **Step 2: Remove the 503 fallback helpers**

Delete the two functions below the model map — `is503Error` and `generateWithFallback` (currently lines 23–56). They are not used anywhere else in this file.

- [ ] **Step 3: Update the model-creation path to use the new resolver**

Find this block inside the `if (type === 'model-creation')` branch:

```typescript
    const ai    = getAI();
    const model = resolveModel(settings.model as string | undefined);
```

Replace with:

```typescript
    const ai         = getAI();
    const model      = resolvePuddingModel(
      settings.model     as string | undefined,
      settings.imageSize as string | undefined,
    );
```

- [ ] **Step 4: Replace generateWithFallback call in the model-creation path**

Find:
```typescript
      const t0 = Date.now();
      const response = await generateWithFallback(ai, {
        model,
        contents,
        config: genConfig as Parameters<typeof ai.models.generateContent>[0]['config'],
      });
      console.log(`[pudding] response received (${Date.now() - t0}ms)`);
```

There are two occurrences — this is the first one (inside the `if (type === 'model-creation')` block). Replace with:

```typescript
      const t0 = Date.now();
      const response = await ai.models.generateContent({
        model,
        contents,
        config: genConfig as Parameters<typeof ai.models.generateContent>[0]['config'],
      });
      console.log(`[pudding] response received (${Date.now() - t0}ms)`);
```

- [ ] **Step 5: Update the slide path to use the new resolver**

In the slide generation path (after the `if (type === 'model-creation')` block ends), find:

```typescript
    const ai    = getAI();
    const model = resolveModel(settings.model as string | undefined);

    console.log(`[pudding] model=${model} type=${type ?? 'slide'} nodeId=${nodeId}`);
```

Replace with:

```typescript
    const ai    = getAI();
    const model = resolvePuddingModel(
      settings.model     as string | undefined,
      settings.imageSize as string | undefined,
    );

    console.log(`[pudding] model=${model} type=${type ?? 'slide'} nodeId=${nodeId}`);
```

- [ ] **Step 6: Replace generateWithFallback call in the slide path**

Find the second occurrence:
```typescript
    const t0 = Date.now();
    const response = await generateWithFallback(ai, {
      model,
      contents,
      config: genConfig as Parameters<typeof ai.models.generateContent>[0]['config'],
    });
    console.log(`[pudding] response received (${Date.now() - t0}ms)`);
```

Replace with:
```typescript
    const t0 = Date.now();
    const response = await ai.models.generateContent({
      model,
      contents,
      config: genConfig as Parameters<typeof ai.models.generateContent>[0]['config'],
    });
    console.log(`[pudding] response received (${Date.now() - t0}ms)`);
```

- [ ] **Step 7: Verify TypeScript**

Run:
```bash
npx tsc --noEmit
```
Expected: no output (zero errors).

---

### Task 2: Add Pudding branch to PromptNode settings panel

**Files:**
- Modify: `app/page.tsx` (around line 1182)

- [ ] **Step 1: Replace the ecco/gemini ternary with a three-way expression**

Find this exact block (PromptNode section, around line 1182):

```tsx
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
```

Replace with:

```tsx
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
                ) : activeProvider === 'pudding' ? (
                  <>
                    <Sec label="Model">
                      <Chips opts={['Flash', 'Pro']} value={settingsOf.model ?? 'Flash'} onChange={v => setSetting('model', v)} cols={2} />
                      <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>Flash = Nano banana 2 · Pro = Nano banana pro</p>
                    </Sec>
                    <Sec label="Image Size">
                      <Chips opts={['1K', '2K']} value={settingsOf.imageSize ?? '1K'} onChange={v => setSetting('imageSize', v)} cols={2} />
                      <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>PuddingAPI bills per resolution — 4K not available</p>
                    </Sec>
                  </>
                ) : (
                  <Sec label="Model">
                    <Chips opts={['Flash', 'Pro', 'Standard']} value={settingsOf.model ?? 'Flash'} onChange={v => setSetting('model', v)} cols={3} />
                    <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>Flash = gemini-3.1-flash-image-preview</p>
                  </Sec>
                )}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no output.

---

### Task 3: Add Pudding branch to CarouselPromptNode settings panel

**Files:**
- Modify: `app/page.tsx` (around line 1293)

- [ ] **Step 1: Replace the ecco/gemini ternary with a three-way expression**

Find this exact block (CarouselPromptNode section, around line 1293):

```tsx
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
```

Replace with:

```tsx
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
                  ) : activeProvider === 'pudding' ? (
                    <>
                      <Sec label="Model">
                        <Chips opts={['Flash', 'Pro']} value={settingsOf.model ?? 'Flash'} onChange={v => setSetting('model', v)} cols={2} />
                        <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>Flash = Nano banana 2 · Pro = Nano banana pro</p>
                      </Sec>
                      <Sec label="Image Size">
                        <Chips opts={['1K', '2K']} value={settingsOf.imageSize ?? '1K'} onChange={v => setSetting('imageSize', v)} cols={2} />
                        <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>PuddingAPI bills per resolution — 4K not available</p>
                      </Sec>
                    </>
                  ) : (
                    <Sec label="Model">
                      <Chips opts={['Flash', 'Flash 2.5']} value={settingsOf.model ?? 'Flash'} onChange={v => setSetting('model', v)} cols={2} />
                      <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>Flash = gemini-3.1-flash-image-preview</p>
                    </Sec>
                  )}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no output.

---

### Task 4: Add Pudding branch to ModelCreationNode settings panel

**Files:**
- Modify: `app/page.tsx` (around line 1389)

- [ ] **Step 1: Replace the ecco-only `&&` block with ecco + pudding branches**

Find this exact block (ModelCreationNode section, around line 1389):

```tsx
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
```

Replace with:

```tsx
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
                      <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>Sync mode (default) waits for the result directly — avoids model swapping in async queues</p>
                    </Sec>
                  </>
                ) : activeProvider === 'pudding' ? (
                  <>
                    <Sec label="Model">
                      <Chips opts={['Flash', 'Pro']} value={settingsOf.model ?? 'Flash'} onChange={v => setSetting('model', v)} cols={2} />
                      <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>Flash = Nano banana 2 · Pro = Nano banana pro</p>
                    </Sec>
                    <Sec label="Image Size">
                      <Chips opts={['1K', '2K']} value={settingsOf.imageSize ?? '1K'} onChange={v => setSetting('imageSize', v)} cols={2} />
                      <p style={{ fontSize: 9, color: '#55556A', marginTop: 4 }}>PuddingAPI bills per resolution — 4K not available</p>
                    </Sec>
                  </>
                ) : null}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no output.
