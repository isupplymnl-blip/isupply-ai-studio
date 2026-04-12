import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { getUploadDir } from '../../../../lib/storage';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  const safe = path.basename(filename); // prevent path traversal
  try {
    const data = await readFile(path.join(getUploadDir(), safe));
    const ext  = safe.split('.').pop()?.toLowerCase() ?? '';
    const mime =
      ext === 'png'  ? 'image/png'  :
      ext === 'webp' ? 'image/webp' :
      ext === 'gif'  ? 'image/gif'  :
      'image/jpeg';
    return new NextResponse(data, {
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
