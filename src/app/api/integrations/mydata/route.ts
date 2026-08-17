import { NextRequest, NextResponse } from 'next/server';
import { isNextResponse, requireApiSession } from '@/lib/integrations/api-helpers';
import { getAdminClient } from '@/lib/integrations/server';
import { clearMyDataCreds, getMyDataCreds, setMyDataCreds } from '@/lib/integrations/mydata';

// GET: myDATA integration status (never returns the subscription key)
export async function GET() {
  const admin = getAdminClient();
  const creds = await getMyDataCreds(admin);
  const { data: state } = await admin.from('aade_sync_state').select('last_completed_mark,last_success_at,last_error').eq('id', 1).maybeSingle();
  const { count: docCount } = await admin.from('aade_documents').select('id', { count: 'exact', head: true });
  const { count: invoiceCount } = await admin.from('invoices').select('id', { count: 'exact', head: true }).eq('created_via', 'api');
  const { data: logs } = await admin
    .from('aade_sync_logs')
    .select('id,created_at,level,message,detail,mark')
    .order('created_at', { ascending: false })
    .limit(50);

  return NextResponse.json({
    configured: creds.configured,
    username: creds.username,
    lastCompletedMark: state?.last_completed_mark ?? 0,
    lastSuccessAt: state?.last_success_at ?? null,
    lastError: state?.last_error ?? null,
    docCount: docCount ?? 0,
    invoiceCount: invoiceCount ?? 0,
    logs: logs || [],
  });
}

// PUT: save (or clear) the myDATA REST API credentials. Admin only. Secrets go to the vault.
export async function PUT(request: NextRequest) {
  const session = await requireApiSession(request);
  if (isNextResponse(session)) return session;
  if (!session.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { username?: string; subscriptionKey?: string; clear?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const admin = getAdminClient();

  if (body.clear) {
    await clearMyDataCreds(admin);
    return NextResponse.json({ ok: true, configured: false });
  }

  const username = (body.username || '').trim();
  const subscriptionKey = (body.subscriptionKey || '').trim();
  if (!username || !subscriptionKey) {
    return NextResponse.json({ error: 'Both Username and Subscription Key are required' }, { status: 400 });
  }
  await setMyDataCreds(admin, username, subscriptionKey);

  return NextResponse.json({ ok: true, configured: true, username });
}
