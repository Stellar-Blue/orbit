# Outlook room meetings ⇄ Orbit conference-room sessions

Date: 2026-11-04 · Status: approved in conversation, pending plan

## Intent

The team already runs recurring meetings in Outlook (stand-ups, weeklies). Today those meetings
are invisible to Orbit's conference rooms, so a room looks free in Orbit while it is actually
taken, and people have to re-create every meeting by hand as a session.

The organiser should be able to open an existing recurring Outlook meeting, add the conference
room from Outlook's room list (Room Finder / "Add room"), and have Orbit show a session in that
room for every occurrence — with the attendees already seated. The reverse also holds: a session
opened in Orbit books the room in Outlook, so neither side can double-book the room.

## Decided with the user

- **Rooms are Exchange room mailboxes.** People add a room in Outlook by picking it from the room
  list (e.g. `athena@stellarblue.eu`), not by typing a location. Each Orbit conference room is
  linked to its room mailbox; the room mailbox's calendar is what Orbit reads.
- **Seats:** the organiser and every invited attendee who is an Orbit colleague gets a seat in the
  session, the same way Orbit invites seat people today (a free chair is picked). An attendee who
  declines loses their seat. A colleague away that day (leave / remote) stays listed as invited
  without a seat. External attendees are listed, never seated.
- **Two-way:** a session opened in Orbit creates the Outlook meeting on the organiser's calendar
  with the room mailbox added as a resource attendee, so Outlook shows the room busy. This
  applies to every session in a room that has a mailbox, not only to sessions with invitees.
- **Horizon:** sessions are materialised for occurrences up to 12 weeks ahead, rolling forward
  daily.
- **Speed:** near-instant — Microsoft Graph change notifications on each room mailbox, plus a daily
  full re-check that catches anything missed, plus an admin "Sync now" action per room (also the
  only trigger in local development, where Graph cannot reach localhost).
- **Outlook-born sessions are read-only in Orbit** apart from Join / Release. Time, title, agenda,
  invitees and cancellation are changed in Outlook; Orbit labels them "Managed in Outlook" and
  hides edit, delete and invite for everyone, admins included.
- **Clashes:** an Outlook meeting that overlaps an existing Orbit session in the same room is not
  imported; it is flagged to admins on that room.
- **Setup:** the admin types the room mailbox address into the room in Spaces → Manage. A plain
  text field — no room picker.

## Goals

1. An Outlook meeting (single or recurring) with an Orbit room's mailbox as a room becomes one
   Orbit session per occurrence in that room, inside the 12-week horizon.
2. Changes made in Outlook — moved occurrence, edited series, new/removed attendees, declined
   responses, cancelled occurrence or series, room removed from the meeting — are reflected in
   Orbit within seconds in production, and at the latest by the next daily re-check.
3. Every session opened in Orbit in a room with a mailbox books that room in Outlook.
4. A meeting is never imported twice, and Orbit's own meetings are recognised when they come back
   through the room calendar (no loops, no duplicates).

## Non-goals

- Rooms without an Exchange room mailbox, or matching rooms by typed location text.
- Reading people's personal calendars for meetings that do not include a room.
- A room picker backed by Graph Places (would need an extra `Place.Read.All` consent).
- Editing Outlook-born sessions from Orbit.
- Desks and other whole-day spaces — only time-range rooms (conference rooms, pods).
- Slack messages for Outlook-born sessions (Outlook already notified the attendees).
- Teams meeting links, attachments, rich-text agenda rendering.

## Anti-goals (failure even if it "works")

- The same room booked twice for the same time, in either system.
- Duplicate sessions for one Outlook occurrence.
- A session someone created in Orbit silently disappearing because of a sync.
- Orbit sending attendees extra Outlook "meeting updated" mails for no-op syncs.
- Sync loops: an Orbit write that triggers a notification that triggers another Orbit write that
  changes something.
- Seats of people who joined a session manually in Orbit being released by the sync.

## Constraints and facts the builder needs

- **Stack:** Next.js 16 (read `node_modules/next/dist/docs/` before using framework APIs — it
  differs from older versions), Supabase (Postgres + RLS, migrations in `supabase/migrations/`),
  hosted on Vercel; crons are declared in `vercel.json` and currently run daily.
