import { 
  Team, Profile, PaymentType, SalaryRecord, PaymentRecord, 
  LeaveType, LeaveEntitlement, MandatoryLeave, LeaveRequest, 
  PublicHoliday, RemoteDay, RemotePattern, Counterparty, Contract, Space, SpaceType, OfficeFloor 
} from './types';

export const MOCK_TEAMS: Team[] = [
  { id: 'team-etrm', name: 'Atlas ETRM Engineering', lead_profile_id: 'prof-nikos' },
  { id: 'team-ems', name: 'EMS & Bidding Optimizer', lead_profile_id: 'prof-maria' },
  { id: 'team-cons', name: 'Energy Consulting', lead_profile_id: 'prof-eleni' },
  { id: 'team-ops', name: 'Operations & Leadership', lead_profile_id: 'prof-eleni' }
];

export const MOCK_PROFILES: Profile[] = [
  {
    id: 'prof-eleni',
    first_name: 'Eleni',
    last_name: 'Founta',
    name_el: 'Ελένη Φούντα',
    work_email: 'eleni.founta@stellarblue.gr',
    phone: '+30 2310 000 001',
    title: 'Co-Founder & Chief Operations Officer',
    team_id: 'team-ops',
    employment_type: 'full_time',
    start_date: '2023-01-10',
    status: 'active',
    work_schedule: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    role: 'admin',
    sensitive: {
      profile_id: 'prof-eleni',
      afm: '108938291',
      amka: '12048501928',
      ama_efka: '49201920',
      iban: 'GR1201100000000012345678901',
      address: 'Tsimiski 45, Thessaloniki 54623',
      birth_date: '1985-04-12'
    }
  },
  {
    id: 'prof-nikos',
    first_name: 'Nikos',
    last_name: 'Vassiliou',
    name_el: 'Νίκος Βασιλείου',
    work_email: 'nikos.vassiliou@stellarblue.gr',
    phone: '+30 2310 000 002',
    title: 'Co-Founder & Chief Technology Officer',
    team_id: 'team-etrm',
    employment_type: 'full_time',
    start_date: '2023-01-10',
    status: 'active',
    work_schedule: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    role: 'admin',
    sensitive: {
      profile_id: 'prof-nikos',
      afm: '098231920',
      amka: '08098202931',
      ama_efka: '39201981',
      iban: 'GR8801400000000023456789012',
      address: 'Mitropoleos 12, Thessaloniki 54624',
      birth_date: '1982-09-08'
    }
  },
  {
    id: 'prof-dimitris',
    first_name: 'Dimitris',
    last_name: 'Papadopoulos',
    name_el: 'Δημήτρης Παπαδόπουλος',
    work_email: 'dimitris.papadopoulos@stellarblue.gr',
    phone: '+30 2310 000 003',
    title: 'Principal ETRM Architect',
    team_id: 'team-etrm',
    manager_id: 'prof-nikos',
    employment_type: 'full_time',
    start_date: '2023-03-01',
    status: 'active',
    work_schedule: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    role: 'employee',
    sensitive: {
      profile_id: 'prof-dimitris',
      afm: '138940291',
      amka: '11028803921',
      ama_efka: '29819203',
      iban: 'GR4401700000000034567890123',
      address: 'Vasilissis Olgas 120, Thessaloniki 54645',
      birth_date: '1988-02-11'
    }
  },
  {
    id: 'prof-maria',
    first_name: 'Maria',
    last_name: 'Konstantinidou',
    name_el: 'Μαρία Κωνσταντινίδου',
    work_email: 'maria.konstantinidou@stellarblue.gr',
    phone: '+30 2310 000 004',
    title: 'EMS Lead Product Manager',
    team_id: 'team-ems',
    manager_id: 'prof-eleni',
    employment_type: 'full_time',
    start_date: '2023-06-15',
    status: 'active',
    work_schedule: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    role: 'employee',
    sensitive: {
      profile_id: 'prof-maria',
      afm: '148293049',
      amka: '01089201938',
      ama_efka: '59201923',
      iban: 'GR6601400000000045678901234',
      address: 'Egnatia 80, Thessaloniki 54622',
      birth_date: '1992-08-01'
    }
  },
  {
    id: 'prof-yannis',
    first_name: 'Yannis',
    last_name: 'Anagnostou',
    name_el: 'Γιάννης Αναγνώστου',
    work_email: 'yannis.anagnostou@stellarblue.gr',
    phone: '+30 2310 000 005',
    title: 'Senior Optimization Engineer',
    team_id: 'team-ems',
    manager_id: 'prof-maria',
    employment_type: 'full_time',
    start_date: '2023-09-01',
    status: 'active',
    work_schedule: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    role: 'employee'
  },
  {
    id: 'prof-katerina',
    first_name: 'Katerina',
    last_name: 'Lymperis',
    name_el: 'Κατερίνα Λυμπέρη',
    work_email: 'katerina.lymperis@stellarblue.gr',
    phone: '+30 2310 000 006',
    title: 'Senior Energy Markets Analyst',
    team_id: 'team-cons',
    manager_id: 'prof-eleni',
    employment_type: 'part_time',
    start_date: '2024-01-08',
    status: 'active',
    work_schedule: ['Mon', 'Wed', 'Fri'], // Part time schedule
    role: 'employee'
  },
  {
    id: 'prof-giorgis',
    first_name: 'Giorgis',
    last_name: 'Makris',
    name_el: 'Γιώργος Μακρής',
    work_email: 'giorgis.makris@stellarblue.gr',
    phone: '+30 2310 000 007',
    title: 'Backend Software Engineer',
    team_id: 'team-etrm',
    manager_id: 'prof-dimitris',
    employment_type: 'full_time',
    start_date: '2024-02-12',
    status: 'active',
    work_schedule: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    role: 'employee'
  },
  {
    id: 'prof-sofia',
    first_name: 'Sofia',
    last_name: 'Stamatiadou',
    name_el: 'Σοφία Σταματιάδου',
    work_email: 'sofia.stamatiadou@stellarblue.gr',
    phone: '+30 2310 000 008',
    title: 'Product UI/UX Lead (Contractor)',
    team_id: 'team-ops',
    manager_id: 'prof-eleni',
    employment_type: 'contractor',
    start_date: '2024-03-01',
    status: 'active',
    work_schedule: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    role: 'employee'
  },
  {
    id: 'prof-kostas',
    first_name: 'Kostas',
    last_name: 'Panagiotou',
    name_el: 'Κώστας Παναγιώτου',
    work_email: 'kostas.panagiotou@stellarblue.gr',
    phone: '+30 2310 000 009',
    title: 'Data Systems Architect (Contractor)',
    team_id: 'team-etrm',
    manager_id: 'prof-nikos',
    employment_type: 'contractor',
    start_date: '2024-04-15',
    status: 'active',
    work_schedule: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    role: 'employee'
  },
  {
    id: 'prof-alexandra',
    first_name: 'Alexandra',
    last_name: 'Vlachou',
    name_el: 'Αλεξάνδρα Βλάχου',
    work_email: 'alexandra.vlachou@stellarblue.gr',
    phone: '+30 2310 000 010',
    title: 'Frontend Systems Engineer',
    team_id: 'team-ems',
    manager_id: 'prof-maria',
    employment_type: 'full_time',
    start_date: '2024-05-20',
    status: 'active',
    work_schedule: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    role: 'employee'
  },
  {
    id: 'prof-petros',
    first_name: 'Petros',
    last_name: 'Samanidis',
    name_el: 'Πέτρος Σαμανίδης',
    work_email: 'petros.samanidis@stellarblue.gr',
    phone: '+30 2310 000 011',
    title: 'Quantitative Algorithms Intern',
    team_id: 'team-ems',
    manager_id: 'prof-yannis',
    employment_type: 'intern',
    start_date: '2025-01-15',
    status: 'active',
    work_schedule: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    role: 'employee'
  }
];

