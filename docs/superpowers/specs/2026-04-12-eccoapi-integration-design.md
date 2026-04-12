# EccoAPI (Nano Banana) Integration Design
**Date:** 2026-04-12
**Status:** Approved

---

## Overview

Add EccoAPI (Nano Banana) as a selectable image generation provider alongside Google Gemini. Users choose their provider at startup; EccoAPI uses async job polling with client-side background generation that persists across batch switches. Also fixes automated batch generation dropping reference images, and adds Google Search grounding for both providers.

---

## Architecture

### Approach: Separate routes per provider (Approach B)

The existing Gemini route (`app/api/generate/route.ts`) is **not modified**. EccoAPI gets its own dedicated async route pair. The client selects the endpoint based on stored provider preference.

```
app/api/generate/route.ts          ← Gemini (unchanged)
app/api/ecco/generate/route.ts     ← EccoAPI: POST → returns jobId instantly
app/api/ecco/jobs/[jobId]/route.ts ← EccoAPI: GET → polls job status, downloads image when done
app/hooks/useGenerationQueue.ts    ← Global polling state (EccoAPI only)
app/context/GenerationQueueContext.tsx ← React Context wrapping the queue at app root
```

---

## Section 1: Provider Selection & Config

### Config Shape

`studio-config.json` (desktop) and `.env.local` (web) expand to hold both keys:

**Desktop (`studio-config.json`):**
```json
{
  "provider": "gemini",
  "geminiApiKey": "AIza...",
  "eccoApiKey": "nk_live_..."
}
```

**Web (`.env.local`):**
```
GEMINI_API_KEY=AIza...
ECCO_API_KEY=nk_live_...
AI_PROVIDER=gemini
```

Both keys are preserved when switching providers — switching back to Gemini does not erase a saved EccoAPI key.

### Startup Setup Dialog (Electron `setup.html`)

- Provider radio toggle at top: **Google Gemini** | **EccoAPI (Nano Banana)**
- Below: single API key field that updates its label, placeholder, and validation rule based on selected provider
  - Gemini: placeholder `AIza...`, validates `key.startsWith('AIza') && key.length >= 20`
  - EccoAPI: placeholder `nk_live_...`, validates `key.startsWith('nk_live_') && key.length >= 20`
- Help link updates to Google AI Studio (Gemini) or eccoapi.com/dashboard (EccoAPI)
- On save: stores `{ provider, geminiApiKey?, eccoApiKey? }` to config; existing key for the other provider is preserved

### Settings Menu (Change API Key)

Existing Electron "Settings — Change API Key" menu opens the updated setup dialog pre-filled with current provider selection and its saved key.

---

## Section 2: EccoAPI Route Layer

### `POST /api/ecco/generate`

**Request body (same shape as existing Gemini route for node compatibility):**
```ts
{
  prompt: string;
  aspectRatio?: string;       // default "1:1"
  imageSize?: "1K" | "2K" | "4K";  // default "1K"
  useGoogleSearch?: boolean;  // default false
  imageBase64?: string[];     // up to 14 reference images
  nodeId: string;
  batchId: string;
  model: "nanobananapro" | "nanobanana31";
}
```

**Behavior:**
- Reads `ECCO_API_KEY` from env (web) or config (desktop)
- Calls `POST https://eccoapi.com/api/v1/{model}/generate` with `Authorization: Bearer {key}`
- Does NOT include `callbackUrl` (client polls instead)
- Returns immediately: `{ jobId, nodeId, batchId, cost, remaining_credits }`

**Response on success (202-style, job queued):**
```json
{ "jobId": "abc123", "nodeId": "node-1", "batchId": "batch-1", "remaining_credits": 9.95 }
```

### `GET /api/ecco/jobs/[jobId]`

**Behavior:**
- Proxies to `GET https://eccoapi.com/api/v1/jobs/{jobId}` with same auth header
- When status is `completed`:
  - Downloads image from the signed `assetUrl` (valid 900s)
  - Saves to local `/generated/{timestamp}-{random}.png` (same path as Gemini)
  - Returns local URL so the rest of the app is provider-agnostic

**Response shape:**
```ts
{
  status: "pending" | "processing" | "completed" | "failed";
  imageUrl?: string;        // local /api/generated/... URL, when completed
  cost?: number;
  remaining_credits?: number;
  error?: string;           // translated error message
}
```

### Error Code Translation

| HTTP Code | EccoAPI Meaning | UI Message |
|-----------|----------------|------------|
| 400 | Bad request | "Invalid request — check prompt and settings" |
| 401 | Invalid API key | "Invalid EccoAPI key — check your settings" |
| 402 | Insufficient credits | "Insufficient credits — top up at eccoapi.com/dashboard" |
| 403 | Access denied | "Access denied for this job" |
| 404 | Job not found | "Job not found — it may have expired" |
| 429 | Rate limit exceeded | "Rate limit reached — please wait a moment" |
| 500 | Server error | "EccoAPI server error — try again" |
| 503 | Model disabled | "EccoAPI model is temporarily unavailable" |

