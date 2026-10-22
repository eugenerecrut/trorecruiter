const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
test('Large review snapshots use RPC body with complete AI and candidate CAS guards',()=>{
 const js=fs.readFileSync(path.join(root,'crm-intake.js'),'utf8');
 assert(js.includes("rpc('crm_keep_document_value'"));assert(js.includes('p_expected_ai:original'));assert(js.includes('p_expected_candidate_updated_at:fresh.candidate.updated_at'));
 assert(!js.includes(".eq('ai_extracted',JSON.stringify(original))"));
 const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261022040523_document_review_decision_body.sql'),'utf8');
 for(const s of ['security invoker',"set search_path=''",'auth.uid() is null','public.crm_staff','and active','for update','d.ai_extracted is distinct from p_expected_ai','c.updated_at is distinct from p_expected_candidate_updated_at','candidate_id=c.id','d.deleted_at','version_number>d.version_number',"'merged_into'","'archived_at'",'from public,anon','to authenticated'])assert(sql.includes(s),s);
 assert(!/security definer|disable.*trigger|update public.candidates|ai_confidence\s*=|verification_status\s*=/i.test(sql));
 assert(sql.includes("'reviewed_by',auth.uid()"));assert(sql.includes("'reviewed_at',clock_timestamp()"));
});
