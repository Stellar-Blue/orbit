# Outlook Room Meetings ⇄ Conference-Room Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Outlook meetings that book an Orbit room's Exchange room mailbox become Orbit sessions (attendees seated), and sessions opened in Orbit book that room mailbox in Outlook.

**Architecture:** A pure planner (`src/lib/room-sync.ts`) turns a room calendar's occurrences plus the room's existing sessions into creates / matches / deletes / clashes; a server module (`src/lib/room-sync-server.ts`) does the Graph reads, applies the plan with the service-role client, and manages one Graph change-notification subscription per room. Three triggers call the same `syncRoom`: the Graph webhook, a daily cron, and an admin "Sync now". The Orbit → Outlook direction extends the existing per-session meeting (`syncSessionCalendar`) with the room as a resource attendee and moves the meeting id onto the session.

**Tech Stack:** Next.js 16 route handlers (`after()` from `next/server`), Supabase Postgres + RLS (service role on the server), Microsoft Graph v1.0 with the existing application token, plain Node verification scripts.

**Spec:** `docs/superpowers/specs/2026-11-04-outlook-room-sessions-design.md`

## Global Constraints

- Read `node_modules/next/dist/docs/` before using any Next.js API (`after` is documented at `01-app/03-api-reference/04-functions/after.md`).
- No new npm dependencies.
- Times are Athens local: `DATE` + `TIME`, timezone `Europe/Athens` (`ATHENS_TIMEZONE` in `src/lib/integrations/types.ts`).
- Horizon: occurrences from today through today + 84 days (12 weeks). Sessions dated before today are never created, changed or deleted by the sync.
- Only time-range spaces (`space_types.booking_mode = 'time_range'`) can have a room mailbox.
- Outlook-born sessions show the label `Managed in Outlook`; no edit, delete or invite for anyone, admins included — enforced in the database and in every API route.
- Webhook `clientState` secret env var: `OUTLOOK_ROOMS_WEBHOOK_SECRET`. Notification URL: `${NEXT_PUBLIC_APP_URL}/api/integrations/outlook/rooms/notify`; a subscription is only created when that URL is `https://`.
- Demo mode (`isDemoMode()`) never calls the new server routes.
- Checks live in `scripts/verify-spaces.mjs` (`assert(condition, name, details)` style) and run with `npm run test:spaces`; `npx tsc --noEmit -p .` and `npx eslint <changed files>` must be clean. Follow the repo's `// eslint-disable-next-line react-hooks/set-state-in-effect -- reason` convention where needed.
- Migrations are applied by the user (no Supabase CLI in the repo); never apply them yourself.
- Commit after every task, message style `feat: …` / `fix: …`, ending with the attribution line in force for the session.

## Review Focus

1. **Room mailbox typed with capitals or spaces, or the same mailbox on two rooms** → stored lowercased/trimmed; a second room with the same mailbox is refused with a readable 409, not a raw constraint error. (Task 1 unique index on `lower(outlook_email)`, Task 6 route test-by-curl step.)
2. **Room booked by someone outside Orbit (external organiser, unknown attendees)** → session still created with no Orbit organiser, nobody seated, guests listed. (Task 2 `planAttendees` external-organiser check.)
3. **Graph refuses the room mailbox (application access policy, wrong address, no token)** → the room shows a readable error and no session is deleted. (Task 2 `describeGraphFailure` checks; Task 5 `syncRoom` returns before applying when the read fails.)
4. **Forged or stray webhook calls** (wrong `clientState`, unknown subscription, empty body) → ignored with 202, no sync. (Task 2 `notifiedSubscriptionIds` checks.)
5. **Last person releases their seat in a session that is booked in Outlook** → the session stays (room still booked) instead of vanishing and being re-imported on the next sync. (Task 1 trigger change; Task 7 manual check.)

## Decisions this plan adds to the spec

