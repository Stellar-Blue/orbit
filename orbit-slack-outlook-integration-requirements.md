# Orbit — Slack Status & Outlook Calendar Integration Requirements

**Status:** Draft v1.2 — Slack connection is per-user and admin-controlled (§2.1): required users are gated at first login, optional users connect only if they choose; self-service opt-out removed in favor of admin exemptions
**Purpose:** when Orbit knows someone is on leave or working remotely, the tools where colleagues actually look — Slack and Outlook — should reflect it automatically. No more setting the palm-tree emoji by hand, no more meetings booked over someone's approved vacation.
**Direction (the core rule):** **Orbit → outward only.** Orbit is the master of leave/remote state; Slack statuses and Outlook events are mirrors. Nothing flows back — same ownership philosophy as the Attio integration. Editing a mirrored artifact in Slack/Outlook changes nothing in Orbit and gets re-asserted by reconciliation.
**Inherits:** leave lifecycle & privacy rules (leave spec), remote days/patterns, `work_schedule`, mandatory-leave fan-out, outbox + reconciliation patterns (Attio guide), Entra ID tenant.

---

## 1. What gets mirrored where

| Orbit state | Slack | Outlook (Microsoft Graph) |
|---|---|---|
| Approved leave, per calendar day of it | Status: 🌴 `Out of office — back {return_date}` with expiration | All-day event "Out of office", **show-as: Out of Office (`oof`)**, spanning the leave's working days |
| Remote day (`remote_gr` / `remote_abroad`) | Status: 🏠 `Working remotely` with same-day expiration | **Outlook work plan only** (`workHoursAndLocations`) — a recurring `remote` rule for each remote weekday in the pattern, a single one-off `remote` occurrence for an ad-hoc day. **Never a calendar event.** |
| Half-day leave | Status text notes it: `Out of office (afternoon)` | Timed event covering the half (per `work_schedule` day bounds, default 09:00–13:00 / 13:00–17:00 Europe/Athens) |
| Public holiday / weekend / non-schedule day | nothing — no status, no event | nothing |
| Mandatory leave (fan-out rows) | identical to regular leave | identical to regular leave |
| Optional, opt-in: leave auto-reply | — | Automatic replies (`automaticRepliesSetting`) scheduled for the leave range, from an employee-editable template |

**Privacy rule (hard):** leave *type* never leaves Orbit. Slack text and Outlook event subjects use configurable generic labels (default "Out of office") for every type — sick leave must be indistinguishable from annual leave to colleagues. Admins may configure a friendlier label per type (e.g. 🌴 for annual) only if the label itself is non-revealing; the settings screen warns about this explicitly. Notes and documents never sync anywhere.

## 2. Slack integration

