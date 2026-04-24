# iSupply AI Studio → Skill Creator: Answers & Follow-Up

This is our response to the briefing alignment. It covers our confirmed decisions, new features we are adding based on your skill's recommendations, and an open question we need your input on regarding reference image seeding.

---

## Our Confirmed Decisions (from your skill's API config)

### seed — adding it, changing type to number
`NodeSettings.seed` currently typed as `string` and shown as a text input. We are changing it to `number`, switching the UI input to `type="number"`, and forwarding it as a parsed integer to the Gemini config in all three route files (`/api/generate`, `/api/pudding/generate`). The Ecco route will also receive it as a pass-through field.

Before this change, the seed field was visible to the user but silently dropped — Gemini never received it. After the fix, setting seed 42 in the panel will actually produce deterministic output.

### topK — adding it
Does not exist anywhere in the codebase today. We are adding `topK?: number` to `NodeSettings`, adding a UI input next to `topP`, and forwarding it to the Gemini direct route's `generationConfig`. A comment in the Pudding route will note that topK pass-through behavior is untested with the Pudding proxy.

### candidateCount — staying at 1
No multi-candidate UI exists (OutputNode renders one image per node). Leaving `candidateCount` implicit at 1 until we design the variant picker UI. The seed explorer (below) serves the same exploration purpose at lower architectural cost.

### Prompt builder — not touched
`buildSlidePrompt()` wrapper stays as-is. Director output pastes clean into PromptNode. App forwards it as-is. The wrapper line (`"Photorealistic, ultra high quality, professional product photography."`) remains for non-Director prompts — users who write quick raw prompts still get a quality baseline. For Director prompts, that line is redundant but harmless since it trails after the Director's own quality tags.

### Google Search grounding — no change
Already implemented. `useGoogleSearch` and `useImageSearch` toggle in node settings.

---

## New Feature 1: Seed Explorer (adding this)

After a successful generation on any PromptNode or OutputNode, we will display a row of 5 seed variant buttons below the output image:

```
[ Seed 42 ] [ +1: 43 ] [ +2: 44 ] [ +7: 49 ] [ +13: 55 ]
```

Each button re-runs the same prompt on the same output node with only the seed changed. Temperature, topP, topK, model — all other settings stay identical. This maps directly to your "Proven Seed Combinations" table:
- +1: minor pose/expression variation
- +2: adjacent (hair/wind movement)
- +7: medium (background depth shift)
- +13: moderate (lighting angle change)

The base seed shown (e.g. "Seed 42") reflects whatever seed is currently set in the node's settings panel. If seed is unset, defaults to 42 for the explorer display.

Implementation: buttons appear in OutputNode after `imageUrl` is populated, stored alongside the image as `lastSeed`. Clicking a variant button calls `onRegenerate()` with `settings: { ...currentSettings, seed: variantSeed }`.

---

## New Feature 2: Auto-Detect Settings from Director Prompt (adding this)

When the user pastes a Director-generated master prompt into a PromptNode or CarouselPromptNode, the app will scan the text and auto-update the node's settings to match what the Director specified.

Detection runs on `onBlur` (when the user leaves the textarea) and on `onChange` with a 600ms debounce. The settings fields update visually — the user can see what was detected and can still override manually.

### Explicit parameter extraction (highest priority)
Scans for exact values stated in the prompt or its API config block:
```
seed: 42          → settings.seed = 42
seed 42           → settings.seed = 42
temperature: 1.0  → settings.temperature = 1.0
temp 1.0          → settings.temperature = 1.0
top_p: 0.97       → settings.topP = 0.97
topP 0.97         → settings.topP = 0.97
top_k: 40         → settings.topK = 40
topK 40           → settings.topK = 40
```

### Scene-type keyword presets (lower priority, only if no explicit values found)
If no explicit parameter values are detected, falls back to scene-type matching:
```
beach / tropical / outdoor    → temperature: 1.0, topP: 0.97, topK: 40
studio / white background     → temperature: 0.5, topP: 0.90, topK: 30
urban / street / city         → temperature: 1.2, topP: 0.98, topK: 50
nature / forest / garden      → temperature: 1.0, topP: 0.95, topK: 40
```

These presets map directly to your skill's "Parameter Tuning Guide" and scene-specific settings in `prompt-patterns.md`.

### Visual feedback
A small indicator appears under the textarea when auto-detection fires:
`✦ Settings auto-detected from prompt`
If the user manually overrides a detected value, the indicator updates to:
`✦ Settings detected · manually overridden`

---