- Orbit-born sessions follow **time** changes made in Outlook on the same day. Their title stays Orbit's (the Outlook subject Orbit writes is `title · room`, so mapping it back would corrupt it). An Orbit-born meeting moved to another day in Outlook is reported as a room issue, not followed.
- An Outlook-born occurrence moved to another day is deleted and re-created (bookings carry a `booking_date`), so manual joiners of that one occurrence must re-join.
- The "last seat leaving closes the session" trigger skips sessions that own an Outlook meeting (`outlook_event_id` set) or are Outlook-born.
- Sync concurrency: a per-room claim column plus a "pending" flag; a burst of notifications ends in at most one extra run.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261105120000_outlook_room_sync.sql` (new) | Room mailbox + sync state columns, session link columns, policies, trigger, backfill |
| `src/lib/types.ts` | `Space`, `SpaceSession` fields |
| `src/lib/room-sync.ts` (new, pure) | Graph event types, `occurrenceFromGraph`, `planRoomSync`, `planAttendees`, `notifiedSubscriptionIds`, `describeGraphFailure` |
| `src/lib/spaces.ts` | `can*Session` refuse Outlook-born |
| `src/lib/integrations/outlook.ts` | Room as resource attendee in the session meeting; `graphCalendarView`; subscription calls |
| `src/lib/spaces-server.ts` | Session context gains room/link fields; `syncSessionCalendar` stores ids; `bookInviteeSeat`, `removeInvitee` helpers |
| `src/lib/room-sync-server.ts` (new) | `syncRoom`, `ensureRoomSubscription`, `linkRoomMailbox` |
| `src/app/api/spaces/sessions/route.ts` | `POST` ensure-meeting; `PATCH` refuses Outlook-born |
| `src/app/api/spaces/session-invites/route.ts` | Uses extracted helpers; refuses Outlook-born; DELETE cancels the session-owned meeting |
| `src/app/api/integrations/outlook/rooms/notify/route.ts` (new) | Graph validation + notifications |
| `src/app/api/spaces/room-mailbox/route.ts` (new) | Admin link / unlink |
| `src/app/api/spaces/room-sync/route.ts` (new) | Admin "Sync now" |
| `src/app/api/cron/room-sync/route.ts` (new) + `vercel.json` | Daily renew + full sync |
| `src/lib/auth-context.tsx` | Ensure-meeting call after a new session; `linkRoomMailbox`, `syncRoomNow` |
| `src/components/spaces/spaces-manager.tsx`, `src/components/spaces/session-slots.tsx` | Mailbox field, sync status, Sync now; `Managed in Outlook` |

---

### Task 1: Schema, policies and types

**Files:**
- Create: `supabase/migrations/20261105120000_outlook_room_sync.sql`
- Modify: `src/lib/types.ts:583-682` (`Space`, `SpaceSession`)

**Interfaces:**
- Produces columns — `spaces`: `outlook_email TEXT` (unique on `lower(outlook_email)` where not null), `outlook_subscription_id TEXT`, `outlook_subscription_expires_at TIMESTAMPTZ`, `outlook_synced_at TIMESTAMPTZ`, `outlook_sync_error TEXT`, `outlook_clashes JSONB NOT NULL DEFAULT '[]'`, `outlook_sync_started_at TIMESTAMPTZ`, `outlook_sync_pending BOOLEAN NOT NULL DEFAULT FALSE`. `space_sessions`: `source TEXT NOT NULL DEFAULT 'orbit' CHECK (source IN ('orbit','outlook'))`, `outlook_ical_uid TEXT` (unique where not null), `outlook_series_id TEXT`, `outlook_event_id TEXT`.
- Produces TS: `Space` gains the eight fields above (optional); `RoomClash = { date: string; startsAt: string; endsAt: string; subject: string | null; organizer: string | null }` exported from `types.ts`; `SpaceSession` gains `source?: 'orbit' | 'outlook'`, `outlook_ical_uid?`, `outlook_series_id?`, `outlook_event_id?` (all `string | null`).

- [ ] **Step 1: Write the migration**, header comment in the style of `20261102140000_space_session_edit.sql`. Contents, in order: the columns and indexes above; backfill `space_sessions.outlook_event_id` from the oldest `space_session_invites` row with `outlook_status = 'sent'` and a non-null `outlook_event_id` per session; recreate `space_sessions_update_own`, `space_sessions_delete_own` and `space_sessions_admin_delete` with `source = 'orbit' AND (...)` added to `USING` (and `WITH CHECK` for update); `CREATE OR REPLACE FUNCTION public.close_empty_space_session()` with the delete guarded by `AND NOT EXISTS (SELECT 1 FROM public.space_sessions s WHERE s.id = OLD.session_id AND (s.source = 'outlook' OR s.outlook_event_id IS NOT NULL))`, keeping `SECURITY DEFINER`, `search_path` and the existing `REVOKE EXECUTE`; `COMMENT ON COLUMN` for each new column.
- [ ] **Step 2: Update the types** in `src/lib/types.ts` as in Interfaces.
- [ ] **Step 3: Verify** — Run: `npx tsc --noEmit -p .` Expected: no output.
- [ ] **Step 4: Ask the user to apply the migration** to the Supabase project, and wait for confirmation before Task 5's live checks (Tasks 2–4 do not need it).
- [ ] **Step 5: Commit** — `git add supabase/migrations/20261105120000_outlook_room_sync.sql src/lib/types.ts && git commit -m "feat: schema for Outlook room mailboxes and linked sessions"`

### Task 2: Pure sync planner

**Files:**
- Create: `src/lib/room-sync.ts` (imports only `@/lib/spaces` and types)
- Test: `scripts/verify-spaces.mjs`

**Interfaces:**
- Consumes: `overlappingSession`, `clockLabel` from `@/lib/spaces`; `SpaceSession`, `RoomClash` from `@/lib/types`.
- Produces:
  - `type GraphCalendarEvent = { id: string; iCalUId: string; seriesMasterId?: string | null; type?: 'singleInstance' | 'occurrence' | 'exception' | 'seriesMaster'; subject?: string | null; body?: { content?: string | null } | null; start: { dateTime: string }; end: { dateTime: string }; isAllDay?: boolean; isCancelled?: boolean; organizer?: { emailAddress?: { name?: string; address?: string } }; attendees?: { type?: 'required' | 'optional' | 'resource'; status?: { response?: string }; emailAddress?: { name?: string; address?: string } }[] }`
  - `type OccurrenceAttendee = { email: string; name: string | null; response: 'accepted' | 'tentative' | 'declined' | 'none' | 'organizer' }`
  - `type RoomOccurrence = { icalUid: string; seriesId: string | null; date: string; startsAt: string; endsAt: string; subject: string | null; body: string | null; organizerEmail: string | null; organizerName: string | null; attendees: OccurrenceAttendee[] }` (`startsAt`/`endsAt` are `HH:MM`)
  - `type LinkedSession = Pick<SpaceSession, 'id' | 'session_date' | 'starts_at' | 'ends_at' | 'title' | 'description' | 'source' | 'outlook_ical_uid' | 'outlook_series_id'>`
  - `type RoomSyncMatch = { sessionId: string; source: 'orbit' | 'outlook'; occurrence: RoomOccurrence; changed: boolean; relink: boolean }`
  - `type RoomSyncPlan = { creates: RoomOccurrence[]; matches: RoomSyncMatch[]; deletes: string[]; clashes: RoomClash[]; missingOrbit: string[]; issues: string[] }`
  - `occurrenceFromGraph(room: GraphCalendarEvent, organizerCopy: GraphCalendarEvent | null, roomMailbox: string): RoomOccurrence | null`
  - `planRoomSync(args: { occurrences: RoomOccurrence[]; sessions: LinkedSession[]; today: string }): RoomSyncPlan`
  - `planAttendees(args: { occurrence: RoomOccurrence; directory: Map<string, { id: string; name: string }>; existingInvites: { email: string; profile_id: string | null }[] }): { add: { email: string; profileId: string | null; name: string | null }[]; remove: { email: string; profileId: string | null }[] }`
  - `notifiedSubscriptionIds(body: unknown, clientState: string): string[]`
  - `describeGraphFailure(failure: { status: number; code?: string; message?: string }): string`
  - `type RoomSyncResult = { ok: boolean; created: number; updated: number; deleted: number; clashes: number; issues: string[]; error?: string; skipped?: 'locked' | 'no_mailbox' }` (type only; shared by server and client)

Rules the tests pin (implement exactly these):
- `occurrenceFromGraph` → `null` for `isCancelled`, `isAllDay`, `type === 'seriesMaster'`, or start/end on different dates. `date`/`startsAt`/`endsAt` are sliced from `dateTime` (already Athens via the `Prefer` header). Subject, body, organiser and attendees come from `organizerCopy` when given, else `room`. Attendees: drop `type: 'resource'` and the room mailbox itself, lowercase + dedupe emails; response map `accepted→accepted`, `tentativelyAccepted→tentative`, `declined→declined`, `organizer→organizer`, anything else `none`. Body trimmed, cut to 2000 chars, empty → `null`. `seriesId` = room event's `seriesMasterId ?? null`.
- `planRoomSync`: ignore sessions and occurrences dated before `today`; process occurrences sorted by date then start. Occurrence with a session of the same `outlook_ical_uid` → match. For an Outlook-born match on a different date → that session in `deletes`, occurrence in `creates`. For an Orbit-born match on a different date → an `issues` entry, no match. Otherwise `changed` = window differs, or (Outlook-born only) title/description differ from `subject`/`body`. An unmatched occurrence whose `seriesId` equals the `outlook_series_id` of an Outlook-born session on the same date whose uid is no longer among the occurrences → match with `relink: true`, `changed: true`. Remaining unmatched occurrence → clash if it overlaps (via `overlappingSession`) any surviving session's final window or an earlier create on that date, else create. Outlook-born sessions left unmatched → `deletes`; Orbit-born sessions with a uid left unmatched → `missingOrbit`; Orbit-born without a uid are only obstacles.
- `planAttendees`: desired = organiser (response `organizer`) + attendees whose response is not `declined`; `add` = desired not in `existingInvites` (profile from `directory` by email, `profileId` null when absent); `remove` = existing invites not desired. Nobody outside `existingInvites` is ever in `remove`.
- `notifiedSubscriptionIds`: from `{ value: [{ subscriptionId, clientState }] }`, unique ids whose `clientState === clientState`; `[]` for an empty secret or malformed body.
- `describeGraphFailure`: `403` or code `ErrorAccessDenied` → `"Orbit cannot read this room mailbox (access denied). If the tenant uses an Exchange application access policy, add the room mailbox to it."`; `404` or code in `ErrorInvalidUser`, `ResourceNotFound`, `MailboxNotEnabledForRESTAPI` → `"No mailbox found at this address — check the room mailbox email."`; code `no_token` or status `0` → `"Microsoft Graph is not configured (no application token)."`; else `` `Outlook returned ${status}${code ? ` (${code})` : ''}: ${message || 'unknown error'}` ``.

- [ ] **Step 1: Write the failing checks** in `scripts/verify-spaces.mjs` (import the five functions from `@/lib/room-sync`), with fixture helpers `occ(uid, date, startsAt, endsAt, extra)` and `ses(id, source, uid, date, startsAt, endsAt, extra)` (times `HH:MM:SS` for sessions). One `assert` per line below, today = `'2026-11-05'`:
  - all-day, cancelled, series master, and `2026-11-10T23:00` → `2026-11-11T00:30` events each give `null`;
  - `2026-11-10T09:30:00.0000000`–`10:00` gives `date '2026-11-10'`, `startsAt '09:30'`, `endsAt '10:00'`;
  - organiser copy subject `'Weekly sync'` wins over room copy subject `'Ana Papadopoulou'`;
  - attendees drop the resource and `athena@stellarblue.eu`, `KOSTAS@x.gr` becomes `kostas@x.gr`, `tentativelyAccepted` becomes `tentative`;
  - new occurrence, empty room → `creates.length === 1`;
  - Outlook-born session `09:00–10:00`, same uid now `09:30–10:30` → one match, `changed === true`, no creates/deletes;
  - same uid, same window and title → match with `changed === false`;
  - Outlook-born session whose uid is gone → `deletes` contains it;
  - Orbit-born session with uid `u-orbit` present in the room calendar → one match, `creates.length === 0` (no duplicate);
  - Orbit-born session with uid gone → `missingOrbit` contains it, `deletes` does not;
  - Orbit-born session (no uid) `10:00–11:00` and new occurrence `10:30–11:30` → one clash `{ date, startsAt: '10:30', endsAt: '11:30' }`, no create;
  - session dated `2026-11-04` with uid gone → untouched (not in deletes);
  - Outlook-born uid `u1` series `s1` on `2026-11-12`, occurrences only `u9` series `s1` same date → match `relink === true`, no delete, no create;
  - Outlook-born match moved from `2026-11-12` to `2026-11-13` → its id in `deletes` and the occurrence in `creates`;
  - Orbit-born match moved to another date → one `issues` entry, no match;
  - `planAttendees`: existing `[ana (declined now)]`, attendees accepted `kostas` (in directory) and external `guest@ex.com`, organiser `maria` (in directory) → remove `[ana]`, add `kostas` with profileId, `guest@ex.com` with `profileId === null`, `maria`;
  - external organiser not in directory → add entry with `profileId === null`;
  - `notifiedSubscriptionIds({ value: [{ subscriptionId: 'a', clientState: 's' }, { subscriptionId: 'a', clientState: 's' }, { subscriptionId: 'b', clientState: 'x' }] }, 's')` → `['a']`; `(null, 's')` → `[]`; `(validBody, '')` → `[]`;
  - `describeGraphFailure` for `{ status: 403 }`, `{ status: 404, code: 'ErrorInvalidUser' }`, `{ status: 0, code: 'no_token' }`, `{ status: 500, code: 'X', message: 'boom' }` → the four strings above.
- [ ] **Step 2: Run** `npm run test:spaces` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `src/lib/room-sync.ts` with the signatures and rules above.
- [ ] **Step 4: Run** `npm run test:spaces` — Expected: all pass, `0 failed`.
- [ ] **Step 5: Commit** — `feat: pure planner for syncing room calendars into sessions`

### Task 3: Read-only Outlook sessions and room-aware meeting payload

**Files:**
- Modify: `src/lib/spaces.ts:312-343`, `src/lib/integrations/outlook.ts:245-344`
- Test: `scripts/verify-spaces.mjs`

**Interfaces:**
- Produces: `canDeleteSession`, `canInviteToSession`, `canEditSession` take `Pick<SpaceSession, 'created_by' | 'source'>` and return `false` when `source === 'outlook'`.
- Produces: `SessionInviteDetails.roomMailbox?: string | null`; `buildSessionInvitePayload` appends `{ emailAddress: { address: roomMailbox, name: roomName }, type: 'resource' }` and sets `location.locationEmailAddress = roomMailbox` when given. `GraphAttendee.type` accepts `'resource'`.
- Produces: `syncSessionCalendarInvite(...)` returns `{ ok: boolean; eventId?: string; icalUid?: string; error?: string }`; a meeting is kept/created when `attendees.length > 0 || roomMailbox`, cancelled only when both are empty; `icalUid` read from the created/patched event's `iCalUId`.

- [ ] **Step 1: Failing checks:** `canEditSession({ created_by: 'p1', source: 'outlook' }, 'p1', true) === false` and same for delete/invite; `canEditSession({ created_by: 'p1', source: 'orbit' }, 'p1', false) === true`; payload with `roomMailbox: 'athena@stellarblue.eu'` has a `resource` attendee with that address and `location.locationEmailAddress` equal to it; payload without it has no resource attendee.
- [ ] **Step 2: Run** `npm run test:spaces` — Expected: the new checks FAIL.
- [ ] **Step 3: Implement** the three changes above.
- [ ] **Step 4: Run** `npm run test:spaces` and `npx tsc --noEmit -p .` — Expected: all pass; no type errors (callers of `can*Session` already pass full sessions).
- [ ] **Step 5: Commit** — `feat: Outlook-born sessions are read-only; session meetings book the room`

### Task 4: Session server plumbing (Orbit → Outlook)

**Files:**
- Modify: `src/lib/spaces-server.ts`, `src/app/api/spaces/sessions/route.ts`, `src/app/api/spaces/session-invites/route.ts`

**Interfaces:**
- Consumes: Task 3 `syncSessionCalendarInvite` result, `roomMailbox` detail.
- Produces in `spaces-server.ts`:
  - `SessionContext` gains `source: 'orbit' | 'outlook'`, `roomMailbox: string | null`, `outlookEventId: string | null`, `outlookIcalUid: string | null` (`loadSessionContext` selects them; `roomMailbox` from `spaces.outlook_email`).
  - `calendarStateOf` returns `eventId = session.outlook_event_id ?? <oldest invite row's id>` (attendees unchanged).
  - `syncSessionCalendar(args)` returns `{ ok: true }` without calling Graph for `source === 'outlook'`; passes `roomMailbox`; after success writes `outlook_event_id` / `outlook_ical_uid` to the session when they changed (null both when the meeting was cancelled).
  - `bookInviteeSeat(admin, target: { spaceId: string; sessionId: string; sessionDate: string }, profileId: string, createdBy: string | null): Promise<{ seat: 'booked' | 'already' | 'full' | 'away' | 'failed'; error?: string }>` — moved verbatim in behaviour from `session-invites/route.ts:151-194` (absence check, `freeChairsFor`, chair retry loop, error mapping; `away` carries the `"invited, but … that day"` message as `error`).
  - `removeInvitee(admin, sessionId: string, email: string): Promise<{ removed: boolean; seatReleased: boolean }>` — the invite-row + booking deletion from the route's single-email `DELETE` branch, without the calendar sync.
