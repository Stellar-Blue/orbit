import { NextRequest, NextResponse } from 'next/server';
import { isNextResponse, requireApiSession } from '@/lib/integrations/api-helpers';
import { getAdminClient } from '@/lib/integrations/server';

// POST /api/integrations/mydata/reset — reset the AADE sync cursor to MARK 0 and clear the raw
// AADE store (aade_documents / aade_cancellations) so the next sync fully re-imports every
// transmitted document from the very first MARK. The mirrored invoices registry is left intact
// and is updated idempotently by MARK during the re-sync (no rows there are deleted).
export async function POST(request: NextRequest) {
  const session = await requireApiSession(request);
  if (isNextResponse(session)) return session;
  if (!session.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = getAdminClient();

  const { error: stateErr } = await admin
    .from('aade_sync_state')
    .update({ last_completed_mark: 0, last_error: null })
    .eq('id', 1);
  if (stateErr) {
    return NextResponse.json({ error: `Failed to reset sync state: ${stateErr.message}` }, { status: 500 });
  }

  // Clear the raw AADE audit store so the re-sync re-imports from scratch (idempotent by MARK).
  const { error: docsErr } = await admin.from('aade_documents').delete().neq('mark', -1);
  if (docsErr) {
    return NextResponse.json({ error: `Failed to clear AADE documents: ${docsErr.message}` }, { status: 500 });
  }
  const { error: cancErr } = await admin.from('aade_cancellations').delete().neq('invoice_mark', -1);
  if (cancErr) {
    return NextResponse.json({ error: `Failed to clear AADE cancellations: ${cancErr.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
