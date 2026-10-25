-- Reuse the three existing archive triggers. No data migration or new public API.
create or replace function crm_private.guard_archive_operation()
returns trigger language plpgsql security invoker set search_path='' as $$
declare
 actor_role text:=coalesce(auth.role(),'');
 old_workflow jsonb;
 new_workflow jsonb;
 allowed_workflow text[]:=array['archived_at','archive_mode','outcome','stage','completion_date','reason','destination','order_number','order_date','incomplete','incomplete_reason','missing_documents','archive_error','restored_at','restored_by','last_archive','changed_at','changed_by'];
 source_id uuid;
 target_id uuid;
 parent public.candidates%rowtype;
 locked boolean;
begin
 -- Effective postgres inside a SECURITY DEFINER RPC is not an administrator
 -- bypass when the originating request carries an authenticated/service JWT.
 if current_user in ('postgres','supabase_admin') and actor_role not in ('anon','authenticated','service_role') then
  return case when tg_op='DELETE' then old else new end;
 end if;
 if tg_table_name='candidates' then
  old_workflow:=coalesce(old.profile_data->'workflow','{}'::jsonb);
  if nullif(old_workflow->>'archived_at','') is not null then
   if tg_op<>'UPDATE' then raise exception 'Справа в архіві. Спочатку поверніть її в роботу.' using errcode='55000';end if;
   new_workflow:=coalesce(new.profile_data->'workflow','{}'::jsonb);
   if new_workflow->>'archived_at' is not null or new_workflow->>'archive_mode' is not null or new_workflow->>'outcome' is not null
    or auth.uid() is null or new_workflow->>'restored_by' is distinct from auth.uid()::text
    or new_workflow->>'changed_by' is distinct from auth.uid()::text or nullif(new_workflow->>'restored_at','') is null
    or not exists(select 1 from public.crm_staff s where s.user_id=auth.uid() and s.active and s.role in ('owner','lead','recruiter'))
    or (to_jsonb(new)-array['profile_data','recruitment_status','updated_at']) is distinct from (to_jsonb(old)-array['profile_data','recruitment_status','updated_at'])
    or (new.profile_data-'workflow') is distinct from (old.profile_data-'workflow')
    or (new_workflow-allowed_workflow) is distinct from (old_workflow-allowed_workflow)
    or new_workflow->>'stage' is distinct from (case when old_workflow->>'archive_previous_stage' in ('Новий кандидат','Дозвон та співбесіда','В роботі','ВЛК','Направлений до ВЧ') then old_workflow->>'archive_previous_stage' else 'В роботі' end)
    or new.recruitment_status is distinct from new_workflow->>'stage'
   then raise exception 'Архівна справа доступна лише для перегляду. Поверніть її в роботу без зміни інших даних.' using errcode='55000';end if;
  end if;
  if actor_role='service_role' or current_user='service_role' then return case when tg_op='DELETE' then old else new end;end if;
  locked:=old_workflow->>'archive_lock' is not null;
  if tg_op='UPDATE' and new.profile_data->'workflow'->>'archive_lock' is distinct from old_workflow->>'archive_lock' then
   raise exception 'Блокування архівування змінює тільки сервер';
  end if;
 else
  if tg_op<>'INSERT' then source_id:=old.candidate_id;end if;
  if tg_op<>'DELETE' then target_id:=new.candidate_id;end if;
  -- Archive updates lock the same parent row. A document write either commits
  -- before archiving, or observes archived_at after waiting and is rejected.
  -- When moving a document, check both parents in stable ID order.
  for parent in select c.* from public.candidates c where c.id=any(array[source_id,target_id]) order by c.id for no key update loop
   if nullif(parent.profile_data->'workflow'->>'archived_at','') is not null then
    raise exception 'Справа в архіві. Документи та дані не змінено; спочатку поверніть справу в роботу.' using errcode='55000';
   end if;
   if actor_role<>'service_role' and current_user<>'service_role' and parent.profile_data->'workflow'->>'archive_lock' is not null then locked:=true;end if;
  end loop;
 end if;
 if coalesce(locked,false) then raise exception 'Триває перенесення справи в архів. Зміни заблоковано.';end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function crm_private.guard_archive_operation() from public,anon,authenticated;