export const MOCK_PAYMENT_TYPES: PaymentType[] = [
  { id: 'pt-salary', code: 'salary', name_en: 'Monthly Salary', name_el: 'Μηνιαίος Μισθός', is_statutory: true, is_recurring_monthly: true, default_multiplier: 1.0, applies_to: ['full_time', 'part_time'], active: true, sort_order: 1 },
  { id: 'pt-pasxa', code: 'dwro_pasxa', name_en: 'Easter Bonus (13th Salary)', name_el: 'Δώρο Πάσχα', is_statutory: true, is_recurring_monthly: false, default_period_month: 4, default_multiplier: 0.5, applies_to: ['full_time', 'part_time'], active: true, sort_order: 2 },
  { id: 'pt-adeias', code: 'epidoma_adeias', name_en: 'Holiday Allowance', name_el: 'Επίδομα Αδείας', is_statutory: true, is_recurring_monthly: false, default_period_month: 7, default_multiplier: 0.5, applies_to: ['full_time', 'part_time'], active: true, sort_order: 3 },
  { id: 'pt-xristougennwn', code: 'dwro_xristougennwn', name_en: 'Christmas Bonus (14th Salary)', name_el: 'Δώρο Χριστουγέννων', is_statutory: true, is_recurring_monthly: false, default_period_month: 12, default_multiplier: 1.0, applies_to: ['full_time', 'part_time'], active: true, sort_order: 4 },
  { id: 'pt-bonus', code: 'bonus', name_en: 'Performance / Spot Bonus', name_el: 'Μπόνους', is_statutory: false, is_recurring_monthly: false, applies_to: ['full_time', 'part_time', 'intern'], active: true, sort_order: 5 },
  { id: 'pt-overtime', code: 'overtime', name_en: 'Overtime Pay', name_el: 'Αμοιβή Υπερωριών', is_statutory: false, is_recurring_monthly: false, applies_to: ['full_time', 'part_time'], active: true, sort_order: 6 },
  { id: 'pt-contractor', code: 'contractor_invoice', name_en: 'Contractor Fee (Invoice)', name_el: 'Τιμολόγιο Συνεργάτη', is_statutory: true, is_recurring_monthly: true, default_multiplier: 1.0, applies_to: ['contractor'], active: true, sort_order: 7 },
  { id: 'pt-other', code: 'other', name_en: 'Other / Reimbursements', name_el: 'Λοιπά / Αποζημιώσεις', is_statutory: false, is_recurring_monthly: false, applies_to: ['full_time', 'part_time', 'contractor', 'intern'], active: true, sort_order: 8 }
];

