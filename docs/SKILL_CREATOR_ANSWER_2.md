# iSupply AI Studio → Skill Creator: Answer Round 2

Received your answers on both open questions. Confirmed and locking in the decisions below. Then we have one major recommendation for you to implement on your end.

---

## Confirmed: Reference Image Seeding — No Anchor Seeds

Agreed. Seed stays scene-type-generic (42 universal anchor). Reference images are visual grounding only — separate concern from seed. No per-image anchor seeds, no hash-derived seeds. Carousel consistency handled entirely by thoughtSignature threading, which we already have on the Gemini direct route. Carousel uses one seed for the whole batch set at the carousel node level.

---

## Confirmed: SettingNode / Agent 3 Standalone Format

Received the background plate prompt format. Confirmed structure:

```
[LIGHTING] → [ENVIRONMENT] → [DEPTH LAYERS] → [ATMOSPHERE] → [CAMERA] → [QUALITY TAGS]
```

Quality tags always end with: `no people — no products — background plate only — photorealistic`

SettingNode will use temperature 0.5–0.7 + fixed seed. Seed is saved alongside the plate so the user can reproduce the exact same background later. Plate saved to asset library → connected to PromptNode as reference image input.

---

## Recommendation: Update the Skill's Director Output Format

This is the main thing we need from you. Right now the Director delivers a block of outputs with no indication of where each piece goes in the app. Users who have iSupply AI Studio open do not know which output to paste where. We recommend you add a **"Where to Put This"** destination label to every section of the Director's output format.

Here is exactly what we recommend adding. You own the skill file — please update accordingly.

---

### Recommended Director Output Format (with node destinations)

Add a destination tag to each section header. Example:

---

**📋 Creative Brief Summary**
*(Reference only — no paste required. Use this to verify the Director understood your scene before proceeding.)*

---

**🧍 Model Block**
→ **PASTE INTO: ModelCreationNode**

Copy this paragraph into the Model Description field of a ModelCreationNode on the canvas. Click Create. The node generates a 4-panel composite (Front · 3/4 · Side · Back) showing your model from all angles. Save the output to the library. That library image becomes a reference for your scene generation.

If you described TWO models: the node auto-detects this and generates a 4-panel 21:9 composite (M1 Front · M1 Back · M2 Front · M2 Back).
If you described THREE models: 6-panel 21:9 (M1F · M1B · M2F · M2B · M3F · M3B).

**Do not paste the Model Block into a PromptNode.** The ModelCreationNode prompt is the Description field only — the app builds the composite framing instructions automatically. After generation, the model composite becomes a reference image that feeds INTO the PromptNode alongside the Master Prompt.

---

**🏖️ Setting Block**
→ **PASTE INTO: SettingNode** *(when available — currently in development)*
→ **INCLUDE IN: Master Prompt** *(current workflow)*

**Current workflow (no SettingNode yet):** The Setting Block is already stitched into the Master Prompt by the Director. You do not paste it separately. It is included automatically.

**Future workflow (once SettingNode ships):** Paste ONLY the Setting Block into a SettingNode. The node generates a background plate image (no model, no product) using temperature 0.5–0.7 and a fixed seed. Save the plate to the library. Connect the SettingNode output to the PromptNode as a reference image. The PromptNode then handles the full scene with model + product — it does not need to re-describe the background because the plate image is already there as visual grounding.

---

**📦 Product Block**
→ **USE AS: Upload reference tags** + **INCLUDE IN: Master Prompt**

The Product Block does two jobs:

1. **The text description** is already stitched into the Master Prompt by the Director — no separate action needed.
2. **The actual product photo** (if the user has one) must be uploaded to the app via UploadNode BEFORE generation. In the UploadNode, set the asset name and tags to match the key words from the Product Block (e.g. tags: `spf, serum, bottle, skincare, frosted glass`). When the Master Prompt mentions those words, the app auto-matches the product photo and sends it to Gemini as a visual reference alongside the text.

**Critical:** If the user has an actual product photo, upload it. The combination of Agent 4's text description AND the real photo gives Gemini two channels of grounding — text tells it what to focus on, the image shows it exactly what to render. Either alone is weaker.

---

**🎬 Master Prompt**
→ **PASTE INTO: PromptNode** (single image) or **CarouselPromptNode → each slide** (multi-slide)

This is the primary paste destination. The app forwards this prompt to Gemini exactly as written — no enrichment, no modification. Paste it clean.

**For a single image:** Paste into a PromptNode textarea. Click Generate.

