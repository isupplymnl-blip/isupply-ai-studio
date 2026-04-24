# Pending Tasks — saved 2026-04-14

## 1. Model Creation — Multi-Model Image Fix
- When 2 or 3 models created simultaneously, only 1 image generates → fix so ALL models appear in generated image
- If prompt contains 2 or 3 models → hardcode aspect ratio to 21:9 (widest)
- This applies to ALL APIs (current + future)

## 2. Gemini API — Model Selection
- Add model chooser dropdown (not hardcoded to 1 model)
- Browse advanced settings: https://ai.google.dev/gemini-api/docs/image-generation
  - Add top P and other advanced image generation params

## 3. Image Sizes — All Available Sizes
- Gemini: all available sizes (1k, 2k, 4k, 8k+ if exists)
- Ecco: all available sizes (1k, 2k, 4k, 8k+ if exists)
- Pudding exception: only 1k and 2k (keep as-is)
- Applied to: Image Prompt node + Carousel Slide node

## 4. Real-Time Search + Image Search
- ALL APIs (Image Prompt node + Carousel Slide node) → add enable/disable toggle for:
  - Real-time search
  - Image search

## 5. SSE Streaming — Ecco API
- Add SSE streaming to Ecco
- ALL APIs should have SSE streaming

## 6. Error Handling — Red Regen Button
- All APIs: show red regen button on image output error (like Pudding already has)
- Error must be visible IN THE APP (not just terminal)
- Auto-retry on error (especially 500 errors) — at least 3 auto-retries
- Applies to: model creation + image prompt/carousel slide
- Ecco error reference: C:\Users\miuri\Downloads\eccoapi-documentation.txt
- Pudding and Gemini errors same pattern

## 7. Left Sidebar — Open/Close Toggle
- Add collapse/expand toggle for left sidebar
- Should not need to be open all the time

## 8. Image Storage Tabs
- Supabase tab: hosted assets and library
- Local tab: local assets and library
- Separate the two

## 9. Carousel Output Nodes
- All generated output image nodes must be visible (no overlapping)
- Add toggle: "Hold nodes together" — when ON, moving 1 node moves all together

## 10. Carousel Slide — Add/Remove Slides
- After carousel node created, allow adding/removing slides dynamically
- e.g. created 6 slides, can remove 1 to get 5; can add 1 back

---
## API Error Reference
- Ecco errors: C:\Users\miuri\Downloads\eccoapi-documentation.txt
- Pudding errors = similar to Gemini errors

## Notes
- All new features apply to ALL APIs unless noted
- Future API integrations should inherit these patterns