- Produces routes: `POST /api/spaces/sessions` body `{ session_id }` → caller must be creator or admin; ensures the meeting via `syncSessionCalendar` with `calendarStateOf` attendees; responds `{ ok, skipped?: 'outlook' | 'no_mailbox', outlook_event_id?, calendar_error? }`. `PATCH /api/spaces/sessions` and `POST`/`DELETE /api/spaces/session-invites` answer `403 { error: 'This session is managed in Outlook — change it there.' }` for Outlook-born sessions. `PATCH` syncs the calendar when `calendar.eventId || calendar.attendees.length > 0 || context.roomMailbox`. `DELETE ?session_id` alone also cancels `context.outlookEventId` on the organiser's (`created_by`) mailbox.

- [ ] **Step 1: Extract** `bookInviteeSeat` and `removeInvitee`, switch `session-invites/route.ts` to them (no behaviour change).
- [ ] **Step 2: Run** `npm run test:spaces` and `npx tsc --noEmit -p .` — Expected: pass, no errors.
- [ ] **Step 3: Implement** the context, `calendarStateOf`, `syncSessionCalendar` and route changes listed above.
- [ ] **Step 4: Run** `npx tsc --noEmit -p .`, `npx eslint src/lib/spaces-server.ts src/app/api/spaces`, `npm run test:spaces` — Expected: all clean.
- [ ] **Step 5: Commit** — `feat: sessions own their Outlook meeting and book the room mailbox`

