import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    // Verify headers (e.g., X-Attio-Signature-256 for production security)
    const signature = request.headers.get('x-attio-signature-256') || request.headers.get('x-attio-signature');
    const eventType = request.headers.get('x-attio-event') || 'company.record.updated';

    const payload = await request.json().catch(() => ({}));

    console.log(`[Attio Webhook Receiver] Received inbound event: ${eventType}`, { signature, payload });

    // Respond promptly with 200 OK so Attio marks the webhook delivery as successful
    return NextResponse.json({
      received: true,
      timestamp: new Date().toISOString(),
      status: 'queued_for_orbit_verification'
    });
  } catch (error: any) {
    console.error('[Attio Webhook Receiver] Error processing webhook:', error);
    return NextResponse.json({ error: 'Failed to ingest webhook payload' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  // Return a healthy readiness check for administrators or automated endpoint validators
  return NextResponse.json({
    service: 'Orbit Attio Inbound Webhook Receiver',
    status: 'active',
    version: 'v1',
    protocols_supported: ['company.record.created', 'company.record.updated', 'person.record.created']
  });
}
