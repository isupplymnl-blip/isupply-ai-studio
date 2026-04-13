import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, readFile } from 'fs/promises';
import path from 'path';
import { GoogleGenAI, type Part, type Content, type GenerateContentResponse } from '@google/genai';
import { findMatchingImages } from '../../../lib/tagMatcher';
import { getGeneratedDir, makeGeneratedUrl, urlToFilePath } from '../../../lib/storage';

// ─── Model map ────────────────────────────────────────────────────────────────
// Gemini 3.1 Flash Image series (v1beta image-generation capable)
// gemini-2.5-flash-preview-05-20 is text-only — excluded intentionally
const GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image-preview';

const MODEL_MAP: Record<string, string> = {
  'Flash':     'gemini-3.1-flash-image-preview', // Nano Banana 2 (primary)
  'Pro':       'gemini-3-pro-image-preview',      // Nano Banana Pro
  'Standard':  'gemini-2.5-flash-image',          // Nano Banana Standard
};

function resolveModel(label?: string): string {
  if (!label) return GEMINI_IMAGE_MODEL;
  return MODEL_MAP[label] ?? label;
}

// ─── 503 retry with Pro fallback ─────────────────────────────────────────────

function is503Error(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return (
    lower.includes('503') ||
    lower.includes('overloaded') ||
    lower.includes('service unavailable') ||
    lower.includes('unavailable') ||
    (typeof err === 'object' && err !== null &&
      ((err as Record<string, unknown>).status === 503 ||
       (err as Record<string, unknown>).statusCode === 503))
  );
}

async function generateWithFallback(
  ai: GoogleGenAI,
  params: Parameters<typeof ai.models.generateContent>[0],
): Promise<GenerateContentResponse> {
  try {
    return await ai.models.generateContent(params);
  } catch (err) {
    if (!is503Error(err)) throw err;

    const proModel = MODEL_MAP['Pro'];
    if (params.model === proModel) throw err; // already on Pro, cannot fall back further

    console.warn(`[generate] 503 on model=${params.model as string} — retrying with Pro model (${proModel})…`);
    await new Promise(r => setTimeout(r, 1500));
    return await ai.models.generateContent({ ...params, model: proModel });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAI(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set in .env.local');
  return new GoogleGenAI({ apiKey });
}

/** Save a base64 PNG to the generated images directory and return its URL. */
async function persistImage(base64: string): Promise<string> {
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
  const outDir   = getGeneratedDir();
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, filename), Buffer.from(base64, 'base64'));
  return makeGeneratedUrl(filename);
}

