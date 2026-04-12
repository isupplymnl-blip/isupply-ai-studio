import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    provider: (process.env.AI_PROVIDER ?? 'gemini') as 'gemini' | 'ecco',
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    hasEccoKey:   !!process.env.ECCO_API_KEY,
  });
}
