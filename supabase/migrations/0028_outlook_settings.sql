-- 0028: Outlook (Microsoft Graph) calendar mirroring settings

INSERT INTO public.integration_settings (provider, key, value, description) VALUES
  ('m365', 'enabled', 'true', 'Master toggle for Outlook calendar mirroring'),
  ('m365', 'leave_label', '"Out of office"', 'Generic subject for leave events (privacy: leave type never leaves Orbit)'),
  ('m365', 'remote_label', '"Working remotely"', 'Subject for remote-day events'),
  ('m365', 'half_day_label', '"Out of office (afternoon)"', 'Subject for half-day leave events'),
  ('m365', 'horizon_days', '60', 'How many days ahead events are kept in sync')
ON CONFLICT (provider, key) DO NOTHING;
