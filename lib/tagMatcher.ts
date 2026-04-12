import { readFile } from 'fs/promises';
import path from 'path';

interface AssetRecord {
  id: string;
  name: string;
  url: string;
  tags: string[];
}

export interface MatchedImage {
  id: string;
  name: string;
  url: string;
  matchedTags: string[];
}

/** Scan prompt text against locally stored asset tags.
 *  Returns only assets whose tags appear in the prompt (case-insensitive). */
export async function findMatchingImages(prompt: string): Promise<MatchedImage[]> {
  const dataFile = path.join(process.cwd(), 'data', 'assets.json');
  let assets: AssetRecord[] = [];
  try {
    const raw = await readFile(dataFile, 'utf-8');
    assets = JSON.parse(raw) as AssetRecord[];
  } catch {
    return [];
  }

  const promptLower = prompt.toLowerCase();
  const matched: MatchedImage[] = [];

  for (const asset of assets) {
    const matchedTags = asset.tags.filter(tag => promptLower.includes(tag.toLowerCase()));
    if (matchedTags.length > 0) {
      matched.push({ id: asset.id, name: asset.name, url: asset.url, matchedTags });
    }
  }

  return matched;
}
