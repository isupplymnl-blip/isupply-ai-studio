import { readFileSync, writeFile } from 'fs';
import { getJobStoreDbPath } from './storage';

export type JobStatus = 'pending' | 'completed' | 'error';

export interface JobResult {
  status: JobStatus;
  imageUrl?: string;
  remaining_credits?: number;
  cost?: number;
  error?: string;
}

type JobMap = Record<string, JobResult>;

// Load existing jobs from disk on startup so jobs survive server restarts
function loadStore(): Map<string, JobResult> {
  try {
    const raw = readFileSync(getJobStoreDbPath(), 'utf-8');
    const obj = JSON.parse(raw) as JobMap;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

const cache = loadStore();

function persist(): void {
  const dbPath = getJobStoreDbPath();
  const obj: JobMap = {};
  for (const [k, v] of cache) obj[k] = v;
  writeFile(dbPath, JSON.stringify(obj, null, 2), err => {
    if (err) console.warn('[eccoJobStore] persist failed:', err);
  });
}

export const jobStore = {
  get(jobId: string): JobResult | undefined {
    return cache.get(jobId);
  },
  set(jobId: string, result: JobResult): void {
    cache.set(jobId, result);
    persist();
  },
};
