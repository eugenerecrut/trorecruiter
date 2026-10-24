begin;
-- Persist the restriction in the existing job; never trust a request-body flag.
create function public.crm_splav_zone_native_canary_enqueue(p_id uuid,p_pages integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare answer jsonb;begin
 answer:=public.crm_splav_zone_canary_enqueue(p_id,p_pages);
 update crm_private.splav_jobs set result=coalesce(result,'{}'::jsonb)||'{"native_only":true}'::jsonb
 where id=(answer->>'id')::uuid and kind='zone' and coordinator_id=p_id and state='queued' and attempts=0;
 if not found then raise exception 'Native canary must be a new queued job' using errcode='40001';end if;
 return answer||'{"native_only":true}'::jsonb;
end $$;
revoke all on function public.crm_splav_zone_native_canary_enqueue(uuid,integer) from public,anon;
grant execute on function public.crm_splav_zone_native_canary_enqueue(uuid,integer) to authenticated;

do $$declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.crm_splav_zone_step(uuid,uuid,text,jsonb)'::regprocedure);
 needle:=$n$return answer||jsonb_build_object('document',$n$;
 if position(needle in definition)=0 then raise exception 'Unexpected zonal load contract';end if;
 definition:=replace(definition,needle,$n$return answer||jsonb_build_object('native_only',coalesce(j.result->'native_only'='true'::jsonb,false),'document',$n$);
 needle:=$n$elsif p_operation='validate' then return$n$;
 if position(needle in definition)=0 then raise exception 'Unexpected zonal validation contract';end if;
 definition:=replace(definition,needle,$n$elsif p_operation='validate' then
  if j.result->'native_only'='true'::jsonb then raise exception 'AI disabled for native canary' using errcode='42501';end if;
  return$n$);
 needle:=$n$elsif p_operation='final' then$n$;
 if position(needle in definition)=0 then raise exception 'Unexpected zonal final contract';end if;
 definition:=replace(definition,needle,$n$elsif p_operation='final' then
  if j.result->'native_only'='true'::jsonb then raise exception 'Native canary cannot finalize a document' using errcode='42501';end if;$n$);
 execute definition;
end $$;
commit;
