import { NextRequest, NextResponse } from 'next/server';
import { isNextResponse, requireApiSession } from '@/lib/integrations/api-helpers';
import { getAdminClient } from '@/lib/integrations/server';

export const dynamic = 'force-dynamic';

// Server-Sent Events (SSE) stream for the myDATA communication log.
// Vercel serverless does not support raw WebSockets; SSE gives the same one-way
// real-time push (server -> browser) with automatic browser reconnection.
// The stream polls aade_sync_logs and pushes new rows as the sync writes them.
export async function GET(request: NextRequest) {
  const session = await requireApiSession(request);
  if (isNextResponse(session)) return session;
  if (!session.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const encoder = new TextEncoder();
  const admin = getAdminClient();
  const sent = new Set<string>();

  let pollTimer: NodeJS.Timeout | undefined;
  let keepAliveTimer: NodeJS.Timeout | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // stream closed
        }
      };

      send({ type: 'connected', at: new Date().toISOString() });

      const poll = async () => {
        try {
          const { data, error } = await admin
            .from('aade_sync_logs')
            .select('id,created_at,level,message,detail,mark')
            .order('created_at', { ascending: false })
            .limit(100);
          if (error) {
            send({ type: 'error', message: error.message, code: 'table' });
            return;
          }
          const fresh = (data || []).filter(r => !sent.has(r.id)).reverse();
          fresh.forEach(r => sent.add(r.id));
          if (fresh.length > 0) {
            send({ type: 'logs', logs: fresh });
          }
        } catch (e) {
          send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
        }
      };

      // Immediate first flush, then poll every 1.5s
      await poll();
      pollTimer = setInterval(poll, 1500);

      // Comment keep-alive every 25s so proxies don't drop the connection
      keepAliveTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keep-alive\n\n`));
        } catch {
          // closed — timers cleared via cancel()
        }
      }, 25_000);
    },
    cancel() {
      if (pollTimer) clearInterval(pollTimer);
      if (keepAliveTimer) clearInterval(keepAliveTimer);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
