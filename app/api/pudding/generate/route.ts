import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, readFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { GoogleGenAI, type Part, type Content, type GenerateContentResponse } from '@google/genai';
import { findMatchingImages } from '../../../../lib/tagMatcher';
import { getGeneratedDir, makeGeneratedUrl, urlToFilePath } from '../../../../lib/storage';

// ─── Model resolution ────────────────────────────────────────────────────────
// PuddingAPI bills per resolution — tier + resolution determine the model name.
// Model names contain Chinese characters and brackets so must be URL-encoded.
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAI(): GoogleGenAI {
  const apiKey = process.env.PUDDING_API_KEY;
  if (!apiKey) throw new Error('PUDDING_API_KEY is not set in .env.local');
  const baseUrl = process.env.PUDDING_BASE_URL ?? 'https://new.apipudding.com';
  return new GoogleGenAI({
    apiKey,
    httpOptions: { baseUrl, apiVersion: 'v1beta' },
  });
}

/** Save a base64 PNG to the generated images directory and return its URL. */
async function persistImage(base64: string): Promise<string> {
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
  const outDir   = getGeneratedDir();
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, filename), Buffer.from(base64, 'base64'));
  return makeGeneratedUrl(filename);
}

/**
 * Read a local URL or remote URL, resize to max 1024px on the longest side,
 * and return a JPEG base64 string (quality 85).
 * This keeps reference images under ~200 KB each to avoid Cloudflare 524s.
 */
async function toBase64(urlOrPath: string): Promise<{ data: string; mimeType: 'image/jpeg' }> {
  let inputBuf: Buffer;
  if (urlOrPath.startsWith('/')) {
    inputBuf = await readFile(urlToFilePath(urlOrPath));
  } else {
    const res = await fetch(urlOrPath);
    if (!res.ok) throw new Error(`Failed to fetch reference image: ${res.status} ${urlOrPath}`);
    inputBuf = Buffer.from(await res.arrayBuffer());
  }

  const outputBuf = await sharp(inputBuf)
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  return { data: outputBuf.toString('base64'), mimeType: 'image/jpeg' };
}

/** Map resolution label → imageSize string. */
function geminiSize(resolution: string): string {
  const map: Record<string, string> = { '4K': '4K', '2K': '2K', '1K': '1K', '512px': '512' };
  return map[resolution] ?? '1K';
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

  console.log('[pudding] finishReason:', candidate?.finishReason ?? 'unknown');
  if (candidate?.safetyRatings?.length) {
    console.log('[pudding] safetyRatings:', JSON.stringify(candidate.safetyRatings));
  }

  const finishReason = candidate?.finishReason ?? 'UNKNOWN';

  if (finishReason === 'SAFETY') {
    const blocked = candidate?.safetyRatings
      ?.filter(r => r.blocked)
      .map(r => String(r.category).replace('HARM_CATEGORY_', ''))
      .join(', ');
    throw new Error(
      `Prompt blocked by safety filters` +
      (blocked ? ` (${blocked})` : '') +
      `. Try rephrasing — avoid overly specific body, violence, or sensitive terms.`
    );
  }

  if (finishReason === 'IMAGE_SAFETY') {
    throw new Error(
      `Generated image rejected by image safety filters (IMAGE_SAFETY). ` +
      `The prompt text was accepted but the resulting image was flagged. ` +
      `Try: simplify your scene description, remove style/body/environment descriptors, ` +
      `or switch to a different aspect ratio.`
    );
  }

  const imagePart = parts.find(p => p.inlineData?.data && p.inlineData.mimeType?.startsWith('image/'));
  const textHint  = parts.find(p => typeof p.text === 'string' && p.text.trim())?.text;

  if (!imagePart?.inlineData?.data) {
    if (textHint) {
      throw new Error(
        `PuddingAPI returned text instead of an image (finishReason: ${finishReason}): ` +
        `"${textHint.slice(0, 300)}"`
      );
    }
    throw new Error(
      `Generation returned no image (finishReason: ${finishReason}). ` +
      `Verify your PUDDING_API_KEY has image generation access.`
    );
  }

  return { imageData: imagePart.inlineData.data, textHint };
}

// ─── SSE streaming helper ─────────────────────────────────────────────────────

const SSE_HEADERS = {
  'Content-Type':      'text/event-stream',
  'Cache-Control':     'no-cache',
  'Connection':        'keep-alive',
  'X-Accel-Buffering': 'no',   // disable Nginx/Cloudflare buffering
} as const;

