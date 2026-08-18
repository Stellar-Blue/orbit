import { NextRequest, NextResponse } from 'next/server';
import { isNextResponse, requireApiSession } from '@/lib/integrations/api-helpers';
import { getAdminClient } from '@/lib/integrations/server';
import { syncIssuedInvoices } from '@/lib/integrations/mydata';

// POST: run an on-demand myDATA issued-invoice import. Admin only.
export async function POST(request: NextRequest) {
  const session = await requireApiSession(request);
  if (isNextResponse(session)) return session;
  if (!session.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let vatNumber: string | undefined;
  try {
    const body = await request.json();
    vatNumber = body.vatNumber;
  } catch {
    // Ignore JSON parse errors for backward compatibility
  }

  const admin = getAdminClient();
  const result = await syncIssuedInvoices(admin, { vatNumber });

  return NextResponse.json(result, { status: result.error ? 502 : 200 });
}
