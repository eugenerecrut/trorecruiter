import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createContextDictionary,RULE_CATEGORIES} from '../contextual-ocr-rules.mjs';

const rule=(extra={})=>({id:'fixture-rule',version:'1',category:'education',canonical_value:'Тестова кваліфікація',
 aliases:['Тестова кваліфікаціія'],document_types:['Тестовий диплом'],field_paths:['education.qualification'],language:'uk',
 valid_from:null,valid_to:null,source_reference:'fixture:approved-source',verification_status:'verified',allowed_action:'suggest',
 matching_constraints:{context:{}},approval_metadata:{approved_by:'fixture-reviewer',approved_at:'2026-11-20',reference:'fixture:approval'},...extra});
const query=(extra={})=>({category:'education',raw_value:'Тестова кваліфікаціія',document_type:'Тестовий диплом',field_path:'education.qualification',
 language:'uk',document_date:'2020-01-01',context:{},source_current:true,owner_match:true,manual_confirmed:false,held:false,
 evidence_location:{document_id:'synthetic-document',page:1,zone_id:'synthetic-zone'},...extra});
const dictionary=rules=>createContextDictionary({version:'fixture-dictionary-1',rules});

test('exact contextual aliases explain their rule, version, source and location without mutating inputs',()=>{
 const rules=[rule()],input=query(),before=structuredClone({rules,input});
 const result=dictionary(rules).match(input);
 assert.equal(result.decision,'suggest');assert.equal(result.proposed_value,'Тестова кваліфікація');
 assert.equal(result.raw_value,input.raw_value);assert.equal(result.matches[0].rule_id,'fixture-rule');
 assert.equal(result.matches[0].rule_version,'1');assert.equal(result.matches[0].source_reference,'fixture:approved-source');
 assert.deepEqual(result.evidence_location,input.evidence_location);assert.equal(result.confidence,null);
 result.evidence_location.page=99;result.matches[0].matching_context.context.region='changed';
 assert.deepEqual({rules,input},before);
});

test('all six categories use the same scoped API; personal data always require human review',()=>{
 for(const category of RULE_CATEGORIES){
  const context=category==='geography'?{administrative_area:'fixture-area'}:{};
  const r=rule({category,valid_from:'2000-01-01',valid_to:'2030-12-31',matching_constraints:{context}});
  const result=dictionary([r]).match(query({category,context}));
  assert.equal(result.decision,category==='personal'?'needs_review':'suggest');
  if(category==='personal')assert.equal(result.proposed_value,null);
 }
});

test('scope mismatch, unknown provenance and unestablished owner never produce proposals',()=>{
 const d=dictionary([rule()]);
 for(const changed of [{document_type:'Рекомендаційний лист'},{field_path:'military.rank'},{language:'ru'},
  {evidence_location:null},{evidence_location:{document_id:'fixture',page:0}},{source_current:false},{owner_match:false},
  {manual_confirmed:undefined},{held:undefined}])assert.equal(d.match(query(changed)).proposed_value,null);
 assert.equal(d.match(query({field_path:'military.rank'})).decision,'reject');
});

test('manual confirmations and holds suppress proposals for every category',()=>{
 for(const category of RULE_CATEGORIES){
  const d=dictionary([rule({category})]);
  for(const changed of [{manual_confirmed:true},{held:true}]){
   const result=d.match(query({category,...changed}));
   assert.equal(result.decision,'needs_review');assert.equal(result.reason,'protected_manual_value');assert.equal(result.proposed_value,null);
  }
 }
});

test('unapproved, wildcard, malformed and duplicate rules are rejected at compilation',()=>{
 for(const extra of [{verification_status:'pending'},{source_reference:''},{approval_metadata:{}},{document_types:['*']},
  {field_paths:['education.*']},{aliases:[]},{category:'unknown'},{valid_from:'2021-02-30',valid_to:'2030-01-01'},
  {category:'geography',matching_constraints:{context:{}}},{category:'military'}]){
  const d=dictionary([rule(extra)]);assert.equal(d.accepted_count,0);assert.equal(d.rejectedRules.length,1);
  assert.equal(d.match(query()).proposed_value,null);
 }
 const d=dictionary([rule(),rule({version:'2'})]);assert.equal(d.accepted_count,0);
 assert(d.rejectedRules.every(r=>r.reason==='duplicate_rule_id'));
});

test('geographic aliases require the dated administrative context and retain source spelling',()=>{
 const r=rule({category:'geography',canonical_value:'Нове Тестове',aliases:['Старе Тестове'],field_paths:['identity.birth_place'],
  valid_from:'2000-01-01',valid_to:'2010-12-31',matching_constraints:{context:{administrative_area:'fixture-area'}}});
 const input=query({category:'geography',raw_value:'Старе Тестове',field_path:'identity.birth_place',document_date:'2009-01-01',context:{administrative_area:'fixture-area'}});
 const d=dictionary([r]);assert.equal(d.match(input).decision,'suggest');assert.equal(d.match(input).raw_value,'Старе Тестове');
 for(const extra of [{document_date:null},{document_date:'2011-01-01'},{document_date:'2009-02-30'},{context:{}},{context:{administrative_area:'another-area'}}]){
  const result=d.match({...input,...extra});assert.equal(result.decision,'needs_review');assert.equal(result.proposed_value,null);
 }
});