export const MOCK_SALARIES: SalaryRecord[] = [
  // Past historical salary records (closed with valid_to to show salary history)
  { id: 'sal-old-1', profile_id: 'prof-eleni', valid_from: '2024-06-01', valid_to: '2025-12-31', basis: 'monthly_gross', gross_amount: 4600, currency: 'EUR', employer_cost_pct: 22.29, employer_cost_multiplier: 1.24, note: '2024-2025 Initial rate' },
  { id: 'sal-old-2', profile_id: 'prof-nikos', valid_from: '2024-06-01', valid_to: '2025-12-31', basis: 'monthly_gross', gross_amount: 4600, currency: 'EUR', employer_cost_pct: 22.29, employer_cost_multiplier: 1.24, note: '2024-2025 Initial rate' },
  // Current active salary records
  { id: 'sal-1', profile_id: 'prof-eleni', valid_from: '2026-01-01', basis: 'monthly_gross', gross_amount: 5200, currency: 'EUR', employer_cost_pct: 22.29, employer_cost_multiplier: 1.24, full_company_cost: 7100, note: '2026 Founder review' },
  { id: 'sal-2', profile_id: 'prof-nikos', valid_from: '2026-01-01', basis: 'monthly_gross', gross_amount: 5200, currency: 'EUR', employer_cost_pct: 22.29, employer_cost_multiplier: 1.24, note: '2026 Founder review' },
  { id: 'sal-3', profile_id: 'prof-dimitris', valid_from: '2026-01-01', basis: 'monthly_gross', gross_amount: 4100, currency: 'EUR', employer_cost_pct: 22.29, employer_cost_multiplier: 1.24, full_company_cost: 5600, note: 'Senior Architect scale' },
  { id: 'sal-4', profile_id: 'prof-maria', valid_from: '2026-01-01', basis: 'monthly_gross', gross_amount: 3900, currency: 'EUR', employer_cost_pct: 22.29, employer_cost_multiplier: 1.24, note: 'EMS PM scale' },
  { id: 'sal-5', profile_id: 'prof-yannis', valid_from: '2026-01-01', basis: 'monthly_gross', gross_amount: 3600, currency: 'EUR', employer_cost_pct: 22.29, employer_cost_multiplier: 1.24, note: 'Optimization Eng scale' },
  { id: 'sal-6', profile_id: 'prof-katerina', valid_from: '2026-01-01', basis: 'monthly_gross', gross_amount: 2200, currency: 'EUR', employer_cost_pct: 22.29, employer_cost_multiplier: 1.24, note: 'Part time Analyst' },
  { id: 'sal-7', profile_id: 'prof-giorgis', valid_from: '2026-01-01', basis: 'monthly_gross', gross_amount: 2800, currency: 'EUR', employer_cost_pct: 22.29, employer_cost_multiplier: 1.24 },
  { id: 'sal-8', profile_id: 'prof-sofia', valid_from: '2026-01-01', basis: 'fixed_fee', gross_amount: 3500, currency: 'EUR', employer_cost_multiplier: 1.0, note: 'UI/UX Retainer excl VAT' },
  { id: 'sal-9', profile_id: 'prof-kostas', valid_from: '2026-01-01', basis: 'fixed_fee', gross_amount: 4200, currency: 'EUR', employer_cost_multiplier: 1.0, note: 'Data Arch Retainer excl VAT' },
  { id: 'sal-10', profile_id: 'prof-alexandra', valid_from: '2026-01-01', basis: 'monthly_gross', gross_amount: 2700, currency: 'EUR', employer_cost_pct: 22.29, employer_cost_multiplier: 1.24 },
  { id: 'sal-11', profile_id: 'prof-petros', valid_from: '2026-01-01', basis: 'monthly_gross', gross_amount: 1100, currency: 'EUR', employer_cost_pct: 22.29, employer_cost_multiplier: 1.24, note: 'Internship' },
  // Contractual extras live in the same effective-dated ledger as the base rates (entry_type).
  { id: 'sal-x1', profile_id: 'prof-eleni', valid_from: '2026-01-01', basis: 'monthly_gross', gross_amount: 60, currency: 'EUR', entry_type: 'recurring_extra', label: 'Mobile & Internet Allowance', payment_type_id: 'pt-bonus' },
  { id: 'sal-x2', profile_id: 'prof-nikos', valid_from: '2024-09-01', basis: 'monthly_gross', gross_amount: 300, currency: 'EUR', entry_type: 'recurring_extra', label: 'Company Car Allowance', note: 'Indexed annually' },
  { id: 'sal-x3', profile_id: 'prof-nikos', valid_from: '2025-06-01', valid_to: '2025-12-31', basis: 'monthly_gross', gross_amount: 250, currency: 'EUR', entry_type: 'recurring_extra', label: 'On-call Retainer', note: 'Ended with the EMS contract' },
  { id: 'sal-x4', profile_id: 'prof-eleni', valid_from: '2026-03-01', valid_to: '2026-03-31', basis: 'monthly_gross', gross_amount: 1500, currency: 'EUR', entry_type: 'one_time_bonus', label: 'Project Delivery Bonus', payment_type_id: 'pt-bonus' }
];