---

## Section 3: Global Generation State (Background Generation)

### `useGenerationQueue` hook + `GenerationQueueContext`

Mounted at app root (outside batch switcher) so state survives batch switches.

**Job shape:**
```ts
interface GenerationJob {
  jobId: string;
  nodeId: string;
  batchId: string;
  status: "polling" | "completed" | "error";
  imageUrl?: string;
  remaining_credits?: number;
  cost?: number;
  error?: string;
  seen: boolean; // false = batch tab shows dot indicator
}
```

**Polling behavior:**
- On `POST /api/ecco/generate` success → job added to queue with `status: "polling"`
- Hook polls `GET /api/ecco/jobs/[jobId]` every **3 seconds** per active job
- On `completed` → `status: "completed"`, `imageUrl` stored, `seen: false`, polling stops
- On `error` → `status: "error"`, error message stored, polling stops
- When user navigates back to a batch → all jobs for that batch marked `seen: true`

**Credits persistence:**
- `remaining_credits` from each completed job saved to `localStorage` key `isupply-ecco-credits`
- Always reflects the most recent known balance across batch switches

### Batch Tab Dot Indicator

The batch switcher reads the queue for jobs where `batchId === tab.id`:
- Amber pulsing dot = at least one job `status: "polling"`
- Green dot = at least one `status: "completed" && !seen`
- Red dot = at least one `status: "error" && !seen`
- Priority order: polling > error > completed (show most actionable state)

---

## Section 4: UI Changes

### A. Node Controls (PromptNode, CarouselPromptNode, ModelCreationNode)

When provider is **EccoAPI**, the existing Gemini model dropdown is replaced with:

| Control | Values | Notes |
|---------|--------|-------|
| Model | NanoBanana Pro / NanoBanana 3.1 | replaces Flash/Standard/Pro |
| Image Size | 1K / 2K / 4K pill selector | default 1K; shown only for EccoAPI |
| Search grounding toggle | on/off | shown for both EccoAPI models and Gemini Flash |

When provider is **Google Gemini**, the existing model dropdown remains. The search grounding toggle is added for the Flash model only.

### B. Credits Display (EccoAPI only)

Location: top bar, right of the batch name area.

- Shows **"Credits: $X.XX"** from `localStorage` (`isupply-ecco-credits`)
- Updates immediately after each completed generation
- When `remaining_credits < 2.00`: label turns amber, shows warning icon — **"Low credits: $X.XX"**
- Hidden entirely when provider is Google Gemini

### C. Error Display

EccoAPI errors appear below the generate button on the node (same location as current Gemini errors), using the translated messages from Section 2.

---

## Bug Fix: Automated Batch — Reference Images Not Sent

**Problem:** The automated batch generation loop calls the generate API with only the prompt text. The `findMatchingImages()` call and base64 encoding of matched reference images is skipped, so reference images are never sent.

**Fix:** In the automated batch generation code path (identified in `CarouselPromptNode.tsx` or `page.tsx` batch automation logic), apply the same `findMatchingImages()` + base64 encoding that manual single-node generation uses before calling the API.

---

## EccoAPI Models Reference

| Model | Endpoint | Price | Rate Limit | Search Grounding | Max Refs |
|-------|----------|-------|------------|-----------------|----------|
| NanoBanana Pro | `/nanobananapro/generate` | $0.05 (1K/2K), $0.10 (4K) | 1000/day, 100/min | Yes | 14 |
| NanoBanana 3.1 | `/nanobanana31/generate` | $0.03 (1K), $0.05 (2K), $0.07 (4K) | 1000/day, 60/min | Yes | 14 |

**Supported aspect ratios:** 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9

**Auth header:** `Authorization: Bearer nk_live_...`

**Signed URL TTL:** 900 seconds — image is downloaded server-side on job completion to avoid expiry issues.

---

## Files Changed / Created

| File | Change |
|------|--------|
| `electron/setup.html` | Add provider toggle, update key validation |
| `electron/main.cjs` | Read/write `provider` + both keys in config |
| `electron/preload.cjs` | Expose provider + eccoApiKey via IPC |
| `app/api/ecco/generate/route.ts` | **New** — EccoAPI async generate |
| `app/api/ecco/jobs/[jobId]/route.ts` | **New** — job polling proxy |
| `app/hooks/useGenerationQueue.ts` | **New** — global polling state |
| `app/context/GenerationQueueContext.tsx` | **New** — context provider |
| `app/page.tsx` | Mount queue context; batch tab dots; credits display; provider-aware controls |
| `app/components/nodes/PromptNode.tsx` | EccoAPI controls (model, size, grounding) |
| `app/components/nodes/CarouselPromptNode.tsx` | EccoAPI controls; fix ref images in auto-batch |
| `app/components/nodes/ModelCreationNode.tsx` | EccoAPI controls |
| `.env.local.example` | Add `ECCO_API_KEY`, `AI_PROVIDER` |
