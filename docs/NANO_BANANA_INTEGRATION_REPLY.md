# Nano Banana Integration Plan — Reply

**Date:** 2026-04-19  
**Status:** ✅ Reviewed  
**Decision:** Proceed with phased rollout

---

## Executive Approval

**Approved phases:**
- ✅ **Phase 1** (seed + topK + API tag parser) — START IMMEDIATELY
- ✅ **Phase 2** (Seed Explorer UI) — Queue after Phase 1
- ⏸️ **Phase 3** (SettingNode + multi-turn) — DEFER until user demand confirmed
- ✅ **Phase 4** (prompt wrapper cleanup) — Bundle with Phase 1

**Timeline:**
- Phase 1 + 4: **2-3 days** (this week)
- Phase 2: **1 week** (next sprint)
- Phase 3: **TBD** (backlog)

---

## Answers to Discussion Questions

### 1. candidateCount vs Seed Explorer
**Decision:** **Seed Explorer** (Phase 2 approach)

**Rationale:**
- Seed variants = reproducible, controllable, documentable
- `candidateCount` = random variations, no control over what changes
- Skill already documents seed exploration strategy (seed+1, +7, +13)
- Simpler UI: buttons vs multi-image picker
- Better for iteration: "I like seed 49, now try +1 from there"

**Action:** Implement Seed Explorer buttons in OutputNode (Phase 2)

---

### 2. Scene-type presets
**Decision:** **YES — but simplified**

**Rationale:**
- Reduces cognitive load for non-technical users
- Aligns with skill's tuning profiles
- Easy to implement (just a dropdown + preset map)

**Modification:** Start with 3 presets only (not 5)
- **Studio** (temp=0.7, topP=0.93, topK=32) — product-focused, controlled
- **Lifestyle** (temp=1.0, topP=0.97, topK=40) — natural, editorial
- **Creative** (temp=1.2, topP=0.98, topK=50) — high variation, experimental

**Action:** Add to Phase 2 (low effort, high UX value)

---

### 3. SettingNode priority
**Decision:** **DEFER to Phase 3** (build only if users request it)

**Rationale:**
- High implementation cost (new node type, composite generation, tag system)
- Unclear user demand — no one has asked for background-only generation yet
- Current workflow (full scene generation) works fine
- Can be added later without breaking changes

**Alternative:** Use existing PromptNode with setting-only prompts
- User pastes Agent 3 output into PromptNode
- Manually append "no people, no products, background plate only"
- Generate → save to library
- Connect as reference to next PromptNode

**Action:** Document workaround in skill guide, defer node implementation

---

### 4. Multi-turn refinement
**Decision:** **DEFER to Phase 3** (low priority)

**Rationale:**
- Complex implementation (chat session management, history storage)
- Only works with Gemini direct (not Pudding/Ecco)
- Current workflow (regenerate with adjusted prompt) is acceptable
- Real need unclear — users haven't complained about lack of refinement

**Alternative:** "Refinement prompt" pattern
- User generates image
- Copies prompt to new PromptNode
- Appends refinement instruction: "same as previous but warmer lighting"
- Connects original OutputNode as reference image
- Generates → Gemini sees original + instruction

**Action:** Document refinement pattern in skill guide, defer RefinementNode

---

### 5. Prompt wrapper
**Decision:** **Always strip for Director prompts** (no toggle)

**Rationale:**
- Director prompts already include quality tags → wrapper is redundant noise
- Auto-detection is reliable (Hasselblad + 8K + anatomically correct)
- User-written prompts still get wrapper → backward compatible
- Toggle adds UI complexity for edge case

**Action:** Implement auto-detection in Phase 1 (bundled with other changes)

---

## Phase 1 Implementation Spec (START NOW)

### 1.1 Type Changes

**File:** `types/index.ts` or `app/types/index.ts`
```typescript
interface NodeSettings {
  // Existing
  model?: string;
  temperature?: number;
  topP?: number;
  resolution?: string;
  aspectRatio?: string;
  negativePrompt?: string;
  useGoogleSearch?: boolean;
  useImageSearch?: boolean;
  
  // NEW — Phase 1
  topK?: number;              // 1-100, vocabulary breadth
  seed?: number;              // integer, deterministic output
  scenePreset?: string;       // Phase 2: 'studio' | 'lifestyle' | 'creative'
}
```

