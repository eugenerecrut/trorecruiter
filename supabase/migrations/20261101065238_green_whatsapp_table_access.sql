-- RLS remains responsible for active staff and role checks.
revoke all on public.whatsapp_messages, public.whatsapp_settings from anon, authenticated;
grant select, insert, update on public.whatsapp_messages, public.whatsapp_settings to authenticated;
