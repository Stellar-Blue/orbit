# Outlook room sync — setup

Conference rooms can be linked to their Exchange room mailbox. Meetings booked on the mailbox show up
in Orbit as sessions ("Managed in Outlook"), and sessions opened in Orbit book the room in Outlook.

## One-time setup

1. **Environment variables** (Vercel project settings):
   - `OUTLOOK_ROOMS_WEBHOOK_SECRET` — a random string of at most 128 characters
     (e.g. `openssl rand -hex 32`). Graph sends it back with every notification; anything else is ignored.
   - `NEXT_PUBLIC_APP_URL` — the public `https://` address of Orbit. Graph only notifies an https URL,
     so without it a room only syncs daily and on **Sync now** (always the case in local development).
2. **Database**: apply `supabase/migrations/20261105120000_outlook_room_sync.sql`.
3. **Exchange application access policy**: if the tenant restricts the Orbit app with an application
   access policy, add the room mailboxes to the allowed group. Otherwise the room shows
   "Orbit cannot read this room mailbox (access denied)".
4. **Vercel Deployment Protection**: `/api/integrations/outlook/rooms/notify` must be reachable
   without it (Graph cannot log in). Exempt the path or use a protection bypass for production.
5. **Room mailboxes should auto-accept** meeting requests (the Exchange default for room mailboxes).
   Until the room accepts, Orbit reports "waiting for the room to accept it in Outlook".

## Linking a room

In **Spaces → Manage**, edit a time-range room and type its room mailbox (e.g. `athena@stellarblue.eu`)
in **Room mailbox**. Saving it:

- books the room on every upcoming Orbit session's Outlook meeting (attendees get an update mail once);
- subscribes to the room calendar for live updates (renewed by the daily cron at 04:45 UTC);
- imports the room's Outlook meetings for the next 12 weeks.

Saving the room again retries meetings that failed to book. Clearing or changing the mailbox deletes the
room's upcoming Outlook-born sessions; Orbit-born sessions stay. A colleague's own address is refused.

## What admins see

Each linked room in Manage shows its mailbox, the last sync time, clashes (Outlook meetings that overlap
an Orbit session and were not imported) and, in red, the last sync's issues: a failed read, meetings not
booked in Outlook, rooms that declined, live updates being off. **Sync now** re-reads the room at once
and reports the result.