### Task 5: Graph room reads, subscriptions and the sync engine

**Files:**
- Modify: `src/lib/integrations/outlook.ts`
- Create: `src/lib/room-sync-server.ts`

**Interfaces:**
- Consumes: Task 2 (`occurrenceFromGraph`, `planRoomSync`, `planAttendees`, `describeGraphFailure`, `GraphCalendarEvent`); Task 4 (`bookInviteeSeat`, `removeInvitee`, `syncSessionCalendar`, `calendarStateOf`, `loadSessionContext`).
- Produces in `outlook.ts`: private `graphRequest` gains an optional `extraHeaders` parameter, passed through retries. Exported:
  - `graphCalendarView(mailbox: string, startIso: string, endIso: string): Promise<{ ok: true; events: GraphCalendarEvent[] } | { ok: false; status: number; code?: string; message?: string }>` — `GET /users/{mailbox}/calendarView`, `$top=100`, follows `@odata.nextLink`, headers `Prefer: outlook.timezone="Europe/Athens", outlook.body-content-type="text"`, `$select=id,iCalUId,seriesMasterId,type,subject,body,start,end,isAllDay,isCancelled,organizer,attendees`.
  - `graphCreateSubscription(input: { resource: string; notificationUrl: string; clientState: string; expirationDateTime: string })`, `graphRenewSubscription(id: string, expirationDateTime: string)`, `graphDeleteSubscription(id: string)` — all `Promise<GraphResult>` against `/subscriptions`, `changeType: 'created,updated,deleted'`.