---

### 1.2 API Route Changes

**File:** `app/api/generate/route.ts`

**Location:** Line ~405-415 (inside generationConfig)
```typescript
const geminiConfig = {
  temperature,
  ...(topP !== undefined ? { topP } : {}),
  ...(topK !== undefined ? { topK } : {}),        // ADD THIS
  ...(seed !== undefined ? { seed } : {}),        // ADD THIS
  responseModalities: ['TEXT', 'IMAGE'],
  thinkingConfig: { includeThoughts, ...(incomingThoughtSig ? { thoughtSignature: incomingThoughtSig } : {}) },
  imageConfig: { aspectRatio, imageSize, mediaResolution: mediaRes },
  safetySettings: buildSafetySettings(safetyThresh),
  ...(searchTools ? { tools: searchTools } : {}),
};
```

**Location:** Line ~397-400 (extract from settings)
```typescript
const temperature     = typeof settings.temperature === 'number' ? settings.temperature : 1.0;
const topP            = typeof settings.topP === 'number' ? settings.topP : undefined;
const topK            = typeof settings.topK === 'number' ? settings.topK : undefined;        // ADD THIS
const seed            = typeof settings.seed === 'number' && Number.isFinite(settings.seed) ? Math.round(settings.seed) : undefined;  // ADD THIS
```

**Repeat for:**
- `app/api/pudding/generate/route.ts` (same locations)
- `app/api/ecco/generate/route.ts` (if exists)

---

### 1.3 Prompt Wrapper Cleanup

**File:** `app/api/generate/route.ts` (and pudding, ecco)

**Location:** Line ~523-538 (buildSlidePrompt function)
```typescript
function buildSlidePrompt(
  prompt: string,
  settings: Record<string, unknown>,
  refs: Array<{ name: string; matchedTags: string[] }>,
  aspectRatio: string,
): string {
  const neg     = settings.negativePrompt as string | undefined;
  const refDesc = refs.length
    ? `Use the attached reference image(s) (${refs.map(r => `"${r.name}"`).join(', ')}) for accurate product representation. `
    : '';
  const ratioHint =
    aspectRatio === '16:9' ? 'Wide 16:9 landscape format.' :
    aspectRatio === '9:16' ? 'Vertical 9:16 portrait format.' :
    aspectRatio === '1:1'  ? 'Square 1:1 format.' :
                             '4:5 portrait ratio.';
  
  // NEW — detect Director prompts, skip quality wrapper
  const isDirectorPrompt = prompt.includes('Hasselblad') || 
                           prompt.includes('8K resolution') ||
                           prompt.includes('anatomically correct');
  
  const qualityTail = isDirectorPrompt 
    ? '' 
    : ' Photorealistic, ultra high quality, professional product photography.';
  
  return `${refDesc}${prompt}. ${ratioHint}${neg ? ` AVOID: ${neg}.` : ''}${qualityTail}`;
}
```

---

### 1.4 API Tag Parser

**File:** `app/components/nodes/PromptNode.tsx`

**Location:** Add helper function at top of file
```typescript
interface APIConfig {
  model?: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  seed?: number;
  sceneType?: string;
}

function parseAPITag(prompt: string): APIConfig | null {
  const match = prompt.match(/^\[API:\s*(.+?)\]/);
  if (!match) return null;
  
  const config: APIConfig = {};
  const pairs = match[1].split(',').map(p => p.trim());
  
  for (const pair of pairs) {
    const [key, value] = pair.split('=').map(s => s.trim());
    
    if (key === 'model') {
      // Map Gemini model names to app model selector
      if (value.includes('flash')) config.model = 'Flash';
      else if (value.includes('pro')) config.model = 'Pro';
      else if (value.includes('standard')) config.model = 'Standard';
    }
    else if (key === 'temp' || key === 'temperature') {
      config.temperature = parseFloat(value);
    }
    else if (key === 'topP') {
      config.topP = parseFloat(value);
    }
    else if (key === 'topK') {
      config.topK = parseInt(value, 10);
    }
    else if (key === 'seed') {
      config.seed = parseInt(value, 10);
    }
    else if (key === 'sceneType') {
      config.sceneType = value;
    }
  }
  
  return config;
}
```

