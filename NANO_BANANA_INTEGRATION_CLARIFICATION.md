# Nano Banana Integration — Clarification on App Scope

**Date:** 2026-04-19  
**From:** iSupply AI Studio Development Team  
**To:** Skill/Product Team  
**Re:** App Purpose + Parameter Implementation Rationale

---

## Important Clarification: General-Purpose Application

### App Scope

**iSupply AI Studio is NOT a skill-specific tool.**

This is a **general-purpose AI image generation application** designed for:
- E-commerce product photography
- Marketing content creation
- Social media ad generation
- Editorial/lifestyle photography
- Any user who needs AI-generated product images

The skill integration is **one use case among many**, not the primary purpose.

---

## Why We're Adding seed, topK, and Other Parameters

### Rationale: Official Gemini API Documentation

These parameters are being added because they are **official Google Gemini API features**, documented at:
- https://ai.google.dev/gemini-api/docs/image-generation
- https://ai.google.dev/api/generate-content#generationconfig

**Parameters from Gemini documentation:**
- ✅ `temperature` (0.0–2.0) — Controls randomness
- ✅ `topP` (0.0–1.0) — Nucleus sampling
- ✅ `topK` (1–100) — Vocabulary breadth
- ✅ `seed` (integer) — Deterministic output
- ✅ `candidateCount` (1–4) — Number of variants
- ✅ `responseModalities` — Output types
- ✅ `safetySettings` — Content filtering
- ✅ `tools` (googleSearch) — Grounding

**These are NOT skill-specific features.** They are standard Gemini API capabilities that ANY user should be able to access.

### Current Implementation Gap

**Before Phase 1:**
- App only exposed: `temperature`, `topP`, `model`, `resolution`, `aspectRatio`
- Missing from UI: `seed`, `topK`, `candidateCount`
- Users had NO way to set seed for reproducible outputs
- Users had NO way to control vocabulary diversity (topK)

**After Phase 1:**
- App exposes ALL core Gemini parameters
- Users can reproduce exact outputs (seed)
- Users can control generation diversity (topK)
- App is feature-complete with Gemini API

---

## API Tag Parser: Convenience Feature, Not Skill Dependency

### What It Does

The `[API: ...]` tag parser is a **power-user convenience feature** that:
1. Detects parameter tags in pasted prompts
2. Auto-fills settings panel
3. Strips tag before sending to Gemini

### Who Benefits

**ANY user who:**
- Copies prompts from external tools (ChatGPT, Claude, Midjourney, etc.)
- Shares prompts with teammates (includes settings in prompt text)
- Uses prompt templates with embedded parameters
- Works with AI assistants that output structured prompts

**Examples:**

**Use Case 1: User copies from ChatGPT**
```
User asks ChatGPT: "Write me a product photo prompt"
ChatGPT outputs:
[API: temp=1.0, seed=42]
A luxury watch on marble surface, studio lighting...

User pastes into iSupply → settings auto-fill
```

**Use Case 2: Team shares prompt library**
```
Team maintains prompt templates in Notion:

Template: Beach Lifestyle
[API: model=Flash, temp=1.0, topP=0.97, topK=40, seed=42]
Wide shot, golden hour beach, model holding product...

Any team member pastes → consistent settings applied
```

**Use Case 3: Skill integration (one of many)**
```
Skill outputs Director prompt with [API: ...] tag
User pastes into iSupply → settings auto-fill
(Same behavior as Use Cases 1 and 2)
```

### Tag Format

The `[API: ...]` format was chosen because:
- Easy to parse (simple regex)
- Doesn't interfere with natural language prompts
- Similar to existing conventions (Midjourney uses `--param value`)
- Can be stripped cleanly before sending to Gemini

**This is NOT a skill-specific format.** Any user can use it.

---

## Phase 1 Implementation: Confirmed Scope

### What We're Building (Unchanged)

