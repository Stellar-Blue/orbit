-- ==============================================================================
-- 0002_seed_reference.sql
-- Production Reference Seed Data: Leave Types, Statutory Payment Types & Holidays
-- ==============================================================================

-- 1. LEAVE TYPES
INSERT INTO leave_types (code, name_en, name_el, counts_against_balance, requires_document, requires_approval, colour)
VALUES
('annual', 'Annual Leave', 'Κανονική άδεια', TRUE, FALSE, TRUE, '#3b82f6'),
('sick', 'Sick Leave', 'Αναρρωτική', FALSE, TRUE, TRUE, '#f59e0b'),
('unpaid', 'Unpaid Leave', 'Άνευ αποδοχών', FALSE, FALSE, TRUE, '#64748b'),
('parental', 'Parental / Maternity / Paternity', 'Γονική / Μητρότητας / Πατρότητας', FALSE, TRUE, TRUE, '#10b981'),
('special', 'Special Leave (Marriage, Student, Bereavement)', 'Ειδικές άδειες', FALSE, FALSE, TRUE, '#8b5cf6')
ON CONFLICT (code) DO UPDATE SET
    name_en = EXCLUDED.name_en,
    name_el = EXCLUDED.name_el,
    counts_against_balance = EXCLUDED.counts_against_balance,
    requires_document = EXCLUDED.requires_document,
    colour = EXCLUDED.colour;

-- 2. STATUTORY PAYMENT TYPES (Greek 14-salary reality & contractor fees)
INSERT INTO payment_types (code, name_en, name_el, is_statutory, is_recurring_monthly, default_period_month, default_multiplier, applies_to, sort_order)
VALUES
('salary', 'Monthly Salary', 'Μηνιαίος Μισθός', TRUE, TRUE, NULL, 1.0, ARRAY['full_time', 'part_time'], 1),
('dwro_pasxa', 'Easter Bonus (13th Salary)', 'Δώρο Πάσχα', TRUE, FALSE, 4, 0.5, ARRAY['full_time', 'part_time'], 2),
('epidoma_adeias', 'Holiday Allowance', 'Επίδομα Αδείας', TRUE, FALSE, 7, 0.5, ARRAY['full_time', 'part_time'], 3),
('dwro_xristougennwn', 'Christmas Bonus (14th Salary)', 'Δώρο Χριστουγέννων', TRUE, FALSE, 12, 1.0, ARRAY['full_time', 'part_time'], 4),
('bonus', 'Performance / Spot Bonus', 'Μπόνους', FALSE, FALSE, NULL, NULL, ARRAY['full_time', 'part_time', 'intern'], 5),
('overtime', 'Overtime Compensation', 'Υπερωρίες', FALSE, FALSE, NULL, NULL, ARRAY['full_time', 'part_time'], 6),
('contractor_invoice', 'Contractor Fee (Invoice)', 'Τιμολόγιο Συνεργάτη', TRUE, TRUE, NULL, 1.0, ARRAY['contractor'], 7),
('severance', 'Severance Compensation', 'Αποζημίωση Απόλυσης / Αποχώρησης', FALSE, FALSE, NULL, NULL, ARRAY['full_time', 'part_time'], 8)
ON CONFLICT (code) DO UPDATE SET
    name_en = EXCLUDED.name_en,
    name_el = EXCLUDED.name_el,
    is_statutory = EXCLUDED.is_statutory,
    is_recurring_monthly = EXCLUDED.is_recurring_monthly,
    default_period_month = EXCLUDED.default_period_month,
    default_multiplier = EXCLUDED.default_multiplier,
    applies_to = EXCLUDED.applies_to;

-- 3. GREEK PUBLIC HOLIDAYS (2026 & 2027, including Orthodox Easter movable feasts & Thessaloniki local holiday)
INSERT INTO public_holidays (date, name_el, name_en, scope, year)
VALUES
-- 2026 Holidays
('2026-01-01', 'Πρωτοχρονιά', 'New Year''s Day', 'national', 2026),
('2026-01-06', 'Θεοφάνεια', 'Epiphany', 'national', 2026),
('2026-02-23', 'Καθαρά Δευτέρα', 'Clean Monday', 'national', 2026),
('2026-03-25', '25η Μαρτίου', 'Independence Day', 'national', 2026),
('2026-04-10', 'Μεγάλη Παρασκευή', 'Good Friday', 'national', 2026),
('2026-04-12', 'Κυριακή του Πάσχα', 'Orthodox Easter Sunday', 'national', 2026),
('2026-04-13', 'Δευτέρα του Πάσχα', 'Orthodox Easter Monday', 'national', 2026),
('2026-05-01', 'Εργατική Πρωτομαγιά', 'Labour Day', 'national', 2026),
('2026-06-01', 'Αγίου Πνεύματος', 'Whit Monday / Holy Spirit', 'national', 2026),
('2026-08-15', 'Κοίμηση της Θεοτόκου', 'Assumption of the Virgin Mary', 'national', 2026),
('2026-10-26', 'Αγίου Δημητρίου', 'Saint Demetrius Day', 'thessaloniki', 2026),
('2026-10-28', '28η Οκτωβρίου', 'Ohi Day', 'national', 2026),
('2026-12-25', 'Χριστούγεννα', 'Christmas Day', 'national', 2026),
('2026-12-26', 'Σύναξη Θεοτόκου', 'Boxing Day / Second Day of Christmas', 'national', 2026),

-- 2027 Holidays
('2027-01-01', 'Πρωτοχρονιά', 'New Year''s Day', 'national', 2027),
('2027-01-06', 'Θεοφάνεια', 'Epiphany', 'national', 2027),
('2027-03-15', 'Καθαρά Δευτέρα', 'Clean Monday', 'national', 2027),
('2027-03-25', '25η Μαρτίου', 'Independence Day', 'national', 2027),
('2027-04-30', 'Μεγάλη Παρασκευή', 'Good Friday', 'national', 2027),
('2027-05-02', 'Κυριακή του Πάσχα', 'Orthodox Easter Sunday', 'national', 2027),
('2027-05-03', 'Δευτέρα του Πάσχα', 'Orthodox Easter Monday', 'national', 2027),
('2027-06-21', 'Αγίου Πνεύματος', 'Whit Monday / Holy Spirit', 'national', 2027),
('2027-08-15', 'Κοίμηση της Θεοτόκου', 'Assumption of the Virgin Mary', 'national', 2027),
('2027-10-26', 'Αγίου Δημητρίου', 'Saint Demetrius Day', 'thessaloniki', 2027),
('2027-10-28', '28η Οκτωβρίου', 'Ohi Day', 'national', 2027),
('2027-12-25', 'Χριστούγεννα', 'Christmas Day', 'national', 2027),
('2027-12-26', 'Σύναξη Θεοτόκου', 'Boxing Day / Second Day of Christmas', 'national', 2027)
ON CONFLICT (date, scope) DO NOTHING;
