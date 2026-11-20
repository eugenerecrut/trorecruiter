import {createCRMRuleRegistry} from './crm-context-rule-registry.mjs';
import {currentEvidenceDocuments,evidenceProfile} from './evidence-source-snapshot.mjs';

const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const present=v=>v!=null&&String(v).trim()!=='';
const held=e=>e?.requires_review===true||['low','unreadable'].includes(e?.legibility);

export function previewEducationRules({candidate,documents}={}, {education,planner,policy,enabled=true}={}){
 const rows=[],diagnostics=[];
 if(!candidate?.id)return {rows,diagnostics};
 if(typeof education?.review!=='function'||typeof education?.ownerMatches!=='function'||typeof planner?.plan!=='function'||typeof policy?.normalize!=='function')
  return {rows,diagnostics:['existing_planner_unavailable']};
 let registry;
 try{registry=createCRMRuleRegistry(education,{enabled});}catch{return {rows,diagnostics:['registry_unavailable']};}
 if(!registry.accepted_count)return {registry_version:registry.version,rows,diagnostics:['registry_disabled']};
 const p=evidenceProfile(candidate);
 if(!p)return {registry_version:registry.version,rows,diagnostics:['candidate_context_unavailable']};
 const stored=Array.isArray(p.education_records)?p.education_records:[];
 for(const document of currentEvidenceDocuments(candidate,documents)){
  if(document.verification_status!=='Підтверджено'||!document.ai_processed_at||['AI обробка','AI помилка'].includes(document.processing_status))continue;
  try{
   // Call existing planners on detached snapshots, never an alternative writer.
   const d=structuredClone(document),c=structuredClone(candidate),normalized=policy.normalize(d);
   if(normalized?.category!=='education'||!education.isDocument(normalized.type))continue;
   const plan=planner.plan(d,c);
   if(plan?.supported!==true||plan.ownerBlocked!==false)continue;
   const e=normalized.extracted;
   if(!object(e)||!Array.isArray(e.education_records))continue;
   e.education_records.forEach((record,index)=>{
    if(!object(record)||!present(record.degree)||record.source_document_id&&record.source_document_id!==d.id||
     !education.ownerMatches(record,c,structuredClone(stored),true))return;
    const accepted=education.review({...structuredClone(e),education_records:[structuredClone(record)],source_verified:true},c,{education_records:structuredClone(stored)});
    if(accepted?.accepted!==1)return;
    const existing=stored.find(row=>row?.source_document_id===d.id&&
     (row.source_record_index===index||record.diploma_number&&row.diploma_number===record.diploma_number));
    const evidence=record.field_evidence?.degree||{};
    const pages=evidence.source_pages||record.source_pages||e.field_evidence?.education_records?.source_pages||e.meta?.field_evidence?.education_records?.source_pages;
    const page=Array.isArray(pages)?pages.find(n=>Number.isSafeInteger(n)&&n>0):null;
    const manual=existing?.confirmed_by_user===true||existing?.manually_confirmed===true||existing?.field_confirmations?.degree===true||p.field_confirmations?.education_level===true;
    const blocked=held(evidence)||held(record)||held(existing)||held(e.field_evidence?.education_records)||held(e.meta?.field_evidence?.education_records)||
     present(existing?.degree)||present(p.education_level)||present(p.form_data?.education_level);
    const result=registry.match({category:'education',raw_value:record.degree,document_type:'education',field_path:'education.degree',language:'uk',
     context:{},source_current:true,owner_match:true,manual_confirmed:manual,held:blocked,
     evidence_location:{document_id:d.id,page}});
    if(result.reason==='already_canonical'||result.reason==='no_matching_rule')return;
    rows.push({document_id:d.id,file_name:d.file_name||'Документ про освіту',record_index:index,source_type:d.document_type,...result});
   });
  }catch{diagnostics.push({code:'source_preview_unavailable',document_id:document.id});}
 }
 return {registry_version:registry.version,rows,diagnostics};
}
