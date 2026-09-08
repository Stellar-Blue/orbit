-- 0052: Extend self-service profile edit column grant to include phone.
-- 0027 restricts authenticated self-edits to (first_name, last_name, name_el, title, photo_url).
-- Phone is a non-sensitive directory contact field employees may maintain themselves,
-- so it is added to that grant (re-granting the full list keeps the file self-documenting).
GRANT UPDATE (first_name, last_name, name_el, title, photo_url, phone) ON public.profiles TO authenticated;