**Location:** Inside PromptNode component, modify prompt change handler
```typescript
const handlePromptChange = (newPrompt: string) => {
  // Parse API tag if present
  const apiConfig = parseAPITag(newPrompt);
  
  if (apiConfig) {
    // Auto-fill settings from API tag
    const updatedSettings: Partial<NodeSettings> = ;
    if (apiConfig.model) updatedSettings.model = apiConfig.model;
    if (apiConfig.temperature !== undefined) updatedSettings.temperature = apiConfig.temperature;
    if (apiConfig.topP !== undefined) updatedSettings.topP = apiConfig.topP;
    if (apiConfig.topK !== undefined) updatedSettings.topK = apiConfig.topK;
    if (apiConfig.seed !== undefined) updatedSettings.seed = apiConfig.seed;
    if (apiConfig.sceneType) updatedSettings.scenePreset = apiConfig.sceneType;
    
    // Update node settings
    onUpdateSettings(id, updatedSettings);
    
    // Show toast notification
    const filledParams = Object.keys(updatedSettings).join(', ');
    toast.success(`⚡ Auto-filled: ${filledParams}`);
  }
  
  // Strip [API: ...] tag before storing prompt
  const cleanPrompt = newPrompt.replace(/^\[API:\s*.+?\]\n?/, '');
  setPrompt(cleanPrompt);
  onUpdateData(id, { prompt: cleanPrompt });
};
```

---

### 1.5 Settings Panel UI

**File:** `app/components/SettingsPanel.tsx` (or wherever settings UI lives)

**Add after topP input:**
```typescript
{/* Top K */}
<div className="setting-row">
  <label htmlFor="topK">
    Top K
    <span className="tooltip" title="Vocabulary breadth. Higher = more diverse concepts. Range: 1-100.">
      ⓘ
    </span>
  </label>
  <input
    id="topK"
    type="number"
    min="1"
    max="100"
    step="1"
    placeholder="40"
    value={settings.topK ?? ''}
    onChange={(e) => {
      const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
      onUpdateSettings({ topK: val });
    }}
  />
</div>

{/* Seed */}
<div className="setting-row">
  <label htmlFor="seed">
    Seed
    <span className="tooltip" title="Deterministic output. Same seed = same image. Integer 0-2147483647.">
      ⓘ
    </span>
  </label>
  <div className="seed-input-group">
    <input
      id="seed"
      type="number"
      min="0"
      max="2147483647"
      step="1"
      placeholder="Random"
      value={settings.seed ?? ''}
      onChange={(e) => {
        const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
        onUpdateSettings({ seed: val });
      }}
    />
    <button
      className="random-seed-btn"
      onClick={() => {
        const randomSeed = Math.floor(Math.random() * 2147483647);
        onUpdateSettings({ seed: randomSeed });
      }}
      title="Generate random seed"
    >
      🎲
    </button>
  </div>
</div>
```

**CSS for seed input group:**
```css
.seed-input-group {
  display: flex;
  gap: 4px;
}

.seed-input-group input {
  flex: 1;
}

.random-seed-btn {
  padding: 4px 8px;
  font-size: 16px;
  cursor: pointer;
}
```

---

## Phase 1 Testing Checklist

### Seed Tests
- [ ] Set seed=42, generate image A
- [ ] Set seed=42 again, generate image B
- [ ] Verify A and B are identical (pixel-perfect match)
- [ ] Set seed=43, generate image C
- [ ] Verify C is different from A/B
- [ ] Leave seed blank, generate twice, verify different outputs

### TopK Tests
- [ ] Set topK=20, generate 5 images, observe vocabulary
- [ ] Set topK=80, generate 5 images, observe vocabulary
- [ ] Verify topK=80 produces more diverse concepts than topK=20

