-- Workflow state only. No candidate/document updates and no scheduler activation.
begin;
create table crm_private.zone_coordinators(
 id uuid primary key default gen_random_uuid(),document_id uuid not null,
 source jsonb not null,file_sha256 text not null check(file_sha256 ~ '^[a-f0-9]{64}$'),
 binding jsonb not null,source_key text not null,version integer not null default 0,
 snapshot jsonb,created_by uuid not null,updated_by uuid not null,
 updated_at timestamptz not null default clock_timestamp(),unique(document_id,source_key)
);
create table crm_private.zone_coordinator_steps(
 coordinator_id uuid not null references crm_private.zone_coordinators(id),
 attempt integer not null check(attempt between 1 and 2600),request_id uuid not null references crm_private.zone_requests(id),
 primary key(coordinator_id,attempt)
);
alter table crm_private.zone_coordinators enable row level security;
alter table crm_private.zone_coordinator_steps enable row level security;
revoke all on crm_private.zone_coordinators,crm_private.zone_coordinator_steps from public,anon,authenticated;

create function crm_private.zone_task_valid(t jsonb,pages integer) returns boolean
language plpgsql immutable set search_path='' as $$
declare b jsonb;k text;n numeric;
begin
 if jsonb_typeof(t) is distinct from 'object' or t-array['mode','page','box','retry','transport_retry']<>'{}'::jsonb
 or coalesce(t->>'mode','') not in ('overview','zone') or coalesce(t->>'page','')!~'^[0-9]+$'
 or (t->>'page')::numeric not between 1 and pages then return false;end if;
 foreach k in array array['retry','transport_retry'] loop
  if t ? k and jsonb_typeof(t->k) is distinct from 'boolean' then return false;end if;
 end loop;
 if t->>'mode'='overview' then return not(t ? 'box') and coalesce(t->>'retry','false')='false';end if;
 b:=t->'box';if jsonb_typeof(b) is distinct from 'object' then return false;end if;
 if b-array['x','y','w','h']<>'{}'::jsonb or (select count(*) from jsonb_object_keys(b))<>4 then return false;end if;
 foreach k in array array['x','y','w','h'] loop
  if jsonb_typeof(b->k) is distinct from 'number' then return false;end if;
  n:=(b->>k)::numeric;if n<0 or n>1 or (k in ('w','h') and n=0) then return false;end if;
 end loop;
 return (b->>'x')::numeric+(b->>'w')::numeric<=1.000001 and (b->>'y')::numeric+(b->>'h')::numeric<=1.000001;
exception when others then return false;end $$;
revoke all on function crm_private.zone_task_valid(jsonb,integer) from public,anon,authenticated;

