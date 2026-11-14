import test from 'node:test';
import assert from 'node:assert/strict';
import {rankEvidence,identityEvidencePreview} from '../evidence-priority-shadow.mjs';
const claim=(value,extra={})=>({value,kind:'identity',verified:true,current:true,ownerMatch:true,sourceKey:'original-a',...extra});
test('known source can suggest a value; duplicate reads count once and inputs remain unchanged',()=>{
 const inputs=Object.freeze([Object.freeze(claim('1991-04-15')),Object.freeze(claim('1991-04-15',{verified:false}))]);
 const r=rankEvidence('birth_date',inputs);
 assert.equal(r.decision,'suggestion');assert.equal(r.evidence.length,1);
 assert.deepEqual(r,rankEvidence('birth_date',[...inputs].reverse()));
 assert.equal(identityEvidencePreview({birth_date:inputs}).length,3);
});
test('manual and existing values cannot be replaced, even by two matching verified documents',()=>{
 const a=claim('1991-04-15'),b=claim('1991-04-15',{sourceKey:'original-b'});
 const r=rankEvidence('birth_date',[a,b],{current:{value:'1991-04-16',manual:true}});
 assert.equal(r.reason,'conflicts_with_existing_value');assert.equal(r.proposal,null);
});
test('a second reading of one file or a weak majority cannot resolve disagreement',()=>{
 const a=claim('1991-04-15'),b=claim('1991-04-16');
 assert.equal(rankEvidence('birth_date',[a,b]).reason,'same_source_disagreement');
 assert.equal(rankEvidence('birth_date',[a,a,{...b,sourceKey:'original-b'}]).reason,'independent_sources_disagree');
});
test('wrong owner, archived source, invalid dates and unsupported roles give no suggestion',()=>{
 assert.equal(rankEvidence('birth_date',[claim('1991-04-15',{ownerMatch:false}),claim('1991-04-15',{current:false}),claim('1991-02-30'),claim('1991-04-15',{kind:'recommendation'})]).decision,'rejected');
 assert.equal(rankEvidence('full_name',[claim('Прикладенко Тест',{kind:'biography'})]).reason,'needs_verified_primary_source');
});
test('historical labels reconcile only with their verified date windows and matching area',()=>{
 const a=claim('Старе Місто',{documentDate:'2001-01-01',placeContext:'fixture-region'});
 const b=claim('Нове Місто',{sourceKey:'original-b',documentDate:'2020-01-01',placeContext:'fixture-region'});
 const rules=[{id:'fictional-town',context:'fixture-region',verified:true,labels:[
  {value:'Старе Місто',from:'1900-01-01',to:'2010-12-31'},{value:'Нове Місто',from:'2011-01-01',to:'2099-12-31'}]}];
 assert.equal(rankEvidence('birth_place',[a,b],{placeRules:rules}).decision,'suggestion');
 for(const extra of [{documentDate:null},{documentDate:'2001-01-01'},{placeContext:'other-region'}])
  assert.equal(rankEvidence('birth_place',[a,{...b,...extra}],{placeRules:rules}).decision,'needs_review');
});
