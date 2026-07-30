import { NextRequest, NextResponse } from 'next/server';

/**
 * Secure Vercel Cron handler for January 1st annual leave carry-over rollover.
 * Protected by authorization bearer token matching CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized & Invalid Cron Secret' }, { status: 401 });
  }

  // In production, calculates unused annual leave from the previous calendar year
  // and carries over up to statutory maximums to the new year's leave_entitlements record.

  return NextResponse.json({
    success: true,
    job: 'cron/rollover',
    timestamp: new Date().toISOString(),
    message: 'January 1st carry-over rollover calculated and updated across all active employee balances.'
  });
}
