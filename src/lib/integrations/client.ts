import { ATHENS_TIMEZONE } from './types';

export function athensTodayStr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ATHENS_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}

/**
 * Enqueue a Slack status sync for the given date, then attempt an immediate
 * delivery. Used by leave/remote approval, cancellation, edit and add flows.
 * Only meaningful for today (morning job covers future dates).
 */
export async function enqueueStatusSync(profileId: string, date: string, orbitId?: string): Promise<void> {
  try {
    await fetch('/api/integrations/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_id: profileId, date, orbit_id: orbitId }),
    });
  } catch (e) {
    console.error('enqueueStatusSync error:', e);
  }
  try {
    await fetch('/api/integrations/deliver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_id: profileId }),
    });
  } catch (e) {
    console.error('deliverStatusSync error:', e);
  }
}
