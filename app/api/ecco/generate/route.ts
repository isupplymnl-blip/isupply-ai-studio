import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, readFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { getGeneratedDir, makeGeneratedUrl, urlToFilePath } from '../../../../lib/storage';
import { findMatchingImages } from '../../../../lib/tagMatcher';
import { jobStore } from '../../../lib/eccoJobStore';

// Force Node.js runtime (not Edge) so background tasks and fs work
export const runtime = 'nodejs';

// ─── Error messages ───────────────────────────────────────────────────────────
const ECCO_ERRORS: Record<number, string> = {
  400: 'Invalid request — check prompt and settings',
  401: 'Invalid EccoAPI key — check your settings',
  402: 'Insufficient credits — top up at eccoapi.com/dashboard',
  403: 'Access denied for this job',
  404: 'Job not found — it may have expired',
  429: 'Rate limit reached — please wait a moment',
  500: 'EccoAPI server error — try again',
  503: 'EccoAPI model is temporarily unavailable',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getEccoKey(): string {
  const key = process.env.ECCO_API_KEY;
  if (!key) throw new Error('ECCO_API_KEY is not set');
  return key;
}

/**
 * Read a local URL or remote URL, resize to max 1024px on the longest side,
 * and return a JPEG base64 string (quality 85).
 * Keeps reference images under ~200 KB each without losing detail needed by the model.
 */
async function urlToEccoImage(urlOrPath: string): Promise<{ data: string; mimeType: 'image/jpeg' }> {
  let inputBuf: Buffer;
  if (urlOrPath.startsWith('/')) {
    inputBuf = await readFile(urlToFilePath(urlOrPath));
  } else {
    const res = await fetch(urlOrPath);
    if (!res.ok) throw new Error(`Failed to fetch reference: ${res.status}`);
    inputBuf = Buffer.from(await res.arrayBuffer());
  }

  const outputBuf = await sharp(inputBuf)
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  return { data: outputBuf.toString('base64'), mimeType: 'image/jpeg' };
}

async function downloadAndPersist(assetUrl: string): Promise<string> {
  const res = await fetch(assetUrl);
  if (!res.ok) throw new Error(`Failed to download image from EccoAPI: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
  const outDir = getGeneratedDir();
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, filename), buf);
  return makeGeneratedUrl(filename);
}

// ─── Background generation (fire-and-forget) ──────────────────────────────────
async function runEccoGeneration(
  jobId: string,
  model: string,
  eccoBody: Record<string, unknown>,
  apiKey: string,
): Promise<void> {
  try {
    const endpoint = `https://eccoapi.com/api/v1/${model}/generate`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(eccoBody),
    });

    const data = await res.json() as Record<string, unknown>;

    console.log(`[ecco/generate] ── ASYNC RESPONSE FROM ECCOAPI job=${jobId} (status ${res.status}) ──`);
    console.log(`[ecco/generate] full response:`, JSON.stringify(data, null, 2));

    if (!res.ok) {
      console.error(`[ecco/generate] job=${jobId} ECCO ${res.status}`);
      const msg = ECCO_ERRORS[res.status] ?? `EccoAPI error ${res.status}`;
      jobStore.set(jobId, { status: 'error', error: msg });
      return;
    }

    const assetUrl = (data?.data as Record<string, unknown> | undefined)?.assetUrl as string | undefined;
    if (!assetUrl) {
      jobStore.set(jobId, { status: 'error', error: 'EccoAPI returned no image URL' });
      return;
    }

    // Download image from signed URL (TTL: 900s) and persist locally
    const meta = data?.meta as Record<string, unknown> | undefined;
    const imageUrl = await downloadAndPersist(assetUrl);
    jobStore.set(jobId, {
      status: 'completed',
      imageUrl,
      remaining_credits: meta?.remaining_credits as number | undefined,
      cost: meta?.cost as number | undefined,
    });
    console.log(`[ecco/generate] job=${jobId} completed imageUrl=${imageUrl}`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ecco/generate] job=${jobId} error:`, msg);
    jobStore.set(jobId, { status: 'error', error: msg });
  }
}

// ─── POST /api/ecco/generate ──────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      prompt: string;
      nodeId: string;
      batchId: string;
      model?: string;
      aspectRatio?: string;
      imageSize?: string;
      useGoogleSearch?: boolean;
      referenceUrls?: string[];
      settings?: Record<string, unknown>;
      // Gemini pass-through params
      temperature?: number;
      includeThoughts?: boolean;
      mediaResolution?: string;
      safetyThreshold?: string;
      useAsync?: boolean;
    };

    const {
      prompt,
      nodeId,
      batchId,
      model = 'nanobanana31',
      aspectRatio = '1:1',
      imageSize = '1K',
      useGoogleSearch = false,
      referenceUrls = [],
      settings = {},
      temperature,
      includeThoughts,
      mediaResolution,
      safetyThreshold,
      useAsync = false,
    } = body;

    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const apiKey = getEccoKey();

    // Tag-match saved assets (same logic as Gemini route)
    const matchedImages = await findMatchingImages(prompt.trim());
    // Merge explicit canvas-connected refs with tag-matched ones (deduplicated)
    const explicitRefs = referenceUrls.filter(url => !matchedImages.find(m => m.url === url));
    const allRefUrls = [...explicitRefs, ...matchedImages.map(m => m.url)].slice(0, 14);

    console.log(`[ecco/generate] references: ${allRefUrls.length} (${explicitRefs.length} explicit + ${matchedImages.length} tag-matched)`);

    // Convert all reference URLs to {data, mimeType} objects (EccoAPI can't reach localhost)
    const imageBase64: { data: string; mimeType: string }[] = [];
    for (const url of allRefUrls) {
      try {
        imageBase64.push(await urlToEccoImage(url));
      } catch (e) {
        console.warn('[ecco/generate] skipping inaccessible reference:', url, e);
      }
    }

    // settings.useGoogleSearch takes precedence over the top-level param
    const resolvedSearch       = (settings.useGoogleSearch  as boolean | undefined) ?? useGoogleSearch;
    const resolvedTemperature  = (settings.temperature      as number  | undefined) ?? temperature ?? 1.0;
    const resolvedThoughts     = (settings.includeThoughts  as boolean | undefined) ?? includeThoughts ?? true;
    const resolvedMediaRes     = (settings.mediaResolution  as string  | undefined) ?? mediaResolution ?? 'media_resolution_high';
    const resolvedSafetyThresh = (settings.safetyThreshold  as string  | undefined) ?? safetyThreshold ?? 'BLOCK_MEDIUM_AND_ABOVE';
    const resolvedAsync        = (settings.useAsync         as boolean | undefined) ?? useAsync;

    const safetyCategories = [
      'HARM_CATEGORY_HARASSMENT',
      'HARM_CATEGORY_HATE_SPEECH',
      'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      'HARM_CATEGORY_DANGEROUS_CONTENT',
    ];

    const eccoBody: Record<string, unknown> = {
      prompt:          prompt.trim(),
      aspectRatio:     (settings.aspectRatio as string | undefined) ?? aspectRatio,
      imageSize:       (settings.imageSize   as string | undefined) ?? imageSize,
      useGoogleSearch: resolvedSearch,
      // Extended Gemini pass-through params
      temperature:        resolvedTemperature,
      thinkingConfig:     { includeThoughts: resolvedThoughts },
      mediaResolution:    resolvedMediaRes,
      responseModalities: ['TEXT', 'IMAGE'],
      safetySettings:     safetyCategories.map(category => ({ category, threshold: resolvedSafetyThresh })),
    };
    if (imageBase64.length) eccoBody.imageBase64 = imageBase64;

    // ── Debug: log exactly what we're sending (strip base64 data for readability) ──
    const loggableBody = {
      ...eccoBody,
      imageBase64: imageBase64.length
        ? imageBase64.map((img, i) => `[image ${i + 1}: ${img.mimeType}, ${Math.round(img.data.length * 0.75 / 1024)}KB]`)
        : undefined,
    };
    console.log(`[ecco/generate] ── REQUEST TO ECCOAPI ──`);
    console.log(`[ecco/generate] endpoint: https://eccoapi.com/api/v1/${model}/generate`);
    console.log(`[ecco/generate] body:`, JSON.stringify(loggableBody, null, 2));

    // ── Sync mode (default): block until EccoAPI responds, return imageUrl directly ──
    if (!resolvedAsync) {
      console.log(`[ecco/generate] mode: SYNC`);
      try {
        const endpoint = `https://eccoapi.com/api/v1/${model}/generate`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(eccoBody),
        });
        const data = await res.json() as Record<string, unknown>;
        console.log(`[ecco/generate] ── RESPONSE FROM ECCOAPI (status ${res.status}) ──`);
        console.log(`[ecco/generate] full response:`, JSON.stringify(data, null, 2));

        const assetUrl = (data?.data as Record<string, unknown> | undefined)?.assetUrl as string | undefined;
        if (!res.ok || !assetUrl) {
          const msg = ECCO_ERRORS[res.status] ?? `EccoAPI error ${res.status}`;
          console.error(`[ecco/generate] sync failed: ${msg}`);
          return NextResponse.json({ error: msg }, { status: res.status });
        }
        const imageUrl = await downloadAndPersist(assetUrl);
        console.log(`[ecco/generate] sync completed imageUrl=${imageUrl}`);
        const meta = data?.meta as Record<string, unknown> | undefined;
        return NextResponse.json({
          imageUrl,
          nodeId,
          batchId,
          remaining_credits: meta?.remaining_credits,
          cost: meta?.cost,
        }, { status: 200 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[ecco/generate] sync error:', msg);
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }

    // ── Async mode (opt-in): fire-and-forget, return 202 + jobId for polling ──
    const jobId = `ecco-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    jobStore.set(jobId, { status: 'pending' });

    console.log(`[ecco/generate] mode: ASYNC queued job=${jobId}`);
    void runEccoGeneration(jobId, model, eccoBody, apiKey);

    return NextResponse.json({ jobId, nodeId, batchId }, { status: 202 });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ecco/generate] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