export const MOCK_PAYMENTS: PaymentRecord[] = [
  { 
    id: 'pay-1', profile_id: 'prof-eleni', period: '2026-07', payment_type_id: 'pt-salary', gross: 5200, net: 3650, employer_contributions: 1159.08, total_cost: 6359.08, payment_date: '2026-07-28', status: 'paid', bank_reference: ['WIRE-GR8910-ELENI'],
    documents: [
      { id: 'doc-1', name: 'Payslip_July2026_Eleni.pdf', type: 'payslip', size: '245 KB', uploaded_at: '2026-07-28' },
      { id: 'doc-2', name: 'Bank_Remittance_Receipt_0726.pdf', type: 'receipt', size: '112 KB', uploaded_at: '2026-07-28' }
    ]
  },
  { 
    id: 'pay-2', profile_id: 'prof-nikos', period: '2026-07', payment_type_id: 'pt-salary', gross: 5200, net: 3650, employer_contributions: 1159.08, total_cost: 6359.08, payment_date: '2026-07-28', status: 'paid', bank_reference: ['WIRE-GR8911-NIKOS'],
    documents: [
      { id: 'doc-3', name: 'Payslip_July2026_Nikos.pdf', type: 'payslip', size: '240 KB', uploaded_at: '2026-07-28' }
    ]
  },
  { id: 'pay-3', profile_id: 'prof-dimitris', period: '2026-07', payment_type_id: 'pt-salary', gross: 4100, net: 2880, employer_contributions: 913.89, total_cost: 5013.89, payment_date: '2026-07-28', status: 'paid', bank_reference: ['WIRE-GR8912-DIMITRIS'], documents: [] },
  { 
    id: 'pay-4', profile_id: 'prof-sofia', period: '2026-07', payment_type_id: 'pt-contractor', gross: 3500, net: 3500, employer_contributions: 0, total_cost: 3500, payment_date: '2026-07-28', status: 'paid', bank_reference: ['INV-891-WIRE'],
    documents: [
      { id: 'doc-4', name: 'Invoice_INV-891_Sofia.pdf', type: 'invoice', size: '512 KB', uploaded_at: '2026-07-25' },
      { id: 'doc-5', name: 'Wire_Transfer_Confirmation.pdf', type: 'receipt', size: '130 KB', uploaded_at: '2026-07-28' }
    ]
  },
  // Sample planned draft row for next month to test that employees cannot see unapproved planned rows
  { id: 'pay-5', profile_id: 'prof-eleni', period: '2026-08', payment_type_id: 'pt-salary', gross: 5200, net: 3650, employer_contributions: 1248, total_cost: 6448, payment_date: '2026-08-28', status: 'planned', documents: [] }
];

