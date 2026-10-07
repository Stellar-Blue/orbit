import { ATHENS_TIMEZONE } from './types';

export function athensTodayStr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ATHENS_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}

/**
 * Enqueue a Slack status sync for the given date, then attempt an immediate
 * delivery. Used by leave/remote approval, cancellation, edit and add flows.
 *
 * Slack status is day-scoped: it must always reflect the current day, and a new
 * day is set when it starts (the morning job). A change dated in the future —
 * e.g. a remote day declared for tomorrow — is therefore a no-op here instead of
 * flipping the employee's status a day early.
 */
export async function enqueueStatusSync(profileId: string, date: string, orbitId?: string): Promise<void> {
  if (date !== athensTodayStr()) return;
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
