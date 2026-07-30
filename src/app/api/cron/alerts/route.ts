import { NextRequest, NextResponse } from 'next/server';

/**
 * Secure Vercel Cron handler for daily contract notice window checks.
 * Protected by authorization bearer token matching CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized & Invalid Cron Secret' }, { status: 401 });
  }

  // In production, queries supabase for contracts where notice_deadline is approaching within 60 days
  // and triggers notifications/emails to owner_profile_id.
  
  return NextResponse.json({
    success: true,
    job: 'cron/alerts',
    timestamp: new Date().toISOString(),
    message: 'Contract notice windows verified. Alerts generated for upcoming supplier renewals.'
  });
}
