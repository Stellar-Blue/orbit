import { NextRequest, NextResponse } from 'next/server';
import { isNextResponse, requireApiSession } from '@/lib/integrations/api-helpers';
import { getAdminClient } from '@/lib/integrations/server';

// POST /api/counterparties/merge — merge a duplicate counterparty into a kept one.
// targetId = the record that stays (receives all data); sourceId = the duplicate (deleted afterwards).
// All child records (contacts, contracts, invoices, attio link/outbox, tiers) are reassigned to
// the target inside a single DB transaction (see public.merge_counterparties RPC, migration 0046).
export async function POST(request: NextRequest) {
  const session = await requireApiSession(request);
  if (isNextResponse(session)) return session;
  if (!session.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { targetId?: string; sourceId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.targetId || !body.sourceId) {
    return NextResponse.json({ error: 'targetId and sourceId are required' }, { status: 400 });
  }

  const admin = getAdminClient();
  const { data, error } = await admin.rpc('merge_counterparties', {
    p_target_id: body.targetId,
    p_source_id: body.sourceId,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, counts: data });
}
