-- Preserve the existing lease, canary, access checks and function ACL.
-- Replace only the final report verdict; no candidate/document rows are rewritten.
do $migration$
declare definition text;old_clause text:=$old$status:=case when jsonb_array_length(c.snapshot->'errors')>0 or exists(select 1 from jsonb_array_elements(reports) r where
    (r->>'mode'='overview' and jsonb_array_length(coalesce(r->'quality_issues','[]'))>0) or
    (r->>'mode'='zone' and (not exists(select 1 from jsonb_array_elements(coalesce(r->'rows','[]')) row where jsonb_array_length(coalesce(row->'fields','[]'))>0)
     or exists(select 1 from jsonb_array_elements(coalesce(r->'rows','[]')) row cross join lateral jsonb_array_elements(coalesce(row->'fields','[]')) f where f->'value'='null'::jsonb or f->>'legibility' is distinct from 'clear')))) then 'complete_with_gaps' else 'complete' end;$old$;new_clause text:=$new$status:=case when jsonb_array_length(c.snapshot->'errors')>0 or exists(select 1 from jsonb_array_elements(reports) r where
    (r->>'mode'='overview' and jsonb_array_length(coalesce(r->'quality_issues','[]'))>0) or
    (r->>'mode'='zone' and (
      jsonb_array_length(case when jsonb_typeof(r->'rows')='array' then r->'rows' else '[]'::jsonb end)=0
      or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(r->'rows')='array' then r->'rows' else '[]'::jsonb end) row where jsonb_array_length(case when jsonb_typeof(row->'fields')='array' then row->'fields' else '[]'::jsonb end)=0)
      or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(r->'rows')='array' then r->'rows' else '[]'::jsonb end) row
        cross join lateral jsonb_array_elements(case when jsonb_typeof(row->'fields')='array' then row->'fields' else '[]'::jsonb end) f where
          f->'value' is null or f->'value'='null'::jsonb
          or (jsonb_typeof(f->'value')='string' and btrim(f->>'value',E' \t\n\r\f' || chr(11) || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')='')
          or f->>'legibility' is distinct from 'clear'
          or case when jsonb_typeof(f->'alternatives')='array' then jsonb_array_length(f->'alternatives')>0 else false end
      )
    ))) then 'complete_with_gaps' else 'complete' end;$new$;
begin
 definition:=pg_get_functiondef('public.crm_splav_zone_step(uuid,uuid,text,jsonb)'::regprocedure);
 if strpos(definition,new_clause)>0 then return;end if;
 if strpos(definition,old_clause)=0 or (length(definition)-length(replace(definition,old_clause,'')))/length(old_clause)<>1 then
  raise exception 'Unexpected zonal verdict definition; no replacement applied';
 end if;
 execute replace(definition,old_clause,new_clause);
end $migration$;
