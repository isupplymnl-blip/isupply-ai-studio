import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, readFile } from 'fs/promises';
import path from 'path';
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

function mimeFromPath(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif')  return 'image/gif';
  return 'image/png';
}

async function urlToEccoImage(urlOrPath: string): Promise<{ data: string; mimeType: string }> {
  if (urlOrPath.startsWith('/')) {
    const filePath = urlToFilePath(urlOrPath);
    const buf  = await readFile(filePath);
    return { data: buf.toString('base64'), mimeType: mimeFromPath(filePath) };
  }
  const res = await fetch(urlOrPath);
  if (!res.ok) throw new Error(`Failed to fetch reference: ${res.status}`);
  const mimeType = res.headers.get('content-type')?.split(';')[0] ?? 'image/png';
  const data = Buffer.from(await res.arrayBuffer()).toString('base64');
  return { data, mimeType };
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

    const data = await res.json() as {
      code?: number;
      msg?: string;
      data?: { assetUrl: string };
      meta?: { cost: number; remaining_credits: number };
    };

    if (!res.ok) {
      console.error(`[ecco/generate] job=${jobId} ECCO ${res.status} body:`, JSON.stringify(data));
      const msg = ECCO_ERRORS[res.status] ?? `EccoAPI error ${res.status}`;
      jobStore.set(jobId, { status: 'error', error: msg });
      return;
    }

    if (!data.data?.assetUrl) {
      jobStore.set(jobId, { status: 'error', error: 'EccoAPI returned no image URL' });
      return;
    }

    // Download image from signed URL (TTL: 900s) and persist locally
    const imageUrl = await downloadAndPersist(data.data.assetUrl);
    jobStore.set(jobId, {
      status: 'completed',
      imageUrl,
      remaining_credits: data.meta?.remaining_credits,
      cost: data.meta?.cost,
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
    const resolvedSearch = (settings.useGoogleSearch as boolean | undefined) ?? useGoogleSearch;

    const eccoBody: Record<string, unknown> = {
      prompt: prompt.trim(),
      aspectRatio:     (settings.aspectRatio as string | undefined) ?? aspectRatio,
      imageSize:       (settings.imageSize   as string | undefined) ?? imageSize,
      useGoogleSearch: resolvedSearch,
    };
    if (imageBase64.length) eccoBody.imageBase64 = imageBase64;

    // Generate a local job ID and return 202 immediately
    const jobId = `ecco-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    jobStore.set(jobId, { status: 'pending' });

    console.log(`[ecco/generate] queued job=${jobId} model=${model} nodeId=${nodeId}`);

    // Fire-and-forget background task
    void runEccoGeneration(jobId, model, eccoBody, apiKey);

    return NextResponse.json({ jobId, nodeId, batchId }, { status: 202 });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ecco/generate] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