export const MOCK_LEAVE_TYPES: LeaveType[] = [
  { id: 'lt-annual', code: 'annual', name_en: 'Annual Leave', name_el: 'Κανονική άδεια', counts_against_balance: true, requires_document: false, requires_approval: true, colour: '#3b82f6', min_notice_days: 7, allow_retroactive: false, sort_order: 10, is_hidden: false },
  { id: 'lt-sick', code: 'sick', name_en: 'Sick Leave', name_el: 'Αναρρωτική', counts_against_balance: false, requires_document: true, requires_approval: true, colour: '#f59e0b', min_notice_days: 0, allow_retroactive: true, sort_order: 20, is_hidden: false },
  { id: 'lt-unpaid', code: 'unpaid', name_en: 'Unpaid Leave', name_el: 'Άνευ αποδοχών', counts_against_balance: false, requires_document: false, requires_approval: true, colour: '#64748b', min_notice_days: 7, allow_retroactive: false, sort_order: 30, is_hidden: false },
  { id: 'lt-bereavement', code: 'bereavement', name_en: 'Bereavement', name_el: 'Άδεια Πένθους', counts_against_balance: false, requires_document: false, requires_approval: true, colour: '#8b5cf6', min_notice_days: 0, allow_retroactive: true, sort_order: 40, is_hidden: false },
  { id: 'lt-blood', code: 'blood_donation', name_en: 'Blood Donation', name_el: 'Άδεια Αιμοδοσίας', counts_against_balance: false, requires_document: true, requires_approval: true, colour: '#ec4899', min_notice_days: 0, allow_retroactive: true, sort_order: 50, is_hidden: false }
];

export const MOCK_ENTITLEMENTS: LeaveEntitlement[] = [
  { id: 'ent-1', profile_id: 'prof-eleni', year: 2026, entitlement_days: 22, carried_over_days: 2 },
  { id: 'ent-2', profile_id: 'prof-nikos', year: 2026, entitlement_days: 22, carried_over_days: 0 },
  { id: 'ent-3', profile_id: 'prof-dimitris', year: 2026, entitlement_days: 22, carried_over_days: 3 },
  { id: 'ent-4', profile_id: 'prof-maria', year: 2026, entitlement_days: 20, carried_over_days: 1 },
  { id: 'ent-5', profile_id: 'prof-yannis', year: 2026, entitlement_days: 20, carried_over_days: 0 },
  { id: 'ent-6', profile_id: 'prof-katerina', year: 2026, entitlement_days: 12, carried_over_days: 0 },
  { id: 'ent-7', profile_id: 'prof-giorgis', year: 2026, entitlement_days: 20, carried_over_days: 2 },
  { id: 'ent-8', profile_id: 'prof-alexandra', year: 2026, entitlement_days: 20, carried_over_days: 0 }
];

