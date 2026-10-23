-- A private receipt is required before any paid zonal request. No backfill.
begin;
create table crm_private.zone_requests(
 id uuid primary key default gen_random_uuid(), document_id uuid not null,
 source jsonb not null, source_key text not null, request_key text not null,
 initiated_by uuid not null, receipt uuid not null default gen_random_uuid(),
 mode text not null check(mode in ('overview','zone')), page integer not null check(page between 1 and 200),
 box jsonb not null, render_sha256 text not null check(render_sha256 ~ '^[a-f0-9]{64}$'),
 state text not null default 'dispatched' check(state in ('dispatched','completed','failed','superseded')),
 result jsonb, created_at timestamptz not null default clock_timestamp(), finished_at timestamptz,
 unique(document_id,source_key,request_key)
);
alter table crm_private.zone_requests enable row level security;
revoke all on crm_private.zone_requests from public,anon,authenticated;

create function crm_private.zone_source(p_document_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.documents;
begin
 if auth.uid() is null or crm_private.is_processor() or not exists(select 1 from public.crm_staff
   where user_id=auth.uid() and active and role in ('owner','lead','recruiter','observer'))
 then raise exception 'Active human reader required' using errcode='42501';end if;
 -- Human access in this CRM is team-wide, gated by active staff. Processors stay denied.
 select * into d from public.documents where id=p_document_id for update;
 if not found or d.deleted_at is not null or d.storage_path is null or not public.crm_document_zone_allowed(d.id)
 then raise exception 'Zone document unavailable' using errcode='42501';end if;
 if exists(select 1 from public.documents v where v.version_group_id=d.version_group_id
   and v.version_number>d.version_number and v.deleted_at is null)
 or not exists(select 1 from public.candidates c where c.id=d.candidate_id
   and jsonb_typeof(coalesce(c.profile_data,'{}'::jsonb))='object'
   and nullif(c.profile_data->>'merged_into','') is null
   and nullif(c.profile_data->'workflow'->>'archived_at','') is null
   and nullif(c.profile_data->'workflow'->>'archive_lock','') is null)
 or exists(select 1 from public.crm_archive a where a.candidate_id=d.candidate_id)
 then raise exception 'Superseded zone source' using errcode='40001';end if;
 return crm_private.splav_source(d)||jsonb_build_object('ai_document_type',d.ai_document_type);
end $$;
revoke all on function crm_private.zone_source(uuid) from public,anon,authenticated;

create function public.crm_zone_begin(p_document_id uuid,p_source jsonb,p_mode text,p_page integer,p_box jsonb,p_render_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; supplied public.documents; sk text; rk text; r crm_private.zone_requests; n numeric; k text;
begin
 snapshot:=crm_private.zone_source(p_document_id);
 if jsonb_typeof(p_source) is distinct from 'object' or octet_length(p_source::text)>10000 then raise exception 'Invalid source';end if;
 supplied:=jsonb_populate_record(null::public.documents,p_source);
 if snapshot is distinct from (crm_private.splav_source(supplied)||jsonb_build_object('ai_document_type',supplied.ai_document_type))
 then raise exception 'Zone source changed' using errcode='40001';end if;
 if p_mode is null or p_mode not in ('overview','zone') or p_page is null or p_page not between 1 and 200
 or p_render_sha256 is null or p_render_sha256 !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_box) is distinct from 'object'
 or (select count(*) from jsonb_object_keys(p_box))<>4 then raise exception 'Invalid zone request';end if;
 foreach k in array array['x','y','w','h'] loop
  if jsonb_typeof(p_box->k) is distinct from 'number' then raise exception 'Invalid zone box';end if;
  n:=(p_box->>k)::numeric;if n<0 or n>1 or (k in ('w','h') and n=0) then raise exception 'Invalid zone box';end if;
 end loop;
 if (p_box->>'x')::numeric+(p_box->>'w')::numeric>1 or (p_box->>'y')::numeric+(p_box->>'h')::numeric>1
 then raise exception 'Invalid zone box';end if;
 sk:=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex');
 rk:=encode(sha256(convert_to(jsonb_build_object('contract','zone-receipt-1','mode',p_mode,'page',p_page,
   'box',p_box,'render_sha256',p_render_sha256)::text,'UTF8')),'hex');
 select * into r from crm_private.zone_requests where document_id=p_document_id and source_key=sk and request_key=rk;
 if found then return jsonb_build_object('state',r.state,'result',r.result);end if;
 -- Same upper bound as 200 pages * (overview + six zones, each with one wider read).
 if (select count(*) from crm_private.zone_requests where document_id=p_document_id and source_key=sk)>=2600
 then raise exception 'Zone request budget exhausted' using errcode='54000';end if;
 insert into crm_private.zone_requests(document_id,source,source_key,request_key,initiated_by,mode,page,box,render_sha256)
 values(p_document_id,snapshot,sk,rk,auth.uid(),p_mode,p_page,p_box,p_render_sha256) returning * into r;
 return jsonb_build_object('state','accepted','id',r.id,'receipt',r.receipt);
end $$;

create function public.crm_zone_finish(p_request_id uuid,p_receipt uuid,p_result jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r crm_private.zone_requests; snapshot jsonb;
begin
 -- Check actor before exposing even whether a receipt exists.
 if auth.uid() is null or crm_private.is_processor() or not exists(select 1 from public.crm_staff
 where user_id=auth.uid() and active and role in ('owner','lead','recruiter','observer'))
 then raise exception 'Active human reader required' using errcode='42501';end if;
 select * into r from crm_private.zone_requests where id=p_request_id for update;
 if not found or r.initiated_by is distinct from auth.uid() or r.receipt is distinct from p_receipt
 then raise exception 'Invalid zone receipt' using errcode='42501';end if;
 if r.state<>'dispatched' then raise exception 'Zone receipt already consumed' using errcode='55000';end if;
 snapshot:=crm_private.zone_source(r.document_id);
 if snapshot is distinct from r.source then
  update crm_private.zone_requests set state='superseded',finished_at=clock_timestamp() where id=r.id;
  return jsonb_build_object('state','superseded');
 end if;
 if jsonb_typeof(p_result) is distinct from 'object' or octet_length(p_result::text)>500000 then raise exception 'Invalid zone result';end if;
 if p_result ? 'error' then
  if coalesce(p_result->>'code','') not in ('ZONE_RESULT_UNCERTAIN','ZONE_PROVIDERS_REJECTED') or p_result->'automatic_retry' is distinct from 'false'::jsonb
  then raise exception 'Invalid zone failure';end if;
 else
  if p_result->'review_only' is distinct from 'true'::jsonb or p_result#>>'{source,document_id}' is distinct from r.document_id::text
   or p_result#>>'{source,render_sha256}' is distinct from r.render_sha256 or p_result#>>'{source,page}' is distinct from r.page::text
   or p_result->>'mode' is distinct from r.mode or p_result#>'{source,box}' is distinct from r.box
  then raise exception 'Invalid zone result source';end if;
 end if;
 update crm_private.zone_requests set state=case when p_result ? 'error' then 'failed' else 'completed' end,
   result=p_result,finished_at=clock_timestamp() where id=r.id;
 return jsonb_build_object('state',case when p_result ? 'error' then 'failed' else 'completed' end);
end $$;
revoke all on function public.crm_zone_begin(uuid,jsonb,text,integer,jsonb,text),public.crm_zone_finish(uuid,uuid,jsonb) from public,anon;
grant execute on function public.crm_zone_begin(uuid,jsonb,text,integer,jsonb,text),public.crm_zone_finish(uuid,uuid,jsonb) to authenticated;
commit;
