import {identityEvidencePreview} from './evidence-priority-shadow.mjs';

const fields=['full_name','birth_date','birth_place'];
const norm=value=>typeof value==='string'?value.normalize('NFKC').replace(/[’ʼ]/g,"'").trim().replace(/\s+/g,' ').toLocaleLowerCase('uk'):'';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function role(type){
 const t=norm(type);
 if(/дітей|дитини|змін|шлюб/.test(t))return null;
 if(/паспорт|^id(?:[\s-]|$)/i.test(t))return 'identity';
 if(/свідоцтво про народження|актовий запис про народження/.test(t))return 'birth_record';
 if(/автобіограф/.test(t))return 'biography';
 return null;
}
export function previewFromSnapshot(candidate,documents){
 if(!candidate?.id||candidate.profile_data?.merged_into||candidate.profile_data?.workflow?.archived_at)return [];
 const latest=new Map(),invalidGroups=new Set();
 for(const d of Array.isArray(documents)?documents:[]){
  if(!d?.id||d.candidate_id!==candidate.id)continue;
  const group=d.version_group_id||d.id,old=latest.get(group);
  const version=d.version_number??1;
  // Unknown version metadata must not revive an older original or let input
  // order decide which document is trusted. Block that version family.
  if(!['number','string'].includes(typeof version)||!/^\d+$/.test(String(version))||!Number.isSafeInteger(Number(version))||Number(version)<1){invalidGroups.add(group);continue;}
  if(!old||Number(version)>Number(old.version_number??1))latest.set(group,d);
  else if(Number(version)===Number(old.version_number??1)&&JSON.stringify(old)!==JSON.stringify(d))latest.set(group,{...old,ambiguous:true});
 }
 const claims=Object.fromEntries(fields.map(k=>[k,[]]));
 for(const [group,d] of latest){
  const kind=role(d.document_type),e=d.ai_extracted;
  const types=[d.document_type,d.ai_document_type,d.requirement_type].filter(norm);
  if(!kind||types.some(t=>role(t)!==kind)||invalidGroups.has(group)||d.deleted_at||d.ambiguous||!norm(d.storage_path)||!object(e)||!d.ai_processed_at||d.verification_status!=='Підтверджено'||
    ['AI помилка','AI обробка'].includes(d.processing_status)||/AI REVIEW REQUIRED/.test(d.notes||''))continue;
  const warnings=[...(Array.isArray(d.ai_warnings)?d.ai_warnings:[]),...(Array.isArray(e.meta?.warnings)?e.meta.warnings:[])].join(' ');
  // Match the existing planner's owner warning guard; a human verification
  // badge alone must not erase contradictory saved owner identifiers.
  if(/інш(?:а|ої|у|ого|ий|е).{0,60}(особ|кандидат|ПІБ)|згаду.{0,80}(особ|ПІБ)|different (?:person|candidate|name)|another (?:person|candidate)/i.test(warnings))continue;
  const bio=kind==='biography'?e.autobiography:null;
  const name=[e.full_name,e.personal?.full_name,bio?.owner_full_name].filter(norm);
  const dates=[e.birth_date,e.personal?.birth_date,bio?.owner_birth_date].filter(norm);
  if(bio?.multiple_owners||!name.length||!name.every(n=>norm(n)===norm(candidate.full_name)))continue;
  const taxIds=[e.rnokpp,e.personal?.rnokpp,bio?.owner_rnokpp].filter(v=>v!=null&&String(v).trim()).map(String);
  if(new Set(taxIds).size>1||candidate.rnokpp&&taxIds.some(v=>v!==String(candidate.rnokpp)))continue;
  const sourceKey=norm(d.file_hash)?d.file_hash:d.storage_path;
  // A different date cannot establish ownership. Do not use that document to
  // suggest missing fields, but do surface the discrepancy itself for review.
  if(new Set(dates).size>1||candidate.birth_date&&dates.some(x=>x!==candidate.birth_date)){
   for(const value of dates)claims.birth_date.push({value,kind,ownerMatch:true,current:true,verified:false,sourceKey});
   continue;
  }
  const values={full_name:name,birth_date:dates,birth_place:[e.birth_place,e.personal?.birth_place,bio?.personal?.birth_place].filter(norm)};
  for(const field of fields)for(const value of values[field]){
   claims[field].push({value,kind,ownerMatch:true,current:true,verified:true,sourceKey});
  }
 }
 return identityEvidencePreview(claims,Object.fromEntries(fields.map(key=>[key,{current:{value:candidate[key]}}])));
}
