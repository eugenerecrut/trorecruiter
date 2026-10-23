-- A report/learning-only write is not a new primary OCR revision.
-- Keep activity auditing; do not append a false document_ai_runs event.
begin;
do $$ declare definition text;comparison text;begin
 comparison:=$expr$(case when jsonb_typeof(new.ai_extracted)='object' and jsonb_typeof(old.ai_extracted)='object'
 then (new.ai_extracted-array['_military_zone_report','_military_zone_learning']) is distinct from (old.ai_extracted-array['_military_zone_report','_military_zone_learning'])
 else new.ai_extracted is distinct from old.ai_extracted end)$expr$;
 definition:=pg_get_functiondef('crm_private.guard_document()'::regprocedure);
 if position('new.ai_extracted is distinct from old.ai_extracted' in definition)=0 then raise exception 'Unexpected document guard contract';end if;
 definition:=replace(definition,'new.ai_extracted is distinct from old.ai_extracted',comparison);execute definition;
 comparison:=$expr$(delta?'ai_extracted' and case when jsonb_typeof(after_row->'ai_extracted')='object' and jsonb_typeof(before_row->'ai_extracted')='object'
 then ((after_row->'ai_extracted')-array['_military_zone_report','_military_zone_learning']) is distinct from ((before_row->'ai_extracted')-array['_military_zone_report','_military_zone_learning'])
 else after_row->'ai_extracted' is distinct from before_row->'ai_extracted' end)$expr$;
 definition:=pg_get_functiondef('crm_private.record_activity()'::regprocedure);
 if position('delta?''ai_extracted''' in definition)=0 then raise exception 'Unexpected document audit contract';end if;
 definition:=replace(definition,'delta?''ai_extracted''',comparison);execute definition;
end $$;
commit;