- Produces in `room-sync-server.ts` (using `RoomSyncResult` from `@/lib/room-sync`):
  - `syncRoom(admin: SupabaseClient, spaceId: string): Promise<RoomSyncResult>`
  - `ensureRoomSubscription(admin: SupabaseClient, spaceId: string): Promise<{ state: 'active' | 'renewed' | 'created' | 'skipped'; reason?: string }>`
  - `linkRoomMailbox(admin: SupabaseClient, spaceId: string, email: string | null): Promise<{ ok: boolean; error?: string; status?: number; backfilled: number; subscription?: string; sync?: RoomSyncResult }>`

`syncRoom` algorithm (decided here):
1. Claim: `update spaces set outlook_sync_started_at = now` where `id = spaceId` and (`outlook_sync_started_at` is null or older than 5 minutes), returning the row. Not claimed → set `outlook_sync_pending = true`, return `{ ok: true, skipped: 'locked', … }`.
2. Read room calendar for [yesterday UTC 00:00, today + 85 days]. On failure → write `outlook_sync_error = describeGraphFailure(...)`, release, return `ok: false`. Nothing else is touched.
3. Read each distinct organiser's `calendarView` once (skip the room mailbox and organisers not in the tenant — a failed read means "use the room copy"); map by `iCalUId`; build occurrences with `occurrenceFromGraph`.
4. Load the room's sessions `session_date >= today`; `planRoomSync`.
5. Apply: creates insert `{ source: 'outlook', outlook_ical_uid, outlook_series_id, created_by: organiser profile id | null, title: subject, description: body }` (23505 on the uid = already created by a concurrent run → skip; overlap trigger error → add a clash); matches with `changed` update window/title/description (Outlook-born) or window only (Orbit-born) plus uid/series when `relink`; for every Outlook-born create/match run `planAttendees` and apply with `bookInviteeSeat` / invite upsert (`slack_status` and `outlook_status` `'skipped'`, `invited_by` = organiser id) / `removeInvitee`; deletes delete the session; each `missingOrbit` session: `graphGetEvent(organiserEmail, outlook_event_id)` — 404 or `isCancelled` → delete the session, otherwise add issue `"<title or Session> on <date> <HH:MM>: the room declined it in Outlook"`.
6. Write `outlook_synced_at = now`, `outlook_sync_error = issues.join('\n') || null`, `outlook_clashes = plan.clashes`, release the claim; if `outlook_sync_pending` was true, reset it and run once more (at most one extra run).

