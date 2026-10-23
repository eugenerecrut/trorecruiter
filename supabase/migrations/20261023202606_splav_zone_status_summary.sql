begin;
-- Extend the existing human-only status RPC. No table changes, new grants or writes.
create or replace function public.crm_splav_job_status(job_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j crm_private.splav_jobs;c crm_private.zone_coordinators;r crm_private.zone_requests;summary jsonb;providers jsonb;
begin
 if crm_private.is_processor() or not exists(select 1 from public.crm_staff where user_id=auth.uid() and active) then raise exception 'Human staff required' using errcode='42501';end if;
 select * into j from crm_private.splav_jobs where id=job_id;
 if not found then return null;end if;
 if j.kind='zone' then
  if crm_private.zone_job_valid(j) then
   select * into c from crm_private.zone_coordinators where id=j.coordinator_id;
   select q.* into r from crm_private.zone_coordinator_steps s join crm_private.zone_requests q on q.id=s.request_id
    where s.coordinator_id=c.id order by s.attempt desc limit 1;
   select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('provider',e->>'provider',
    'diagnosis',case when e->>'diagnosis' in ('insufficient_quota','rate_limit_exceeded','invalid_api_key','model_not_found','permission_denied','RESOURCE_EXHAUSTED','UNAUTHENTICATED','PERMISSION_DENIED','NOT_FOUND','INVALID_ARGUMENT','UNAVAILABLE','INTERNAL','AUTHENTICATION_FAILED','ACCESS_DENIED','MODEL_OR_ENDPOINT_UNAVAILABLE','INPUT_TOO_LARGE','QUOTA_OR_RATE_LIMIT','PROVIDER_HTTP_ERROR','SAFETY','RECITATION','MAX_TOKENS','PROHIBITED_CONTENT','BLOCKLIST','STOP','OTHER','FINISH_REASON_UNSPECIFIED','max_output_tokens','content_filter','incomplete','failed','length','stop','UNREADABLE_OUTPUT','TRANSPORT_RESULT_UNKNOWN') then e->>'diagnosis' end,
    'http_status',case when e->>'http_status' ~ '^[1-5][0-9]{2}$' then (e->>'http_status')::integer
     when e->>'error' ~ '^(OpenAI|Gemini|OpenRouter): HTTP [1-5][0-9]{2}$' then right(e->>'error',3)::integer end))),'[]'::jsonb) into providers
   from (select value e from jsonb_array_elements(case when jsonb_typeof(r.result->'provider_errors')='array' then r.result->'provider_errors' else '[]'::jsonb end) limit 8) entries
   where e->>'provider' in ('OpenAI','Gemini','OpenRouter');
   summary:=jsonb_build_object('attempts',c.snapshot->'attempts','budget',c.snapshot->'budget','pages',c.snapshot->'pages',
    'pending_steps',jsonb_array_length(coalesce(c.snapshot->'tasks','[]'::jsonb)),
    'error_count',jsonb_array_length(coalesce(c.snapshot->'errors','[]'::jsonb)),
    'receipt_state',r.state,'page',r.page,'providers',providers,
    'code',case when r.result->>'code' in ('ZONE_RESULT_UNCERTAIN','ZONE_PROVIDERS_REJECTED') then r.result->>'code' end);
  else summary:=jsonb_build_object('source_changed',true);end if;
 end if;
 return jsonb_build_object('id',j.id,'document_id',j.document_id,'state',j.state,'stage',j.stage,
  'initiated_by',j.initiated_by,'updated_at',j.updated_at,'result',j.result,'kind',j.kind,'zone_summary',summary);
end $$;
commit;
