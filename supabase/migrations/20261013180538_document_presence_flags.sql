-- Paper presence uses existing profile_data and the existing candidate activity audit.
-- This function retains caller RLS and never creates files or document AI results.
create or replace function public.crm_set_document_presence(
  p_candidate_id uuid, p_requirement_id uuid, p_present boolean, p_expected jsonb default null
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  actor uuid:=auth.uid(); actor_name text; candidate public.candidates; requirement public.document_requirements;
  profile jsonb; marks jsonb; current_mark jsonb; next_mark jsonb; changed_at timestamptz;
begin
  select display_name into actor_name from public.crm_staff
    where user_id=actor and active and role in ('owner','lead','recruiter');
  if not found then raise exception 'Потрібна активна авторизована сесія CRM' using errcode='42501';end if;
  if p_present is null then raise exception 'Вкажіть стан документа';end if;
  select * into requirement from public.document_requirements where id=p_requirement_id and active for share;
  if not found then raise exception 'Тип документа не знайдено';end if;
  if requirement.document_type<>all(array[
    'Автобіографія рукописна','Заява на контракт','Згода на обробку даних',
    'Згода на обробку даних для психологічного тестування','Картка соціально-психологічного вивчення',
    'Анкета на контракт','Розписка кандидата на військову службу за контрактом','Фото 9×12','Фото 3×4',
    'Характеристика','Сертифікат від психіатра та нарколога / відповідні довідки',
    'Довідка з визначенням групи крові та резус-фактору','Додаток 13 (Картка обстеження та медичного огляду)',
    'Сертифікат психологічного тестування (перша сторінка)','Припис про направлення','Реєстр кандидата',
    'Довідка гінеколога','Копія УБД','Копія витягу з наказу','Нагороди',
    'Послужний список','Перелік документів','Титульний аркуш','Наказ про зарахування до ВЧ'
  ]) then raise exception 'Для цього документа потрібен файл';end if;
  select * into candidate from public.candidates where id=p_candidate_id for update;
  if not found then raise exception 'Кандидата не знайдено або немає доступу' using errcode='42501';end if;
  profile:=coalesce(candidate.profile_data,'{}'::jsonb);
  if jsonb_typeof(profile)='string' then profile:=(profile#>>'{}')::jsonb;end if;
  if jsonb_typeof(profile)<>'object' then raise exception 'Некоректні дані профілю';end if;
  if profile->>'merged_into' is not null then raise exception 'Відкрийте основну справу кандидата';end if;
  marks:=coalesce(nullif(profile->'document_presence','null'::jsonb),'{}'::jsonb);
  if jsonb_typeof(marks)<>'object' then raise exception 'Некоректні позначки документів';end if;
  current_mark:=marks->p_requirement_id::text;
  if coalesce(current_mark,'null'::jsonb) is distinct from coalesce(p_expected,'null'::jsonb) then
    raise exception 'Позначку вже змінив інший працівник. Оновіть документи';
  end if;
  if p_present and current_mark->>'available'='true' and current_mark->>'document_type'=requirement.document_type then return current_mark;end if;
  if not p_present and current_mark is null then return null;end if;
  changed_at:=clock_timestamp();
  if p_present then
    next_mark:=jsonb_build_object('document_type',requirement.document_type,'available',true,
      'checked_by',actor,'checked_by_name',actor_name,'checked_at',changed_at);
    marks:=marks||jsonb_build_object(p_requirement_id::text,next_mark);
  else marks:=marks-p_requirement_id::text;next_mark:=null;end if;
  update public.candidates set profile_data=jsonb_set(profile,'{document_presence}',marks,true),updated_at=changed_at
    where id=p_candidate_id;
  if not found then raise exception 'Позначку не збережено. Перевірте доступ' using errcode='42501';end if;
  return next_mark;
end;
$$;
revoke all on function public.crm_set_document_presence(uuid,uuid,boolean,jsonb) from public,anon;
grant execute on function public.crm_set_document_presence(uuid,uuid,boolean,jsonb) to authenticated;