/** Read a local URL or remote URL and return a raw base64 string. */
async function toBase64(urlOrPath: string): Promise<string> {
  if (urlOrPath.startsWith('/')) {
    const buf = await readFile(urlToFilePath(urlOrPath));
    return buf.toString('base64');
  }
  const res = await fetch(urlOrPath);
  if (!res.ok) throw new Error(`Failed to fetch reference image: ${res.status} ${urlOrPath}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer).toString('base64');
}

/** Map resolution label → Gemini imageSize string. */
function geminiSize(resolution: string): string {
  const map: Record<string, string> = { '4K': '4K', '2K': '2K', '1K': '1K', '512px': '512' };
  return map[resolution] ?? '1K';
}

/** Derive MIME type from file extension, defaulting to image/jpeg. */
function mimeFromUrl(url: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'png')  return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif')  return 'image/gif';
  return 'image/jpeg';
}

// ─── Safety settings mapper ───────────────────────────────────────────────────

type SafetyThreshold = 'BLOCK_NONE' | 'BLOCK_ONLY_HIGH' | 'BLOCK_MEDIUM_AND_ABOVE' | 'BLOCK_LOW_AND_ABOVE';

function buildSafetySettings(threshold: SafetyThreshold) {
  const categories = [
    'HARM_CATEGORY_HARASSMENT',
    'HARM_CATEGORY_HATE_SPEECH',
    'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    'HARM_CATEGORY_DANGEROUS_CONTENT',
  ];
  return categories.map(category => ({ category, threshold }));
}

// ─── Fail-safe response parser ────────────────────────────────────────────────

interface ParsedResponse {
  imageData: string;
  textHint?: string;
}

function parseImageResponse(response: GenerateContentResponse): ParsedResponse {
  const candidate = response.candidates?.[0];
  const parts: Part[] = candidate?.content?.parts ?? [];

  // Log debug info to server console for every response
  console.log('[generate] finishReason:', candidate?.finishReason ?? 'unknown');
  if (candidate?.safetyRatings?.length) {
    console.log('[generate] safetyRatings:', JSON.stringify(candidate.safetyRatings));
  }

  const finishReason = candidate?.finishReason ?? 'UNKNOWN';

  // 1. Text safety refusal
  if (finishReason === 'SAFETY') {
    const blocked = candidate?.safetyRatings
      ?.filter(r => r.blocked)
      .map(r => String(r.category).replace('HARM_CATEGORY_', ''))
      .join(', ');
    throw new Error(
      `Prompt blocked by Gemini text safety filters` +
      (blocked ? ` (${blocked})` : '') +
      `. Try rephrasing — avoid overly specific body, violence, or sensitive terms.`
    );
  }

  // 2. Image safety refusal — Gemini generates then rejects the image itself
  if (finishReason === 'IMAGE_SAFETY') {
    throw new Error(
      `Generated image rejected by Gemini image safety filters (IMAGE_SAFETY). ` +
      `The prompt text was accepted but the resulting image was flagged. ` +
      `Try: simplify your scene description, remove style/body/environment descriptors, ` +
      `or switch to a different aspect ratio. Changing the model (Flash → Standard) may also help.`
    );
  }

  // 3. Find image part — do NOT assume index 0; Gemini often leads with a text explanation
  const imagePart = parts.find(p => p.inlineData?.data && p.inlineData.mimeType?.startsWith('image/'));

  // 4. Capture text part for error context / debugging
  const textHint = parts.find(p => typeof p.text === 'string' && p.text.trim())?.text;

  if (!imagePart?.inlineData?.data) {
    if (textHint) {
      throw new Error(
        `Gemini returned text instead of an image (finishReason: ${finishReason}): ` +
        `"${textHint.slice(0, 300)}"`
      );
    }
    throw new Error(
      `Generation returned no image (finishReason: ${finishReason}). ` +
      `Verify your GEMINI_API_KEY has image generation access enabled at ai.google.dev.`
    );
  }

  return { imageData: imagePart.inlineData.data, textHint };
}

// ─── POST /api/generate ───────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      prompt: string;
      nodeId: string;
      type?: 'slide' | 'model-creation';
      settings?: Record<string, unknown>;
      referenceUrls?: string[];
    };

    const { prompt, nodeId, type, settings = {}, referenceUrls = [] } = body;

    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const ai    = getAI();
    const model = resolveModel(settings.model as string | undefined);

    console.log(`[generate] model=${model} type=${type ?? 'slide'} nodeId=${nodeId}`);

    // ── Model Creation path (text-only → 16:9 four-panel composite) ───────────
    if (type === 'model-creation') {
      const textPrompt = buildModelPrompt(prompt, settings);
      const contents: Content[] = [{ role: 'user', parts: [{ text: textPrompt }] }];

      const temperature     = typeof settings.temperature === 'number' ? settings.temperature : 1.0;
      const includeThoughts = settings.includeThoughts !== false;
      const safetyThresh    = (settings.safetyThreshold as SafetyThreshold | undefined) ?? 'BLOCK_MEDIUM_AND_ABOVE';

      const geminiConfig = {
        temperature,
        responseModalities: ['TEXT', 'IMAGE'],
        thinkingConfig: { includeThoughts },
        imageConfig: { aspectRatio: '16:9', imageSize: '1K', mediaResolution: 'media_resolution_high' },
        safetySettings: buildSafetySettings(safetyThresh),
      };

      console.log(`[generate] ── REQUEST TO GOOGLE GEMINI API ──`);
      console.log(`[generate] model: ${model}`);
      console.log(`[generate] config:`, JSON.stringify(geminiConfig, null, 2));
      console.log(`[generate] parts: [text prompt — ${textPrompt.length} chars, no reference images]`);

      const t0 = Date.now();
      const response = await generateWithFallback(ai, {
        model,
        contents,
        config: geminiConfig as Parameters<typeof ai.models.generateContent>[0]['config'],
      });
      const gemini_ms = Date.now() - t0;

      const candidate     = response.candidates?.[0];
      const responseParts = candidate?.content?.parts ?? [];
      const imageParts    = responseParts.filter(p => p.inlineData?.mimeType?.startsWith('image/'));
      const textParts     = responseParts.filter(p => typeof p.text === 'string' && p.text.trim());
      const usage         = response.usageMetadata ?? {};

      console.log(`[generate] ── RESPONSE FROM GOOGLE GEMINI API (${gemini_ms}ms) ──`);
      console.log(`[generate] finishReason: ${candidate?.finishReason ?? 'unknown'}`);
      console.log(`[generate] ── TOKEN USAGE (proves mediaResolution is applied) ──`);
      console.log(`[generate] usageMetadata:`, JSON.stringify(usage, null, 2));
      console.log(`[generate] ── THINKING (proves thinkingConfig.includeThoughts worked) ──`);
      console.log(`[generate] thought parts returned: ${textParts.length}`);
      if (textParts.length > 0) {
        textParts.forEach((p, i) => {
          console.log(`[generate] thought[${i}] (first 300 chars): "${(p.text ?? '').slice(0, 300)}"`);
        });
      } else {
        console.log(`[generate] ⚠ No thought parts — thinkingConfig may not have been applied`);
      }
      console.log(`[generate] ── IMAGE OUTPUT ──`);
      console.log(`[generate] images returned: ${imageParts.length} (${
        imageParts.map(p => `${p.inlineData?.mimeType}, ${Math.round((p.inlineData?.data?.length ?? 0) * 0.75 / 1024)}KB`).join(', ')
      })`);
      console.log(`[generate] ── SAFETY RATINGS (proves safetySettings threshold was applied) ──`);
      if (candidate?.safetyRatings?.length) {
        console.log(`[generate] safetyRatings:`, JSON.stringify(candidate.safetyRatings, null, 2));
      } else {
        console.log(`[generate] no safetyRatings returned`);
      }

      const { imageData } = parseImageResponse(response);
      const imageUrl = await persistImage(imageData);
      return NextResponse.json({ success: true, imageUrl, nodeId });
    }

    // ── Slide generation path (text + optional reference images → output) ──────
    const matchedImages = await findMatchingImages(prompt);

    // Merge canvas-connected reference images with tag-matched ones.
    const explicitRefs = (referenceUrls as string[])
      .filter(url => !matchedImages.find(m => m.url === url))
      .map(url => ({ url, name: 'canvas-reference', matchedTags: [] as string[] }));
    const allImages = [...explicitRefs, ...matchedImages].slice(0, 14);

    const aspectRatio = (settings.aspectRatio as string | undefined) ?? '4:5';
    const imageSize     = geminiSize((settings.resolution as string | undefined) ?? '1K');
    const textPrompt    = buildSlidePrompt(prompt, settings, matchedImages, aspectRatio);

    // Part 1: text prompt (must come first per v1beta spec)
    const parts: Part[] = [{ text: textPrompt }];

    // Parts 2-N: reference images as inlineData (max 14 to stay within token budget)
    for (const img of allImages) {
      try {
        const data     = await toBase64(img.url);
        const mimeType = mimeFromUrl(img.url);
        parts.push({ inlineData: { mimeType, data } });
      } catch (refErr) {
        console.warn('[generate] skipping inaccessible reference:', img.url,
          refErr instanceof Error ? refErr.message : refErr);
      }
    }

    const contents: Content[] = [{ role: 'user', parts }];

    const temperature     = typeof settings.temperature === 'number' ? settings.temperature : 1.0;
    const includeThoughts = settings.includeThoughts !== false;
    const mediaRes        = (settings.mediaResolution as string | undefined) ?? 'media_resolution_high';
    const safetyThresh    = (settings.safetyThreshold as SafetyThreshold | undefined) ?? 'BLOCK_MEDIUM_AND_ABOVE';

    const geminiConfig = {
      temperature,
      responseModalities: ['TEXT', 'IMAGE'],
      thinkingConfig: { includeThoughts },
      imageConfig: { aspectRatio, imageSize, mediaResolution: mediaRes },
      safetySettings: buildSafetySettings(safetyThresh),
    };

    const refSummary = parts
      .map((p, i) => i === 0
        ? `text(${(p.text ?? '').length} chars)`
        : `image(${p.inlineData?.mimeType ?? '?'}, ${Math.round(((p.inlineData?.data?.length ?? 0) * 0.75) / 1024)}KB)`
      ).join(', ');

    console.log(`[generate] ── REQUEST TO GOOGLE GEMINI API ──`);
    console.log(`[generate] model: ${model}`);
    console.log(`[generate] config:`, JSON.stringify(geminiConfig, null, 2));
    console.log(`[generate] parts: [${refSummary}]`);

    const t0 = Date.now();
    const response = await generateWithFallback(ai, {
      model,
      contents,
      config: geminiConfig as Parameters<typeof ai.models.generateContent>[0]['config'],
    });
    const gemini_ms = Date.now() - t0;

    const candidate = response.candidates?.[0];
    const responseParts = candidate?.content?.parts ?? [];
    const thoughtPart   = responseParts.find(p => typeof p.text === 'string' && p.text.trim() && !responseParts.find(x => x.inlineData)?.inlineData);
    const imageParts    = responseParts.filter(p => p.inlineData?.mimeType?.startsWith('image/'));
    const textParts     = responseParts.filter(p => typeof p.text === 'string' && p.text.trim());
    const usage         = response.usageMetadata ?? {};

    console.log(`[generate] ── RESPONSE FROM GOOGLE GEMINI API (${gemini_ms}ms) ──`);
    console.log(`[generate] finishReason: ${candidate?.finishReason ?? 'unknown'}`);
    console.log(`[generate] ── TOKEN USAGE (proves mediaResolution is applied) ──`);
    console.log(`[generate] usageMetadata:`, JSON.stringify(usage, null, 2));
    console.log(`[generate] ── THINKING (proves thinkingConfig.includeThoughts worked) ──`);
    console.log(`[generate] thought parts returned: ${textParts.length}`);
    if (textParts.length > 0) {
      textParts.forEach((p, i) => {
        console.log(`[generate] thought[${i}] (first 300 chars): "${(p.text ?? '').slice(0, 300)}"`);
      });
    } else {
      console.log(`[generate] ⚠ No thought parts — thinkingConfig may not have been applied`);
    }
    console.log(`[generate] ── IMAGE OUTPUT ──`);
    console.log(`[generate] images returned: ${imageParts.length} (${
      imageParts.map(p => `${p.inlineData?.mimeType}, ${Math.round((p.inlineData?.data?.length ?? 0) * 0.75 / 1024)}KB`).join(', ')
    })`);
    console.log(`[generate] ── SAFETY RATINGS (proves safetySettings threshold was applied) ──`);
    if (candidate?.safetyRatings?.length) {
      console.log(`[generate] safetyRatings:`, JSON.stringify(candidate.safetyRatings, null, 2));
    } else {
      console.log(`[generate] no safetyRatings returned`);
    }

    const { imageData, textHint } = parseImageResponse(response);

    if (textHint) {
      console.log('[generate] model text alongside image:', textHint.slice(0, 200));
    }

    const imageUrl = await persistImage(imageData);
    return NextResponse.json({
      success: true,
      imageUrl,
      matchedRefs: allImages.map(m => m.name),
      nodeId,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[generate] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

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
  return `${refDesc}${prompt}. ${ratioHint}${neg ? ` AVOID: ${neg}.` : ''} Photorealistic, ultra high quality, professional product photography.`;
}

function detectModelCount(description: string): 1 | 2 {
  const lower = description.toLowerCase();
  return /\b(two models?|2 models?|both models?|model 1\b[\s\S]{0,80}\bmodel 2\b|(male|man|boy)[\s\S]{0,80}(female|woman|girl)|(female|woman|girl)[\s\S]{0,80}(male|man|boy)|first model\b[\s\S]{0,80}\bsecond model\b)\b/.test(lower) ? 2 : 1;
}

function buildModelPrompt(description: string, settings: Record<string, unknown>): string {
  const style  = (settings.style      as string | undefined) ?? 'realistic commercial photography';
  const light  = (settings.lighting   as string | undefined) ?? 'professional studio lighting';
  const bg     = (settings.background as string | undefined) ?? 'pure white';
  if (detectModelCount(description) === 2) {
    return `Create a professional composite image with FOUR panels in a single 16:9 frame showing TWO models, each from two angles.
Panels layout (left to right): [Model 1 Front view] [Model 1 Back view] [Model 2 Front view] [Model 2 Back view].
Models: ${description}.
Style: ${style}. Lighting: ${light}. Background: ${bg}.
Each model must be visually consistent across their two panels. Ultra high quality, sharp details, professional fashion photography.`;
  }
  return `Create a professional composite image with FOUR panels in a single 16:9 frame showing the same model from four angles.
Panels layout (left to right): [Front view] [3/4 angle] [Side profile] [Rear view].
Model: ${description}.
Style: ${style}. Lighting: ${light}. Background: ${bg}.
All panels must show the same person with consistent appearance. Ultra high quality, sharp details, professional fashion photography.`;
}
