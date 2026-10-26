// Local coding proposals only: no shell tools, file edits or database access for the model.
import {readFile,realpath,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const MODEL='qwen2.5-coder:7b';
export const KNOWLEDGE_VERSION='2';
export const ENDPOINT='http://127.0.0.1:11434/api/chat';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const LIMIT=16000;
export async function loadKnowledge(){
 return (await Promise.all(['knowledge.md','examples.md'].map(name=>readFile(path.join(ROOT,'docs/qwen',name),'utf8')))).join('\n\n');
}
const blocked=/^(?:tmp|backups|reports|output|\.git|\.codex|\.agents|\.aider[^/]*)(?:\/|$)|^supabase\/\.temp(?:\/|$)|(?:^|\/)\.env(?:\.|$)/i;
export function validateRelative(value){
 const normalized=String(value).replaceAll('\\','/');
 if(path.isAbsolute(value)||/^[a-z]:/i.test(normalized)||normalized.split('/').some(s=>s==='..')||blocked.test(normalized)||! /\.(?:js|mjs|cjs|ts|md|sql)$/i.test(normalized))throw Error('Context must be an allowed tracked source file inside this repository.');
 return normalized;
}
export function checkSecrets(text){
 if(/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{20,}|\bsbp_[A-Za-z0-9]{20,}|\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/.test(text))throw Error('Possible credential in context; remove it before requesting a proposal.');
}
async function trackedSource(name){
 const relative=validateRelative(name);
 const tracked=execFileSync('git',['ls-files','--error-unmatch','--',relative],{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 if(tracked!==relative)throw Error('Only an exact tracked file may be included.');
 const resolved=await realpath(path.join(ROOT,relative));
 const inside=path.relative(await realpath(ROOT),resolved);
 if(inside.startsWith('..')||path.isAbsolute(inside))throw Error('Source resolves outside repository.');
 const content=await readFile(resolved,'utf8');checkSecrets(content);
 return {name:relative,content};
}
export function makeRequest(task,knowledge,files=[]){
 if(typeof task!=='string'||!task.trim())throw Error('A concrete coding task is required.');
 const content=['TASK\n'+task,...files.map(f=>'SOURCE '+f.name+'\n'+f.content)].join('\n\n');
 checkSecrets(content);checkSecrets(knowledge);
 if(content.length+knowledge.length>LIMIT)throw Error('Context exceeds 16000 characters; choose a smaller task or source file. Nothing was sent.');
 return {model:MODEL,stream:false,messages:[{role:'system',content:knowledge},{role:'user',content}],options:{temperature:0,num_ctx:8192,num_predict:1600}};
}
export async function requestProposal(body,{fetchImpl=fetch,timeoutMs=120000}={}){
 const response=await fetchImpl(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs)});
 if(!response.ok)throw Error('Ollama returned HTTP '+response.status+'; no automatic retry.');
 const result=await response.json();
 if(result.done!==true||typeof result.message?.content!=='string'||!result.message.content.trim())throw Error('Ollama returned an incomplete or empty proposal.');
 return {proposal:result.message.content,model:result.model||MODEL,inputTokens:result.prompt_eval_count??null,outputTokens:result.eval_count??null};
}
export async function main(args=process.argv.slice(2)){
 let task='',dryRun=false;const sources=[];
 for(let i=0;i<args.length;i++){
  if(args[i]==='--task')task=args[++i]||'';
  else if(args[i]==='--file')sources.push(args[++i]||'');
  else if(args[i]==='--dry-run')dryRun=true;
  else if(args[i]==='--help'){console.log('node tools/qwen-collaborator.mjs --task "Specific coding task" [--file tracked-source.js] [--dry-run]');return;}
  else throw Error('Unknown option: '+args[i]);
 }
 const knowledge=await loadKnowledge();
 const files=[];for(const source of sources)files.push(await trackedSource(source));
 const body=makeRequest(task,knowledge,files);
 if(dryRun){console.log(JSON.stringify({model:MODEL,endpoint:ENDPOINT,files:files.map(f=>f.name),characters:body.messages.reduce((n,m)=>n+m.content.length,0),sent:false},null,2));return;}
 const startedAt=new Date().toISOString(),result=await requestProposal(body);
 const dir=path.join(ROOT,'tmp/qwen-runs');await mkdir(dir,{recursive:true});
 const report=path.join(dir,startedAt.replaceAll(':','-')+'-'+process.pid+'.json');
 await writeFile(report,JSON.stringify({version:1,startedAt,task,files:files.map(f=>f.name),knowledgeVersion:KNOWLEDGE_VERSION,...result,status:'unreviewed'},null,2),{flag:'wx'});
 console.log(result.proposal+'\n\nUnreviewed proposal saved: '+report);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
