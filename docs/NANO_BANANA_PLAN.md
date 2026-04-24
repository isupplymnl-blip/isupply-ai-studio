# NANO_BANANA_PLAN.md

## 1. What I Understood from the Skill

### API Configuration
The skill uses Google's Gemini image generation API with these exact parameters:

| Parameter | Skill Default | Notes |
|---|---|---|
| `model` | `gemini-3.1-flash-image-preview` | Flash = speed; Pro = complex text/scenes |
| `temperature` | 1.0–1.1 (lifestyle), 0.3–0.5 (accuracy) | Tunes creativity vs. fidelity |
| `topP` | 0.97 | Nucleus sampling — 0.95–0.99 range |
| `topK` | 40 | Vocabulary breadth — higher = more diverse |
| `seed` | 42 (anchor) | Integer; same seed = same image |
| `candidateCount` | 2 | Returns 2 image variants per call |
| `responseModalities` | `["TEXT", "IMAGE"]` | Always both |
| `tools` | `[]` or `[{ googleSearch: {} }]` | Grounding when scene needs real-world accuracy |

**Tuning order enforced by Agent 5:** temperature → top_p → top_k (never reverse).

### Code Pattern
The JS SDK call is:
```javascript
const response = await ai.models.generateContent({
  model: "gemini-3.1-flash-image-preview",
  contents: prompt,
  generationConfig: {
    responseModalities: ["TEXT", "IMAGE"],
    temperature: 1.0,
    topP: 0.97,
    topK: 40,
    candidateCount: 2,
    seed: 42,
  },
  tools: [],
});
```
Response parsing: iterate `response.candidates[0].content.parts` — `inlineData` parts are images, `text` parts are model narration/description. Save image as `output_seed42_<timestamp>.png`.

### Seed Strategy
- Always document the seed used
- Anchor: seed 42
- Micro-variants: seed+1 (+7, +13) for subtle pose/wind/wave changes
- Medium variants: seed 49, 55 for background depth / lighting angle shifts
- Strong variants: seed 77, 100 for composition alternatives
- Temperature ±0.1 from a fixed seed = mood shift without composition change
- top_p 0.95 vs 0.99 = tighter vs more diverse interpretation

### Prompt Architecture (Director's Stitching Formula)
```
[SHOT TYPE + CAMERA] + [LIGHTING] + [MODEL DESCRIPTION] + [PRODUCT INTERACTION] +
[SETTING DESCRIPTION] + [ATMOSPHERE/MOOD] + [STYLE REFERENCE] + [TECHNICAL QUALITY TAGS]
```
Always ends with: `Shot on Hasselblad X2D 100C, 85mm f/1.4, ISO 100, RAW — hyperrealistic editorial photography — 8K resolution — cinematic depth of field — professional commercial lighting — no distortion — anatomically correct — skin texture visible — photojournalistic realism`

---

## 2. What the App Currently Does

### API Routes
- **`/api/generate`** — Primary route using `GEMINI_API_KEY` directly to Google's API
- **`/api/pudding/generate`** — Alternate route using `PUDDING_API_KEY` → proxied through `new.apipudding.com` (a third-party Gemini proxy)
- **`/api/ecco/generate`** — EccoAPI provider route (async job queue pattern)

### Generation Config (what the app sends today)
In `app/api/generate/route.ts` (slide path):
```typescript
const geminiConfig = {
  temperature,          // from settings.temperature (default 1.0) ✓
  topP,                 // from settings.topP ✓
  responseModalities: ['TEXT', 'IMAGE'],  // ✓
  thinkingConfig: { includeThoughts, ... },  // app-specific addition
  imageConfig: { aspectRatio, imageSize, mediaResolution },  // app-specific
  safetySettings: [...],  // app-specific
  // tools: searchTools (optional) ✓
};
```

**Missing from the current config sent to Gemini:**
- `seed` — field exists in `NodeSettings` (type `string`) and is shown in the UI, but **never passed to `geminiConfig`** in either route file
- `topK` — not in `NodeSettings`, not in any generate route config
- `candidateCount` — not used; app always requests 1 candidate

### Prompt Building (current)
`buildSlidePrompt()` in `route.ts`:
```
"${refDesc}${prompt}. ${ratioHint}${neg ? ` AVOID: ${neg}.` : ''} Photorealistic, ultra high quality, professional product photography."
```
This is minimal — no Director formula, no lighting-first structure, no quality tags like Hasselblad/8K/cinematic.

### Output Flow
1. PromptNode → user types prompt → clicks Generate
2. `onGenerateSlide(nodeId, prompt, settings)` in `page.tsx`
3. POST to `/api/generate` (or pudding/ecco based on active provider)
4. Route calls Gemini, parses first `inlineData` part, saves PNG to `public/generated/`
5. Returns `{ imageUrl }` → OutputNode renders the image

