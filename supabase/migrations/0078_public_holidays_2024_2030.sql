-- ==============================================================================
-- 0078: Public holidays 2024-2030 + re-costing of the leave rows that predate them.
--
-- 0002 seeded ONLY 2026 and 2027, so from 2024 to 2025 `public_holidays` was empty and every
-- holiday was a normal working day. 15 August 2024 counted as a leave day for anyone whose range
-- covered it (and so did Christmas 2025, Epiphany 2025, ...). 2027 was missing exactly one row:
-- Labour Day.
--
-- This file is also now the yearly-seeding reference the docs ask for: the whole 2024-2030
-- calendar lives here, movable Orthodox feasts included, so the next year only needs a new block
-- of VALUES when 2031 comes.
--
-- TWO PARTS, do not run one without the other:
--   1. the calendar itself (ON CONFLICT DO NOTHING — safe to re-run)
--   2. a re-cost of the leave rows the new dates invalidate (see the block comment on it)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. THE CALENDAR
--
-- National (mandatory for every employer) in the order the Greek Ministry of Labour publishes:
--   New Year, Epiphany, Clean Monday, Independence Day, Good Friday, Easter Sunday, Easter Monday,
--   Labour Day, Whit Monday, Assumption, Ohi Day, Christmas, Boxing Day.
-- Thessaloniki-scope rows carry the local holiday of Agios Dimitrios (26 October) that the
-- requirements single out; scope decides nothing in the maths (any row excludes its own date) and
-- everything for reporting.
--
-- MOVABLE FEASTS are anchored to Orthodox Easter (Julian computus, shown here in Gregorian):
--   2024-05-05 · 2025-04-20 · 2026-04-12 · 2027-05-02 · 2028-04-16 · 2029-04-08 · 2030-04-28
--   Clean Monday   = Easter - 48   Good Friday = Easter - 2   Easter Monday = Easter + 1
--   Whit Monday    = Easter + 50
--
-- LABOUR DAY (1 May) is the one holiday Greek law transfers when it clashes. It is NOT the same
-- rule every year, so it is spelled out per year below:
--   2024  1 May was Holy Wednesday → the private sector ran it on Tuesday 7 May. The company is
--          private sector, so 2024-05-07 is the holiday and 1 May is a WORKING day.
--   2025  1 May = Thursday → normal.
--   2026  1 May = Friday   → normal (already seeded).
--   2027  1 May = Saturday → transferred to Tuesday 4 May (Monday 3 May is Easter Monday).
--          This row was the hole in the 2027 seed.
--   2028+ 1 May falls on a working day every year through 2030 → normal.
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS _new_holidays;
CREATE TEMP TABLE _new_holidays (date DATE, name_el TEXT, name_en TEXT, scope TEXT);

