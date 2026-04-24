import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, readFile } from 'fs/promises';
import path from 'path';
import { getUploadDir, getAssetsDbPath, makeUploadUrl } from '../../lib/storage';

interface AssetRecord {
  id: string;
  name: string;
  url: string;
  tags: string[];
  createdAt: string;
}

async function readAssets(): Promise<AssetRecord[]> {
  try {
    const raw = await readFile(getAssetsDbPath(), 'utf-8');
    return JSON.parse(raw) as AssetRecord[];
  } catch {
    return [];
  }
}

async function writeAssets(assets: AssetRecord[]): Promise<void> {
  const dbPath = getAssetsDbPath();
  await mkdir(path.dirname(dbPath), { recursive: true });
  await writeFile(dbPath, JSON.stringify(assets, null, 2), 'utf-8');
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file     = formData.get('file')  as File   | null;
    const name     = formData.get('name')  as string | null;
    const tagsRaw  = formData.get('tags')  as string | null;

    if (!file || !name?.trim()) {
      return NextResponse.json({ error: 'file and name are required' }, { status: 400 });
    }

    const tags: string[] = tagsRaw ? (JSON.parse(tagsRaw) as string[]) : [];

    // Write file to the writable uploads directory
    const ext      = (file.name.split('.').pop() ?? 'jpg').toLowerCase();
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const uploadsDir = getUploadDir();
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(path.join(uploadsDir, filename), Buffer.from(await file.arrayBuffer()));

    const url = makeUploadUrl(filename);
    const id  = `asset-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Append to assets database
    const assets = await readAssets();
    assets.unshift({ id, name: name.trim(), url, tags, createdAt: new Date().toISOString() });
    await writeAssets(assets);

    return NextResponse.json({ success: true, id, name: name.trim(), url, tags });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    console.error('[upload]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