export const MOCK_MANDATORY_LEAVES: MandatoryLeave[] = [
  { id: 'ml-xmas-2026', name: 'Christmas & New Year Closure 2026', leave_type_id: 'lt-annual', start_date: '2026-12-28', end_date: '2026-12-31', status: 'published', created_by: 'prof-eleni', note: 'Company-wide closure for winter break.' }
];

export const MOCK_LEAVE_REQUESTS: LeaveRequest[] = [
  { id: 'lr-1', profile_id: 'prof-dimitris', leave_type_id: 'lt-annual', start_date: '2026-08-03', end_date: '2026-08-14', half_day_start: false, half_day_end: false, working_days: 10, status: 'approved', origin: 'employee_request', note: 'Summer break in Halkidiki', ergani_status: 'submitted' },
  { id: 'lr-2', profile_id: 'prof-maria', leave_type_id: 'lt-annual', start_date: '2026-08-10', end_date: '2026-08-21', half_day_start: false, half_day_end: false, working_days: 9, status: 'approved', origin: 'employee_request', note: 'August holidays', ergani_status: 'pending' },
  { id: 'lr-3', profile_id: 'prof-giorgis', leave_type_id: 'lt-annual', start_date: '2026-09-07', end_date: '2026-09-11', half_day_start: false, half_day_end: false, working_days: 5, status: 'pending', origin: 'employee_request', note: 'Early Sept trip', ergani_status: 'not_required' },
  { id: 'lr-4', profile_id: 'prof-dimitris', leave_type_id: 'lt-annual', start_date: '2026-12-28', end_date: '2026-12-31', half_day_start: false, half_day_end: false, working_days: 4, status: 'approved', origin: 'mandatory', mandatory_leave_id: 'ml-xmas-2026', note: 'Company-wide closure', ergani_status: 'not_required' },
  { id: 'lr-5', profile_id: 'prof-yannis', leave_type_id: 'lt-annual', start_date: '2026-12-28', end_date: '2026-12-31', half_day_start: false, half_day_end: false, working_days: 4, status: 'approved', origin: 'mandatory', mandatory_leave_id: 'ml-xmas-2026', note: 'Company-wide closure', ergani_status: 'not_required' }
];

export const MOCK_PUBLIC_HOLIDAYS: PublicHoliday[] = [
  { id: 'hol-1', date: '2026-01-01', name_el: 'Πρωτοχρονιά', name_en: "New Year's Day", scope: 'national', year: 2026 },
  { id: 'hol-2', date: '2026-01-06', name_el: 'Θεοφάνεια', name_en: 'Epiphany', scope: 'national', year: 2026 },
  { id: 'hol-3', date: '2026-02-23', name_el: 'Καθαρά Δευτέρα', name_en: 'Clean Monday', scope: 'national', year: 2026 },
  { id: 'hol-4', date: '2026-03-25', name_el: '25η Μαρτίου', name_en: 'Independence Day', scope: 'national', year: 2026 },
  { id: 'hol-5', date: '2026-04-10', name_el: 'Μεγάλη Παρασκευή', name_en: 'Good Friday', scope: 'national', year: 2026 },
  { id: 'hol-6', date: '2026-04-12', name_el: 'Κυριακή του Πάσχα', name_en: 'Orthodox Easter Sunday', scope: 'national', year: 2026 },
  { id: 'hol-7', date: '2026-04-13', name_el: 'Δευτέρα του Πάσχα', name_en: 'Orthodox Easter Monday', scope: 'national', year: 2026 },
  { id: 'hol-8', date: '2026-05-01', name_el: 'Εργατική Πρωτομαγιά', name_en: 'Labour Day', scope: 'national', year: 2026 },
  { id: 'hol-9', date: '2026-06-01', name_el: 'Αγίου Πνεύματος', name_en: 'Whit Monday / Holy Spirit', scope: 'national', year: 2026 },
  { id: 'hol-10', date: '2026-08-15', name_el: 'Κοίμηση της Θεοτόκου', name_en: 'Assumption of the Virgin Mary', scope: 'national', year: 2026 },
  { id: 'hol-11', date: '2026-10-26', name_el: 'Αγίου Δημητρίου', name_en: 'Saint Demetrius Day', scope: 'thessaloniki', year: 2026 },
  { id: 'hol-12', date: '2026-10-28', name_el: '28η Οκτωβρίου', name_en: 'Ohi Day', scope: 'national', year: 2026 },
  { id: 'hol-13', date: '2026-12-25', name_el: 'Χριστούγεννα', name_en: 'Christmas Day', scope: 'national', year: 2026 },
  { id: 'hol-14', date: '2026-12-26', name_el: 'Σύναξη Θεοτόκου', name_en: 'Boxing Day', scope: 'national', year: 2026 }
];