`ensureRoomSubscription`: skip with a reason when the room has no mailbox, `OUTLOOK_ROOMS_WEBHOOK_SECRET` is unset, or the notification URL is not `https://`; renew when the stored expiry is within 48 h; create when there is none or renewal returns 404; expiry = now + 6 days; persist id and expiry.

`linkRoomMailbox`: admin authorisation is the route's job. Normalise with `normalizeInviteEmail`; refuse non-time-range rooms (400). Changing or clearing: delete the old subscription, delete the room's Outlook-born sessions dated today or later. Setting: save (unique violation → `status: 409`, error `"<email> is already linked to another room."`); for every Orbit-born session dated today or later in that room run `syncSessionCalendar` with `calendarStateOf` attendees (count them as `backfilled`); `ensureRoomSubscription`; `syncRoom`.

- [ ] **Step 1: Implement** the Graph functions in `outlook.ts`.
- [ ] **Step 2: Implement** `room-sync-server.ts` per the algorithm above.
- [ ] **Step 3: Run** `npx tsc --noEmit -p .`, `npx eslint src/lib/integrations/outlook.ts src/lib/room-sync-server.ts`, `npm run test:spaces` — Expected: clean, all pass.
- [ ] **Step 4: Commit** — `feat: room calendar sync engine and Graph subscriptions`

