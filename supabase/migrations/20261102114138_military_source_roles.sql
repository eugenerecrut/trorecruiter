-- JSON profile field only; no table/column or access changes.
-- Patch the existing guarded writer so CAS, source snapshots and audit remain intact.
do $migration$
declare definition text; marker text;
begin
  definition:=pg_get_functiondef('public.crm_apply_document_fields(uuid,jsonb)'::regprocedure);
  marker:='    if target=''candidate'' and key=any(array[';
  if position(marker in definition)=0 or position('elsif target=''profile'' and key=any(array[' in definition)=0 then
    raise exception 'Unknown document writer contract; migration stopped';
  end if;
  if position('recommendation_military_specialty' in definition)>0 then
    raise exception 'Source role migration already present; inspect before applying';
  end if;
  definition:=replace(definition,marker,$guard$
    if (coalesce(doc.document_type,'')||' '||coalesce(doc.ai_document_type,'')) ~* 'рекомендац' then
      if (target='candidate' and key in ('military_specialty','military_rank','tcc')) or (target='profile' and key='military_unit') then
        raise exception 'РЛ описує призначення, а не поточний облік чи попередню службу';
      end if;
    end if;
    if target='profile' and key='recommendation_military_specialty' then
      if (coalesce(doc.document_type,'')||' '||coalesce(doc.ai_document_type,'')) !~* 'рекомендац'
        or item->>'fill_only' is distinct from 'true' or not(item ? 'expected_ai') or not(item ? 'expected_current')
        or upper(btrim(coalesce(item->>'incoming',''))) !~ '^[0-9]{3,6}[А-ЯІЇЄҐA-Z]?$'
        or upper(btrim(coalesce(item->>'incoming',''))) is distinct from upper(btrim(coalesce(nullif(doc.ai_extracted->>'military_specialty',''),doc.ai_extracted->'service'->>'military_specialty','')))
      then raise exception 'Непідтверджене джерело ВОС призначення';end if;
    end if;
    if target='candidate' and key=any(array[$guard$);
  definition:=replace(definition,'elsif target=''profile'' and key=any(array[','elsif target=''profile'' and key=any(array[''recommendation_military_specialty'',');
  execute definition;
end $migration$;
