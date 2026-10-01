import { NextRequest, NextResponse } from 'next/server';
import { isNextResponse, requireApiSession } from '@/lib/integrations/api-helpers';
import { getAdminClient } from '@/lib/integrations/server';
import { extractPaymentFields, type ModelInputPayload } from '@/lib/integrations/deepseek';

/**
 * Documents travel as base64 data URLs, so the body is ~1.35× the file size. Vercel rejects bodies
 * over 4.5 MB before the handler runs, so guard below that with a message the admin can act on.
 */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * Read a payment's attached receipts/payslips and return the ledger fields to fill.
 *
 * Admin only, and only the fields — the documents themselves stay in the browser until they are
 * sent here as already-extracted text (or JPEG page images for scans).
 */
export async function POST(request: NextRequest) {
  const session = await requireApiSession(request);
  if (isNextResponse(session)) return session;
  if (!session.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { documents?: ModelInputPayload[]; employeeName?: string; period?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const documents = (body.documents || []).filter(d => d && typeof d.name === 'string').slice(0, 6);
  if (!documents.length) {
    return NextResponse.json({ ok: false, error: 'Attach the bank receipt and the payslip first.' }, { status: 400 });
  }
  if (JSON.stringify(documents).length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: 'Those attachments are too large to send at once. Detach some, or replace a large scan with a smaller one.' }, { status: 413 });
  }

  const admin = getAdminClient();
  const result = await extractPaymentFields(admin, documents, {
    employeeName: (body.employeeName || '').trim() || 'unknown',
    period: (body.period || '').trim() || 'unknown',
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
