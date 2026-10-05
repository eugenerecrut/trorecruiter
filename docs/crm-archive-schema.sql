create table public.crm_archive (
 id uuid primary key default gen_random_uuid(), candidate_id uuid not null unique,
 full_name text not null, phone text, outcome text not null, completion_date date,
 destination text, reason text, incomplete boolean not null default false,
 order_number text, order_date date, missing_documents text, incomplete_reason text,
 pdf_path text not null, pdf_sha256 text not null, pdf_size bigint not null,
 source_manifest jsonb not null, state text not null default 'Очищення' check(state in ('Очищення','Готово')),
 error text, archived_by uuid not null, archived_at timestamptz not null default now()
);
alter table public.crm_archive enable row level security;
revoke all on public.crm_archive from anon,authenticated;
grant select on public.crm_archive to authenticated;
grant all on public.crm_archive to service_role;
create policy crm_archive_staff_read on public.crm_archive for select to authenticated
 using (exists(select 1 from public.crm_staff where user_id=(select auth.uid()) and active));
create index crm_archive_date_idx on public.crm_archive(archived_at desc);
create policy crm_archive_storage_insert_lock on storage.objects as restrictive for insert to authenticated
 with check (bucket_id<>'candidate-documents' or not exists(select 1 from public.crm_archive where candidate_id::text=split_part(name,'/',1)));
create policy crm_archive_storage_update_lock on storage.objects as restrictive for update to authenticated
 using (bucket_id<>'candidate-documents' or not exists(select 1 from public.crm_archive where candidate_id::text=split_part(name,'/',1)))
 with check (bucket_id<>'candidate-documents' or not exists(select 1 from public.crm_archive where candidate_id::text=split_part(name,'/',1)));
create policy crm_archive_storage_pdf_keep on storage.objects as restrictive for delete to authenticated
 using (bucket_id<>'candidate-documents' or not exists(select 1 from public.crm_archive where pdf_path=name));

create function crm_private.guard_archive_operation() returns trigger language plpgsql security invoker set search_path='' as $$
declare locked boolean;
begin
 if current_user in ('service_role','postgres','supabase_admin') then return case when tg_op='DELETE' then old else new end; end if;
 if tg_table_name='candidates' then
  locked:=old.profile_data->'workflow'->>'archive_lock' is not null;
  if tg_op='UPDATE' and new.profile_data->'workflow'->>'archive_lock' is distinct from old.profile_data->'workflow'->>'archive_lock' then
   raise exception 'Блокування архівування змінює тільки сервер';
  end if;
 else
  select profile_data->'workflow'->>'archive_lock' is not null into locked from public.candidates where id=case when tg_op='DELETE' then old.candidate_id else new.candidate_id end;
 end if;
 if coalesce(locked,false) then raise exception 'Триває перенесення справи в архів. Зміни заблоковано.'; end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function crm_private.guard_archive_operation() from public;
create trigger crm_archive_candidate_lock before update or delete on public.candidates for each row execute function crm_private.guard_archive_operation();
create trigger crm_archive_document_lock before insert or update or delete on public.documents for each row execute function crm_private.guard_archive_operation();
create trigger crm_archive_personal_lock before insert or update or delete on public.personal_files for each row execute function crm_private.guard_archive_operation();

create function public.crm_prepare_archive(p_id uuid,p_path text,p_sha text,p_size bigint,p_manifest jsonb,p_personal jsonb,p_updated timestamptz,p_actor uuid)
returns public.crm_archive language plpgsql security invoker set search_path='' as $$
declare c public.candidates%rowtype; a public.crm_archive%rowtype; w jsonb; actual jsonb; personal jsonb;
begin
 select * into a from public.crm_archive where candidate_id=p_id;
 if found then return a; end if;
 select * into c from public.candidates where id=p_id for update;
 if not found then raise exception 'Кандидата не знайдено'; end if;
 if c.updated_at is distinct from p_updated then raise exception 'Картка змінилась. Сформуйте пакет знову.'; end if;
 perform 1 from public.personal_files where candidate_id=p_id for update;
 select to_jsonb(p) into personal from public.personal_files p where candidate_id=p_id;
 if personal is distinct from p_personal then raise exception 'Особова справа змінилась. Сформуйте пакет знову.'; end if;
 perform 1 from public.documents where candidate_id=p_id for update;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'path',storage_path,'version',version_number,'deleted_at',deleted_at,'size',file_size) order by id),'[]'::jsonb) into actual from public.documents where candidate_id=p_id;
 if actual is distinct from p_manifest then raise exception 'Документи змінилися. Сформуйте пакет знову.'; end if;
 w:=c.profile_data->'workflow';
 if w->>'outcome' not in ('Відмова кандидата','Відмова ВЧ','Переданий до іншої РМГ','Зарахований до ВЧ') or w->>'outcome' is null then raise exception 'Не визначено результат справи'; end if;
 insert into public.crm_archive(candidate_id,full_name,phone,outcome,completion_date,destination,reason,incomplete,order_number,order_date,missing_documents,incomplete_reason,pdf_path,pdf_sha256,pdf_size,source_manifest,archived_by)
 values(c.id,c.full_name,c.phone,w->>'outcome',(w->>'completion_date')::date,w->>'destination',w->>'reason',coalesce((w->>'incomplete')::boolean,false),w->>'order_number',(w->>'order_date')::date,w->>'missing_documents',w->>'incomplete_reason',p_path,p_sha,p_size,actual,p_actor) returning * into a;
 update public.candidates set profile_data=jsonb_set(profile_data,'{workflow,archive_lock}',to_jsonb(a.id::text),true) where id=p_id;
 return a;
end $$;
revoke all on function public.crm_prepare_archive(uuid,text,text,bigint,jsonb,jsonb,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.crm_prepare_archive(uuid,text,text,bigint,jsonb,jsonb,timestamptz,uuid) to service_role;

create function public.crm_finalize_archive(p_id uuid) returns void language plpgsql security invoker set search_path='' as $$
declare a public.crm_archive%rowtype; actual jsonb;
begin
 select * into a from public.crm_archive where candidate_id=p_id for update;
 if not found then raise exception 'Архівний запис відсутній'; end if;
 if a.state='Готово' then return; end if;
 perform 1 from public.candidates where id=p_id for update;
 perform 1 from public.documents where candidate_id=p_id for update;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'path',storage_path,'version',version_number,'deleted_at',deleted_at,'size',file_size) order by id),'[]'::jsonb) into actual from public.documents where candidate_id=p_id;
 if actual is distinct from a.source_manifest then raise exception 'Документи змінилися під час архівування. Потрібна перевірка.'; end if;
 delete from public.document_ai_runs where candidate_id=p_id or document_id in (select id from public.documents where candidate_id=p_id);
 delete from public.candidates where id=p_id;
 delete from public.crm_activity where candidate_id=p_id;
 update public.crm_archive set state='Готово',error=null,source_manifest='[]'::jsonb where id=a.id;
end $$;
revoke all on function public.crm_finalize_archive(uuid) from public,anon,authenticated;
grant execute on function public.crm_finalize_archive(uuid) to service_role;
