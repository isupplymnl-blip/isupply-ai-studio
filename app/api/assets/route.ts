import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { getAssetsDbPath } from '../../lib/storage';

export async function GET() {
  try {
    const raw = await readFile(getAssetsDbPath(), 'utf-8');
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json([]);
  }
}
