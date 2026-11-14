import {identityEvidencePreview} from './evidence-priority-shadow.mjs';

const fields=['full_name','birth_date','birth_place'];
const norm=value=>typeof value==='string'?value.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('uk'):'';
function role(doc){
 const t=norm(doc.document_type);
 if(/дітей|дитини|змін|шлюб/.test(t))return null;
 if(/паспорт|^id(?:[\s-]|$)/i.test(t))return 'identity';
 if(/свідоцтво про народження|актовий запис про народження/.test(t))return 'birth_record';
 if(/автобіограф/.test(t))return 'biography';
 return null;
}
export function previewFromSnapshot(candidate,documents){
 if(!candidate?.id||candidate.profile_data?.merged_into||candidate.profile_data?.workflow?.archived_at)return [];
 const latest=new Map();
 for(const d of documents||[]){
  if(!d?.id||d.candidate_id!==candidate.id)continue;
  const group=d.version_group_id||d.id,old=latest.get(group);
  if(!old||Number(d.version_number||1)>Number(old.version_number||1))latest.set(group,d);
  else if(Number(d.version_number||1)===Number(old.version_number||1)&&old.id!==d.id)latest.set(group,{...old,ambiguous:true});
 }
 const claims=Object.fromEntries(fields.map(k=>[k,[]]));
 for(const d of latest.values()){
  const kind=role(d),e=d.ai_extracted;
  if(!kind||d.deleted_at||d.ambiguous||!d.storage_path||!e||!d.ai_processed_at||d.verification_status!=='Підтверджено'||
    ['AI помилка','AI обробка'].includes(d.processing_status)||/AI REVIEW REQUIRED/.test(d.notes||''))continue;
  const bio=kind==='biography'?e.autobiography:null;
  const name=[e.full_name,e.personal?.full_name,bio?.owner_full_name].filter(norm);
  const dates=[e.birth_date,e.personal?.birth_date,bio?.owner_birth_date].filter(norm);
  if(bio?.multiple_owners||!name.length||!name.every(n=>norm(n)===norm(candidate.full_name)))continue;
  // A different date cannot establish ownership. Do not use that document to
  // suggest missing fields, but do surface the discrepancy itself for review.
  if(candidate.birth_date&&dates.some(x=>x!==candidate.birth_date)){
   for(const value of dates)claims.birth_date.push({value,kind,ownerMatch:true,current:true,verified:false,sourceKey:d.file_hash||d.storage_path});
   continue;
  }
  const values={full_name:name,birth_date:dates,birth_place:[e.birth_place,e.personal?.birth_place,bio?.personal?.birth_place].filter(norm)};
  for(const field of fields)for(const value of values[field]){
   const sourceKey=d.file_hash||d.storage_path;
   claims[field].push({value,kind,ownerMatch:true,current:true,verified:true,sourceKey});
  }
 }
 return identityEvidencePreview(claims,Object.fromEntries(fields.map(key=>[key,{current:{value:candidate[key]}}])));
}
