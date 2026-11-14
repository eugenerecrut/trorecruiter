// Read-only policy. Input classes and provenance must come from a trusted adapter.
export const POLICY_VERSION='identity-shadow-1';
const priorities={full_name:{identity:3,birth_record:2,biography:1},
 birth_date:{identity:3,birth_record:3,biography:1},
 birth_place:{birth_record:3,identity:3,biography:1}};
const norm=s=>s.normalize('NFKC').replace(/[’ʼ]/g,"'").trim().replace(/\s+/g,' ').toLocaleLowerCase('uk');
const day=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const valid=(field,v)=>typeof v==='string'&&v.length<=300&&!!v.trim()&&
 (field==='birth_date'?day(v):field!=='full_name'||/^[\p{L}.'’ʼ-]+(?:\s+[\p{L}.'’ʼ-]+)+$/u.test(v.trim()));

// Only a verified, dated rule with matching administrative context may equate
// two historical labels. Never rewrite the source spelling.
function labelKey(value,at,context,rules){
 if(!day(at)||!context)return null;
 const matches=rules.filter(r=>r?.verified===true&&r.context===context&&typeof r.id==='string'&&r.id&&
   Array.isArray(r.labels)&&r.labels.some(x=>typeof x?.value==='string'&&norm(x.value)===norm(value)&&
    day(x.from)&&day(x.to)&&x.from<=at&&at<=x.to));
 return matches.length===1?'place:'+matches[0].id:null;
}

export function rankEvidence(field,claims=[],context={}){
 const out=(decision,reason,evidence=[],proposal=null)=>({policy:POLICY_VERSION,field,decision,reason,proposal,evidence});
 if(!Object.hasOwn(priorities,field))return out('rejected','unsupported_field');
 const rules=Array.isArray(context.placeRules)?context.placeRules:[];
 const key=(value,at,area)=>field==='birth_place'?(labelKey(value,at,area,rules)??'literal:'+norm(value)):'literal:'+norm(value);
 const evidence=(Array.isArray(claims)?claims:[]).flatMap(c=>{
  if(c?.ownerMatch!==true||c.current!==true||!Object.hasOwn(priorities[field],c.kind)||
   typeof c.sourceKey!=='string'||!c.sourceKey.trim()||!valid(field,c.value))return [];
  return [{sourceKey:c.sourceKey,value:c.value,role:c.kind,verified:c.verified===true,
   rank:priorities[field][c.kind],key:key(c.value,c.documentDate,c.placeContext)}];
 }).sort((a,b)=>Number(b.verified)-Number(a.verified)||b.rank-a.rank||
  a.sourceKey.localeCompare(b.sourceKey,'en')||a.value.localeCompare(b.value,'uk')||a.role.localeCompare(b.role,'en'));
 const bySource=new Map();
 for(const e of evidence){
  if(!bySource.has(e.sourceKey))bySource.set(e.sourceKey,new Map());
  const readings=bySource.get(e.sourceKey);
  if(!readings.has(e.key))readings.set(e.key,e);
 }
 const entries=[...bySource.values()].flatMap(x=>[...x.values()]);
 const visible=entries.map(({key:_,...e})=>e);
 if([...bySource.values()].some(x=>x.size>1))return out('needs_review','same_source_disagreement',visible);
 const current=context.current;
 if(typeof current?.value==='string'&&current.value.trim()){
  if(!evidence.length)return out('unchanged','existing_value_protected');
  const matches=entries.every(e=>norm(e.value)===norm(current.value)||e.key===key(current.value,current.documentDate,current.placeContext));
  return out(matches?'unchanged':'needs_review',matches?'existing_value_protected':'conflicts_with_existing_value',visible);
 }
 if(!entries.length)return out('rejected','no_eligible_evidence');
 if(new Set(entries.map(e=>e.key)).size>1)return out('needs_review','independent_sources_disagree',visible);
 const best=entries[0];
 if(!best.verified||best.role==='biography')return out('needs_review','needs_verified_primary_source',visible);
 return out('suggestion','verified_primary_source',visible,{value:best.value,sourceKey:best.sourceKey});
}

export function identityEvidencePreview(claimsByField,contexts={}){
 return Object.keys(priorities).map(field=>rankEvidence(field,claimsByField?.[field],contexts?.[field]??{}));
}