export const MOCK_REMOTE_PATTERNS: RemotePattern[] = [
  { id: 'rp-1', profile_id: 'prof-dimitris', weekday: 'Tue', mode: 'remote_gr', valid_from: '2026-01-01' },
  { id: 'rp-2', profile_id: 'prof-dimitris', weekday: 'Thu', mode: 'remote_gr', valid_from: '2026-01-01' },
  { id: 'rp-3', profile_id: 'prof-yannis', weekday: 'Wed', mode: 'remote_gr', valid_from: '2026-01-01' }
];

export const MOCK_REMOTE_DAYS: RemoteDay[] = [
  { id: 'rd-1', profile_id: 'prof-dimitris', date: '2026-07-30', mode: 'remote_gr', note: 'Working from home today', ergani_status: 'submitted' },
  { id: 'rd-2', profile_id: 'prof-maria', date: '2026-07-30', mode: 'office', ergani_status: 'not_required' },
  { id: 'rd-3', profile_id: 'prof-yannis', date: '2026-07-31', mode: 'remote_abroad', location: 'London, UK', note: 'Attending energy summit', ergani_status: 'pending' }
];

export const MOCK_COUNTERPARTIES: Counterparty[] = [
  { id: 'cp-depa', legal_name: 'DEPA Commercial S.A.', afm: '090123891', doy: 'FATE Athens', country: 'Greece', address: 'Marinadou 92, Athens' },
  { id: 'cp-heron', legal_name: 'Heron Energy S.A.', afm: '099881726', doy: 'FATE Athens', country: 'Greece', address: 'Kifissias 120, Athens' },
  { id: 'cp-aws', legal_name: 'Amazon Web Services EMEA SARL', afm: 'LU26330132', country: 'Luxembourg', address: '38 Avenue John F. Kennedy' },
  { id: 'cp-pbot', legal_name: 'PowerBot GmbH', afm: 'DE318920182', country: 'Germany', address: 'Karlstrasse 45, Munich' }
];

