begin;
create function crm_private.splav_review_groups(p_issues jsonb,p_groups jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare n int; g jsonb; i int; first_i int; item jsonb; seen int[]:='{}'; ids jsonb; field text;
begin
 if jsonb_typeof(p_issues) is distinct from 'array' or jsonb_typeof(p_groups) is distinct from 'array' or octet_length(p_groups::text)>4096 then return null; end if;
 n:=jsonb_array_length(p_issues);
 if n not between 2 and 24 or jsonb_array_length(p_groups) not between 1 and n-1 then return null;end if;
 for g in select value from jsonb_array_elements(p_groups) loop
  if jsonb_typeof(g) is distinct from 'object' or g-array['items','action']<>'{}'::jsonb or
   coalesce(g->>'action','') not in ('check_identity','compare_sources','check_dates','review_document') or jsonb_typeof(g->'items') is distinct from 'array' then return null;end if;
  if jsonb_array_length(g->'items') not between 1 and n then return null;end if;
  first_i:=null;
  for item in select value from jsonb_array_elements(g->'items') loop
   if jsonb_typeof(item) is distinct from 'number' or item::text !~ '^[0-9]{1,2}$' then return null;end if;
   i:=item::text::int;
   if i>=n or i=any(seen) then return null;end if;
   seen:=array_append(seen,i);
   if first_i is null then
    first_i:=i;field:=p_issues->i->>'key';ids:=p_issues->i->'source_ids';
   else
    if coalesce(field,'') not in ('full_name','birth_date','birth_place','rnokpp') or field is distinct from p_issues->i->>'key' then return null;end if;
    select coalesce(jsonb_agg(source_id),'[]'::jsonb) into ids
     from jsonb_array_elements(ids) s(source_id) where (p_issues->i->'source_ids') @> jsonb_build_array(source_id);
    if ids='[]'::jsonb then return null;end if;
   end if;
  end loop;
 end loop;
 if cardinality(seen)<>n then return null;end if;
 return jsonb_build_object('original_count',n,'group_count',jsonb_array_length(p_groups),'groups',p_groups);
end $$;
revoke all on function crm_private.splav_review_groups(jsonb,jsonb) from public,anon,authenticated;
do $migration$
declare definition text; needle text;
begin
 definition:=pg_get_functiondef('public.crm_splav_zone_step(uuid,uuid,text,jsonb)'::regprocedure);
 needle:='jsonb_build_object(''crosscheck'',comparison) where id=j.id;';
 if strpos(definition,needle)=0 then raise exception 'Unexpected SPLAV report persistence';end if;
 definition:=replace(definition,needle,$patch$jsonb_build_object('crosscheck',comparison)||
    jsonb_strip_nulls(jsonb_build_object('review_shadow',crm_private.splav_review_groups(comparison->'issues',p_data->'review_groups')))
    where id=j.id;$patch$);
 execute definition;
end $migration$;
commit;
