export type JobStatus = 'pending' | 'completed' | 'error';

export interface JobResult {
  status: JobStatus;
  imageUrl?: string;
  remaining_credits?: number;
  cost?: number;
  error?: string;
}

// Module-level singleton — same Map instance across all imports in the same process
export const jobStore = new Map<string, JobResult>();