- **Graph access already exists:** an application token with tenant-wide `Calendars.ReadWrite`
  (admin-consented) via `getGraphToken()` in `src/lib/integrations/outlook.ts`, plus optional
  per-user delegated tokens. Application permission covers room mailboxes too, unless the tenant
  has an Exchange ApplicationAccessPolicy restricting the app — if so, the room mailboxes must be
  added to the allowed group (a one-time tenant setup step to document, not code).
- **Room calendar copies are often stripped.** Exchange room mailboxes default to
  `DeleteSubject`, `AddOrganizerToSubject` and `DeleteComments`, so the room's copy of a meeting
  may show the organiser's name as subject and no body. The room calendar is the truth for *that
  the room is booked and when*; the real subject, body and attendee list come from the
  organiser's copy of the same meeting (same `iCalUId`). If the organiser's copy cannot be read
  (external organiser), fall back to what the room copy has.
- **Recurrence:** read occurrences with `calendarView` over [today, today + 12 weeks], with the
  `Prefer: outlook.timezone="Europe/Athens"` header (Orbit stores local `DATE` + `TIME`, Athens).
  Graph's `iCalUId` is unique per occurrence, so it is the key that links a session to an
  occurrence across calendars. Occurrences are not listed by `/events`, so matching the
  organiser's copy means reading the organiser's `calendarView` for the same window (one read per
  organiser per sync, not per meeting).
- **Change notifications:** subscribe to `/users/{roomMailbox}/events` (created, updated,
  deleted). Graph validates a new subscription by calling the endpoint with `validationToken`,
  which must be echoed as `text/plain` within 10 seconds; notifications must be acknowledged with
  a 2xx within a few seconds, so the endpoint answers immediately and does the sync in `after()`
  from `next/server`. Every notification carries the `clientState` set at subscription time —
  verify it against a secret before acting. Outlook event subscriptions expire after at most
  ~7 days, so the daily job renews them (and re-creates one that has lapsed). A notification
  only means "this room changed": the handler re-syncs that room's whole window rather than
  applying the delta, which keeps one code path and makes replays harmless.
- **Retimed series.** Moving one occurrence keeps its link, but changing the time of a whole
  series may give every occurrence a new `iCalUId` (verify on the tenant). Treat "an unlinked
  occurrence of the same series on the same date as a session that just lost its occurrence" as
  the same session and move it, so seats — including manual joiners' — survive a series edit.
- **Notification storms.** One series edit produces a burst of notifications for the same room.
  Syncs of one room must not run concurrently (lock or coalesce per room); a burst should end in
  one or two syncs, not dozens.
- **Notification URL** must be public HTTPS: `NEXT_PUBLIC_APP_URL` + the route. Webhooks
  therefore only work on deployed environments.
- **Existing session model** (`space_sessions`, `space_bookings`, `space_session_invites`):
  database triggers already refuse overlapping sessions in a room, enforce capacity, one seat per
  person per session, and refuse a seat on a day the person is away (SQLSTATE `SB001`). The
  invite route (`src/app/api/spaces/session-invites/route.ts`) already contains the seat-booking
  loop with free-chair selection and the error mapping — reuse it, do not fork it.
- **Today a session's Outlook meeting id lives only on its invite rows**
  (`space_session_invites.outlook_event_id`, read by `calendarStateOf` in
  `src/lib/spaces-server.ts`). Two-way needs a meeting for sessions with no invitees, so the
  session itself has to own its meeting id (and its `iCalUId`). Existing rows need a backfill.
- **Orbit sessions are created client-side** (`bookSpaceSeat` in `src/lib/auth-context.tsx`
  inserts the session row directly). Creating the Outlook meeting with the room therefore needs a
  server call after the insert; deletion already calls the invites `DELETE` route to cancel
  meetings and must also cancel the session-owned one.

## Behaviour, rule by rule

**Linking.** A session is linked to an Outlook occurrence by `iCalUId`. A session also records
where it was born: `orbit` or `outlook`.

**Sync of one room** (shared by webhook, daily job and "Sync now"): read the room's occurrences in
the window, ignore cancelled, all-day and multi-day ones, then for each occurrence:

- linked to an existing session → bring that session's date/time/title/agenda in line with
  Outlook if they differ (this also covers an organiser moving an Orbit-born meeting in Outlook);
  for Outlook-born sessions also reconcile attendees and seats;
- not linked, no overlap → create an `outlook`-born session, seat the attendees;
- not linked, overlaps an Orbit session → do not import; record a clash on the room.

Then, for `outlook`-born sessions in the window (today onwards) whose occurrence is no longer in
the room calendar → delete the session (its bookings and invites go with it). Past sessions are
never touched.

For `orbit`-born sessions whose meeting is missing from the room calendar: if the organiser's copy
is gone or cancelled, the organiser cancelled it in Outlook → delete the session, like an
Outlook-born one. If the organiser's copy still exists but the room declined it, keep the session
and flag it ("room declined in Outlook") — never delete what someone made in Orbit on a decline.

**Seats and invites for Outlook-born sessions.** Attendees of type required/optional (not
resource) are written as invite rows; Orbit colleagues among them get a seat unless they declined
or are away. On later syncs, a person whose invite row came from the sync and who has since
declined or been removed loses invite and seat; people who joined manually (no invite row) keep
their seat. A full room means "invited without a seat", never a failed sync.

**Orbit-born sessions in a room with a mailbox.** On creation, Orbit creates the organiser's
meeting with the room mailbox as a resource attendee (plus any invitees, as today) and stores the
meeting id and `iCalUId` on the session. Edits patch it as today; deletion cancels it. Patches are
only sent when something actually changed (anti-goal: no-op update mails).

**Linking a room** (admin saves a mailbox): every upcoming Orbit-born session in that room gets
its Outlook meeting created or patched with the room added — decided with the user, accepting a
one-time burst of calendar mails. Then the subscription is created and the room is synced once.

**Unlinking a room** (admin clears the mailbox): the subscription is deleted and the room's future
Outlook-born sessions are removed; Orbit-born sessions stay.

**Visibility.** Outlook-born session rows show "Managed in Outlook" and the organiser's name.
Admins see the room's last sync time, last error and any clashes in Spaces → Manage.

## My calls (not discussed with the user — check these)

- Unlinking a room deletes its future Outlook-born sessions rather than leaving stale ones.
- Orbit-born sessions follow time/title changes made to their meeting in Outlook (last change
  wins), and are deleted when the organiser cancels the meeting in Outlook.
- A declined room on an Orbit-born session is flagged, not acted on.
- External organisers: the session is created with no Orbit organiser (`created_by` null), details
  from the room copy.
- Sync errors and clashes are surfaced to admins only, in Spaces → Manage, not pushed to Slack.
- "Read-only in Orbit" is enforced in the database (policy or trigger), not only by hiding
  buttons, since the client writes sessions directly.
- The Orbit-born meeting's attendee list stays as today (invitees + the room); people who only
  joined a seat in Orbit are not added to the Outlook meeting.

## Left to the builder

- Exact schema (column names, where subscription state lives, unique indexes) and the backfill.
- Route names, the shape of the webhook and "Sync now" endpoints, whether renewal rides on the
  existing `integration-daily` cron or a new one.
- The `clientState` secret's env var name.
- How the pure "plan the sync" logic is split from Graph I/O. It should be a pure function
  (room occurrences + existing sessions → creates / updates / deletes / clashes) with a check in
  `scripts/verify-spaces.mjs`, since that is where the risk lives.
- Concurrency guard for two notifications syncing the same room at once (a unique index on the
  linked `iCalUId` is the minimum).
- Wording of the UI labels.

## How we'll know it works

- Unit checks for the sync planner cover: new occurrence, moved occurrence, cancelled occurrence,
  room removed, attendee declined, manual joiner kept, Orbit-born meeting coming back (no
  duplicate), overlap clash, past sessions untouched.
- On the real tenant with one room mailbox: add the room to an existing recurring meeting →
  sessions appear for 12 weeks with attendees seated; move one occurrence → that session moves;
  cancel it → session gone; open a session in Orbit → room shows busy in Outlook Room Finder.