✅ **seed support** — Gemini API feature, benefits all users  
✅ **topK support** — Gemini API feature, benefits all users  
✅ **API tag parser** — Convenience feature, benefits all users  
✅ **Prompt wrapper cleanup** — Quality improvement, benefits all users

### What We're NOT Building

❌ Skill-specific UI  
❌ Skill-specific API endpoints  
❌ Skill-specific prompt formats  
❌ Skill-specific workflows

### Skill Integration = Standard User Workflow

When skill users paste Director prompts:
1. They use the same PromptNode as any other user
2. They use the same settings panel as any other user
3. They use the same generate button as any other user
4. The API tag parser auto-fills settings (convenience)
5. The app generates images using standard Gemini API

**No special treatment. No skill-specific code paths.**

---

## Gemini API Documentation Confirmation

### Verified Parameters (Official Docs)

| Parameter | Gemini Docs | iSupply Status |
|-----------|-------------|----------------|
| `temperature` | ✅ Documented | ✅ Implemented (existing) |
| `topP` | ✅ Documented | ✅ Implemented (existing) |
| `topK` | ✅ Documented | ✅ Phase 1 (new) |
| `seed` | ✅ Documented | ✅ Phase 1 (new) |
| `candidateCount` | ✅ Documented | ⏸️ Phase 2 (planned) |
| `responseModalities` | ✅ Documented | ✅ Implemented (existing) |
| `safetySettings` | ✅ Documented | ✅ Implemented (existing) |
| `tools.googleSearch` | ✅ Documented | ✅ Implemented (existing) |

**Source:** https://ai.google.dev/gemini-api/docs/image-generation

### Parameters NOT in Gemini Docs

| Parameter | Status | Notes |
|-----------|--------|-------|
| `scenePreset` | ❌ Not in Gemini docs | iSupply-specific UI convenience (maps to temp/topP/topK) |
| `sceneType` | ❌ Not in Gemini docs | Alias for `scenePreset` (for API tag compatibility) |

**Clarification:** Scene presets are NOT Gemini API features. They are iSupply UI shortcuts that map to standard Gemini parameters.

Example:
```
User selects "Lifestyle" preset
  ↓
App sets: temperature=1.0, topP=0.97, topK=40
  ↓
App sends standard Gemini API call with these values
```

---

## User Experience: Before vs After Phase 1

### Before Phase 1 (Current)

**Scenario:** User wants to reproduce an image exactly

```
User generates image → likes it → wants to generate again
Problem: No way to reproduce exact output
Workaround: None — user must regenerate until they get lucky
Result: Frustration, wasted API calls
```

**Scenario:** User wants more creative variations

```
User generates image → too generic → wants more diversity
Problem: No way to increase vocabulary breadth
Workaround: Increase temperature (affects randomness, not diversity)
Result: Unpredictable results
```

### After Phase 1 (Improved)

**Scenario:** User wants to reproduce an image exactly

```
User generates image → likes it → sees seed value in metadata
User copies seed → pastes into new generation
Result: Exact reproduction (pixel-perfect)
```

**Scenario:** User wants more creative variations

```
User generates image → too generic → adjusts topK from 40 to 80
User regenerates → sees more diverse concepts/vocabulary
Result: Predictable, controllable diversity
```

---

## API Tag Parser: Technical Details

### Supported Tag Formats

**Standard format (recommended):**
```
[API: model=Flash, temp=1.0, topP=0.97, topK=40, seed=42]
```

**Partial tags (supported):**
```
[API: seed=42]
[API: temp=1.0, topP=0.97]
[API: model=Pro]
```

**Alternative key names (supported):**
```
[API: temperature=1.0]  (same as temp=1.0)
```

**Model name variations (supported):**
```
[API: model=Flash]                              → Flash
[API: model=gemini-3.1-flash-image-preview]     → Flash
[API: model=Pro]                                → Pro
[API: model=gemini-3-pro-image-preview]         → Pro
[API: model=Standard]                           → Standard
[API: model=gemini-2.5-flash-image]             → Standard
```

