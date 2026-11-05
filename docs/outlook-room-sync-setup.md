# Outlook room sync — setup

Conference rooms can be linked to their Exchange room mailbox. Meetings booked on the mailbox show up
in Orbit as sessions ("Managed in Outlook"), and sessions opened in Orbit book the room in Outlook.
Rooms that do not exist in Outlook yet can be created from Orbit.

## One-time setup

1. **Environment variables** (Vercel project settings):
   - `OUTLOOK_ROOMS_WEBHOOK_SECRET` — a random string of at most 128 characters
     (e.g. `openssl rand -hex 32`). Graph sends it back with every notification; anything else is ignored.
   - `NEXT_PUBLIC_APP_URL` — the public `https://` address of Orbit. Graph only notifies an https URL,
     so without it a room only syncs daily and on **Sync now** (always the case in local development).
   - *Optional* `OUTLOOK_ROOMS_BUILDING` / `OUTLOOK_ROOMS_FLOOR` — the building and floor to use when a
     room has no location or is not drawn on an Orbit floor (defaults: `Orbit` / `Main`).
2. **Database**: apply `supabase/migrations/20261105120000_outlook_room_sync.sql`.
3. **Create rooms from Orbit** (only if Outlook does not have them yet): the app registration needs
   - the **application** permission `Place.ReadWrite.All` (Microsoft Graph, admin consent), and
   - the Exchange application roles `MailRecipient` and `TenantPlacesManagement` for the app.
   The tenant must also have Places configured; without it the Places list calls return nothing:
   `Connect-MicrosoftPlaces`, then `Set-PlacesSettings -EnableBuildings 'Default:true'`.
   Creating rooms needs *Exchange Administrator* or a custom role with those assignments. Without
   these, **Sync to Outlook** reports exactly what is missing, and rooms that already exist in
   Exchange can still be linked by address.
4. **Exchange application access policy**: if the tenant restricts the Orbit app with an application
   access policy, add the room mailboxes to the allowed group. Otherwise the room shows
   "Orbit cannot read this room mailbox (access denied)".
5. **Vercel Deployment Protection**: `/api/integrations/outlook/rooms/notify` must be reachable
   without it (Graph cannot log in). Exempt the path or use a protection bypass for production.
6. **Room mailboxes should auto-accept** meeting requests (the Exchange default for room mailboxes).
   Until the room accepts, Orbit reports "waiting for the room to accept it in Outlook".

## Creating the rooms in Outlook

In **Spaces → Manage**, **Sync to Outlook** walks every active time-range room:

- a room with no mailbox is created in Outlook as a Places room (an Exchange room mailbox). Orbit
  creates or reuses the building (from the room's location) and floor (the Orbit floor it is drawn
  on), puts the room on that floor, and copies its name and capacity;
- a room that already has a mailbox has its name, capacity, location and floor brought back in step
  when they differ;
- every room is then subscribed, its upcoming Orbit sessions are booked in Outlook and its Outlook
  meetings are imported into Orbit — the same work as saving the mailbox by hand.

The result toast lists how many rooms were created/updated and every room that failed, with the
reason (usually a missing permission or Exchange role).

## Sessions on people's calendars

Every Orbit session owns one Outlook meeting, created on its organiser's calendar when the session is
opened — even when the room has no mailbox yet. The room appears in the meeting's location, and is
added as a resource attendee (so Outlook shows it busy) when it has one.

- **Joining a session puts it on your calendar.** Taking a seat adds your work email to the meeting;
  Outlook sends the invite and the event appears in that person's calendar. Releasing the seat takes
  you off it again.
- **Invited colleagues** are on the meeting too: holding a seat is participating, so the invitation
  carries the meeting to their calendar. The *Include an Outlook meeting invite* box additionally
  invites colleagues who could not take a seat (away that day, or a full room).
- **Deleting a session** cancels its meeting, so it disappears from everyone's calendar. A session
  whose last seat is released keeps its meeting (the organiser still has it) and the last person out
  is offered to delete the session.

## Linking an existing room mailbox

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
and reports the result. The **Outlook** link next to the mailbox opens the room's calendar in Outlook on
the web; the same link appears in the room's info in Spaces.