## Open Question: Reference Image Seeding

This is the most important design question we need your input on, and we don't have a strong answer yet.

### The current state
When a user uploads a product image (e.g. the SPF serum bottle photo), it gets:
- A name: `"SPF Serum"`
- Tags: `"spf, serum, bottle, skincare"`
- A URL: `/uploads/1714012345-abc123.jpeg`
- No seed association

When generation runs, tag matching fires → the bottle image is found → it gets sent as `inlineData` alongside the text prompt. Gemini receives both the prompt AND the actual product photo as a multi-modal input.

No seed is associated with any reference image. No seed is currently sent to Gemini at all (which we are now fixing). So today, every generation with the same reference image and same prompt produces different results because seed is absent.

### The question we are asking you

Once we fix seed forwarding, the combination of **prompt + reference images + seed** will produce deterministic output. That's good. But we are wondering if we should go further:

**Should each uploaded reference image have its own "anchor seed" — a seed value that, when used, consistently produces the most faithful rendering of that specific product?**

The idea would be:
1. When a user uploads a product reference image, they (or the system) assigns an "anchor seed" to it
2. When any prompt uses that reference image, the app suggests starting with the anchor seed
3. The seed explorer buttons then show variants relative to that anchor (anchor, anchor+1, anchor+2, anchor+7, anchor+13)

This would mean the "Seed 42 → beach anchor, Seed 100 → studio anchor" discipline from your skill gets built into the asset library itself, not just remembered by the user.

**Variant: image-content-derived seed**
Alternatively — rather than user-assigned, the seed could be auto-derived from the image file itself (e.g. a simple hash of the filename or pixel data → mapped to a seed integer in a stable range). This would be fully automatic, consistent across sessions, and require zero user input. The downside is the seed would be arbitrary (e.g. 38471) and not match your skill's documented seed vocabulary (42, 43, 44, 55, 77, 100).

**What we need from you:**
- Does your seed strategy assume per-product anchor seeds, or is seed 42 a universal starting point regardless of the reference image?
- When the Director outputs a seed value in the API config block, is that seed calibrated to the specific product reference used in that shoot, or is it scene-type-generic?
- If we implement per-reference anchor seeds, should the skill's Director agent output a seed recommendation that accounts for the reference image being included?

### Why this matters for the carousel
In a carousel shoot, the same product reference image is sent to every slide. If each slide uses a different seed, the product rendering can vary slightly between slides even with identical reference. If the product reference had its own anchor seed, we could pin all carousel slides to anchor + slide_index (e.g. anchor+0, anchor+1, ..., anchor+5) — giving maximum carousel consistency while still allowing per-slide variation.

This is the direction we are leaning toward, but we want your skill's seed strategy to agree before we build it in.

---

## How Reference Images Are Sent to Gemini (for your records)

In case this was not clear from the briefing:

```
User prompt text → sent as parts[0]: { text: "Editorial fashion photograph..." }
Reference image 1 → sent as parts[1]: { inlineData: { mimeType: "image/jpeg", data: "<base64>" } }
Reference image 2 → sent as parts[2]: { inlineData: { mimeType: "image/jpeg", data: "<base64>" } }
...up to 14 reference images
```

All images are resized to max 1024px and compressed to JPEG 85 quality before sending. The text prompt always comes first per the v1beta spec.

The Gemini model receives the actual product photo(s) alongside the prompt. It uses them as visual grounding — the bottle shape, label design, color, material — are visible to the model, not just described. The Director's Product Block (Agent 4 output) in the prompt reinforces the visual grounding with text description. Both channels work together.

This means: **for product accuracy, reference images + a precise Agent 4 product description is more reliable than either alone.** The image shows Gemini what to render; the text description tells it what to pay attention to.

---

## Summary of Changes Being Made

| Area | Change | Status |
|---|---|---|
| `NodeSettings.seed` | `string` → `number` | Building |
| `NodeSettings.topK` | Add field | Building |
| `/api/generate` geminiConfig | Add `seed`, `topK` forwarding | Building |
| `/api/pudding/generate` geminiConfig | Add `seed`, `topK` (with comment) | Building |
| PromptNode / CarouselNode settings panel | Add topK input, change seed to number input | Building |
| OutputNode | Seed Explorer row (5 variant buttons) | Building |
| PromptNode / CarouselNode prompt textarea | Auto-detect settings on paste/blur | Building |
| Reference image anchor seed | Architecture decision pending — waiting on your input | Open |
| SettingNode / LocationNode | Agent 3 standalone output format needed | Open |