export const MOCK_CONTRACTS: Contract[] = [
  {
    id: 'cnt-1',
    counterparty_id: 'cp-depa',
    counterparty: MOCK_COUNTERPARTIES[0],
    direction: 'revenue',
    reference: 'SB-ATLAS-2025-01',
    type: 'saas_subscription',
    status: 'active',
    signed_on: '2025-01-01',
    starts_on: '2025-01-01',
    ends_on: '2026-12-31',
    auto_renews: true,
    renewal_term_months: 12,
    notice_period_days: 60,
    notice_deadline: '2026-11-01',
    value: 180000,
    currency: 'EUR',
    billing_cadence: 'annual',
    vat_treatment: 'domestic_24',
    owner_profile_id: 'prof-nikos',
    product: 'Atlas ETRM',
    notes: 'Key anchor client for Atlas ETRM platform.'
  },
  {
    id: 'cnt-2',
    counterparty_id: 'cp-heron',
    counterparty: MOCK_COUNTERPARTIES[1],
    direction: 'revenue',
    reference: 'SB-EMS-2025-04',
    type: 'saas_subscription',
    status: 'active',
    signed_on: '2025-04-01',
    starts_on: '2025-04-01',
    ends_on: '2026-09-30',
    auto_renews: true,
    renewal_term_months: 12,
    notice_period_days: 60,
    notice_deadline: '2026-08-01', // Urgent Notice Window approaching!
    value: 120000,
    currency: 'EUR',
    billing_cadence: 'quarterly',
    vat_treatment: 'domestic_24',
    owner_profile_id: 'prof-maria',
    product: 'EMS & Bidding Optimizer',
    notes: 'Includes hourly day-ahead algorithm bidding integration.'
  },
  {
    id: 'cnt-3',
    counterparty_id: 'cp-aws',
    counterparty: MOCK_COUNTERPARTIES[2],
    direction: 'cost',
    reference: 'SUP-AWS-2026',
    type: 'supplier',
    status: 'active',
    signed_on: '2026-01-01',
    starts_on: '2026-01-01',
    ends_on: '2026-12-31',
    auto_renews: true,
    notice_period_days: 30,
    notice_deadline: '2026-12-01',
    value: 24000,
    currency: 'EUR',
    billing_cadence: 'monthly',
    vat_treatment: 'intra_eu_reverse_charge',
    owner_profile_id: 'prof-nikos',
    product: 'Cloud Infrastructure'
  },
  {
    id: 'cnt-4',
    counterparty_id: 'cp-pbot',
    counterparty: MOCK_COUNTERPARTIES[3],
    direction: 'cost',
    reference: 'SUP-PBOT-2025',
    type: 'supplier',
    status: 'expiring',
    signed_on: '2025-09-01',
    starts_on: '2025-09-01',
    ends_on: '2026-08-31',
    auto_renews: true,
    renewal_term_months: 12,
    notice_period_days: 45,
    notice_deadline: '2026-07-17', // NOTICE WINDOW PASSED OR CLOSING!
    value: 18000,
    currency: 'EUR',
    billing_cadence: 'annual',
    vat_treatment: 'intra_eu_reverse_charge',
    owner_profile_id: 'prof-maria',
    product: 'Algorithm Partner Feed',
    notes: 'Critical feed for short term intraday trading algorithms.'
  }
];

// ---------------------------------------------------------------------------
// Spaces & seat booking (demo workspace)
// ---------------------------------------------------------------------------

export const MOCK_SPACE_TYPES: SpaceType[] = [
  { id: 'spt-desks', name: 'Working space', booking_mode: 'whole_day', color: '#2f6fa3', sort_order: 10, active: true },
  { id: 'spt-conf', name: 'Conference room', booking_mode: 'time_range', color: '#a21caf', sort_order: 20, active: true },
  { id: 'spt-pod', name: 'Meeting pod', booking_mode: 'time_range', color: '#0d9488', sort_order: 30, active: true },
];

export const MOCK_OFFICE_FLOORS: OfficeFloor[] = [
  { id: 'flr-2', name: 'Floor 2', width: 24, depth: 16, sort_order: 10, active: true },
];

export const MOCK_SPACES: Space[] = [
  {
    id: 'spc-desks', name: 'Desks · Floor 2', type_id: 'spt-desks', capacity: 12, location: 'Floor 2',
    notes: 'Open desk area', active: true, floor_id: 'flr-2',
    pos_x: -5, pos_z: -3, room_width: 10, room_depth: 6, room_height: 2.6, rotation: 0,
  },
  {
    id: 'spc-conf-a', name: 'Conference room A', type_id: 'spt-conf', capacity: 8, location: 'Floor 2',
    notes: 'Screen + video conference', active: true, floor_id: 'flr-2',
    pos_x: 5, pos_z: -3.5, room_width: 7, room_depth: 5, room_height: 2.6, rotation: 0,
    // An L, so the demo shows a room that wraps a corner.
    room_shape: 'l', notch_width: 2.5, notch_depth: 2, notch_corner: 'ne',
    screen_wall: 'n',
  },
  {
    id: 'spc-pod-1', name: 'Phone pod 1', type_id: 'spt-pod', capacity: 1, location: 'Floor 2',
    notes: 'Single-occupancy calls', active: true, floor_id: 'flr-2',
    pos_x: 8.5, pos_z: 4, room_width: 2.2, room_depth: 2.2, room_height: 2.6, rotation: 0,
  },
];
