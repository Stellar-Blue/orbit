import { NextRequest, NextResponse } from 'next/server';
import { isNextResponse, requireApiSession } from '@/lib/integrations/api-helpers';
import { getAdminClient } from '@/lib/integrations/server';
import { DEEPSEEK_MODEL, clearDeepSeekKey, hasDeepSeekKey, setDeepSeekKey } from '@/lib/integrations/deepseek';

// GET: whether an API key is stored. Never returns the key itself.
export async function GET(request: NextRequest) {
  const session = await requireApiSession(request);
  if (isNextResponse(session)) return session;
  if (!session.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = getAdminClient();
  return NextResponse.json({ configured: await hasDeepSeekKey(admin), model: DEEPSEEK_MODEL });
}

// PUT: save (or clear) the DeepSeek API key. Admin only, secret goes to the vault.
export async function PUT(request: NextRequest) {
  const session = await requireApiSession(request);
  if (isNextResponse(session)) return session;
  if (!session.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { apiKey?: string; clear?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const admin = getAdminClient();

  if (body.clear) {
    await clearDeepSeekKey(admin);
    return NextResponse.json({ ok: true, configured: false });
  }

  const apiKey = (body.apiKey || '').trim();
  if (!apiKey) {
    return NextResponse.json({ error: 'An API key is required' }, { status: 400 });
  }
  // Cheap shape check so an obvious paste mistake is caught before it breaks a real extraction.
  if (!/^sk-[A-Za-z0-9_-]{16,}$/.test(apiKey)) {
    return NextResponse.json({ error: 'That does not look like a DeepSeek key (expected to start with "sk-").' }, { status: 400 });
  }
  if (!(await setDeepSeekKey(admin, apiKey))) {
    return NextResponse.json({ error: 'Could not store the key in the vault.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, configured: true });
}