### Parser Behavior

**Success case:**
```
Input: [API: temp=1.0, seed=42]\nA luxury watch on marble...
Output: 
  - Settings auto-filled: temperature=1.0, seed=42
  - Toast shown: "⚡ Auto-filled: temperature, seed"
  - Stored prompt: "A luxury watch on marble..." (tag stripped)
```

**Malformed tag (fail-safe):**
```
Input: [API: invalid syntax here]\nA luxury watch...
Output:
  - No auto-fill (tag ignored)
  - No error shown to user
  - Error logged to console
  - Stored prompt: "A luxury watch..." (tag stripped anyway)
```

**No tag (backward compatible):**
```
Input: A luxury watch on marble surface...
Output:
  - No auto-fill (no tag detected)
  - Stored prompt: "A luxury watch on marble surface..." (unchanged)
```

---

## Skill Integration: How It Works (No Special Code)

### Step-by-Step Flow

**1. Skill generates prompt**
```
Director skill outputs:
[API: model=gemini-3.1-flash-image-preview, temp=1.0, topP=0.97, topK=40, seed=42]

Editorial fashion photograph, wide to medium shot — golden hour beach...
```

**2. User pastes into iSupply**
```
User opens PromptNode
User pastes skill output
```

**3. App detects API tag (standard parser)**
```
parseAPITag() function runs (same for ALL users)
Extracts: model=Flash, temp=1.0, topP=0.97, topK=40, seed=42
```

**4. App auto-fills settings (standard UI)**
```
Settings panel updates (same for ALL users)
Toast shown: "⚡ Auto-filled: model, temperature, topP, topK, seed"
```

**5. App strips tag (standard cleanup)**
```
Stored prompt: "Editorial fashion photograph, wide to medium shot..."
(Tag removed before storage)
```

**6. User clicks Generate (standard flow)**
```
App sends to Gemini API (same for ALL users)
Request includes: model, temperature, topP, topK, seed
Gemini generates image
```

**7. App displays result (standard UI)**
```
OutputNode shows image (same for ALL users)
Metadata shows: seed=42, model=Flash, etc.
```

**NO skill-specific code executed at any step.**

---

## Response to Integration Plan

### Agreement: Phase 1 Scope

✅ We agree with Phase 1 implementation:
- seed support
- topK support
- API tag parser
- Prompt wrapper cleanup

✅ We agree with Phase 1 timeline:
- 2-3 days implementation
- Deploy this week

### Agreement: Phase 2 Scope

✅ We agree with Phase 2 features:
- Seed Explorer UI (benefits all users)
- Scene Presets (benefits all users)

✅ We agree with Phase 2 timeline:
- 1 week implementation
- Deploy next sprint

### Agreement: Phase 3 Deferral

✅ We agree to defer:
- SettingNode (unclear demand)
- Multi-turn refinement (complex, low priority)
- Custom presets (wait for feedback)

### Clarification: Feature Rationale

**Original plan stated:**
> "Full alignment between Nano Banana Skill API reference and app implementation"

**Corrected rationale:**
> "Full alignment between **Google Gemini API documentation** and app implementation"

The skill benefits from this alignment, but it's not the reason we're building it.

---

## Questions for Skill Team

### Q1: Tag Format Flexibility

**Current behavior:**
- App parses `[API: ...]` tags
- App strips tags before sending to Gemini
- Tags are optional (backward compatible)

**Question:** Does skill REQUIRE `[API: ...]` tags, or can it work without them?

**Recommendation:** Make tags optional in skill output. Users who don't want auto-fill can manually set parameters.

---

### Q2: Skill Documentation

**Current state:**
- Skill docs may imply iSupply is skill-specific
- Skill docs may imply `[API: ...]` format is skill-specific

**Request:** Update skill docs to clarify:
- iSupply is a general-purpose tool (skill is one use case)
- `[API: ...]` format is a convenience feature (not required)
- Users can manually set parameters instead of using tags