### Task 6: Routes and cron

**Files:**
- Create: `src/app/api/integrations/outlook/rooms/notify/route.ts`, `src/app/api/spaces/room-mailbox/route.ts`, `src/app/api/spaces/room-sync/route.ts`, `src/app/api/cron/room-sync/route.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: Task 2 `notifiedSubscriptionIds`; Task 5 `syncRoom`, `ensureRoomSubscription`, `linkRoomMailbox`; `requireApiSession`, `requireCronSecret`, `isNextResponse` from `@/lib/integrations/api-helpers`; `getAdminClient` from `@/lib/integrations/server`.
- Produces:
  - `POST /api/integrations/outlook/rooms/notify` — with `?validationToken=` returns it decoded, `200`, `Content-Type: text/plain`. Otherwise parses JSON, maps `notifiedSubscriptionIds(body, process.env.OUTLOOK_ROOMS_WEBHOOK_SECRET || '')` to spaces by `outlook_subscription_id`, schedules `syncRoom` for each with `after()`, returns `202` with an empty body — always 202 for a non-validation call, including bad bodies.
  - `PUT /api/spaces/room-mailbox` `{ space_id, outlook_email: string | null }` — admin only (403 otherwise); returns `linkRoomMailbox`'s result with its `status` (default 200).
  - `POST /api/spaces/room-sync` `{ space_id }` — admin only; `ensureRoomSubscription` then `syncRoom`; returns `{ subscription, sync }`.
  - `GET /api/cron/room-sync` — `requireCronSecret`; for every active space with `outlook_email`: `ensureRoomSubscription` + `syncRoom`; returns per-room summary.
  - `vercel.json` cron `{ "path": "/api/cron/room-sync", "schedule": "45 4 * * *" }`.

- [ ] **Step 1: Implement** the four routes and the cron entry.
- [ ] **Step 2: Verify the webhook locally** — with `npm run dev` running: `curl -s -X POST 'http://localhost:3000/api/integrations/outlook/rooms/notify?validationToken=abc%20123'` → body `abc 123`; `curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"value":[{"subscriptionId":"x","clientState":"wrong"}]}' http://localhost:3000/api/integrations/outlook/rooms/notify` → `202`; `curl -s -o /dev/null -w '%{http_code}' -X PUT -H 'Content-Type: application/json' -d '{}' http://localhost:3000/api/spaces/room-mailbox` → `401`.
- [ ] **Step 3: Run** `npx tsc --noEmit -p .` and `npx eslint src/app/api/integrations/outlook src/app/api/spaces src/app/api/cron/room-sync` — Expected: clean.
- [ ] **Step 4: Commit** — `feat: Outlook room webhook, link, sync-now and daily cron routes`

