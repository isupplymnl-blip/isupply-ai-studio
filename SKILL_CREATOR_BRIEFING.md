# iSupply AI Studio — Briefing for Nano Banana Skill Creator

This document explains exactly how this app works so we can align the skill with our architecture before integration. Read this before making any assumptions about how we call Gemini.

---

## What This App Is

**iSupply AI Studio** is a visual, node-based AI content studio for commercial product photography. It is built with Next.js (App Router) and React Flow. The canvas is a directed graph where nodes are connected by edges to form generation pipelines.

The product target is **Philippine e-commerce and lifestyle brands** — the primary use case is generating photorealistic product + model images for ad campaigns, carousels, social media content, and commercial shoots. Think: skincare serum at the beach, supplements with a Filipina model in a studio, earbuds in an urban street setting.

This is **not a chatbot**. It is a production content tool used by marketing teams who paste Director-crafted prompts directly into the canvas.

---

## The Node Types (Canvas Building Blocks)

### 1. UploadNode — Image Reference Input
The user uploads a product image (e.g. a photo of the serum bottle). The node stores:
- `name` — human-readable label (e.g. "SPF Serum Bottle")
- `tags` — comma-separated keywords (e.g. `spf, serum, bottle, skincare`)
- `url` — local file path served at `/api/uploads/[filename]`

**Reference matching is automatic:** When any prompt node runs generation, the backend calls `findMatchingImages(prompt)` — it scans all uploaded assets and returns any whose tags appear in the prompt text. Matched assets are converted to base64 JPEG (max 1024px, quality 85 via sharp) and sent as `inlineData` parts alongside the text prompt. Up to 14 reference images per generation call.

You can also manually connect an UploadNode to a PromptNode via a canvas edge — those become explicit reference images that bypass the tag-matching step.

### 2. PromptNode — Single Image Generation
A single text prompt → single image output. The user types a scene description. On Generate:
- Finds the connected OutputNode(s) via canvas edges
- Calls the backend with: `{ prompt, nodeId, type: 'slide', settings, referenceUrls }`
- Displays the returned image in the OutputNode

**This is where the Director's master prompt goes.** The user pastes the full Director output here. The app does not enrich or modify the prompt — it forwards it as-is to Gemini (plus a minimal wrapper for reference images and ratio hints).

