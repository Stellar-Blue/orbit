-- 1. Create budget_categories
CREATE TABLE public.budget_categories (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('expense', 'income')),
    sort_order INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Seed basic categories
INSERT INTO public.budget_categories (name, direction, sort_order) VALUES
('Payroll & Benefits', 'expense', 10),
('Contractors & Freelancers', 'expense', 20),
('SaaS & Software', 'expense', 30),
('Cloud Infrastructure', 'expense', 40),
('Rent & Facilities', 'expense', 50),
('Legal & Professional', 'expense', 60),
('Travel & Entertainment', 'expense', 70),
('Marketing & Advertising', 'expense', 80),
('Hardware & Equipment', 'expense', 90),
('Other Expenses', 'expense', 100),
('Software Subscriptions', 'income', 10),
('Consulting & Services', 'income', 20),
('Other Income', 'income', 30);

-- 2. Create budgets
CREATE TABLE public.budgets (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    fiscal_year INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')) DEFAULT 'draft',
    revision_of UUID REFERENCES public.budgets(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Ensure only one active budget per fiscal year
CREATE UNIQUE INDEX idx_budgets_active_year ON public.budgets (fiscal_year) WHERE status = 'active';

-- 3. Create budget_lines
CREATE TABLE public.budget_lines (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    budget_id UUID NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES public.budget_categories(id) ON DELETE CASCADE,
    period TEXT NOT NULL, -- YYYY-MM
    amount NUMERIC NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'EUR',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(budget_id, category_id, period)
);

-- 4. Create recurring_commitments
CREATE TABLE public.recurring_commitments (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    category_id UUID NOT NULL REFERENCES public.budget_categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly', 'quarterly', 'yearly')),
    start_date DATE NOT NULL,
    end_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Alter invoices to link to budget_categories
ALTER TABLE public.invoices ADD COLUMN category_id UUID REFERENCES public.budget_categories(id) ON DELETE SET NULL;

-- Enable RLS
ALTER TABLE public.budget_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_commitments ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read/write for v1 (admin only controls can be added later)
CREATE POLICY "Allow authenticated read budget_categories" ON public.budget_categories FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow authenticated all budget_categories" ON public.budget_categories FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated read budgets" ON public.budgets FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow authenticated all budgets" ON public.budgets FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated read budget_lines" ON public.budget_lines FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow authenticated all budget_lines" ON public.budget_lines FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated read recurring_commitments" ON public.recurring_commitments FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow authenticated all recurring_commitments" ON public.recurring_commitments FOR ALL USING (auth.role() = 'authenticated');