INSERT INTO _new_holidays (date, name_el, name_en, scope) VALUES
-- 2024
('2024-01-01', 'Πρωτοχρονιά', 'New Year''s Day', 'national'),
('2024-01-06', 'Θεοφάνεια', 'Epiphany', 'national'),
('2024-03-18', 'Καθαρά Δευτέρα', 'Clean Monday', 'national'),
('2024-03-25', '25η Μαρτίου', 'Independence Day', 'national'),
('2024-05-03', 'Μεγάλη Παρασκευή', 'Good Friday', 'national'),
('2024-05-05', 'Κυριακή του Πάσχα', 'Orthodox Easter Sunday', 'national'),
('2024-05-06', 'Δευτέρα του Πάσχα', 'Orthodox Easter Monday', 'national'),
('2024-05-07', 'Εργατική Πρωτομαγιά (μεταφορά)', 'Labour Day (transferred from 1 May)', 'national'),
('2024-06-24', 'Αγίου Πνεύματος', 'Whit Monday / Holy Spirit', 'national'),
('2024-08-15', 'Κοίμηση της Θεοτόκου', 'Assumption of the Virgin Mary', 'national'),
('2024-10-26', 'Αγίου Δημητρίου', 'Saint Demetrius Day', 'thessaloniki'),
('2024-10-28', '28η Οκτωβρίου', 'Ohi Day', 'national'),
('2024-12-25', 'Χριστούγεννα', 'Christmas Day', 'national'),
('2024-12-26', 'Σύναξη Θεοτόκου', 'Boxing Day / Second Day of Christmas', 'national'),
-- 2025
('2025-01-01', 'Πρωτοχρονιά', 'New Year''s Day', 'national'),
('2025-01-06', 'Θεοφάνεια', 'Epiphany', 'national'),
('2025-03-03', 'Καθαρά Δευτέρα', 'Clean Monday', 'national'),
('2025-03-25', '25η Μαρτίου', 'Independence Day', 'national'),
('2025-04-18', 'Μεγάλη Παρασκευή', 'Good Friday', 'national'),
('2025-04-20', 'Κυριακή του Πάσχα', 'Orthodox Easter Sunday', 'national'),
('2025-04-21', 'Δευτέρα του Πάσχα', 'Orthodox Easter Monday', 'national'),
('2025-05-01', 'Εργατική Πρωτομαγιά', 'Labour Day', 'national'),
('2025-06-09', 'Αγίου Πνεύματος', 'Whit Monday / Holy Spirit', 'national'),
('2025-08-15', 'Κοίμηση της Θεοτόκου', 'Assumption of the Virgin Mary', 'national'),
('2025-10-26', 'Αγίου Δημητρίου', 'Saint Demetrius Day', 'thessaloniki'),
('2025-10-28', '28η Οκτωβρίου', 'Ohi Day', 'national'),
('2025-12-25', 'Χριστούγεννα', 'Christmas Day', 'national'),
('2025-12-26', 'Σύναξη Θεοτόκου', 'Boxing Day / Second Day of Christmas', 'national'),
-- 2026 (already seeded — listed so this file stays the single readable calendar; ON CONFLICT skips)
('2026-01-01', 'Πρωτοχρονιά', 'New Year''s Day', 'national'),
('2026-01-06', 'Θεοφάνεια', 'Epiphany', 'national'),
('2026-02-23', 'Καθαρά Δευτέρα', 'Clean Monday', 'national'),
('2026-03-25', '25η Μαρτίου', 'Independence Day', 'national'),
('2026-04-10', 'Μεγάλη Παρασκευή', 'Good Friday', 'national'),
('2026-04-12', 'Κυριακή του Πάσχα', 'Orthodox Easter Sunday', 'national'),
('2026-04-13', 'Δευτέρα του Πάσχα', 'Orthodox Easter Monday', 'national'),
('2026-05-01', 'Εργατική Πρωτομαγιά', 'Labour Day', 'national'),
('2026-06-01', 'Αγίου Πνεύματος', 'Whit Monday / Holy Spirit', 'national'),
('2026-08-15', 'Κοίμηση της Θεοτόκου', 'Assumption of the Virgin Mary', 'national'),
('2026-10-26', 'Αγίου Δημητρίου', 'Saint Demetrius Day', 'thessaloniki'),
('2026-10-28', '28η Οκτωβρίου', 'Ohi Day', 'national'),
('2026-12-25', 'Χριστούγεννα', 'Christmas Day', 'national'),
('2026-12-26', 'Σύναξη Θεοτόκου', 'Boxing Day / Second Day of Christmas', 'national'),
-- 2027
('2027-01-01', 'Πρωτοχρονιά', 'New Year''s Day', 'national'),
('2027-01-06', 'Θεοφάνεια', 'Epiphany', 'national'),
('2027-03-15', 'Καθαρά Δευτέρα', 'Clean Monday', 'national'),
('2027-03-25', '25η Μαρτίου', 'Independence Day', 'national'),
('2027-04-30', 'Μεγάλη Παρασκευή', 'Good Friday', 'national'),
('2027-05-02', 'Κυριακή του Πάσχα', 'Orthodox Easter Sunday', 'national'),
('2027-05-03', 'Δευτέρα του Πάσχα', 'Orthodox Easter Monday', 'national'),
('2027-05-04', 'Εργατική Πρωτομαγιά (μεταφορά)', 'Labour Day (transferred from 1 May)', 'national'),
('2027-06-21', 'Αγίου Πνεύματος', 'Whit Monday / Holy Spirit', 'national'),
('2027-08-15', 'Κοίμηση της Θεοτόκου', 'Assumption of the Virgin Mary', 'national'),
('2027-10-26', 'Αγίου Δημητρίου', 'Saint Demetrius Day', 'thessaloniki'),
('2027-10-28', '28η Οκτωβρίου', 'Ohi Day', 'national'),
('2027-12-25', 'Χριστούγεννα', 'Christmas Day', 'national'),
('2027-12-26', 'Σύναξη Θεοτόκου', 'Boxing Day / Second Day of Christmas', 'national'),
-- 2028
('2028-01-01', 'Πρωτοχρονιά', 'New Year''s Day', 'national'),
('2028-01-06', 'Θεοφάνεια', 'Epiphany', 'national'),
('2028-02-28', 'Καθαρά Δευτέρα', 'Clean Monday', 'national'),
('2028-03-25', '25η Μαρτίου', 'Independence Day', 'national'),
('2028-04-14', 'Μεγάλη Παρασκευή', 'Good Friday', 'national'),
('2028-04-16', 'Κυριακή του Πάσχα', 'Orthodox Easter Sunday', 'national'),
('2028-04-17', 'Δευτέρα του Πάσχα', 'Orthodox Easter Monday', 'national'),
('2028-05-01', 'Εργατική Πρωτομαγιά', 'Labour Day', 'national'),
('2028-06-05', 'Αγίου Πνεύματος', 'Whit Monday / Holy Spirit', 'national'),
('2028-08-15', 'Κοίμηση της Θεοτόκου', 'Assumption of the Virgin Mary', 'national'),
('2028-10-26', 'Αγίου Δημητρίου', 'Saint Demetrius Day', 'thessaloniki'),
('2028-10-28', '28η Οκτωβρίου', 'Ohi Day', 'national'),
('2028-12-25', 'Χριστούγεννα', 'Christmas Day', 'national'),
('2028-12-26', 'Σύναξη Θεοτόκου', 'Boxing Day / Second Day of Christmas', 'national'),
-- 2029
('2029-01-01', 'Πρωτοχρονιά', 'New Year''s Day', 'national'),
('2029-01-06', 'Θεοφάνεια', 'Epiphany', 'national'),
('2029-02-19', 'Καθαρά Δευτέρα', 'Clean Monday', 'national'),
('2029-03-25', '25η Μαρτίου', 'Independence Day', 'national'),
('2029-04-06', 'Μεγάλη Παρασκευή', 'Good Friday', 'national'),
('2029-04-08', 'Κυριακή του Πάσχα', 'Orthodox Easter Sunday', 'national'),
('2029-04-09', 'Δευτέρα του Πάσχα', 'Orthodox Easter Monday', 'national'),
('2029-05-01', 'Εργατική Πρωτομαγιά', 'Labour Day', 'national'),
('2029-05-28', 'Αγίου Πνεύματος', 'Whit Monday / Holy Spirit', 'national'),
('2029-08-15', 'Κοίμηση της Θεοτόκου', 'Assumption of the Virgin Mary', 'national'),
('2029-10-26', 'Αγίου Δημητρίου', 'Saint Demetrius Day', 'thessaloniki'),
('2029-10-28', '28η Οκτωβρίου', 'Ohi Day', 'national'),
('2029-12-25', 'Χριστούγεννα', 'Christmas Day', 'national'),
('2029-12-26', 'Σύναξη Θεοτόκου', 'Boxing Day / Second Day of Christmas', 'national'),
-- 2030
('2030-01-01', 'Πρωτοχρονιά', 'New Year''s Day', 'national'),
('2030-01-06', 'Θεοφάνεια', 'Epiphany', 'national'),
('2030-03-11', 'Καθαρά Δευτέρα', 'Clean Monday', 'national'),
('2030-03-25', '25η Μαρτίου', 'Independence Day', 'national'),
('2030-04-26', 'Μεγάλη Παρασκευή', 'Good Friday', 'national'),
('2030-04-28', 'Κυριακή του Πάσχα', 'Orthodox Easter Sunday', 'national'),
('2030-04-29', 'Δευτέρα του Πάσχα', 'Orthodox Easter Monday', 'national'),
('2030-05-01', 'Εργατική Πρωτομαγιά', 'Labour Day', 'national'),
('2030-06-17', 'Αγίου Πνεύματος', 'Whit Monday / Holy Spirit', 'national'),
('2030-08-15', 'Κοίμηση της Θεοτόκου', 'Assumption of the Virgin Mary', 'national'),
('2030-10-26', 'Αγίου Δημητρίου', 'Saint Demetrius Day', 'thessaloniki'),
('2030-10-28', '28η Οκτωβρίου', 'Ohi Day', 'national'),
('2030-12-25', 'Χριστούγεννα', 'Christmas Day', 'national'),
('2030-12-26', 'Σύναξη Θεοτόκου', 'Boxing Day / Second Day of Christmas', 'national');

