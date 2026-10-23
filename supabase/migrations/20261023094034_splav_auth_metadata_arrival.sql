-- Auth Admin may attach trusted app metadata after the INSERT. Never activate on arrival.
begin;
create or replace function crm_private.sync_staff() returns trigger
language plpgsql security definer set search_path=''
as $$
begin
  if tg_op='UPDATE' and new.raw_app_meta_data->>'crm_account_type'='splav_processor' then
    update public.crm_staff set role='processor',display_name='СПЛАВ',
      active=case when role='processor' then active and (new.banned_until is null or new.banned_until<=now()) else false end
      where user_id=new.id;
  elsif tg_op='INSERT' then
    if new.raw_app_meta_data->>'crm_account_type'='splav_processor' then
      insert into public.crm_staff(user_id,display_name,role,active)
        values(new.id,'СПЛАВ','processor',false);
    else
      insert into public.crm_staff(user_id,display_name,role)
        values(new.id,coalesce(nullif(new.raw_user_meta_data->>'full_name',''),split_part(new.email,'@',1)),'recruiter');
    end if;
  else
    -- Auth token refresh, metadata/password updates and unbanning cannot activate a worker.
    update public.crm_staff set
      display_name=case when role='processor' then 'СПЛАВ' else coalesce(nullif(new.raw_user_meta_data->>'full_name',''),display_name) end,
      active=case when role='processor' then active and (new.banned_until is null or new.banned_until<=now())
                  else (new.banned_until is null or new.banned_until<=now()) end
      where user_id=new.id;
  end if;
  return new;
end $$;


drop trigger crm_staff_sync on auth.users;
create trigger crm_staff_sync after insert or update of raw_user_meta_data,raw_app_meta_data,banned_until on auth.users for each row execute function crm_private.sync_staff();
-- Repair only the reserved, trusted, still-banned worker created by the owner.
update public.crm_staff s set role='processor',active=false,display_name='СПЛАВ'
from auth.users u where s.user_id=u.id and u.email='splav-worker@trorecruiter.invalid'
and u.raw_app_meta_data->>'crm_account_type'='splav_processor' and u.banned_until>now() and not s.active;
commit;