### API Tag Parser Tests
- [ ] Paste Director prompt with `[API: model=Flash, temp=1.0, topP=0.97, topK=40, seed=42]`
- [ ] Verify settings panel auto-fills: model=Flash, temp=1.0, topP=0.97, topK=40, seed=42
- [ ] Verify toast notification shows: "⚡ Auto-filled: model, temperature, topP, topK, seed"
- [ ] Verify `[API: ...]` tag is stripped from stored prompt
- [ ] Generate image, verify backend receives clean prompt (no `[API: ...]` tag)

### Prompt Wrapper Tests
- [ ] Paste Director prompt (contains "Hasselblad"), generate
- [ ] Check backend logs, verify NO quality wrapper appended
- [ ] Paste user-written prompt (no "Hasselblad"), generate
- [ ] Check backend logs, verify quality wrapper appended

### Backward Compatibility Tests
- [ ] Load old node with `seed: "42"` (string), verify auto-converts to number
- [ ] Load old node with no topK, verify defaults to undefined
- [ ] Generate with old prompt (no API tag), verify works as before

---

## Phase 2 Implementation Spec (NEXT SPRINT)

### 2.1 Seed Explorer UI

**File:** `app/components/nodes/OutputNode.tsx`

**Location:** Add below generated image display
```typescript
{/* Seed Explorer */}
{imageUrl && settings.seed !== undefined && (
  <div className="seed-explorer">
    <div className="seed-explorer-header">
      <span className="seed-label">Current seed: {settings.seed}</span>
      <span className="seed-hint">Explore variants:</span>
    </div>
    <div className="seed-buttons">
      <button
        className="seed-btn seed-btn-base"
        onClick={() => regenerateWithSeed(settings.seed!)}
        title="Regenerate with same seed"
      >
        {settings.seed}
      </button>
      <button
        className="seed-btn seed-btn-variant"
        onClick={() => regenerateWithSeed(settings.seed! + 1)}
        title="Minor pose/expression shift"
      >
        +1
      </button>
      <button
        className="seed-btn seed-btn-variant"
        onClick={() => regenerateWithSeed(settings.seed! + 2)}
        title="Hair/wind movement"
      >
        +2
      </button>
      <button
        className="seed-btn seed-btn-variant"
        onClick={() => regenerateWithSeed(settings.seed! + 7)}
        title="Background depth shift"
      >
        +7
      </button>
      <button
        className="seed-btn seed-btn-variant"
        onClick={() => regenerateWithSeed(settings.seed! + 13)}
        title="Lighting angle change"
      >
        +13
      </button>
    </div>
    <p className="seed-guide">
      +1: minor pose · +2: hair/wind · +7: background · +13: lighting
    </p>
  </div>
)}

function regenerateWithSeed(newSeed: number) {
  // Update node settings with new seed
  onUpdateSettings(id, { seed: newSeed });
  
  // Trigger regeneration (reuse existing generate logic)
  handleGenerate();
}
```

**CSS:**
```css
.seed-explorer {
  margin-top: 12px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 8px;
}

.seed-explorer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
  color: #666;
}

.seed-label {
  font-weight: 600;
}

.seed-buttons {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.seed-btn {
  flex: 1;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: white;
  cursor: pointer;
  transition: all 0.2s;
}

.seed-btn:hover {
  background: #f5f5f5;
  border-color: #999;
}

.seed-btn-base {
  background: #e3f2fd;
  border-color: #2196f3;
  color: #1976d2;
}

.seed-btn-variant {
  background: white;
}

.seed-guide {
  margin: 0;
  font-size: 11px;
  color: #999;
  text-align: center;
}
```

---

### 2.2 Scene Presets

**File:** `app/components/SettingsPanel.tsx`