/** Iterate generateContentStream chunks and extract the image. */
async function extractImageFromStream(
  stream: AsyncGenerator<GenerateContentResponse>,
): Promise<{ imageData: string; textHint?: string }> {
  let imageData: string | undefined;
  let textHint: string | undefined;

  for await (const chunk of stream) {
    const candidate = chunk.candidates?.[0];
    const parts: Part[] = candidate?.content?.parts ?? [];

    const finishReason = candidate?.finishReason;
    if (finishReason === 'SAFETY') {
      const blocked = candidate?.safetyRatings?.filter(r => r.blocked).map(r => String(r.category).replace('HARM_CATEGORY_', '')).join(', ');
      throw new Error(`Prompt blocked by safety filters${blocked ? ` (${blocked})` : ''}. Try rephrasing.`);
    }
    if (finishReason === 'IMAGE_SAFETY') {
      throw new Error('Generated image rejected by image safety filters (IMAGE_SAFETY).');
    }

    const imagePart = parts.find(p => p.inlineData?.data && p.inlineData.mimeType?.startsWith('image/'));
    if (imagePart?.inlineData?.data) imageData = imagePart.inlineData.data;

    const textPart = parts.find(p => typeof p.text === 'string' && p.text.trim());
    if (textPart?.text) textHint = textPart.text;
  }

  if (!imageData) {
    if (textHint) throw new Error(`PuddingAPI returned text instead of an image: "${textHint.slice(0, 300)}"`);
    throw new Error('Streaming generation returned no image. Verify PUDDING_API_KEY has image generation access.');
  }

  return { imageData, textHint };
}

/**
 * Open the SSE stream immediately, send the first heartbeat, then run `runner`.
 * This ensures Cloudflare receives data within the 100-second window even when
 * image pre-processing (toBase64 for large reference images) takes a long time.
 */
