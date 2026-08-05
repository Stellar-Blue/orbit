-- 0031: configurable payment document categories (payroll attachments)

CREATE TABLE IF NOT EXISTS public.payment_document_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '📎',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.payment_document_types (code, label, emoji, is_default, sort_order) VALUES
  ('receipt', 'Bank Receipt (Proof)', '⭐', TRUE, 1),
  ('payslip', 'Payslip (Analysis)', '📄', TRUE, 2),
  ('invoice', 'Contractor Invoice', '🧾', TRUE, 3),
  ('tax_sheet', 'Tax Declaration', '🏛️', TRUE, 4),
  ('timesheet', 'Timesheet Record', '🕒', TRUE, 5),
  ('other', 'Other Attachment', '📎', TRUE, 6)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.payment_document_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY policy_document_types_admin ON public.payment_document_types
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY policy_document_types_read ON public.payment_document_types
  FOR SELECT TO authenticated USING (true);