**Add at top of settings panel (before temperature):**
```typescript
{/* Scene Preset */}
<div className="setting-row">
  <label htmlFor="scenePreset">
    Scene Type
    <span className="tooltip" title="Quick presets for common scene types. Auto-fills temperature, topP, topK.">
      ⓘ
    </span>
  </label>
  <select
    id="scenePreset"
    value={settings.scenePreset ?? 'custom'}
    onChange={(e) => {
      const preset = e.target.value;
      onUpdateSettings({ scenePreset: preset });
      
      // Apply preset values
      if (preset === 'studio') {
        onUpdateSettings({ temperature: 0.7, topP: 0.93, topK: 32 });
      } else if (preset === 'lifestyle') {
        onUpdateSettings({ temperature: 1.0, topP: 0.97, topK: 40 });
      } else if (preset === 'creative') {
        onUpdateSettings({ temperature: 1.2, topP: 0.98, topK: 50 });
      }
      // 'custom' = no auto-fill, user enters manually
    }}
  >
    <option value="custom">Custom</option>
    <option value="studio">Studio (controlled, product-focused)</option>
    <option value="lifestyle">Lifestyle (natural, editorial)</option>
    <option value="creative">Creative (high variation)</option>
  </select>
</div>
```

---

## Migration Notes

### For Existing Nodes
- Old nodes with `seed: string` → auto-convert to `number` on load
- Old nodes with no `topK` → leave undefined (Gemini uses default)
- Old nodes with no `scenePreset` → default to 'custom'

### For Skill Integration
- Director skill updated to output `[API: ...]` tag with all params
- Users paste Director output → settings auto-fill
- No manual parameter entry needed

---

## Documentation Updates Needed

### User Guide
- [ ] "How to use Seed Explorer for variations"
- [ ] "Understanding scene presets"
- [ ] "Pasting Director prompts (auto-fill)"

### Developer Guide
- [ ] API tag format specification
- [ ] Scene preset tuning profiles
- [ ] Seed exploration strategy

### Changelog
- [ ] "Added seed and topK support for reproducible generations"
- [ ] "Added API tag parser for auto-fill from skill output"
- [ ] "Added Seed Explorer UI for quick variations"
- [ ] "Added scene type presets (Studio, Lifestyle, Creative)"

---

## Rollout Plan

### Week 1 (Phase 1)
- **Day 1-2:** Implement type changes, API route changes, prompt wrapper cleanup
- **Day 3:** Implement API tag parser, settings panel UI
- **Day 4:** Testing (all Phase 1 tests)
- **Day 5:** Deploy to staging, user acceptance testing

### Week 2 (Phase 2)
- **Day 1-2:** Implement Seed Explorer UI
- **Day 3:** Implement scene presets
- **Day 4-5:** Testing, documentation, deploy to production

### Future (Phase 3 — TBD)
- SettingNode (if user demand confirmed)
- Multi-turn refinement (if user demand confirmed)

---

## Success Metrics

### Phase 1
- ✅ 100% of Director prompts auto-fill settings correctly
- ✅ Seed reproducibility: same seed = identical output
- ✅ No quality wrapper on Director prompts
- ✅ Zero breaking changes for existing nodes

### Phase 2
- ✅ 80%+ of users try Seed Explorer within first week
- ✅ Average 3+ seed variants explored per generation
- ✅ Scene presets used in 50%+ of new nodes

---

## Risk Assessment

### Low Risk
- Type changes (backward compatible)
- API route changes (additive only)
- Prompt wrapper cleanup (auto-detection reliable)

### Medium Risk
- API tag parser (regex parsing can fail on malformed input)
  - **Mitigation:** Wrap in try-catch, fail silently, log error
- Seed Explorer UI (regeneration logic must not break existing flow)
  - **Mitigation:** Reuse existing generate handler, no new code paths

### High Risk
- None identified

---

## Open Questions

1. **Should seed be visible in PromptNode settings panel or only in OutputNode?**
   - **Recommendation:** Both. PromptNode = set before generation. OutputNode = see what was used + explore variants.

2. **Should API tag parser support partial tags (e.g., only `[API: seed=42]`)?**
   - **Recommendation:** Yes. Parse whatever params are present, ignore missing ones.

3. **Should scene presets be editable by user (custom presets)?**
   - **Recommendation:** Not in Phase 2. Add in Phase 3 if requested.

4. **Should Seed Explorer show preview thumbnails of variants?**
   - **Recommendation:** Not in Phase 2 (requires batch generation). Add in Phase 3 if requested.

---

## Final Approval

**Approved by:** [Your Name]  
**Date:** 2026-04-19  
**Next action:** Start Phase 1 implementation (seed + topK + API tag parser + prompt wrapper cleanup)

---

**END OF REPLY**
