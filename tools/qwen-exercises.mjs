// Diagnostic answers only. Never execute model-generated code or promote it into knowledge.
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {MODEL,KNOWLEDGE_VERSION,loadKnowledge,makeRequest,requestProposal} from './qwen-collaborator.mjs';

export const exercises=Object.freeze([
 {id:'police_service_question',question:'worked_before=true, served_before=true. Only work_records entry is a usable police_service record; no legacy narratives. Must the military_service_history clarification question be asked? Boolean.',expected:false},
 {id:'selection_property',question:'What exact selection property identifies a field in CRMDocumentSync.plan?',expected:'key'},
 {id:'target_conflict',question:'Rows: phone=conflict, military_registry_number=leave. Does this prove a conflict of military_registry_number? Boolean.',expected:false},
 {id:'failed_ocr_fallback',question:'AI помилка with old ai_extracted and supported:false. May the legacy mapper run? Boolean.',expected:false},
 {id:'manual_service',question:'Saved service_type is За мобілізацією; OCR says За контрактом. Return the saved value that must remain.',expected:'За мобілізацією'},
 {id:'repeat_period',question:'Same source and same previously transferred PFU period are processed again. How many duplicate periods may be added? Number.',expected:0},
 {id:'duplicate_dashboard',question:'CRMDashboard.load already owns loading. Should legacy updateDashboard call it again? Boolean.',expected:false},
 {id:'partial_date',question:'Only month 2020-02 is observed. Return the date with its original precision.',expected:'2020-02'},
 {id:'passport_regex',question:"Evaluate JavaScript /паспорт/iu.test('Копія паспорта/ID Картки'). Boolean.",expected:true},
 {id:'marriage_regex',question:"Evaluate JavaScript /шлюб/iu.test('Копія свідоцтва про шлюб'). Boolean.",expected:true},
]);
export function exerciseTask(){return 'Diagnostic only. Return exactly ONE JSON object mapping each ID to its primitive answer. No prose, extra keys, or nested objects.\n'+exercises.map(e=>e.id+': '+e.question).join('\n');}
export function grade(text){
 let answers;try{answers=JSON.parse(text);}catch{return {passed:0,total:exercises.length,valid:false,reason:'Invalid JSON',failures:exercises.map(e=>e.id)};}
 if(!answers||typeof answers!=='object'||Array.isArray(answers)||Object.keys(answers).some(k=>!exercises.some(e=>e.id===k)))return {passed:0,total:exercises.length,valid:false,reason:'Invalid answer schema',failures:exercises.map(e=>e.id)};
 const failures=exercises.filter(e=>!Object.hasOwn(answers,e.id)||answers[e.id]!==e.expected).map(e=>e.id);
 return {passed:exercises.length-failures.length,total:exercises.length,valid:true,failures};
}
export async function main(args=process.argv.slice(2)){
 if(args.some(a=>a!=='--dry-run'))throw Error('Usage: node tools/qwen-exercises.mjs [--dry-run]');
 const body=makeRequest(exerciseTask(),await loadKnowledge());body.format='json';
 if(args.includes('--dry-run')){console.log(JSON.stringify({model:MODEL,knowledgeVersion:KNOWLEDGE_VERSION,exercises:exercises.length,sent:false},null,2));return;}
 const startedAt=new Date().toISOString(),result=await requestProposal(body),score=grade(result.proposal);
 const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../tmp/qwen-runs');await mkdir(dir,{recursive:true});
 const report=path.join(dir,startedAt.replaceAll(':','-')+'-exercises-'+process.pid+'.json');
 await writeFile(report,JSON.stringify({version:1,startedAt,knowledgeVersion:KNOWLEDGE_VERSION,...result,score,status:'diagnostic-not-approval'},null,2),{flag:'wx'});
 console.log(JSON.stringify({...score,report},null,2));if(!score.valid||score.passed!==score.total)process.exitCode=2;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
