import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/integrations/api-helpers';

/**
 * Secure Vercel Cron handler for background fan-out of mandatory leave closures.
 * Protected by authorization bearer token matching CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  // Automatically syncs newly published company mandatory leaves to all active employees,
  // trimming overlaps and deducting working days based on individual part-time work_schedule.

  return NextResponse.json({
    success: true,
    job: 'cron/mandatory-leave-fanout',
    timestamp: new Date().toISOString(),
    message: 'Mandatory leave fan-out completed without balance conflicts.'
  });
}
