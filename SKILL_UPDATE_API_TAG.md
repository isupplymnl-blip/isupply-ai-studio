# iSupply AI Studio → Update: [API: ...] Tag Protocol

This update defines a new deterministic auto-detection protocol. The previous approach (scanning the Master Prompt text for embedded parameter values) was unreliable — the Director puts API config in a separate Agent 5 block, not inside the scene description. This replaces it with an explicit tag that the app parses and strips before generation.

---

## The Tag Format

Every Master Prompt and every carousel slide must begin with this line as line 1:

```
[API: model=gemini-3.1-flash-image-preview, temp=1.0, topP=0.97, topK=40, seed=67]
```

Every Setting Block must begin with:

```
[API: temp=0.6, seed=67]
```

### Rules

- Tag is always **line 1**, before any scene description
- No blank line between the tag and the scene description
- All values on one line, comma-separated, inside `[API: ... ]`
- Seed is the **same value** across all carousel slides (one seed for the batch)
- SettingNode tag only includes `temp` and `seed` — no model, topP, topK (those are fixed for plate generation)

---

## What Happens in the App

1. User pastes a Master Prompt (with `[API: ...]` on line 1) into a PromptNode or CarouselPromptNode textarea
2. App detects the tag within 500ms
3. Parses: `model`, `temp` → temperature, `topP`, `topK`, `seed`
4. Applies parsed values to node settings (sidebar sliders + inputs update instantly)
5. **Strips the tag from the prompt** — Gemini never sees it
6. Shows ⚡ indicator: `Auto-filled: temperature, topP, topK, seed, model`

For carousel: pasting slide 1 fills carousel-level settings. Slides 2–N still need the tag stripped — paste each slide and the tag is auto-stripped. The settings remain (they were applied from slide 1).

For SettingNode: same flow — paste sets temp + seed, strips tag, plate generation uses the clamped values.

Server-side strip is also in place as a safety net (in case client-side strip doesn't fire).

---

## Model Values → App Labels

| Tag value | App model selector |
|---|---|
| `gemini-3.1-flash-image-preview` | Flash |
| `gemini-3-pro-image-preview` | Pro |
| `gemini-2.5-flash-image` | Standard |
| anything containing `pro` | Pro |
| anything containing `standard` | Standard |
| anything else | Flash |

---

## What the Director Must Change

### Agent 5 output changes

Agent 5 no longer outputs a standalone JSON block. Instead, the tag is prepended to every Master Prompt automatically by the Director.

**Before (old):**
```
MASTER PROMPT:
[scene description here]

AGENT 5 — API CONFIGURATION:
{ "model": "gemini-3.1-flash-image-preview", "temperature": 1.0, ... }
```

**After (new):**
```
MASTER PROMPT:
[API: model=gemini-3.1-flash-image-preview, temp=1.0, topP=0.97, topK=40, seed=67]
[scene description here]
```

The standalone Agent 5 JSON block can be removed from the Director output — the tag replaces it. The Paste API Config box in the right sidebar is still available as a manual fallback.

### Carousel output changes

Every slide gets the tag on line 1, all slides use the same seed:

```
CAROUSEL SLIDE 1 — [label]
[API: model=gemini-3.1-flash-image-preview, temp=1.0, topP=0.97, topK=40, seed=42]
[slide 1 scene description]

CAROUSEL SLIDE 2 — [label]
[API: model=gemini-3.1-flash-image-preview, temp=1.0, topP=0.97, topK=40, seed=42]
[slide 2 scene description]
```

The API Config block at the end of the carousel output (one block for all slides) can be removed — it is now embedded per-slide as a tag.

### Setting Block output changes

```
SETTING BLOCK:
[API: temp=0.6, seed=42]
[lighting] → [environment] → [depth layers] → [atmosphere] → [camera]
```

---

## Backward Compatibility

The Paste API Config box (right sidebar) still works — users can paste the old-format JSON block there as a manual override. The tag system is the primary path; the paste box is the fallback.

Scene-keyword presets (beach, studio, urban, nature) still fire if no tag is found and no explicit values are detected — lowest priority.
