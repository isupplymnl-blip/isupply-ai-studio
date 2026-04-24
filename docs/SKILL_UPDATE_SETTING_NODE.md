# iSupply AI Studio → Update: SettingNode Now Built

This is a status update for the skill creator. SettingNode has shipped. The "coming soon" note in the previous answer file is now resolved. Please update the skill accordingly.

---

## What Was Built

**SettingNode** is a new canvas node for generating background plates — no model, no product, environment only.

### How it works

1. User pastes Agent 3's Setting Block (the `[LIGHTING] → [ENVIRONMENT] → [DEPTH LAYERS] → [ATMOSPHERE] → [CAMERA] → [QUALITY TAGS]` format) into the SettingNode textarea.
2. Node appends the quality tail automatically: `no people — no products — background plate only — photorealistic`. User does not need to type this.
3. Generation runs at **temperature 0.5–0.7** (default 0.6) with a **fixed seed** (user-set or auto-assigned). Same provider routing as PromptNode (Gemini / Pudding / Ecco).
4. Output image saves to the asset library with auto-tags derived from the Setting Block keywords (lighting type, environment type, etc.).
5. User connects the SettingNode output to PromptNode as a reference image input. PromptNode does not re-describe the background — the plate image handles visual grounding.

### Node settings exposed

| Setting | Default | Notes |
|---|---|---|
| Temperature | 0.6 | Range 0.5–0.7 enforced — higher would destabilize the plate |
| Seed | user-set | Saved alongside the plate output so the exact plate is reproducible |
| Model | Flash | Same model selector as PromptNode |
| Provider override | inherits global | Can override to Gemini/Pudding/Ecco per-node |

---

## What You Need to Update in the Skill

### 1. Setting Block section — remove "coming soon"

The Director's output format in `SKILL_CREATOR_ANSWER_2.md` had:

```
→ PASTE INTO: SettingNode (when available — currently in development)
→ INCLUDE IN: Master Prompt (current workflow)
```

Update this to:

```
→ PASTE INTO: SettingNode
```

The fallback "include in Master Prompt" path is no longer needed. SettingNode is live.

### 2. Current workflow vs future workflow — collapse into one

Remove the two-path description. There is now only one workflow:

> Paste the Setting Block into a SettingNode. The node appends the quality tail automatically — do not add "no people / no products / background plate only" to the Setting Block yourself, the node handles it. Node generates the plate, user saves to library, connects output to PromptNode. Master Prompt does not need to describe the background.

### 3. Director instruction for Agent 3

Agent 3 (Setting Block) should be told:

- **Do not** include the quality tail in its output. The app appends it.
- Output format stays the same: `[LIGHTING] → [ENVIRONMENT] → [DEPTH LAYERS] → [ATMOSPHERE] → [CAMERA]`
- Stop at camera. No quality tags. The node adds them.

### 4. Full node workflow order — update Step 3

Previous Step 3 was marked "SettingNode — coming soon." Update to:

```
STEP 3 — Generate background plate
  → SettingNode
  → Paste Agent 3's Setting Block (lighting → environment → depth → atmosphere → camera only)
  → Temperature 0.5–0.7, set a fixed seed
  → Generate → output auto-saves to library with environment tags
  → Connect SettingNode output to PromptNode (or it auto-matches if tags overlap)
```

---

## One Thing to Verify With Us

The SettingNode currently appends this exact quality tail:

```
no people — no products — background plate only — photorealistic
```

If Agent 3 should produce a different tail (e.g. adding `8K`, `ultra-detailed`, `golden hour` as permanent quality tags), tell us and we will update what the node appends. Right now it is minimal by design — clean plate, no creative quality tags, to avoid fighting the model's own interpretation of the setting description.
