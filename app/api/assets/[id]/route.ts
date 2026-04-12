import { NextRequest, NextResponse } from 'next/server';
import { readFile, writeFile, unlink } from 'fs/promises';
import path from 'path';

interface AssetRecord {
  id: string;
  name: string;
  url: string;
  tags: string[];
  createdAt: string;
}

const DATA_FILE = path.join(process.cwd(), 'data', 'assets.json');

async function readAssets(): Promise<AssetRecord[]> {
  try {
    return JSON.parse(await readFile(DATA_FILE, 'utf-8')) as AssetRecord[];
  } catch {
    return [];
  }
}

async function writeAssets(assets: AssetRecord[]): Promise<void> {
  await writeFile(DATA_FILE, JSON.stringify(assets, null, 2), 'utf-8');
}

// PUT /api/assets/[id] — update name and/or tags
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { name, tags } = await request.json() as { name?: string; tags?: string[] };

  const assets = await readAssets();
  const idx    = assets.findIndex(a => a.id === id);
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (name  !== undefined) assets[idx].name = name.trim();
  if (tags  !== undefined) assets[idx].tags = tags.map(t => t.trim().toLowerCase()).filter(Boolean);

  await writeAssets(assets);
  return NextResponse.json(assets[idx]);
}

// DELETE /api/assets/[id] — remove from JSON and delete the file
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const assets = await readAssets();
  const asset  = assets.find(a => a.id === id);
  if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Delete the physical file (best-effort)
  try {
    await unlink(path.join(process.cwd(), 'public', asset.url));
  } catch { /* file might be missing */ }

  await writeAssets(assets.filter(a => a.id !== id));
  return NextResponse.json({ success: true });
}