### NodeSettings (UI fields exposed)
`seed?: string`, `temperature?: number`, `topP?: number`, `includeThoughts?: boolean`, `model?: string`, `useGoogleSearch?: boolean`, etc.
**`topK` is not in `NodeSettings` at all.**

---

## 3. The Gap

| Skill Requires | App Currently Does | Gap |
|---|---|---|
| `seed` (integer) always set | `seed` in UI as string, never sent to API | `seed` is collected but dropped — never forwarded to `geminiConfig` |
| `topK: 40` default | `topK` doesn't exist anywhere in the codebase | Missing field in `NodeSettings`, missing in all route configs |
| `candidateCount: 2` | Always 1 candidate | App returns only 1 image; skill's multi-variant workflow not supported |
| Director prompt formula (cinematic, lighting-first, quality tags) | Minimal wrapper: `"${prompt}. Photorealistic..."` | Prompts from PromptNode go in raw — no Director-style enrichment |
| Seed exploration table output | No such concept | App has no seed variant suggestion or exploration UI |
| Scene-type parameter tuning (beach=1.0–1.1, studio=0.6–0.8) | Fixed default 1.0 | No scene-aware parameter preset system |

---

## 4. Proposed Changes

### File 1: `app/context/StudioContext.ts`
**What to change:** Add `topK` to `NodeSettings` interface.
```typescript
topK?: number;   // add after topP
```

### File 2: `app/api/generate/route.ts`
**What to change:**
1. In the slide path `geminiConfig` block — add `seed` and `topK`:
```typescript
const seed  = typeof settings.seed === 'string' && settings.seed.trim()
  ? parseInt(settings.seed, 10)
  : typeof settings.seed === 'number' ? settings.seed : undefined;
const topK  = typeof settings.topK === 'number' ? settings.topK : undefined;

const geminiConfig = {
  temperature,
  ...(topP !== undefined ? { topP } : {}),
  ...(topK !== undefined ? { topK } : {}),   // ADD
  ...(seed !== undefined && !isNaN(seed) ? { seed } : {}),  // ADD
  responseModalities: ['TEXT', 'IMAGE'],
  // ... rest unchanged
};
```
2. Same change in the model-creation path `geminiConfig` block.
3. Same change in the streaming path inside `sseWrap`.

### File 3: `app/api/pudding/generate/route.ts`
**What to change:** Same `seed` + `topK` forwarding in all three paths (slide, model-creation, streaming). Identical diff to File 2.

### File 4: `app/page.tsx` — settings panel for PromptNode
**What to change:** Add a `topK` input field in the right-panel settings UI, next to the existing `topP` field. (Around line 1681 where `seed` input already exists.)

```tsx
<label>Top K</label>
<input
  type="number" min={1} max={100} step={1}
  placeholder="e.g. 40"
  value={settingsOf.topK ?? ''}
  onChange={e => setSetting('topK', e.target.value ? parseInt(e.target.value) : undefined)}
/>
```

### File 5: `app/page.tsx` — CarouselPromptNode settings panel
**What to change:** Same `topK` field (around line 1864 where the carousel seed input exists).

### What I am NOT changing
- The prompt builder (`buildSlidePrompt`) — the skill is a **prompt engineering skill for Claude to run**, not an auto-enricher. The Director agents run in this Claude conversation, and the resulting master prompt is what the user pastes into the PromptNode. The app's job is to forward it faithfully. Modifying the prompt builder to inject Hasselblad tags would conflict with user-crafted Director output.
- `candidateCount` — the app's OutputNode UI renders a single image per node. Supporting 2 candidates would require significant UI changes (side-by-side OutputNode, variant picker). This is a larger feature, not a parameter fix. Leaving for a separate discussion.
- Ecco route — Ecco uses a different model/API surface; seed/topK semantics may differ. Out of scope.

---

## 5. Questions

1. **Seed as string vs integer:** `NodeSettings.seed` is typed as `string` (shown in UI as text input). Should I change the type to `number | string` and parse it in the route, or change the UI input to `type="number"`? The skill always uses integer seeds — a number input seems right, but it's a breaking change to the stored type.

2. **candidateCount:** Do you want the app to generate 2 candidates per call (as the skill recommends) and show both in the OutputNode? This would need UI work — do you want me to scope that in, or keep it out for now?

3. **Director prompt enrichment:** Should the app's `buildSlidePrompt` auto-append the Hasselblad quality tags, or is the expectation that the user always pastes the full Director output into the PromptNode? If auto-appending: should it be opt-in (a toggle) or always on?

4. **Seed Exploration UI:** The skill produces a seed variant table. Do you want a "Seed Explorer" panel in the app where clicking a seed variant re-runs generation with that seed? Or is the table just for the user to manually retry?

5. **topK in pudding route:** The Pudding proxy wraps the Gemini API — does it pass `topK` through to Gemini, or does it have its own parameter surface? If it strips unknown params, adding `topK` there won't help.

---

**Ready to implement once you approve and answer the questions above.**