- **Per-user OAuth via a *user* token.** Setting a user's status requires a user token with `users.profile:write` — a bot token cannot do it. Whether connecting is *required* is admin-controlled per user (`profiles.slack_required`): required users are gated at first login (§2.1); optional users may connect voluntarily from their profile, and once connected their status is mirrored like anyone else's.
- **Setting:** a morning job (07:30 Europe/Athens, before the workday) sets the status for anyone whose day is leave/remote, using Slack's `status_expiration` set to end-of-day (or leave end for multi-day) — **statuses self-clear**, so the common case needs no cleanup call and a crashed evening job can't leave stale statuses.
- **Never fight the human:** before writing, read the current status; overwrite only if it's empty or matches the last status Orbit set (stored per user). An employee who manually set something custom keeps it — Orbit logs a skip, doesn't clobber.
- **Immediate updates:** approval of leave starting today, same-day cancellation, or an admin edit triggers an immediate set/clear through the outbox, not just the next morning job.
- **Day-scoped, never early:** a status op is only ever written for *today*. A change dated in the future (e.g. a remote day declared for tomorrow) is a no-op at declaration time — the morning job of that day sets it. Otherwise declaring a future remote day would flip the employee to 🏠 a day early.
- **No self-service opt-out (changed from v1.0 draft):** a per-employee "don't touch my Slack status" toggle would contradict mandatory connection — connect-but-never-write is connection theater. Exemptions exist but are **admin-granted only** (`integration_exemptions`), with a reason and optional expiry. The "never fight the human" rule above remains the everyday pressure valve: anyone can override any single day by setting their own status manually.
- Out of scope v1: DND scheduling, Slack profile fields, channel announcements ("X is off today" bot posts — revisit only if asked; it's noise at 20 people with a good calendar).

### 2.1 Slack connection at first login

**Requirement:** an employee the admin has marked as Slack-required must complete Slack connection before reaching any other part of the app. Optional users are never gated; they can connect from their profile if they choose, and their status is mirrored once connected.

- **Gate mechanics:** after the first successful Entra sign-in and profile auto-link, middleware routes any profile with `slack_required = true` and no completed Slack onboarding to `/onboarding` for every app route (deep links included; the intended destination is preserved and restored after completion). The flow: (1) confirm profile basics, (2) **Connect Slack** — OAuth completes, token stored, a test `users.profile:get` verifies it — then `onboarding_completed_at` is stamped and the app opens.
- **Who is gated:** only profiles with `slack_required = true`, which admins control per user in Settings → Integrations. Everyone else — e.g. contractors, who have no leave or remote records — is not gated and may connect voluntarily.
- **Escape hatches (both explicit, both audited):**
  - *Admin deferral:* an admin can grant a time-boxed exemption (default 7 days, reason required) for the legitimate case — a new hire whose Slack workspace invite hasn't arrived yet. The gate converts to a countdown banner; at expiry it hardens again.
  - *Slack-outage grace:* if the OAuth handshake fails with a Slack-side error (5xx/timeout — not a user cancellation), the gate auto-grants a 72-hour grace so a Slack incident can never lock the whole company out of Orbit. User-cancelled OAuth does **not** trigger grace — cancelling re-presents the gate.
- **Later revocation (token invalidated, app uninstalled by the user):** don't hard-lock mid-session — an employee mid-leave-request shouldn't lose work because a token died. Instead: integration row → `revoked`, a persistent non-dismissible banner ("reconnect Slack"), admin exceptions list entry, and the **gate re-arms at their next sign-in**. Deliberately circumventing it (revoke, reconnect-prompt-ignore loops) is thus visible to admins rather than silently effective.
- **Retro-rollout:** existing alpha users get the same gate at their next sign-in (`onboarding_completed_at` backfilled as NULL for gated types without a connected token).

### 2.2 Conference-room session invitations (direct messages)

Messaging someone is a **bot** action: `users.lookupByEmail` → `conversations.open` → `chat.postMessage` only works with a bot token, which the per-user status mirroring deliberately does not use. The two credentials therefore live side by side — `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` for status mirroring, and `SLACK_BOT_TOKEN` (scopes `chat:write`, `users:read.email`, `im:write`) for invitations.

- **Who may invite:** the person who opened the session, or an administrator — the same rule the delete button uses (`canInviteToSession`), re-checked in `POST /api/spaces/session-invites` before anything reaches Slack or Graph.
- **Channels:** an address matching an *active* Orbit colleague is messaged on Slack from the bot. When the organiser ticks **Include an Outlook meeting invite**, that colleague is also an attendee of a Graph meeting on the organiser's calendar. An address that is not an Orbit user can only be reached by email, so it **always** gets the calendar invite. A departed colleague has no Slack to message, so their address is treated as external too.
- **Slack identity:** `employee_integrations.external_user_id` (stored at OAuth time) is used when present, `users.lookupByEmail` otherwise. A colleague who never connected Slack is still reachable only if the bot resolves their address — a failure is recorded per recipient, never swallowed.
- **Seats:** inviting an Orbit colleague books their seat in the session, so `enforce_space_booking` stays the single source of truth for capacity. A full session still sends the invite and reports "invited without a seat"; the Slack message tells the invitee the same.
- **One Graph event per batch**, created with the organiser's delegated token when they have connected Microsoft, otherwise the application token. The event id is stored on the invite rows.
- **Deleting a session** withdraws its Graph meetings first (`DELETE /api/spaces/session-invites?session_id=…`) because the invite rows cascade away with the session.
- **No bot token configured:** the invitation is still recorded, with `slack_status = 'failed'` and the reason, so the organiser sees why instead of a silent success.

## 3. Outlook / Microsoft 365 integration

- **Auth:** Microsoft Graph with **application permissions** (`Calendars.ReadWrite`, plus `MailboxSettings.ReadWrite` only if auto-replies enabled), admin-consented once on the StellarBlue tenant — no per-user OAuth needed since everyone lives in the same Entra tenant Orbit already trusts. Mailbox resolution by work email from the profile.
- **Event ownership marker:** every Orbit-created event carries an open extended property (`orbitRef = leave:{id}` / `remote:{id}`). Sync finds, updates, and deletes **only** events bearing its marker — it can never touch a human-created event, and duplicates are structurally impossible (upsert by marker).
- **Lifecycle fidelity:** leave approved → event created; edited (dates/half-day) → event patched; cancelled or partially cancelled ("returned early on day 3") → event shrunk or deleted; mandatory leave cancelled → cascade deletes its events. External event ids stored per Orbit record (`external_refs` table) so every operation is targeted, never search-based.
- **Auto-replies (opt-in per employee):** on approval of leave ≥ 1 full day, schedule `automaticRepliesSetting` for the exact range with the employee's saved template (placeholders: `{return_date}`, `{contact}`); default template provided in English + Greek. Employee can disable per-leave at request time ("set my OOO reply" checkbox, default from their preference). Orbit never *clears* a manually-configured auto-reply it didn't set (same marker philosophy: store what we set, compare before touching).
- **Team visibility:** the existing ICS out-of-office feed (leave spec) remains the team-wide calendar answer; individual-calendar events are what make **scheduling assistants show the person as unavailable** — that's the meeting-booked-over-vacation fix, and show-as `oof` is what Outlook's scheduling views key on.

## 4. Sync engine (shared mechanics)

- **Outbox, again:** leave/remote domain transactions insert `integration_outbox` rows (`provider, operation, payload, idempotency_key`); workers deliver with exponential backoff. A Slack or Graph outage never fails an approval. Rate limits respected per provider (Graph throttling, Slack Tier limits) — trivial at 20 people but the retry path must handle 429s correctly anyway.
- **Idempotent by external ref:** every operation is an upsert/patch/delete against a stored external id or marker — replays are harmless.
- **Nightly reconciliation** (the standard Orbit drift pattern): for each active leave/remote record in the next 60 days, verify the mirror exists and matches (event dates, marker; status only for "today" records); re-assert Orbit's truth on drift; report unresolvable cases (revoked Slack token, mailbox not found, consent removed) to an admin exceptions list. Dashboard widget: "Integrations: last reconciled {date}, {n} exceptions, {n} employees not connected to Slack."
- **Ordering guard:** outbox rows for the same record are processed serially (per-record ordering key) so an edit-then-cancel can't apply as cancel-then-edit.

## 5. Schema sketch

```
profiles                + onboarding_completed_at (null = gated, see §2.1)
employee_integrations   id, profile_id, provider (slack|m365), external_user_id,
                        token_ref (encrypted, slack only), status
                        (connected|revoked|skipped|exempt), auto_reply_opt_in bool,
                        auto_reply_template text,
                        connected_at, last_synced_at
integration_exemptions  id, profile_id, provider, reason, granted_by,
                        expires_at (null = permanent), created_at
external_refs           id, provider, orbit_kind (leave|remote|auto_reply|status),
                        orbit_id, external_id, marker, created_at, deleted_at
integration_outbox      id, provider, operation, orbit_kind, orbit_id,
                        payload jsonb, idempotency_key, ordering_key,
                        attempts, next_retry_at, status, last_error
integration_settings    provider-level config: labels per leave type, emoji,
                        default templates, feature toggles (auto_reply enabled)
space_session_invites   id, session_id, invited_by, profile_id (null = external guest),
                        email, name, slack_status, outlook_status, slack_error,
                        outlook_error, outlook_event_id, created_at  (see §2.2)
```

Slack tokens are the only per-user secrets Orbit holds — encrypted at rest (Supabase Vault / pgsodium), never in logs, revocable from the employee's profile and automatically marked `revoked` on the first `invalid_auth` response.

## 6. Failure & edge cases (specified, not discovered)

- Employee has no mailbox → skip with a recorded reason, visible in the exceptions list once, not daily noise. No-Slack-account is no longer a silent skip: it's either an admin deferral (invite pending) or an exemption — always an explicit, audited state.
- Leave spanning months → one Outlook event, one Slack status with far expiration; Slack expiration is a Unix timestamp, no practical limit.
- Overlap of remote day inside a leave (data allows it) → leave wins; no remote artifacts emitted for those days.
- Employee departs (`status: departed`) → all future-dated mirrors deleted, tokens revoked, integrations row closed.
- Admin edits leave while an event exists but consent was since revoked → outbox row fails to `exceptions`, leave edit itself unaffected (Orbit truth never blocked by mirror health).
- Clock/timezone: all scheduling in Europe/Athens; all-day Graph events created timezone-correct (midnight-to-midnight Athens, not UTC — the classic all-day-event-off-by-one).

## 7. Acceptance criteria

1. Approving a leave (Tue–Thu) creates one marked `oof` all-day event Tue–Thu in the employee's Outlook; Outlook's scheduling assistant shows them unavailable; cancelling the leave removes exactly that event and nothing else in their calendar.
2. On a remote-pattern Tuesday, by 07:35 the employee's Slack shows 🏠 with same-day expiration; at midnight it's gone with zero API calls from Orbit.
3. An employee who manually set a custom Slack status on their leave morning keeps it; the skip is logged.
4. A sick leave and an annual leave produce byte-identical Slack text and Outlook subjects (generic label) — type is unrecoverable from the mirrors.
5. Partial cancellation ("back on day 3 of 5") shrinks the Outlook event and, if auto-reply was set by Orbit, shortens its schedule; a manually-configured auto-reply is left untouched.
6. With Slack unreachable for a day, approvals proceed normally; the outbox drains on recovery; the morning job + reconciliation converge statuses without duplicates.
7. Deleting an Orbit-created event by hand in Outlook results in its re-creation at nightly reconciliation (Orbit is master), logged as drift.
8. Mandatory-leave publish for 15 employees produces 15 events + statuses; its cancellation removes all 15; the one admin-exempted employee gets events but no status writes.
9. Revoking the Graph admin consent surfaces as one clear admin exception, not 40 cryptic outbox failures.
10. **Gate:** a first-time employee sign-in lands on `/onboarding` regardless of the deep link used; completing Slack OAuth (verified by a test profile read) opens the app at the originally requested route; cancelling the OAuth re-presents the gate.
11. **Gate exemptions:** a contractor's first sign-in skips the Slack step entirely; an admin deferral shows a countdown banner and hardens at expiry; a simulated Slack 5xx during OAuth grants 72h grace, while a user-cancelled OAuth grants none.
12. **Revocation loop:** uninstalling the Slack app mid-week keeps the current session working with a persistent banner, creates an admin exception, and re-arms the gate at next sign-in.

## 8. Build order

1. `employee_integrations` + `external_refs` + `integration_outbox` (generalize the Attio outbox if practical — one outbox mechanism, multiple providers).
2. Outlook events (highest value: fixes meeting-booking; single admin consent, no per-user onboarding).
3. Slack connect flow + morning status job + immediate triggers.
4. Nightly reconciliation + dashboard widget + exceptions list.
5. Auto-replies (opt-in) last — it touches mailbox settings, the most personal surface, and benefits from the marker/ownership machinery being proven.

## 9. Open questions

1. ~~**Remote days in Outlook:** ship as specced (`workingElsewhere` events), or Slack-only for remote and Outlook only for leave?~~ **Resolved 2026-09-28 — work plan only.** Per-day `workingElsewhere` events flooded calendars whenever a remote routine or an auto-filled period existed, and they duplicated the recurring work-plan rule. The work plan now carries every remote day: one recurring rule per remote weekday, one one-off occurrence per ad-hoc day. Requirement in force: **one remote day = exactly one work-plan artifact, never a calendar event.** Ad-hoc remote mirroring therefore needs the employee's one-time Microsoft sign-in (it is a delegated-token API).
2. **Label config:** confirm the default generic labels and emoji with the team (and whether any leave type gets a distinct — still non-revealing — label).
3. **Auto-reply default:** opt-in (specced) vs opt-out-but-on-by-default for annual leave. Opt-in is the privacy-safe start.
4. **Slack workspace:** confirm single workspace; multi-workspace (e.g. a shared client workspace) is out of scope and statuses there are never touched.
5. **Gate strictness — confirm the trade-off:** as specced, an employee who refuses to connect Slack cannot use Orbit at all, including submitting leave requests — which is a stronger position than "no Slack mirroring for you." If that ever feels too blunt, the softer alternative is gating only the leave/remote modules rather than the whole app; the middleware design supports either with a one-line change. Recommend shipping strict (as requested) and revisiting only if it produces real friction.
