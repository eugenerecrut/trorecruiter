-- Atomic parent/child handoff, no backfill or activation. Existing source/lease guards
-- and the existing zonal executor remain authoritative. No candidate writes.
begin;
create function public.crm_splav_continue_zone(job_id uuid,token uuid,outcome jsonb,p_digest text,p_pages integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j crm_private.splav_jobs;d public.documents;c crm_private.zone_coordinators;child crm_private.splav_jobs;
 v_source jsonb;binding jsonb;sk text;tasks jsonb;final_outcome jsonb;
begin
 j:=crm_private.splav_lock_job(job_id,token);
 if j.stage<>'ocr_saved' or outcome->>'state' is distinct from 'needs_review' or outcome->'zone_eligible' is distinct from 'true'::jsonb
 then raise exception 'Eligible saved OCR required' using errcode='42501';end if;
 if not exists(select 1 from crm_private.splav_settings where enabled and zones_enabled) then raise exception 'Zonal continuation disabled' using errcode='55000';end if;
 select * into d from public.documents where id=j.document_id;
 if d.processing_status is distinct from 'AI оброблено' or jsonb_typeof(d.ai_extracted) is distinct from 'object'
 or not public.crm_document_zone_allowed(d.id) or not (d.mime_type='application/pdf' or d.storage_path ~* '\.pdf$')
 or coalesce(d.file_size,0) not between 5 and 20971520 then raise exception 'Unsupported continuation source' using errcode='42501';end if;
 if p_digest is null or p_digest!~'^[a-f0-9]{64}$' or p_pages is null or p_pages not between 1 and 4
 then raise exception 'Invalid continuation digest/pages';end if;
 if d.file_hash is not null and lower(d.file_hash)<>p_digest then raise exception 'Original digest changed' using errcode='40001';end if;
 v_source:=j.current_source||jsonb_build_object('ai_document_type',d.ai_document_type);
 binding:=jsonb_build_object('document_id',d.id::text,'file_sha256',p_digest,'revision',coalesce(v_source->>'ai_processed_at','unprocessed'));
 sk:=encode(sha256(convert_to(jsonb_build_object('source',v_source,'file_sha256',p_digest)::text,'UTF8')),'hex');
 -- Existing manual/coordinator evidence is never reset or silently re-used by a new parent.
 if exists(select 1 from crm_private.zone_coordinators z where z.document_id=d.id and z.source=v_source)
 or exists(select 1 from crm_private.zone_requests z where z.document_id=d.id and z.source=v_source)
 or exists(select 1 from crm_private.splav_jobs q where q.document_id=d.id and q.kind='zone' and q.original_source=j.current_source)
 then
  final_outcome:=outcome||jsonb_build_object('continuation',jsonb_build_object('state','needs_review','reason','existing_zone_history'));
  perform public.crm_splav_finish(job_id,token,final_outcome);return final_outcome->'continuation';
 end if;
 select jsonb_agg(jsonb_build_object('mode','overview','page',n) order by n) into tasks from generate_series(1,p_pages)n;
 insert into crm_private.zone_coordinators(document_id,source,file_sha256,binding,source_key,created_by,updated_by,snapshot)
 values(d.id,v_source,p_digest,binding,sk,j.initiated_by,auth.uid(),jsonb_build_object('version',1,'pages',p_pages,'source',binding,
 'budget',p_pages*13,'attempts',0,'completed',0,'tasks',tasks,'in_flight',null,'errors','[]'::jsonb)) returning * into c;
 insert into crm_private.splav_jobs(document_id,candidate_id,initiated_by,original_source,current_source,kind,coordinator_id)
 values(d.id,j.candidate_id,j.initiated_by,j.current_source,j.current_source,'zone',c.id) returning * into child;
 if not crm_private.zone_job_valid(child) then raise exception 'Continuation source no longer eligible' using errcode='40001';end if;
 final_outcome:=outcome||jsonb_build_object('continuation',jsonb_build_object('state','queued','job_id',child.id,'pages',p_pages,'budget',p_pages*13));
 perform public.crm_splav_finish(job_id,token,final_outcome);
 insert into crm_private.splav_events(job_id,actor_id,initiated_by,operation) values(child.id,auth.uid(),j.initiated_by,'continued_from_root');
 return final_outcome->'continuation';
end $$;
revoke all on function public.crm_splav_continue_zone(uuid,uuid,jsonb,text,integer) from public,anon;
grant execute on function public.crm_splav_continue_zone(uuid,uuid,jsonb,text,integer) to authenticated;
commit;