create function crm_private.zone_checkpoint_valid(s jsonb,binding jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text;t jsonb;pages integer;budget integer;attempts integer;completed integer;
begin
 if jsonb_typeof(s) is distinct from 'object' or octet_length(s::text)>1000000 or s->'source' is distinct from binding
 or s-array['version','pages','source','budget','attempts','completed','tasks','in_flight','errors']<>'{}'::jsonb
 or (select count(*) from jsonb_object_keys(s))<>9 then return false;end if;
 foreach k in array array['version','pages','budget','attempts','completed'] loop
  if jsonb_typeof(s->k) is distinct from 'number' or s->>k !~'^[0-9]+$' then return false;end if;
 end loop;
 pages:=(s->>'pages')::integer;budget:=(s->>'budget')::integer;attempts:=(s->>'attempts')::integer;completed:=(s->>'completed')::integer;
 if s->>'version'<>'1' or pages not between 1 and 200 or budget not between 1 and 2600 or attempts>budget or completed>attempts
 or jsonb_typeof(s->'tasks') is distinct from 'array' or jsonb_typeof(s->'errors') is distinct from 'array'
 or jsonb_array_length(s->'tasks')>2600 or jsonb_array_length(s->'errors')>2600 then return false;end if;
 for t in select value from jsonb_array_elements(s->'tasks') loop
  if not crm_private.zone_task_valid(t,pages) then return false;end if;
 end loop;
 if s->'in_flight'<>'null'::jsonb then
  if not crm_private.zone_task_valid(s->'in_flight',pages) or s->'in_flight' is distinct from s#>'{tasks,0}' or attempts-completed<>1 then return false;end if;
 elsif attempts<>completed then return false;end if;
 for t in select value from jsonb_array_elements(s->'errors') loop
  if jsonb_typeof(t) is distinct from 'object' or t-array['page','mode','code','automatic_retry']<>'{}'::jsonb
   or (select count(*) from jsonb_object_keys(t))<>4 or coalesce(t->>'page','')!~'^[0-9]+$'
   or (t->>'page')::numeric not between 1 and pages or coalesce(t->>'mode','') not in ('overview','zone')
   or coalesce(t->>'code','')!~'^[A-Z0-9_]{1,64}$' or t->'automatic_retry' is distinct from 'false'::jsonb then return false;end if;
 end loop;
 return true;
exception when others then return false;end $$;
revoke all on function crm_private.zone_checkpoint_valid(jsonb,jsonb) from public,anon,authenticated;

create function public.crm_zone_coordinator_open(p_document_id uuid,p_file_sha256 text,p_recover boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare source jsonb;sk text;binding jsonb;c crm_private.zone_coordinators;response jsonb;reports jsonb;report_bytes bigint;
begin
 source:=crm_private.zone_source(p_document_id);
 if p_file_sha256 is null or p_file_sha256!~'^[a-f0-9]{64}$' then raise exception 'Invalid original digest';end if;
 if source->>'file_hash' is not null and lower(source->>'file_hash')<>p_file_sha256 then raise exception 'Original digest changed' using errcode='40001';end if;
 binding:=jsonb_build_object('document_id',p_document_id::text,'file_sha256',p_file_sha256,'revision',coalesce(source->>'ai_processed_at','unprocessed'));
 sk:=encode(sha256(convert_to(jsonb_build_object('source',source,'file_sha256',p_file_sha256)::text,'UTF8')),'hex');
 insert into crm_private.zone_coordinators(document_id,source,file_sha256,binding,source_key,created_by,updated_by)
 values(p_document_id,source,p_file_sha256,binding,sk,auth.uid(),auth.uid()) on conflict(document_id,source_key) do nothing;
 select * into c from crm_private.zone_coordinators where document_id=p_document_id and source_key=sk for update;
 if p_recover and c.snapshot->'in_flight'<>'null'::jsonb and not exists(select 1 from crm_private.zone_coordinator_steps
 where coordinator_id=c.id and attempt=(c.snapshot->>'attempts')::integer) then
  -- No receipt means no coordinator dispatch. CAS fences the old tab before rearming.
  update crm_private.zone_coordinators set snapshot=jsonb_set(jsonb_set(snapshot,'{in_flight}','null'),'{attempts}',snapshot->'completed'),
    version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=c.id returning * into c;
 end if;
 select jsonb_build_object('state',r.state,'result',r.result) into response from crm_private.zone_coordinator_steps s
 join crm_private.zone_requests r on r.id=s.request_id where s.coordinator_id=c.id and s.attempt=(c.snapshot->>'attempts')::integer and c.snapshot->'in_flight'<>'null'::jsonb;
 select coalesce(sum(octet_length(r.result::text)),0) into report_bytes from crm_private.zone_coordinator_steps s
 join crm_private.zone_requests r on r.id=s.request_id where s.coordinator_id=c.id and s.attempt<=coalesce((c.snapshot->>'completed')::integer,0)
 and r.state='completed' and r.result->'review_only'='true'::jsonb;
 if report_bytes<=1800000 then
  select coalesce(jsonb_agg(r.result order by s.attempt),'[]'::jsonb) into reports from crm_private.zone_coordinator_steps s
  join crm_private.zone_requests r on r.id=s.request_id where s.coordinator_id=c.id and s.attempt<=coalesce((c.snapshot->>'completed')::integer,0)
  and r.state='completed' and r.result->'review_only'='true'::jsonb;
 else reports:='[]';end if;
 return jsonb_build_object('id',c.id,'version',c.version,'source',c.binding,'snapshot',c.snapshot,'in_flight_response',response,'reports',reports,'reports_truncated',report_bytes>1800000);
end $$;

create function public.crm_zone_coordinator_save(p_id uuid,p_expected_version integer,p_snapshot jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare c crm_private.zone_coordinators;doc uuid;source jsonb;previous jsonb;expected_tasks jsonb;added integer;tail jsonb;t jsonb;old_errors integer;
begin
 select document_id into doc from crm_private.zone_coordinators where id=p_id;source:=crm_private.zone_source(doc);
 select * into c from crm_private.zone_coordinators where id=p_id for update;
 if not found or c.source is distinct from source then raise exception 'Coordinator source changed' using errcode='40001';end if;
 if not crm_private.zone_checkpoint_valid(p_snapshot,c.binding) then raise exception 'Invalid coordinator checkpoint';end if;
 if c.version is distinct from p_expected_version then
  -- Repeating an acknowledged after-step write grants no new dispatch capability.
  if p_snapshot->'in_flight'='null'::jsonb and c.snapshot=p_snapshot then return c.version;end if;
  raise exception 'Coordinator already advanced in another execution' using errcode='40001';
 end if;
 previous:=c.snapshot;
 if previous is null then
  select jsonb_agg(jsonb_build_object('mode','overview','page',n) order by n) into expected_tasks from generate_series(1,(p_snapshot->>'pages')::integer) n;
  if p_snapshot->>'attempts'<>'1' or p_snapshot->>'completed'<>'0' or p_snapshot->'tasks'<>expected_tasks
   or p_snapshot->'in_flight' is distinct from expected_tasks->0 or p_snapshot->'errors'<>'[]'::jsonb then raise exception 'Invalid initial checkpoint';end if;
 elsif p_snapshot->'pages' is distinct from previous->'pages' or p_snapshot->'budget' is distinct from previous->'budget' then raise exception 'Coordinator budget cannot change';
 elsif previous->'in_flight'='null'::jsonb then
  if (p_snapshot->>'attempts')::integer<>(previous->>'attempts')::integer+1 or p_snapshot->'completed'<>previous->'completed'
   or p_snapshot->'tasks'<>previous->'tasks' or p_snapshot->'errors'<>previous->'errors' or p_snapshot->'in_flight' is distinct from previous#>'{tasks,0}' then raise exception 'Invalid dispatch checkpoint';end if;
 else
  if p_snapshot->'attempts'<>previous->'attempts' or (p_snapshot->>'completed')::integer<>(previous->>'completed')::integer+1
   or p_snapshot->'in_flight'<>'null'::jsonb then raise exception 'Invalid completion checkpoint';end if;
  tail:=(previous->'tasks')-0;added:=jsonb_array_length(p_snapshot->'tasks')-jsonb_array_length(tail);
  if added not between 0 and 6 then raise exception 'Coordinator dropped pending pages';end if;
  select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) into expected_tasks from jsonb_array_elements(p_snapshot->'tasks') with ordinality a(value,ord) where ord>added;
  if expected_tasks<>tail then raise exception 'Coordinator changed pending pages';end if;
  for t in select value from jsonb_array_elements(p_snapshot->'tasks') with ordinality a(value,ord) where ord<=added loop
   if t->'page'<>previous#>'{in_flight,page}' then raise exception 'Coordinator changed task page';end if;
   if t->'transport_retry'='true'::jsonb then
    if added<>1 or t is distinct from (previous->'in_flight')||'{"transport_retry":true}'::jsonb then raise exception 'Invalid local retry';end if;
   elsif t->>'mode'<>'zone' then raise exception 'Invalid next zone';end if;
  end loop;
  old_errors:=jsonb_array_length(previous->'errors');
  if jsonb_array_length(p_snapshot->'errors') not between old_errors and old_errors+1 then raise exception 'Coordinator changed errors';end if;
  select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) into expected_tasks from jsonb_array_elements(p_snapshot->'errors') with ordinality a(value,ord) where ord<=old_errors;
  if expected_tasks<>previous->'errors' then raise exception 'Coordinator changed errors';end if;
  if jsonb_array_length(p_snapshot->'errors')=old_errors+1 then
   t:=p_snapshot->'errors'->old_errors;
   if t->'page' is distinct from previous#>'{in_flight,page}' or t->'mode' is distinct from previous#>'{in_flight,mode}' then raise exception 'Coordinator changed error source';end if;
  end if;
 end if;
 update crm_private.zone_coordinators set snapshot=p_snapshot,version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp()
 where id=c.id returning version into p_expected_version;
 return p_expected_version;
end $$;

-- A cached request ID is provenance, not a provider dispatch secret.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.crm_zone_begin(uuid,jsonb,text,integer,jsonb,text)'::regprocedure);
 if position($old$jsonb_build_object('state',r.state,'result',r.result)$old$ in definition)=0 then raise exception 'Unexpected zone receipt contract';end if;
 definition:=replace(definition,$old$jsonb_build_object('state',r.state,'result',r.result)$old$,$new$jsonb_build_object('id',r.id,'state',r.state,'result',r.result)$new$);
 execute definition;
end $$;

create function public.crm_zone_coordinator_begin(p_id uuid,p_version integer,p_document_id uuid,p_mode text,p_page integer,p_box jsonb,p_render_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare source jsonb;c crm_private.zone_coordinators;r crm_private.zone_requests;answer jsonb;task jsonb;b jsonb;x numeric;y numeric;w numeric;h numeric;k text;
begin
 source:=crm_private.zone_source(p_document_id);
 select * into c from crm_private.zone_coordinators where id=p_id for update;
 if not found or c.document_id is distinct from p_document_id or c.source is distinct from source or c.version is distinct from p_version
 then raise exception 'Coordinator source or version changed' using errcode='40001';end if;
 task:=c.snapshot->'in_flight';if task is null or task='null'::jsonb or task->>'mode' is distinct from p_mode or task->>'page' is distinct from p_page::text then raise exception 'No matching coordinator dispatch';end if;
 if p_mode='overview' then b:='{"x":0,"y":0,"w":1,"h":1}';else
  b:=task->'box';x:=greatest(0,(b->>'x')::numeric-0.015);y:=greatest(0,(b->>'y')::numeric-0.015);
  w:=least(1,(b->>'x')::numeric+(b->>'w')::numeric+0.015)-x;h:=least(1,(b->>'y')::numeric+(b->>'h')::numeric+0.015)-y;
  b:=jsonb_build_object('x',x,'y',y,'w',w,'h',h);
 end if;
 foreach k in array array['x','y','w','h'] loop
  if jsonb_typeof(p_box->k) is distinct from 'number' or abs((p_box->>k)::numeric-(b->>k)::numeric)>0.000001 then raise exception 'Coordinator crop changed';end if;
 end loop;
 select q.* into r from crm_private.zone_coordinator_steps s join crm_private.zone_requests q on q.id=s.request_id
 where s.coordinator_id=c.id and s.attempt=(c.snapshot->>'attempts')::integer;
 if found then return jsonb_build_object('id',r.id,'state',r.state,'result',r.result);end if;
 answer:=public.crm_zone_begin(p_document_id,source,p_mode,p_page,p_box,p_render_sha256);
 insert into crm_private.zone_coordinator_steps(coordinator_id,attempt,request_id) values(c.id,(c.snapshot->>'attempts')::integer,(answer->>'id')::uuid);
 return answer;
end $$;
revoke all on function public.crm_zone_coordinator_open(uuid,text,boolean),public.crm_zone_coordinator_save(uuid,integer,jsonb),public.crm_zone_coordinator_begin(uuid,integer,uuid,text,integer,jsonb,text) from public,anon;
grant execute on function public.crm_zone_coordinator_open(uuid,text,boolean),public.crm_zone_coordinator_save(uuid,integer,jsonb),public.crm_zone_coordinator_begin(uuid,integer,uuid,text,integer,jsonb,text) to authenticated;
commit;