test('ambiguous rules never vote or choose by input order',()=>{
 const a=rule({id:'a'}),b=rule({id:'b',canonical_value:'Інша кваліфікація'});
 const first=dictionary([a,b]).match(query());
 assert.equal(first.reason,'ambiguous_rules');assert.equal(first.proposed_value,null);
 assert.deepEqual(first,dictionary([b,a]).match(query()));
});

test('incomplete templates are hypotheses; incomplete names and numeric codes are not reconstructed',()=>{
 const r=rule({category:'phrases',canonical_value:'Військову присягу на вірність Українському народові',aliases:['Військову присягу на вірність Українському народові']});
 const result=dictionary([r]).match(query({category:'phrases',raw_value:'Військову присягу на вірність'}));
 assert.equal(result.reason,'incomplete_template');assert.equal(result.proposed_value,null);
 assert.equal(dictionary([{...r,category:'templates'}]).match(query({category:'templates',raw_value:'Військову присягу на вірність'})).reason,'incomplete_template');
 for(const [category,canonical,raw] of [['personal','Прикладенко Тест Тестович','Прикладенко Тест'],['military','123456','12345']]){
  const d=dictionary([rule({category,canonical_value:canonical,aliases:[canonical],valid_from:'2000-01-01',valid_to:'2030-01-01'})]);
  assert.equal(d.match(query({category,raw_value:raw})).decision,'reject');
 }
});

test('automatic presentation is limited to whole fact-free boilerplate in designated template fields',()=>{
 const r=rule({category:'phrases',field_paths:['template.oath_text'],canonical_value:'Військову присягу на вірність Українському народові',
  aliases:['Військову присягу на вірність Українському народовві'],allowed_action:'auto_normalize',matching_constraints:{context:{},fact_free:true}});
 const input=query({category:'phrases',field_path:'template.oath_text',raw_value:r.aliases[0]});
 assert.equal(dictionary([r]).match(input).decision,'auto_normalize');
 for(const extra of [{matching_constraints:{context:{}}},{canonical_value:'Присяга 2020'}, {field_paths:['military.rank']}]){
  const changed={...r,...extra};
  assert.equal(dictionary([changed]).match({...input,field_path:changed.field_paths[0]}).decision,extra.canonical_value?'needs_review':'suggest');
 }
});

test('dictionary snapshots are independent of later caller mutation and can be replaced for rollback',()=>{
 const r=rule(),d=dictionary([r]);r.canonical_value='Змінено';r.aliases.length=0;
 assert.equal(d.match(query()).proposed_value,'Тестова кваліфікація');
 assert.equal(createContextDictionary({version:'rollback-empty',rules:[]}).match(query()).decision,'reject');
 assert.throws(()=>createContextDictionary({rules:[]}),TypeError);
 assert.doesNotThrow(()=>d.match(null));
});

test('results carry only a document location, not unrelated OCR or candidate data',()=>{
 const result=dictionary([rule()]).match(query({evidence_location:{document_id:'fixture',page:2,zone_id:'zone',raw_text:'private OCR',candidate:{phone:'not-for-a-dictionary'}}}));
 assert.deepEqual(result.evidence_location,{document_id:'fixture',page:2,zone_id:'zone'});
 for(const input of [null,[],true,123,{raw_value:{}}])assert.equal(dictionary([]).match(input).decision,'reject');
});

test('canonical values do not produce redundant corrections and unknown payloads are ignored',()=>{
 const r=rule();r.extra={fn(){}};r.extra.self=r.extra;
 const result=dictionary([r]).match(query({raw_value:r.canonical_value}));
 assert.equal(result.reason,'already_canonical');assert.equal(result.proposed_value,null);
});

test('an approved alias still cannot reconstruct factual identifiers, digits, dates or diagnoses',()=>{
 for(const [field,raw,canonical] of [
  ['military.vos','12345','123456'],['military.unit','А0001','Б0001'],['identity.birth_date','01.02.2000','2000-02-01'],
  ['education.qualification','Кухар','Кухар п’ятого розряду 5'],['vlk.diagnosis','Неповний запис','Повний діагноз']
 ]){
  const d=dictionary([rule({field_paths:[field],aliases:[raw],canonical_value:canonical})]);
  const result=d.match(query({field_path:field,raw_value:raw}));
  assert.equal(result.reason,'factual_value_requires_review');assert.equal(result.proposed_value,null);
 }
});

test('existing education vocabulary remains the source of canonical degree normalization',()=>{
 const context={};vm.runInNewContext(readFileSync(new URL('../education-document.js',import.meta.url),'utf8'),context);
 const canonical=context.CRMEducation.normalizeDegree('кваліфікований робітник');
 const d=dictionary([rule({canonical_value:canonical,aliases:['кваліфікований робітник'],source_reference:'repo:education-document.js#normalizeDegree'})]);
 assert.equal(d.match(query({raw_value:'кваліфікований робітник'})).proposed_value,canonical);
});
