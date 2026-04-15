import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { createClient } from '@supabase/supabase-js';
import { urlToFilePath } from '../../../../lib/storage';

/**
 * POST /api/supabase/export
 *
 * Uploads a batch of generated images to Supabase Storage and returns their
 * public URLs. Requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
 * (or SUPABASE_SERVICE_ROLE_KEY for private buckets).
 *
 * Body:
 *   { imageUrls: string[]; bucket?: string; folder?: string }
 *
 * Returns:
 *   { uploaded: Array<{ localUrl: string; supabaseUrl: string }> }
 */
export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: 'Supabase credentials not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY) in your .env.local.' },
        { status: 400 },
      );
    }

    const body = await request.json() as {
      imageUrls: string[];
      bucket?: string;
      folder?: string;
    };

    const { imageUrls, bucket = 'generated-images', folder = '' } = body;

    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
      return NextResponse.json({ error: 'imageUrls must be a non-empty array' }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const uploaded: Array<{ localUrl: string; supabaseUrl: string }> = [];
    const errors:   Array<{ localUrl: string; error: string }>       = [];

    for (const localUrl of imageUrls) {
      try {
        const filePath = urlToFilePath(localUrl);
        const data     = await readFile(filePath);

        // Derive filename from URL path
        const filename = localUrl.split('/').pop() ?? `image-${Date.now()}.png`;
        const storagePath = folder ? `${folder}/${filename}` : filename;

        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(storagePath, data, { contentType: 'image/png', upsert: true });

        if (uploadError) throw new Error(uploadError.message);

        const { data: publicUrlData } = supabase.storage
          .from(bucket)
          .getPublicUrl(storagePath);

        uploaded.push({ localUrl, supabaseUrl: publicUrlData.publicUrl });
      } catch (err) {
        errors.push({ localUrl, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return NextResponse.json({ uploaded, errors });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[supabase/export] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
