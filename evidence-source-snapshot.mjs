// Shared current-version selection. Tombstones and ambiguous families never
// resurrect an older reading. This module performs no I/O or mutations.
export function evidenceProfile(candidate){
 let value=candidate?.profile_data;
 if(value==null)return {};
 if(typeof value==='string'){try{value=JSON.parse(value);}catch{return null;}}
 return value&&typeof value==='object'&&!Array.isArray(value)?value:null;
}
export function currentEvidenceDocuments(candidate,documents){
 const p=evidenceProfile(candidate);
 if(!candidate?.id||!p||p.merged_into||p.workflow?.archived_at)return [];
 const latest=new Map(),invalidGroups=new Set();
 for(const d of Array.isArray(documents)?documents:[]){
  if(!d?.id||d.candidate_id!==candidate.id)continue;
  const group=d.version_group_id||d.id,old=latest.get(group),version=d.version_number??1;
  if(!['number','string'].includes(typeof version)||!/^\d+$/.test(String(version))||!Number.isSafeInteger(Number(version))||Number(version)<1){invalidGroups.add(group);continue;}
  if(!old||Number(version)>Number(old.version_number??1))latest.set(group,d);
  else if(Number(version)===Number(old.version_number??1)&&JSON.stringify(old)!==JSON.stringify(d))latest.set(group,{...old,ambiguous:true});
 }
 return [...latest].filter(([group,d])=>!invalidGroups.has(group)&&!d.ambiguous&&!d.deleted_at&&typeof d.storage_path==='string'&&d.storage_path.trim()).map(([,d])=>d);
}
