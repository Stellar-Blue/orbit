-- Table for past telework log amendment requests
CREATE TABLE IF NOT EXISTS public.remote_amendments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  requested_mode TEXT NOT NULL CHECK (requested_mode IN ('office', 'remote_gr', 'remote_abroad')),
  current_mode TEXT CHECK (current_mode IN ('office', 'remote_gr', 'remote_abroad')),
  location TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  decided_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.remote_amendments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all read write on remote amendments" ON public.remote_amendments FOR ALL USING (true) WITH CHECK (true);