**For a carousel:** The Director should generate N separate Master Prompts — one per slide — each describing the same product and model in a different scene moment (different angle, expression, product interaction, or setting depth). Paste each into a slide in the CarouselPromptNode (navigate slides with the ← → arrows, use + to add slides). All slides share the same settings (temperature, seed, topK set once at the carousel node level). Generation runs sequentially. thoughtSignature from slide 1 threads to slide 2, 2 to 3, etc. — the model visually remembers the character and product from the previous frame.

**For a carousel, seed rule:** Use ONE seed for the entire batch (set in the carousel node settings panel). Do not vary the seed between slides. The seed controls compositional randomness — keep it stable across the carousel. Visual consistency between slides is handled by thoughtSignature, not seed uniformity.

---

**⚙️ API Configuration**
→ **ENTER INTO: Node Settings Panel** (right sidebar when node is selected)

After selecting the PromptNode or CarouselPromptNode on the canvas, the right sidebar shows the settings panel. Enter the values from the API Config block here:

| API Config field | Settings panel field |
|---|---|
| `temperature` | Temperature |
| `top_p` | Top P |
| `top_k` | Top K |
| `seed` | Seed |
| `model` | Model (Flash / Pro / Standard) |
| `tools: [googleSearch]` | Toggle: Google Search Grounding |

**Note on candidateCount:** The app currently generates 1 candidate per call (one image per OutputNode). The `candidateCount: 2` in the API config is not used yet. Use the Seed Explorer instead — after generation, 5 buttons appear below the output image (Seed, +1, +2, +7, +13) to explore variants without leaving the canvas.

**Auto-detection:** The app scans your pasted Master Prompt for parameter values (`seed: 42`, `temperature: 1.0`, `top_k: 40`, etc.) and auto-fills the settings panel. You may still want to verify the values match the API Config block. Scene-type keywords (beach, studio, urban, nature) also trigger parameter presets if no explicit values are detected.

---

**💻 Ready-to-Run Code**
→ **NOT NEEDED in the app** — ignore this section when working in iSupply AI Studio.

The app handles the API call internally. You do not paste or run code. This section is for users calling the Gemini API directly from their own scripts.

---

**🌱 Seed Exploration Guide**
→ **REFERENCE: OutputNode Seed Explorer**

After generation completes, the OutputNode displays 5 seed variant buttons:
`[ Seed N ] [ N+1 ] [ N+2 ] [ N+7 ] [ N+13 ]`

These match your documented Proven Seed Combinations table. Click any to re-run the same prompt with only the seed changed. Use the Seed Exploration Guide from the Director as a reference for what each variant tends to produce in your specific scene type.

---

## Summary: Full Node Workflow Order

This is the canonical order for a full commercial shoot in iSupply AI Studio:

```
STEP 1 — Upload product reference photo
  → UploadNode
  → Set name + tags matching Agent 4's product keywords
  → Connect to PromptNode (or leave unconnected — auto-matched by tags)

STEP 2 — Generate model reference sheet  [optional but recommended]
  → ModelCreationNode
  → Paste Agent 2's Model Block into Description field
  → Select style (Realistic / Editorial / Commercial / Artistic)
  → Generate → save output to library
  → Upload the model composite as an asset with tags (e.g. "model, filipina, 26yo")

STEP 3 — Generate background plate  [SettingNode — coming soon]
  → SettingNode
  → Paste Agent 3's standalone Setting Block
  → Use temperature 0.5–0.7, fixed seed
  → Generate → save to library → connect to PromptNode

STEP 4 — Generate the scene
  → PromptNode (single) or CarouselPromptNode (multi-slide)
  → Paste Director's Master Prompt
  → Enter API Config values in right panel (or let auto-detect fill them)
  → All reference images (product photo + model composite + background plate)
     auto-attach via tag matching
  → Click Generate

STEP 5 — Explore variants
  → OutputNode Seed Explorer: try +1, +2, +7, +13
  → Adjust temperature ±0.1 in settings for mood shifts
  → Save keepers to library → export to Supabase or download ZIP
```

---

## One Additional Request

When the Director generates carousel content, please output the slides in the exact format we need for the CarouselPromptNode:

```
CAROUSEL SLIDE 1 — [brief scene label]
[Master Prompt for slide 1]

API CONFIG (applies to all slides):
temperature: X.X | top_p: X.XX | top_k: XX | seed: XX | model: [model name]

CAROUSEL SLIDE 2 — [brief scene label]
[Master Prompt for slide 2]

CAROUSEL SLIDE 3 — [brief scene label]
[Master Prompt for slide 3]

...
```

One API Config block for the entire carousel (not repeated per slide). The user enters it once in the carousel node settings panel and it applies to all slides. Individual slide prompts are pasted one-by-one into the carousel navigator.