### Task 7: Client and UI

**Files:**
- Modify: `src/lib/auth-context.tsx` (`bookSpaceSeat` ~5889, `saveSpace` ~5627, context value ~7398), `src/components/spaces/spaces-manager.tsx`, `src/components/spaces/session-slots.tsx`

**Interfaces:**
- Consumes: Task 6 routes; Task 1 types; Task 3 `can*Session`.
- Produces in `useAuth()`: `linkRoomMailbox(spaceId: string, email: string | null): Promise<{ ok: boolean; error?: string; backfilled?: number; sync?: RoomSyncResult }>` and `syncRoomNow(spaceId: string): Promise<{ ok: boolean; error?: string; sync?: RoomSyncResult }>` (both `fetch` the routes, then `refreshSpaces()`; demo mode returns `{ ok: false, error: 'Outlook rooms need the real workspace.' }`). Import `RoomSyncResult` as a type from `@/lib/room-sync`, never from the server module.
- `bookSpaceSeat`: when it inserted a new session (not a join, not demo), fire-and-forget `POST /api/spaces/sessions { session_id }`.

- [ ] **Step 1: Implement** the two `useAuth` functions and the `bookSpaceSeat` call.
- [ ] **Step 2: Spaces manager** — room dialog shows a `Room mailbox` email input only for time-range types (placeholder `room@stellarblue.eu`, hint `Pick this room in Outlook's room list and its meetings appear here.`); on save, when the value changed, call `linkRoomMailbox` and report the result (`notifySuccess` with backfilled/created counts, or `alert` the error). Rooms table: for a linked room, a meta line `Outlook · <mailbox> · synced <HH:MM>` (or `not synced yet`), the error text in rose when `outlook_sync_error` is set, `<n> clash(es)` with the clashes listed in its `title`, and a `Sync now` button calling `syncRoomNow`.
- [ ] **Step 3: Session rows** — `session-slots.tsx`: for `source === 'outlook'` show a `ui-meta` line `Managed in Outlook` (with the `CalendarDays` icon) under the window; edit/delete buttons already disappear through `can*Session`.
- [ ] **Step 4: Run** `npx tsc --noEmit -p .`, `npx eslint src/lib/auth-context.tsx src/components/spaces`, `npm run test:spaces` — Expected: clean.
- [ ] **Step 5: Check in the app** — `npm run dev`, Spaces → Manage as admin: the mailbox field appears for a conference room and not for a desk type; Spaces page renders with no console errors. (Data-dependent flows are Task 8.)
- [ ] **Step 6: Commit** — `feat: room mailbox setup, sync status and Outlook-managed sessions in Spaces`

### Task 8: Live tenant verification (with the user)

Needs: migration applied, deployed preview or production with `NEXT_PUBLIC_APP_URL` (https) and `OUTLOOK_ROOMS_WEBHOOK_SECRET` set, one real room mailbox. Each step is done by or with the user; report outcomes faithfully.

- [ ] **Step 1:** Link the room mailbox in Spaces → Manage → expect `backfilled` = number of upcoming Orbit sessions in that room, a subscription `created`, and no sync error. An access-denied error means the Exchange application access policy needs the room mailbox (tenant admin step).
- [ ] **Step 2:** Add the room to an existing recurring Outlook meeting → within a minute, sessions for each occurrence in the next 12 weeks, organiser and Orbit attendees seated, label `Managed in Outlook`.
- [ ] **Step 3:** Move one occurrence → that session moves. Change the whole series' time → sessions move, seats kept (confirms the series-retime matching). Decline as one attendee → their seat goes. Cancel one occurrence → that session goes.
- [ ] **Step 4:** Open a session in Orbit in that room → the room shows busy in Outlook Room Finder; delete it in Orbit → the room is free again.
- [ ] **Step 5:** Release every seat of an Outlook-born session → the session stays. Run the cron once (`curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/room-sync`) → subscription renewed, no duplicates.
