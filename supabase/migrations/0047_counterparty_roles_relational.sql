-- Migration: Create relational roles schema

-- 1. Create roles table
CREATE TABLE IF NOT EXISTS public.roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    attio_id TEXT UNIQUE,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create counterparty_roles join table
CREATE TABLE IF NOT EXISTS public.counterparty_roles (
    counterparty_id UUID NOT NULL REFERENCES public.counterparties(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (counterparty_id, role_id)
);

-- Enable RLS
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counterparty_roles ENABLE ROW LEVEL SECURITY;

-- Add RLS Policies
CREATE POLICY "Enable read access for all authenticated users" ON public.roles FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Enable insert for authenticated users" ON public.roles FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Enable update for authenticated users" ON public.roles FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Enable delete for authenticated users" ON public.roles FOR DELETE USING (auth.role() = 'authenticated');

CREATE POLICY "Enable read access for all authenticated users" ON public.counterparty_roles FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Enable insert for authenticated users" ON public.counterparty_roles FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Enable update for authenticated users" ON public.counterparty_roles FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Enable delete for authenticated users" ON public.counterparty_roles FOR DELETE USING (auth.role() = 'authenticated');

-- Create triggers for updated_at
CREATE EXTENSION IF NOT EXISTS moddatetime SCHEMA extensions;
CREATE TRIGGER handle_roles_updated_at BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE PROCEDURE extensions.moddatetime(updated_at);

-- 3. Backfill initial roles
INSERT INTO public.roles (attio_id, name, slug) VALUES 
('rel_1', 'Client', 'client'),
('rel_3', 'Supplier', 'supplier'),
('rel_4', 'Partner', 'partner'),
('rel_5', 'Vendor', 'vendor')
ON CONFLICT (slug) DO NOTHING;

-- 4. Clean up any previous array implementation if it exists
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'counterparties' AND column_name = 'roles') THEN
        ALTER TABLE public.counterparties DROP COLUMN roles;
    END IF;
END $$;
