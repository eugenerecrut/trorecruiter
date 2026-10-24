begin;
-- Extend the existing human-only read RPC with a bounded, verified source binding.
-- No tables, grants, processing jobs or stored candidate data are changed.
do $$declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.crm_splav_job_status(uuid)'::regprocedure);
 needle:=$n$'zone_reports', reports$n$;
 if position(needle in definition)=0 then needle:=$n$'zone_reports',reports$n$;end if;
 if position(needle in definition)=0 or position('zone_binding' in definition)>0 then raise exception 'Unexpected zone status contract';end if;
 definition:=replace(definition,needle,$n$'zone_binding',case when j.kind='zone' and c.id is not null then jsonb_build_object('document_id',c.document_id,'file_sha256',c.file_sha256,'revision',c.binding->>'revision') else null end,'zone_reports',reports$n$);
 execute definition;
end $$;
commit;