---

### Q3: Alternative Workflows

**Question:** Can skill users work WITHOUT the API tag parser?

**Answer:** Yes. Alternative workflow:

```
1. Skill outputs prompt (no [API: ...] tag)
2. User pastes into iSupply
3. User manually sets: model=Flash, temp=1.0, topP=0.97, topK=40, seed=42
4. User clicks Generate
5. Same result as auto-fill workflow
```

**Recommendation:** Support both workflows in skill docs.

---

## Summary

### Key Points

1. **iSupply AI Studio is a general-purpose application**, not skill-specific
2. **seed, topK, and other parameters are from Gemini API docs**, not skill requirements
3. **API tag parser is a convenience feature** for ANY user who pastes prompts with embedded parameters
4. **Skill integration uses standard user workflows**, no special code paths
5. **Phase 1 implementation proceeds as planned**, rationale updated

### No Changes to Implementation

Phase 1 scope remains unchanged:
- ✅ seed support (Gemini API feature)
- ✅ topK support (Gemini API feature)
- ✅ API tag parser (general convenience feature)
- ✅ Prompt wrapper cleanup (quality improvement)

### Documentation Updates Needed

**iSupply docs:**
- [ ] Clarify app is general-purpose (not skill-specific)
- [ ] Document API tag format as optional convenience feature
- [ ] Show examples of manual parameter entry (alternative to tags)

**Skill docs:**
- [ ] Clarify iSupply is general-purpose tool
- [ ] Show both workflows (with/without API tags)
- [ ] Remove any language implying iSupply is skill-specific

---

## Confirmation Request

**Please confirm:**
1. ✅ You understand iSupply is general-purpose (not skill-specific)
2. ✅ You understand parameters are from Gemini docs (not skill requirements)
3. ✅ You understand API tag parser is optional convenience feature
4. ✅ Phase 1 implementation can proceed as planned

**Once confirmed, we will:**
1. Deploy Phase 1 to production (this week)
2. Begin Phase 2 implementation (next sprint)
3. Update documentation (both iSupply and skill docs)

---

**END OF CLARIFICATION**

---

## Appendix: Gemini API Documentation References

### Official Gemini Image Generation Docs

**URL:** https://ai.google.dev/gemini-api/docs/image-generation

**Relevant sections:**
- Generation configuration parameters
- Image configuration options
- Safety settings
- Tool use (Google Search grounding)

### GenerationConfig Parameters (Official)

From Gemini API docs:

```typescript
interface GenerationConfig {
  temperature?: number;        // 0.0-2.0, controls randomness
  topP?: number;              // 0.0-1.0, nucleus sampling
  topK?: number;              // 1-100, vocabulary breadth
  candidateCount?: number;    // 1-4, number of variants
  maxOutputTokens?: number;   // max tokens in response
  stopSequences?: string[];   // sequences that stop generation
  seed?: number;              // integer, deterministic output
  responseModalities?: string[]; // ["TEXT", "IMAGE"]
  // ... other parameters
}
```

**Source:** https://ai.google.dev/api/generate-content#generationconfig

### ImageConfig Parameters (Official)

From Gemini API docs:

```typescript
interface ImageConfig {
  aspectRatio?: string;       // "16:9", "9:16", "4:5", "1:1"
  imageSize?: string;         // "512", "1K", "2K", "4K"
  mediaResolution?: string;   // "media_resolution_high", etc.
}
```

**Source:** https://ai.google.dev/gemini-api/docs/image-generation#image-config

### Tools (Official)

From Gemini API docs:

```typescript
interface Tools {
  googleSearch?: {
    searchTypes?: {
      imageSearch?: {};
    };
  };
}
```

**Source:** https://ai.google.dev/gemini-api/docs/grounding

---

**Document Version:** 1.0  
**Last Updated:** 2026-04-19  
**Status:** Ready for Review
