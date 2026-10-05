-- Additional document types used only when the military unit collects the case.
insert into public.document_requirements(document_type,is_required,ai_enabled,sort_order,condition_field,condition_value,condition_behavior,condition_note)
values ('Припис про направлення',true,false,271,'case_mode','unit','include','Документ про направлення кандидата до ВЧ; не приписне посвідчення.'),
       ('Реєстр кандидата',true,false,272,'case_mode','unit','include','Реєстр, у якому зазначений цей кандидат.')
on conflict(document_type) do nothing;

CREATE OR REPLACE FUNCTION public.sync_candidate_document_requirements(p_candidate_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c public.candidates%rowtype;
  req record;
  i integer;
  target_count integer;
  matches_condition boolean;
begin
  if auth.uid() is not null and not exists(select 1 from public.crm_staff where user_id=auth.uid() and active) then
    raise exception 'Синхронізація доступна лише активним працівникам CRM' using errcode='42501';
  end if;
  select * into c from public.candidates where id = p_candidate_id;
  if not found then return; end if;

  delete from public.candidate_document_requirements
  where candidate_id = p_candidate_id;

  for req in
    select * from public.document_requirements
    where active = true
      and (coalesce(c.profile_data->>'case_mode','full') <> 'unit'
        or document_type in ('Копія рекомендаційного листа','Припис про направлення','Реєстр кандидата'))
      and (
        condition_field is null
        or (condition_field = 'case_mode' and condition_value = coalesce(c.profile_data->>'case_mode','full') and condition_behavior = 'include')
        or (condition_field = 'sex' and condition_value = c.sex and condition_behavior = 'include')
        or (condition_field = 'marital_status' and condition_value = c.marital_status and condition_behavior = 'include')
        or (condition_field = 'has_children' and condition_value = coalesce(c.has_children,false)::text and condition_behavior = 'include')
        or (condition_field = 'worked_before' and condition_value = coalesce(c.worked_before,false)::text and condition_behavior = 'include')
        or (condition_field = 'served_before' and condition_value = coalesce(c.served_before,false)::text and condition_behavior = 'include')
      )
  loop
    if req.condition_field = 'has_children' then
      target_count := greatest(coalesce(c.children_count,0),0);
      if coalesce(c.has_children,false) and target_count > 0 then
        for i in 1..target_count loop
          insert into public.candidate_document_requirements(candidate_id, requirement_id, child_index, status)
          values (p_candidate_id, req.id, i, 'Потрібен');
        end loop;
      end if;
    else
      insert into public.candidate_document_requirements(candidate_id, requirement_id, child_index, status)
      values (p_candidate_id, req.id, null, 'Потрібен');
    end if;
  end loop;
end;
$function$
;

drop trigger if exists trg_candidates_sync_case_mode on public.candidates;
create trigger trg_candidates_sync_case_mode after update of profile_data on public.candidates
for each row when ((old.profile_data->>'case_mode') is distinct from (new.profile_data->>'case_mode'))
execute function public.trg_sync_candidate_document_requirements();

