'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface GenerationJob {
  id: string;
  nodeId: string;
  batchId: string;
  status: 'polling' | 'completed' | 'error';
  imageUrl?: string;
  remaining_credits?: number;
  cost?: number;
  error?: string;
  seen: boolean;
}

interface UseGenerationQueueOptions {
  onJobComplete: (job: GenerationJob) => void;
  onJobError:    (job: GenerationJob) => void;
}

export function useGenerationQueue({ onJobComplete, onJobError }: UseGenerationQueueOptions) {
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const addJob = useCallback((job: Omit<GenerationJob, 'status' | 'seen'>) => {
    setJobs(prev => [...prev, { ...job, status: 'polling', seen: false }]);
  }, []);

  const markBatchSeen = useCallback((batchId: string) => {
    setJobs(prev => prev.map(j => j.batchId === batchId ? { ...j, seen: true } : j));
  }, []);

  useEffect(() => {
    const interval = setInterval(async () => {
      const active = jobsRef.current.filter(j => j.status === 'polling');
      if (!active.length) return;

      for (const job of active) {
        try {
          const res  = await fetch(`/api/ecco/jobs/${job.id}`);
          if (!res.ok) continue;
          const data = await res.json() as {
            status: string;
            imageUrl?: string;
            remaining_credits?: number;
            cost?: number;
            error?: string;
          };

          if (data.status === 'completed' && data.imageUrl) {
            const updated: GenerationJob = {
              ...job,
              status: 'completed',
              imageUrl: data.imageUrl,
              remaining_credits: data.remaining_credits,
              cost: data.cost,
            };
            setJobs(prev => prev.map(j => j.id === job.id ? updated : j));
            onJobComplete(updated);
          } else if (data.status === 'error') {
            const updated: GenerationJob = {
              ...job,
              status: 'error',
              error: data.error ?? 'Generation failed',
            };
            setJobs(prev => prev.map(j => j.id === job.id ? updated : j));
            onJobError(updated);
          }
        } catch {
          // Network error — retry next tick
        }
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [onJobComplete, onJobError]);

  return { jobs, addJob, markBatchSeen };
}
