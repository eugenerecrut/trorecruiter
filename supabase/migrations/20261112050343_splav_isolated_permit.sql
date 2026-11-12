begin;
-- Dormant until a dedicated control runner uses this policy. Existing queue
-- claims, staff permissions and scheduler behavior are untouched.
create table crm_private.splav_isolated_permits(
 root_job_id uuid primary key references crm_private.splav_jobs(id),
 document_id uuid not null,
 executor_id uuid not null,
 file_sha256 text not null check(file_sha256 ~ '^[a-f0-9]{64}$'),
 root_source jsonb not null check(jsonb_typeof(root_source)='object'),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 closed_at timestamptz,
 check(expires_at>created_at and expires_at<=created_at+interval '15 minutes')
);
alter table crm_private.splav_isolated_permits enable row level security;
revoke all on crm_private.splav_isolated_permits from public,anon,authenticated;

-- The caller must supply the digest computed from the actual file bytes.
-- A positive answer is a deadline, not a lease or authentication credential.
create function crm_private.splav_isolated_deadline(p_root uuid,p_job uuid,p_document uuid,p_verified_sha256 text)
returns timestamptz language sql volatile set search_path='' as $$
 select p.expires_at
 from crm_private.splav_isolated_permits p
 join crm_private.splav_jobs root on root.id=p.root_job_id and root.kind='root'
 join crm_private.splav_jobs j on j.id=p_job
 where p.root_job_id=p_root and p.closed_at is null and p.expires_at>clock_timestamp()
 and p.document_id=p_document and root.document_id=p.document_id and j.document_id=p.document_id
 and p.file_sha256=p_verified_sha256 and root.original_source=p.root_source
 and j.current_source->>'storage_path'=p.root_source->>'storage_path'
 and ((j.id=root.id and j.state in ('queued','running'))
 or (root.stage='finished' and j.kind='zone' and j.state in ('queued','running')
     and root.result#>>'{continuation,job_id}'=j.id::text))
$$;
revoke all on function crm_private.splav_isolated_deadline(uuid,uuid,uuid,text) from public,anon,authenticated;

-- Private primitive: the future runner must authenticate the executor before
-- passing p_executor. This is intentionally not callable through a public RPC.
create function crm_private.splav_isolated_claim(p_root uuid,p_job uuid,p_document uuid,p_verified_sha256 text,p_executor uuid)
returns uuid language plpgsql volatile set search_path='' as $$
declare deadline timestamptz; token uuid;
begin
 if p_executor is null then return null;end if;
 perform 1 from crm_private.splav_isolated_permits where root_job_id=p_root and executor_id=p_executor for update;
 if not found then return null;end if;
 perform 1 from crm_private.splav_jobs where id=p_root for update;
 perform 1 from crm_private.splav_jobs where id=p_job for update;
 deadline:=crm_private.splav_isolated_deadline(p_root,p_job,p_document,p_verified_sha256);
 if deadline is null or deadline<=clock_timestamp() then return null;end if;
 update crm_private.splav_jobs
 set state='running',leased_by=p_executor,lease_token=gen_random_uuid(),
     lease_until=least(deadline,clock_timestamp()+interval '10 minutes'),
     attempts=attempts+1,updated_at=clock_timestamp()
 where id=p_job and state='queued' and deadline>clock_timestamp()
 returning lease_token into token;
 return token;
end $$;
revoke all on function crm_private.splav_isolated_claim(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;

-- A runner must call this before serving a file or dispatching a new step.
-- The deadline can be shorter than an existing lease if the permit was closed
-- or shortened. No access remains once either deadline expires.
create function crm_private.splav_isolated_step_deadline(
 p_root uuid,p_job uuid,p_document uuid,p_verified_sha256 text,p_executor uuid,p_token uuid
) returns timestamptz language sql volatile set search_path='' as $$
 select least(j.lease_until,scope.deadline)
 from crm_private.splav_jobs j
 join crm_private.splav_isolated_permits p on p.root_job_id=p_root and p.executor_id=p_executor
 cross join lateral (select crm_private.splav_isolated_deadline(p_root,p_job,p_document,p_verified_sha256) as deadline) scope
 where j.id=p_job and j.state='running' and j.leased_by=p_executor and j.lease_token=p_token
 and j.lease_until>clock_timestamp() and scope.deadline>clock_timestamp()
$$;
revoke all on function crm_private.splav_isolated_step_deadline(uuid,uuid,uuid,text,uuid,uuid) from public,anon,authenticated;
commit;
