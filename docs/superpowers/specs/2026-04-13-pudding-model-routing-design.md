# PuddingAPI Model Routing — Design Spec

**Date:** 2026-04-13  
**Status:** Approved

---

## Problem

The PuddingAPI route (`app/api/pudding/generate/route.ts`) currently sends Gemini model IDs (e.g. `gemini-3.1-flash-image-preview`) to PuddingAPI. PuddingAPI does not recognise these names — it has its own model naming scheme where the model tier (Flash vs Pro) and the output resolution (1K vs 2K) are baked into a single model name. This causes every request to fail.

Additionally, the 503 fallback inherited from the Gemini route attempts to retry with `gemini-3-pro-image-preview`, which also does not exist on PuddingAPI, producing a second error.

---

## PuddingAPI Model Names

PuddingAPI bills per resolution. Each model name encodes both the tier and the resolution. The `[官逆C]` prefix indicates image output capability.

| Tier | Resolution | Model name |
|------|-----------|------------|
| Flash | 1K | `[官逆C]Nano banana 2` |
| Flash | 2K | `[官逆C]Nano banana 2-2k` |
| Pro   | 1K | `[官逆C]Nano banana pro(大香蕉)` |
| Pro   | 2K | `[官逆C]Nano banana pro-2k` |

4K is not available on PuddingAPI. Maximum resolution is 2K.

All model names must be URL-encoded with `encodeURIComponent()` before being passed to the SDK, because they contain Chinese characters, brackets, and parentheses.

---

## Design

### 1. Pudding route — model resolution

Replace the current `MODEL_MAP` and `resolveModel` function with a two-key lookup:

```typescript
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

The `imageSize` value comes from `settings.imageSize` (already passed in the request body from all call sites).

### 2. Pudding route — remove 503 fallback

Delete the `generateWithFallback` function and replace all call sites with direct `ai.models.generateContent(...)` calls. On 503, the error surfaces to the user immediately. There is no valid fallback model on PuddingAPI.

### 3. UI — Pudding settings panels

Three locations in `app/page.tsx` render provider-specific settings in the right panel:
- PromptNode settings (around line 1182)
- CarouselPromptNode settings (around line 1293)
- ModelCreationNode settings (around line 1339)

Each currently has `activeProvider === 'ecco' ? <ecco controls> : <gemini controls>`.

Change each to a three-way branch:

```
activeProvider === 'ecco'    → EccoAPI controls (unchanged)
activeProvider === 'pudding' → Pudding controls:
                               Model: Flash | Pro  (sets settings.model)
                               Image Size: 1K | 2K (sets settings.imageSize, no 4K)
else                         → Gemini controls (unchanged)
```

The `Chips` component and `setSetting` calls already exist for these fields — the Pudding branch reuses them with restricted options.

### 4. No NodeSettings type changes

`model: string` and `imageSize: '1K' | '2K' | '4K'` already exist in `NodeSettings`. No new fields needed.

---

## Error Handling

- **503 from PuddingAPI:** Return the error directly to the UI. No retry.
- **Unknown model/size combination:** The lookup covers all 4 valid combinations. Any other input falls through to the `flash-1k` default.
- **Missing PUDDING_API_KEY:** Already handled — throws `'PUDDING_API_KEY is not set in .env.local'`.

---

## Files Changed

| File | Change |
|------|--------|
| `app/api/pudding/generate/route.ts` | Replace `MODEL_MAP` + `resolveModel` + `generateWithFallback` with `resolvePuddingModel` and direct API calls |
| `app/page.tsx` | Add Pudding branch to 3 settings panel locations |

No other files change.