-- Keep only the rows this run actually adds. Two jobs: makes the insert below unconditional, and
-- gives part 2 the exact set of NEW dates it needs to tell "before" from "after".
DELETE FROM _new_holidays n
USING public.public_holidays h
WHERE h.date = n.date AND h.scope = n.scope;

INSERT INTO public.public_holidays (date, name_el, name_en, scope, year)
SELECT date, name_el, name_en, scope, extract(year FROM date)::int
FROM _new_holidays;

-- ------------------------------------------------------------------------------
-- 2. RE-COST THE LEAVE ROWS THE NEW DATES INVALIDATE
--
-- `leave_requests.working_days` is the STORED deduction — the balance is subtracted by it, so a
-- row filed against a holiday-free calendar keeps costing the holiday day no matter what the
-- calendar says now. (The leave pages clamp the DISPLAY with `min(stored, recount)`, which is why
-- this only ever showed up as a wrong balance.)
--
-- The rule, and why it is this narrow — the same one the Settings → Holidays screen applies when
-- an admin edits the calendar:
--
--   before = the cost counted with the calendar as it was BEFORE this migration
--   after  = the cost counted with the calendar as it is now
--   update only rows where `stored = before` and `before <> after`.
--
-- `stored = before` is the "this row was costed correctly at the time" test. Rows that disagree
-- with the old calendar are legacy (the pre-2026-09-15 `Math.max(1, …)` era rows, e.g. Papakis
-- 2024-08-12→19 stored as 1) or a deliberate admin adjustment — those are left for the payroll
-- decision they need, exactly as before.
--
-- Counting mirrors `countWorkingDaysForProfile` (auth-context): the employee's scheduled weekdays,
-- minus public holidays, minus company closures. Rows excluded, and why:
--   origin 'mandatory'     → costed by the closure fan-out, not by the leave pages (0076/0055)
--   detached = true        → an admin manually cut this row loose from its closure
--   rejected/cancelled/expired → never deducted from any balance
--   half-day flags         → the flags and the stored count can disagree; not worth guessing
-- ------------------------------------------------------------------------------
WITH scan AS (
    SELECT lr.id,
           lr.start_date,
           lr.end_date,
           lr.working_days AS stored,
           COALESCE(NULLIF(p.work_schedule, ARRAY[]::TEXT[]),
                    ARRAY['Mon', 'Tue', 'Wed', 'Thu', 'Fri']::TEXT[]) AS schedule
    FROM public.leave_requests lr
    JOIN public.profiles p ON p.id = lr.profile_id
    WHERE lr.origin <> 'mandatory'
      AND COALESCE(lr.detached, FALSE) = FALSE
      AND lr.status NOT IN ('rejected', 'cancelled', 'expired')
      AND lr.half_day_start = FALSE
      AND lr.half_day_end = FALSE
      -- Only rows a NEW date can reach can possibly change.
      AND EXISTS (
          SELECT 1 FROM _new_holidays n
          WHERE n.date BETWEEN lr.start_date AND lr.end_date
      )
),
costed AS (
    SELECT s.id,
           s.stored,
           (SELECT count(*)
              FROM generate_series(s.start_date::TIMESTAMP, s.end_date::TIMESTAMP, INTERVAL '1 day') g
             WHERE (ARRAY['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])[extract(dow FROM g)::INT + 1] = ANY (s.schedule)
               -- "before": every holiday EXCEPT the ones added here.
               AND NOT EXISTS (
                   SELECT 1 FROM public.public_holidays h
                   WHERE h.date = g::DATE
                     AND NOT EXISTS (SELECT 1 FROM _new_holidays n WHERE n.date = h.date)
               )
               AND NOT EXISTS (
                   SELECT 1 FROM public.mandatory_leaves m
                   WHERE m.status <> 'cancelled' AND g::DATE BETWEEN m.start_date AND m.end_date
               )) AS before_days,
           (SELECT count(*)
              FROM generate_series(s.start_date::TIMESTAMP, s.end_date::TIMESTAMP, INTERVAL '1 day') g
             WHERE (ARRAY['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])[extract(dow FROM g)::INT + 1] = ANY (s.schedule)
               AND NOT EXISTS (SELECT 1 FROM public.public_holidays h WHERE h.date = g::DATE)
               AND NOT EXISTS (
                   SELECT 1 FROM public.mandatory_leaves m
                   WHERE m.status <> 'cancelled' AND g::DATE BETWEEN m.start_date AND m.end_date
               )) AS after_days
    FROM scan s
)
UPDATE public.leave_requests lr
SET working_days = c.after_days,
    note = COALESCE(lr.note || ' ', '') || '[auto: re-costed for the 2024-2030 public holidays]'
FROM costed c
WHERE lr.id = c.id
  AND c.stored = c.before_days
  AND c.before_days <> c.after_days;

DROP TABLE IF EXISTS _new_holidays;
