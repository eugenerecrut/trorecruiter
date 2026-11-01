-- Inbound ingestion is server-only. A public client must not bypass webhook auth.
revoke all on function public.crm_receive_whatsapp_message(text,text,text,text,text,bigint,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.crm_receive_whatsapp_message(text,text,text,text,text,bigint,text,text,text,jsonb) to service_role;

drop policy if exists "CRM staff can read whatsapp messages" on public.whatsapp_messages;
drop policy if exists "CRM staff can insert whatsapp messages" on public.whatsapp_messages;
drop policy if exists "CRM staff can update whatsapp messages" on public.whatsapp_messages;
create policy "CRM staff can read whatsapp messages" on public.whatsapp_messages for select to authenticated
using (exists(select 1 from public.crm_staff s where s.user_id=(select auth.uid()) and s.active and s.role in ('owner','lead','recruiter','observer')));
create policy "CRM staff can insert whatsapp messages" on public.whatsapp_messages for insert to authenticated
with check (exists(select 1 from public.crm_staff s where s.user_id=(select auth.uid()) and s.active and s.role in ('owner','lead','recruiter')));
create policy "CRM staff can update whatsapp messages" on public.whatsapp_messages for update to authenticated
using (exists(select 1 from public.crm_staff s where s.user_id=(select auth.uid()) and s.active and s.role in ('owner','lead','recruiter')))
with check (exists(select 1 from public.crm_staff s where s.user_id=(select auth.uid()) and s.active and s.role in ('owner','lead','recruiter')));

drop policy if exists "CRM staff can read whatsapp settings" on public.whatsapp_settings;
drop policy if exists "CRM staff can manage whatsapp settings" on public.whatsapp_settings;
create policy "CRM staff can read whatsapp settings" on public.whatsapp_settings for select to authenticated
using (exists(select 1 from public.crm_staff s where s.user_id=(select auth.uid()) and s.active and s.role in ('owner','lead','recruiter')));
create policy "CRM staff can manage whatsapp settings" on public.whatsapp_settings for all to authenticated
using (exists(select 1 from public.crm_staff s where s.user_id=(select auth.uid()) and s.active and s.role in ('owner','lead')))
with check (exists(select 1 from public.crm_staff s where s.user_id=(select auth.uid()) and s.active and s.role in ('owner','lead')));
