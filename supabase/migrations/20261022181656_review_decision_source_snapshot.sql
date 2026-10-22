-- Bind future decisions to one shared exact extraction snapshot.
-- No candidate updates, table changes, new privileges, or historical rewrites.
create or replace function public.crm_keep_document_value(
 p_document_id uuid,p_candidate_id uuid,p_expected_ai jsonb,
 p_expected_candidate_updated_at timestamptz,p_decision jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare d public.documents;c public.candidates;decisions jsonb;decision jsonb;source jsonb;context jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.crm_staff where user_id=auth.uid() and active) then raise exception 'Потрібна активна сесія';end if;
 if jsonb_typeof(p_decision) is distinct from 'object' or p_decision->>'action' is distinct from 'keep_card'
 or coalesce(p_decision->>'target','') not in ('candidate','profile')
 or coalesce(p_decision->>'key','') !~ '^[a-z_][a-z_0-9]*(\.[a-z_0-9]+)*$'
 or not(p_decision ? 'current' and p_decision ? 'incoming' and p_decision ? 'reason') then raise exception 'Некоректне рішення';end if;
 select * into c from public.candidates where id=p_candidate_id for update;
 if not found or c.updated_at is distinct from p_expected_candidate_updated_at then raise exception 'Дані картки змінилися. Повторіть звірку.';end if;
 if c.profile_data->>'merged_into' is not null or c.profile_data->'workflow'->>'archived_at' is not null then raise exception 'Об’єднана або архівна картка';end if;
 select * into d from public.documents where id=p_document_id and candidate_id=c.id for update;
 if not found or d.deleted_at is not null or d.processing_status in ('AI обробка','AI помилка') then raise exception 'Документ недоступний для звірки';end if;
 if d.ai_extracted is distinct from p_expected_ai then raise exception 'Документ змінився. Повторіть звірку.';end if;
 if exists(select 1 from public.documents where version_group_id=d.version_group_id and version_number>d.version_number and deleted_at is null) then raise exception 'Документ замінено новою версією';end if;
 if jsonb_typeof(d.ai_extracted) is distinct from 'object' then raise exception 'Некоректний результат AI';end if;
 decisions:=coalesce(d.ai_extracted->'_crm_review_decisions','[]');
 if jsonb_typeof(decisions)<>'array' then raise exception 'Забагато збережених рішень';end if;
 source:=jsonb_build_object('document_id',d.id,'candidate_id',d.candidate_id,
 'document_type',to_jsonb(d)->'document_type','version_group_id',to_jsonb(d)->'version_group_id',
 'version_number',to_jsonb(d)->'version_number','storage_path',to_jsonb(d)->'storage_path',
 'file_hash',to_jsonb(d)->'file_hash','extraction',d.ai_extracted-'_crm_review_decisions'-'_crm_review_context');
 context:=d.ai_extracted->'_crm_review_context';
 if context->>'version' is distinct from '1' or nullif(context->>'id','') is null or context->'source' is distinct from source then
  context:=jsonb_build_object('version',1,'id',pg_catalog.gen_random_uuid(),'source',source);
 end if;
 decision:=jsonb_build_object('target',p_decision->'target','key',p_decision->'key','current',p_decision->'current','incoming',p_decision->'incoming','reason',p_decision->'reason','action','keep_card','source_binding',jsonb_build_object('version',1,'context_id',context->'id'),'reviewed_by',auth.uid(),'reviewed_at',clock_timestamp());
 if exists(select 1 from jsonb_array_elements(decisions) saved where saved->>'reviewed_by' is not null and saved->>'reviewed_at' is not null and (saved-'reviewed_by'-'reviewed_at')=(decision-'reviewed_by'-'reviewed_at')) then return;end if;
 if jsonb_array_length(decisions)>=200 then raise exception 'Забагато збережених рішень';end if;
 update public.documents set ai_extracted=jsonb_set(jsonb_set(d.ai_extracted,'{_crm_review_context}',context),'{_crm_review_decisions}',decisions||jsonb_build_array(decision)) where id=d.id;
end $$;
revoke all on function public.crm_keep_document_value(uuid,uuid,jsonb,timestamptz,jsonb) from public,anon;
grant execute on function public.crm_keep_document_value(uuid,uuid,jsonb,timestamptz,jsonb) to authenticated;

