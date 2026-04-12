import { NextRequest, NextResponse } from 'next/server';
import { jobStore } from '../../../../lib/eccoJobStore';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const job = jobStore.get(jobId);

  if (!job) {
    return NextResponse.json({ status: 'pending' });
  }

  return NextResponse.json(job);
}