**Current prompt wrapper** (what the backend adds around the user's prompt):
```
"${referenceImageInstruction}${userPrompt}. ${aspectRatioHint}${negativePrompt}. Photorealistic, ultra high quality, professional product photography."
```

### 3. CarouselPromptNode — Multi-Slide Sequential Generation
For Instagram/TikTok carousels. One node holds **N slides**, each with its own prompt text. Each slide maps to its own OutputNode. Generation runs **sequentially** (not parallel) to avoid rate limits.

**Gemini-specific feature: thoughtSignature threading.** After each slide generates, the response's `thoughtSignature` is extracted and passed as context to the next slide's API call. This keeps character identity and product appearance consistent across the carousel — the model remembers what the model/product looked like from slide 1 when generating slide 6.

Carousel settings (temperature, topP, seed, etc.) apply to ALL slides in the batch.

### 4. ModelCreationNode — Multi-Angle Model Composite
Not a scene generator — a specialized node for creating **reference sheets** of human models. The output is a single composite image showing the same model from multiple angles in one frame, used as a reference for subsequent scene generation.

**Auto-detects model count from description:**
- 1 model → 16:9 frame, 4 panels: Front · 3/4 · Side · Back
- 2 models → 21:9 frame, 4 panels: M1 Front · M1 Back · M2 Front · M2 Back
- 3 models → 21:9 frame, 6 panels: M1F · M1B · M2F · M2B · M3F · M3B

The system prompt sent to Gemini is fully pre-built by the backend — the user only provides the model description. Example system prompt built:
```
Create a professional composite image with FOUR panels in a single 16:9 frame showing
the same model from four angles. Panels layout (left to right): [Front view] [3/4 angle]
[Side profile] [Rear view]. Model: {description}. Style: {style}. Lighting: {lighting}.
Background: {background}. All panels must show the same person with consistent appearance.
Ultra high quality, sharp details, professional fashion photography.
```

The output of ModelCreationNode is **saved to the library** and then uploaded as a reference image for scene generation.

### 5. OutputNode — Image Display
Renders the generated image. Has regen, library save, and download controls. Displays generation status and errors.

### 6. Planned: SettingNode / LocationNode
**Not yet built.** Concept: a dedicated node for generating background environments — a beach scene, urban street, studio setup — without a model, to be used as a reference layer for scene generation. The plan is to connect a SettingNode's output to a PromptNode as a reference image input, then compose the full scene in the PromptNode prompt. This mirrors Agent 3's Background/Setting Creator role. Still in design phase.

---

## The Three API Providers (All Route to Gemini)

The app supports three providers switchable via toolbar. **All three ultimately call Gemini's image generation API.** The provider affects how the HTTP call is made, not what model runs.

### Provider 1: Gemini (Direct)
**Route:** `POST /api/generate`
**Auth:** `GEMINI_API_KEY` → Google AI API directly (`@google/genai` SDK)
**Models:**
- `Flash` → `gemini-3.1-flash-image-preview` (default, primary)
- `Pro` → `gemini-3-pro-image-preview` (complex scenes, text in image)
- `Standard` → `gemini-2.5-flash-image` (lightweight)

Has automatic Pro fallback on 503 errors.

Supports SSE streaming via `generateContentStream` for long generations.

Passes `thoughtSignature` back to client for carousel threading.

### Provider 2: Pudding (Gemini Proxy)
**Route:** `POST /api/pudding/generate`
**Auth:** `PUDDING_API_KEY` → `new.apipudding.com` (third-party Gemini proxy)
**Same `@google/genai` SDK**, different `baseUrl` + `apiVersion`.
**Models** (Pudding-encoded names, URL-encoded before sending):
- Flash 1K → `[官逆C]Nano banana 2`
- Flash 2K → `[官逆C]Nano banana 2-2k`
- Pro 1K → `[官逆C]Nano banana pro(大香蕉)`
- Pro 2K → `[官逆C]Nano banana pro-2k`

Same generation logic as Gemini direct. Same SDK call. Same response parsing.

### Provider 3: Ecco (Gemini Proxy with Job Queue)
**Route:** `POST /api/ecco/generate`
**Auth:** `ECCO_API_KEY` → `eccoapi.com/api/v1/{model}/generate`
**NOT using the SDK** — uses raw `fetch` to EccoAPI's REST endpoint.
**Models:** `nanobanana31` (Flash) or `nanobananapro` (Pro)

Key difference: EccoAPI returns a **signed asset URL** (not base64 inline data). The backend downloads the image from that URL and saves it locally. Supports async job queuing (202 + jobId polling) and sync mode.

Ecco passes Gemini config parameters (`temperature`, `thinkingConfig`, `mediaResolution`, `safetySettings`, `responseModalities`) as JSON body fields — EccoAPI forwards them to Gemini.

---

## What All Three Providers Share: The Same Gemini Config Pattern

Despite the different routes, all three providers send the same generation config structure to Gemini:

```typescript
const generationConfig = {
  temperature: settings.temperature ?? 1.0,
  topP: settings.topP ?? undefined,            // only sent if set
  responseModalities: ["TEXT", "IMAGE"],        // ALWAYS both
  thinkingConfig: {
    includeThoughts: settings.includeThoughts ?? true,
    thoughtSignature: incomingThoughtSig,       // Gemini direct only, for carousel
  },
  imageConfig: {
    aspectRatio: settings.aspectRatio ?? "4:5",
    imageSize: settings.resolution ?? "1K",     // maps to Gemini imageSize string
    mediaResolution: "media_resolution_high",
  },
  safetySettings: [
    { category: "HARM_CATEGORY_HARASSMENT",       threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    { category: "HARM_CATEGORY_HATE_SPEECH",      threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  ],
  tools: useGoogleSearch ? [{ googleSearch: {} }] : [],
};
```

**What is currently MISSING from all three providers:**
- `seed` — exists in UI settings (`NodeSettings.seed: string`) and is shown to the user, but is **never forwarded to any generation config**
- `topK` — does not exist anywhere in the settings interface or generation config
- `candidateCount` — always 1 (app returns one image per node; multi-candidate UI not built yet)

These are the exact gaps the skill's API configuration block defines that we don't yet support.

---

## How Settings Flow (Frontend → Backend)

```
User types in settings panel (right sidebar)
  → onUpdateSettings(nodeId, { temperature, topP, seed, model, ... })
    → stored in node.data.settings (NodeSettings type)

User clicks Generate
  → PromptNode: onGenerateSlide(nodeId, prompt, node.data.settings)
  → CarouselPromptNode: onGenerateCarousel(nodeId, slides, node.data.settings)
  → ModelCreationNode: onCreateModel(nodeId, description, node.data.settings)

page.tsx dispatch (for Gemini provider):
  → callGenerate([outputNodeId], { prompt, nodeId, type: 'slide', settings, referenceUrls })
    → fetch POST /api/generate
      → reads settings.temperature, settings.topP, settings.model, etc.
      → builds geminiConfig
      → calls ai.models.generateContent(...)
      → parses inlineData image part
      → persists PNG to public/generated/
      → returns { imageUrl, nodeId, thoughtSignature }
```

The `settings` object is passed wholesale to the backend. The backend extracts individual fields. Any field in `NodeSettings` that the backend doesn't explicitly read is silently ignored (which is currently what happens to `seed` and `topK`).

---

## The NodeSettings Type (Complete)

```typescript
interface NodeSettings {
  // Core generation params
  temperature?: number;       // default 1.0
  topP?: number;              // nucleus sampling
  seed?: string;              // shown in UI — NOT YET forwarded to Gemini
  // topK?: number;           // NOT IN TYPE — missing entirely
  negativePrompt?: string;
  includeThoughts?: boolean;  // Gemini thinkingConfig
  mediaResolution?: 'media_resolution_high' | 'media_resolution_medium' | 'media_resolution_low';
  model?: string;             // 'Flash' | 'Pro' | 'Standard' for Gemini
  // EccoAPI-specific
  eccoModel?: 'nanobanana31' | 'nanobananapro';
  imageSize?: '1K' | '2K' | '4K';
  // Output format
  resolution?: string;
  aspectRatio?: string;       // default '4:5'
  // Google Search grounding
  useGoogleSearch?: boolean;
  useImageSearch?: boolean;
  // Connection mode
  useStreaming?: boolean;     // SSE streaming to avoid 524 timeout
  useAsync?: boolean;         // Ecco async job queue mode
  // Per-node provider override
  providerOverride?: 'gemini' | 'ecco' | 'pudding';
  // Model Creation node
  style?: string;
  lighting?: string;
  background?: string;
  // Safety
  safetyThreshold?: 'BLOCK_NONE' | 'BLOCK_ONLY_HIGH' | 'BLOCK_MEDIUM_AND_ABOVE' | 'BLOCK_LOW_AND_ABOVE';
  // Count
  count?: number;
}
```

---

## How Reference Images Are Handled

All three providers use the same reference image pipeline:

1. **Tag matching** — `findMatchingImages(prompt)` scans all uploaded assets, returns those whose tags appear in the prompt text
2. **Canvas-connected refs** — explicit UploadNode → PromptNode edges, bypass tag matching
3. **Merge + deduplicate** — combined list, capped at 14 images
4. **toBase64()** — each image is fetched (local path or remote URL), resized to max 1024px via sharp, compressed to JPEG quality 85
5. **Parts array** — text prompt goes first, then each image as `inlineData` part

```typescript
const parts: Part[] = [{ text: textPrompt }];
for (const img of allImages) {
  const { data, mimeType } = await toBase64(img.url);
  parts.push({ inlineData: { mimeType, data } });
}
const contents: Content[] = [{ role: 'user', parts }];
```

Ecco sends them differently (as `imageBase64: [{ data, mimeType }]` array in JSON body) because EccoAPI can't reach localhost URLs.

---

## What We Need from the Skill

The skill is used in **two ways** in our workflow:

### Way 1: Claude as the Director (current)
The user opens Claude Code / claude.ai, triggers the skill, and Claude runs all 6 agents to produce a master prompt + API config. The user then **copies the master prompt** and pastes it into a PromptNode on the canvas. Generation happens in the app.

**What the skill needs to know:** The user will paste the Director's master prompt verbatim. The app does NOT further enrich or modify it (beyond a minimal ratio hint wrapper). So the Director's prompt must be self-contained and camera-ready.

### Way 2: In-App Director (planned)
A future node type that runs the skill's agents inside the app — the user fills in a brief form (product description, scene type, model details) and the node auto-generates the Director prompt, then passes it directly to generation. This would require the skill to be callable as a structured function with defined input/output contracts.

### Alignment Gaps to Address

**Gap 1: seed + topK**
The skill's API config always includes `seed` (integer) and `topK` (default 40). Our app currently sends neither to Gemini. We are adding both — seed needs to change from `string` to `number` in `NodeSettings`, and `topK` needs to be added to the type and forwarded in all three route configs.

**Gap 2: candidateCount**
The skill recommends `candidateCount: 2` to get variant options. Our app currently gets 1 candidate per call — the OutputNode shows one image. Adding multi-candidate would require UI work (side-by-side output, variant picker). This is a separate discussion — please confirm if the skill's workflows assume the user picks from 2 candidates, or if single-candidate with seed variants is acceptable.

**Gap 3: Prompt wrapper**
Our `buildSlidePrompt()` appends: `"Photorealistic, ultra high quality, professional product photography."` to every prompt. The Director's quality tags (Hasselblad, 8K, cinematic, anatomically correct, etc.) are already in the master prompt. The wrapper line is redundant and potentially conflicts. Should we strip it when we detect a Director-format prompt, or should the Director omit those tags since the wrapper handles them?

**Gap 4: Scene-type parameter presets**
The skill defines tuning profiles per scene type (beach: temp 1.0–1.1, topP 0.97; studio: temp 0.6–0.8, topP 0.93; urban: temp 1.1–1.3, topP 0.98). Currently our app uses a single temperature input — the user must know to change it per scene. Would a scene-type dropdown that auto-sets the parameter group be useful, or should this remain in the Director's output (the user reads the API config block and manually enters the values)?

**Gap 5: SettingNode / LocationNode**
We are planning a Background/Setting Creator node that mirrors Agent 3's role. When we build it, we would like the skill's Agent 3 to be callable as a standalone step (produce a background prompt only, no model, no product) that feeds into a SettingNode → generates a background image → feeds as reference into a scene PromptNode. Please document Agent 3's standalone output format.

---

## Technical Stack Reference

| Layer | Tech |
|---|---|
| Framework | Next.js 15 (App Router) |
| Canvas | React Flow |
| AI SDK | `@google/genai` (official Google GenAI JS SDK) |
| Image processing | `sharp` (resize + compress reference images) |
| Persistence | Local filesystem (`public/generated/`, `public/uploads/`, `data/assets.json`) |
| Streaming | Server-Sent Events (SSE) via ReadableStream |
| State | React useState + useRef + localStorage (batch history) |

All generation routes are in `app/api/`. All use Node.js runtime (not Edge). All return images as local URLs (`/generated/<filename>.png`).

---

## Quick Summary for Alignment

- App = node-based visual canvas, not a chat interface
- Three providers, all Gemini under the hood, same config shape
- Prompts go in raw from the user — Director output pastes directly into PromptNode
- Reference images are auto-matched by tag keywords in the prompt text
- Carousel generation is sequential; Gemini provider threads thoughtSignature for character consistency
- ModelCreationNode outputs multi-angle reference sheets, not final scene images
- seed and topK are missing from our current implementation — adding them
- candidateCount=2 and SettingNode are planned — need design input from skill side