function sseWrap(
  runner: (send: (event: string, data: unknown) => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder();

  const body = new ReadableStream({
    async start(ctrl) {
      const send = (event: string, data: unknown) =>
        ctrl.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      // Fire the first heartbeat BEFORE any work — this is what keeps Cloudflare happy
      send('heartbeat', { ts: Date.now() });

      // Continue heartbeats every 15 s while work is in progress
      const hb = setInterval(() => send('heartbeat', { ts: Date.now() }), 15_000);

      try {
        await runner(send);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[pudding-stream] error:', message);
        send('error', { error: message });
      } finally {
        clearInterval(hb);
        ctrl.close();
      }
    },
  });

  return new Response(body, { headers: SSE_HEADERS });
}

// ─── POST /api/pudding/generate ───────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      prompt: string;
      nodeId: string;
      type?: 'slide' | 'model-creation';
      settings?: Record<string, unknown>;
      referenceUrls?: string[];
      useStreaming?: boolean;
    };

    const { prompt, nodeId, type, settings = {}, referenceUrls = [], useStreaming = false } = body;

    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const ai    = getAI();
    const model = resolvePuddingModel(
      settings.model     as string | undefined,
      settings.imageSize as string | undefined,
    );

    const useGoogleSearch = Boolean(settings.useGoogleSearch);
    const useImageSearch  = Boolean(settings.useImageSearch);
    const searchTools = useGoogleSearch
      ? [{ googleSearch: useImageSearch ? { searchTypes: { imageSearch: {} } } : {} }]
      : undefined;

    console.log(`[pudding] model=${model} type=${type ?? 'slide'} nodeId=${nodeId} search=${useGoogleSearch} imageSearch=${useImageSearch}`);

    // ── Model Creation path ──────────────────────────────────────────────────
    if (type === 'model-creation') {
      const textPrompt = buildModelPrompt(prompt, settings);
      const contents: Content[] = [{ role: 'user', parts: [{ text: textPrompt }] }];

      const temperature     = typeof settings.temperature === 'number' ? settings.temperature : 1.0;
      const topP            = typeof settings.topP === 'number' ? settings.topP : undefined;
      const includeThoughts = settings.includeThoughts !== false;
      const safetyThresh    = (settings.safetyThreshold as SafetyThreshold | undefined) ?? 'BLOCK_MEDIUM_AND_ABOVE';
      const aspectRatio     = modelCreationAspectRatio(prompt);
      const imageSize       = geminiSize((settings.imageSize as string | undefined) ?? (settings.resolution as string | undefined) ?? '1K');

      const genConfig = {
        temperature,
        ...(topP !== undefined ? { topP } : {}),
        responseModalities: ['TEXT', 'IMAGE'],
        thinkingConfig: { includeThoughts },
        imageConfig: { aspectRatio, imageSize, mediaResolution: 'media_resolution_high' },
        safetySettings: buildSafetySettings(safetyThresh),
        ...(searchTools ? { tools: searchTools } : {}),
      };

      console.log(`[pudding] ── REQUEST TO PUDDINGAPI (model-creation${useStreaming ? ', streaming' : ''}) ──`);
      console.log(`[pudding] model: ${model}`);
      console.log(`[pudding] config:`, JSON.stringify(genConfig, null, 2));

      if (useStreaming) {
        return sseWrap(async (send) => {
          console.log(`[pudding-stream] model-creation model: ${model}`);
          const t0 = Date.now();
          const stream = await ai.models.generateContentStream({
            model,
            contents,
            config: genConfig as Parameters<typeof ai.models.generateContent>[0]['config'],
          });
          const { imageData, textHint } = await extractImageFromStream(stream);
          console.log(`[pudding-stream] model-creation response received (${Date.now() - t0}ms)`);
          if (textHint) console.log('[pudding-stream] text alongside image:', textHint.slice(0, 200));
          const imageUrl = await persistImage(imageData);
          send('complete', { imageUrl, nodeId });
        });
      }

      const t0 = Date.now();
      const response = await ai.models.generateContent({
        model,
        contents,
        config: genConfig as Parameters<typeof ai.models.generateContent>[0]['config'],
      });
      console.log(`[pudding] response received (${Date.now() - t0}ms)`);

      const { imageData } = parseImageResponse(response);
      const imageUrl = await persistImage(imageData);
      return NextResponse.json({ success: true, imageUrl, nodeId });
    }

    // ── Slide generation path ────────────────────────────────────────────────

    // Shared setup (cheap — no I/O)
    const aspectRatio     = (settings.aspectRatio  as string | undefined) ?? '4:5';
    const imageSize       = geminiSize((settings.resolution as string | undefined) ?? (settings.imageSize as string | undefined) ?? '1K');
    const temperature     = typeof settings.temperature === 'number' ? settings.temperature : 1.0;
    const topP            = typeof settings.topP === 'number' ? settings.topP : undefined;
    const includeThoughts = settings.includeThoughts !== false;
    const mediaRes        = (settings.mediaResolution as string | undefined) ?? 'media_resolution_high';
    const safetyThresh    = (settings.safetyThreshold as SafetyThreshold | undefined) ?? 'BLOCK_MEDIUM_AND_ABOVE';

    /** Build contents from scratch — includes findMatchingImages + toBase64 I/O. */
    async function buildSlideContents(): Promise<{
      contents: Content[];
      allImages: Array<{ url: string; name: string; matchedTags: string[] }>;
    }> {
      const matchedImages = await findMatchingImages(prompt);

      const explicitRefs = referenceUrls
        .filter(url => !matchedImages.find(m => m.url === url))
        .map(url => ({ url, name: 'canvas-reference', matchedTags: [] as string[] }));
      const allImages = [...explicitRefs, ...matchedImages].slice(0, 14);

      const textPrompt = buildSlidePrompt(prompt, settings, matchedImages, aspectRatio);
      const parts: Part[] = [{ text: textPrompt }];

      for (const img of allImages) {
        try {
          const { data, mimeType } = await toBase64(img.url);
          parts.push({ inlineData: { mimeType, data } });
        } catch (refErr) {
          console.warn('[pudding] skipping inaccessible reference:', img.url,
            refErr instanceof Error ? refErr.message : refErr);
        }
      }

      return { contents: [{ role: 'user', parts }], allImages };
    }

    if (useStreaming) {
      return sseWrap(async (send) => {
        // Image processing happens HERE — stream is already open and heartbeats are running
        const { contents, allImages } = await buildSlideContents();

        const genConfig = {
          temperature,
          ...(topP !== undefined ? { topP } : {}),
          responseModalities: ['TEXT', 'IMAGE'],
          thinkingConfig: { includeThoughts },
          imageConfig: { aspectRatio, imageSize, mediaResolution: mediaRes },
          safetySettings: buildSafetySettings(safetyThresh),
          ...(searchTools ? { tools: searchTools } : {}),
        };

        const parts = (contents[0] as { role: string; parts: Part[] }).parts;
        const refSummary = parts
          .map((p, i) => i === 0
            ? `text(${(p.text ?? '').length} chars)`
            : `image(${p.inlineData?.mimeType ?? '?'}, ${Math.round(((p.inlineData?.data?.length ?? 0) * 0.75) / 1024)}KB)`
          ).join(', ');

        console.log(`[pudding-stream] ── REQUEST TO PUDDINGAPI (slide, streaming) ──`);
        console.log(`[pudding-stream] model: ${model}`);
        console.log(`[pudding-stream] config:`, JSON.stringify(genConfig, null, 2));
        console.log(`[pudding-stream] parts: [${refSummary}]`);

        const t0 = Date.now();
        const stream = await ai.models.generateContentStream({
          model,
          contents,
          config: genConfig as Parameters<typeof ai.models.generateContent>[0]['config'],
        });
        const { imageData, textHint } = await extractImageFromStream(stream);
        console.log(`[pudding-stream] response received (${Date.now() - t0}ms)`);

        if (textHint) console.log('[pudding-stream] text alongside image:', textHint.slice(0, 200));

        const imageUrl = await persistImage(imageData);
        send('complete', { imageUrl, nodeId, matchedRefs: allImages.map(m => m.name) });
      });
    }

    // Non-streaming slide path
    const { contents, allImages } = await buildSlideContents();

    const genConfig = {
      temperature,
      ...(topP !== undefined ? { topP } : {}),
      responseModalities: ['TEXT', 'IMAGE'],
      thinkingConfig: { includeThoughts },
      imageConfig: { aspectRatio, imageSize, mediaResolution: mediaRes },
      safetySettings: buildSafetySettings(safetyThresh),
      ...(searchTools ? { tools: searchTools } : {}),
    };

    const parts = (contents[0] as { role: string; parts: Part[] }).parts;
    const refSummary = parts
      .map((p, i) => i === 0
        ? `text(${(p.text ?? '').length} chars)`
        : `image(${p.inlineData?.mimeType ?? '?'}, ${Math.round(((p.inlineData?.data?.length ?? 0) * 0.75) / 1024)}KB)`
      ).join(', ');

    console.log(`[pudding] ── REQUEST TO PUDDINGAPI (slide) ──`);
    console.log(`[pudding] model: ${model}`);
    console.log(`[pudding] config:`, JSON.stringify(genConfig, null, 2));
    console.log(`[pudding] parts: [${refSummary}]`);

    const t0 = Date.now();
    const response = await ai.models.generateContent({
      model,
      contents,
      config: genConfig as Parameters<typeof ai.models.generateContent>[0]['config'],
    });
    console.log(`[pudding] response received (${Date.now() - t0}ms)`);

    const { imageData, textHint } = parseImageResponse(response);

    if (textHint) {
      console.log('[pudding] model text alongside image:', textHint.slice(0, 200));
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
    console.error('[pudding] error:', message);
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

function detectModelCount(description: string): 1 | 2 | 3 {
  const lower = description.toLowerCase();
  if (/\b(three models?|3 models?|three people|3 people|3 persons?|three persons?)\b/.test(lower)) return 3;
  if (/\b(two models?|2 models?|both models?|model 1\b[\s\S]{0,80}\bmodel 2\b|(male|man|boy)[\s\S]{0,80}(female|woman|girl)|(female|woman|girl)[\s\S]{0,80}(male|man|boy)|first model\b[\s\S]{0,80}\bsecond model\b)\b/.test(lower)) return 2;
  return 1;
}

function modelCreationAspectRatio(description: string): '16:9' | '21:9' {
  return detectModelCount(description) >= 2 ? '21:9' : '16:9';
}

function buildModelPrompt(description: string, settings: Record<string, unknown>): string {
  const style  = (settings.style      as string | undefined) ?? 'realistic commercial photography';
  const light  = (settings.lighting   as string | undefined) ?? 'professional studio lighting';
  const bg     = (settings.background as string | undefined) ?? 'pure white';
  const count  = detectModelCount(description);
  if (count === 3) {
    return `Create a professional composite image with SIX panels in a single ultra-wide 21:9 frame showing THREE models, each from two angles.
Panels layout (left to right): [Model 1 Front] [Model 1 Back] [Model 2 Front] [Model 2 Back] [Model 3 Front] [Model 3 Back].
Models: ${description}.
Style: ${style}. Lighting: ${light}. Background: ${bg}.
Each model must be visually consistent across their two panels. Ultra high quality, sharp details, professional fashion photography.`;
  }
  if (count === 2) {
    return `Create a professional composite image with FOUR panels in a single ultra-wide 21:9 frame showing TWO models, each from two angles.
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
