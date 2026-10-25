-- Existing leased source metadata and bounded diagnostics only; no schema/grants/data changes.
begin;
do $patch$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.crm_splav_zone_step(uuid,uuid,text,jsonb)'::regprocedure);
 needle:=$n$'file_size',d.file_size$n$;
 replacement:=$n$'file_size',d.file_size,'document_type',d.document_type$n$;
 if position(replacement in definition)=0 then
  if position(needle in definition)=0 then raise exception 'Unexpected zonal load definition';end if;
  execute replace(definition,needle,replacement);
 end if;
 definition:=pg_get_functiondef('public.crm_splav_job_status(uuid)'::regprocedure);
 needle:=$n$'UNREADABLE_OUTPUT','TRANSPORT_RESULT_UNKNOWN'$n$;
 replacement:=$n$'UNREADABLE_OUTPUT','OUTPUT_LIMIT_EXCEEDED','TRANSPORT_RESULT_UNKNOWN'$n$;
 if position(replacement in definition)=0 then
  if position(needle in definition)=0 then raise exception 'Unexpected zonal status diagnostics';end if;
  execute replace(definition,needle,replacement);
 end if;
end $patch$;
commit;
