-- Reuse the existing worker RPC and comparator. No new public endpoint, data
-- backfill, scheduler activation, candidate writes or automatic confirmation.
begin;
create function crm_private.splav_case_fingerprint(p_candidate uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('candidate_id',p_candidate,'candidate_revision',
  (select md5(to_jsonb(c)::text) from public.candidates c where c.id=p_candidate),
  'documents_revision',(select md5(coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]'::jsonb)::text) from public.documents d where d.candidate_id=p_candidate))
$$;
revoke all on function crm_private.splav_case_fingerprint(uuid) from public,anon,authenticated;

do $migration$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.crm_splav_zone_step(uuid,uuid,text,jsonb)'::regprocedure);
 needle:='report_bytes bigint;';
 if strpos(definition,needle)=0 then raise exception 'Unexpected worker declaration';end if;
 definition:=replace(definition,needle,needle||' parent_job uuid;case_binding jsonb;comparison jsonb;');
 needle:='if p_operation=''load'' then';
 replacement:=$patch$if p_operation in ('load','final') then
  select q.id into parent_job from crm_private.splav_jobs q where q.kind='root' and q.document_id=j.document_id and q.candidate_id=j.candidate_id
   and q.initiated_by=j.initiated_by and q.current_source=j.current_source and q.stage='finished'
   and q.result#>>'{continuation,job_id}'=j.id::text;
  if parent_job is not null then
   if p_operation='final' then
    perform 1 from public.candidates where id=j.candidate_id for update;
    perform 1 from public.documents where candidate_id=j.candidate_id order by id for share;
   end if;
   case_binding:=crm_private.splav_case_fingerprint(j.candidate_id)||jsonb_build_object('parent_job_id',parent_job,'document_id',j.document_id,'source',c.binding);
  end if;
 end if;
 if p_operation='load' then$patch$;
 if strpos(definition,needle)=0 then raise exception 'Unexpected load contract';end if;
 definition:=replace(definition,needle,replacement);
 needle:='return answer||jsonb_build_object(';
 if strpos(definition,needle)=0 then raise exception 'Unexpected load response';end if;
 definition:=replace(definition,needle,'return answer||jsonb_build_object(''crosscheck_binding'',case_binding)||jsonb_build_object(');
 needle:='elsif p_operation=''final'' then';
 replacement:=$patch$elsif p_operation='final' then
  if parent_job is not null then
   comparison:=p_data->'crosscheck';
   if jsonb_typeof(comparison) is distinct from 'object' or octet_length(comparison::text)>60000
    or comparison-array['contract','binding','status','checked','issues']<>'{}'::jsonb
    or comparison->>'contract' is distinct from 'splav-post-zone-1' or comparison->'binding' is distinct from case_binding
    or jsonb_typeof(comparison->'issues') is distinct from 'array' or jsonb_array_length(comparison->'issues')>200
    or coalesce(comparison->>'checked','')!~'^[0-9]{1,3}$'
    or (comparison->>'checked')::int not between 0 and 200
    or comparison->>'status' is distinct from (case when jsonb_array_length(comparison->'issues')>0 then 'needs_review' else 'matched' end)
    then raise exception 'Fresh source-bound crosscheck required' using errcode='40001';end if;
   if exists(select 1 from jsonb_array_elements(comparison->'issues') e where
    jsonb_typeof(e) is distinct from 'object' or e-array['key','status','source_ids']<>'{}'::jsonb
    or jsonb_typeof(e->'key') is distinct from 'string' or length(e->>'key') not between 1 and 80
    or coalesce(e->>'status','') not in ('conflict','needs_review')
    or jsonb_typeof(e->'source_ids') is distinct from 'array' or jsonb_array_length(e->'source_ids')>32)
    then raise exception 'Invalid crosscheck issues';end if;
   if exists(select 1 from jsonb_array_elements(comparison->'issues') e cross join lateral jsonb_array_elements_text(e->'source_ids') s(id)
     where not exists(select 1 from public.documents evidence where evidence.id::text=s.id and evidence.candidate_id=j.candidate_id))
    then raise exception 'Foreign crosscheck source' using errcode='42501';end if;
  end if;$patch$;
 if strpos(definition,needle)=0 then raise exception 'Unexpected final contract';end if;
 definition:=replace(definition,needle,replacement);
 needle:='report:=jsonb_build_object(''status'',status,''reports'',reports,''errors'',c.snapshot->''errors'');';
 replacement:=$patch$if comparison is not null and comparison->>'status'='needs_review' then status:='complete_with_gaps';end if;
  report:=jsonb_build_object('status',status,'reports',reports,'errors',c.snapshot->'errors')||case when comparison is not null then jsonb_build_object('crosscheck',comparison) else '{}'::jsonb end;$patch$;
 if strpos(definition,needle)=0 then raise exception 'Unexpected final report';end if;
 definition:=replace(definition,needle,replacement);
 needle:='where zone_canary_coordinator=j.coordinator_id;return answer;';
 replacement:=$patch$where zone_canary_coordinator=j.coordinator_id;
  if parent_job is not null then
   update crm_private.splav_jobs set result=coalesce(result,'{}'::jsonb)||jsonb_build_object('crosscheck',comparison) where id=j.id;
   update crm_private.splav_jobs set result=jsonb_set(result,'{continuation}',result->'continuation'||jsonb_build_object(
     'state',case when status='complete' then 'completed' else 'needs_review' end,'report_status',status,'crosscheck',comparison)),updated_at=clock_timestamp()
    where id=parent_job and result#>>'{continuation,job_id}'=j.id::text;
  end if;
  return answer;$patch$;
 if strpos(definition,needle)=0 then raise exception 'Unexpected final persistence';end if;
 definition:=replace(definition,needle,replacement);
 execute definition;
end $migration$;
commit;
