// Shadow dictionary API: no I/O, OCR, global learning or record writes.
export const RULE_POLICY_VERSION='context-rules-1';
export const RULE_CATEGORIES=Object.freeze(['personal','geography','military','education','phrases','templates']);
const actions=new Set(['auto_normalize','suggest','needs_review']);
const boilerplateFields=new Set(['template.oath_text','template.discharge_text']);
const text=v=>typeof v==='string'&&v.trim().length>0&&v.length<=2000;
const key=v=>v.normalize('NFKC').replace(/[’ʼ]/g,"'").trim().replace(/\s+/g,' ').toLocaleLowerCase('uk');
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const list=v=>Array.isArray(v)&&v.length>0&&v.every(text);
const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const order=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const locationOf=value=>object(value)?{
 document_id:typeof value.document_id==='string'?value.document_id:null,
 page:Number.isSafeInteger(value.page)?value.page:null,...(text(value.zone_id)?{zone_id:value.zone_id}:{})
}:null;

function invalid(rule){
 if(!object(rule)||!text(rule.id)||!text(rule.version)||!RULE_CATEGORIES.includes(rule.category)||!text(rule.canonical_value))return 'invalid_identity';
 if(!list(rule.aliases)||!list(rule.document_types)||!list(rule.field_paths)||!text(rule.language))return 'invalid_scope';
 if([...rule.document_types,...rule.field_paths].some(v=>v.includes('*')))return 'wildcard_scope';
 if(rule.verification_status!=='verified'||!text(rule.source_reference)||!object(rule.approval_metadata)||
  !text(rule.approval_metadata.approved_by)||!day(rule.approval_metadata.approved_at)||!text(rule.approval_metadata.reference))return 'unverified_rule';
 if(!actions.has(rule.allowed_action)||!object(rule.matching_constraints))return 'invalid_constraints';
 const scope=rule.matching_constraints.context;
 if(!object(scope)||Object.entries(scope).some(([k,v])=>!text(k)||!text(v)))return 'invalid_context';
 if(rule.category==='geography'&&!text(scope.administrative_area))return 'missing_administrative_area';
 const temporal=rule.valid_from!=null||rule.valid_to!=null;
 if((temporal||['geography','military'].includes(rule.category))&&(!day(rule.valid_from)||!day(rule.valid_to)||rule.valid_from>rule.valid_to))return 'invalid_date_window';
 return null;
}

export function createContextDictionary({version,rules}={}){
 if(!text(version)||!Array.isArray(rules))throw new TypeError('A dictionary version and rules array are required');
 // An unresolved duplicate ID cannot select its own current version by order.
 const counts=new Map();
 for(const r of rules)if(text(r?.id))counts.set(r.id,(counts.get(r.id)||0)+1);
 const rejectedRules=[],accepted=[];
 rules.forEach((r,index)=>{
  const reason=invalid(r)||(counts.get(r.id)>1?'duplicate_rule_id':null);
  if(reason){rejectedRules.push({index,id:text(r?.id)?r.id:null,reason});return;}
  // Keep only the schema, never extra OCR/candidate payloads or caller objects.
  accepted.push({id:r.id,version:r.version,category:r.category,canonical_value:r.canonical_value,
   aliases:[...r.aliases],document_types:[...r.document_types],field_paths:[...r.field_paths],language:r.language,
   valid_from:r.valid_from??null,valid_to:r.valid_to??null,source_reference:r.source_reference,allowed_action:r.allowed_action,
   matching_constraints:{context:{...r.matching_constraints.context},fact_free:r.matching_constraints.fact_free===true}});
 });
 accepted.sort(order);freeze(accepted);freeze(rejectedRules);

 function match(input={}){
  if(!object(input))input={};
  const location=locationOf(input.evidence_location);
  const result=(decision,reason,matches=[],proposed_value=null)=>({policy_version:RULE_POLICY_VERSION,dictionary_version:version,
   raw_value:typeof input.raw_value==='string'?input.raw_value:null,proposed_value,decision,reason,confidence:null,evidence_location:location,matches});
  if(!RULE_CATEGORIES.includes(input.category)||!text(input.raw_value)||!text(input.document_type)||!text(input.field_path)||!text(input.language))return result('reject','invalid_input');
  if(!location||!text(location.document_id)||!Number.isSafeInteger(location.page)||location.page<1)return result('reject','missing_evidence_location');
  if(input.source_current!==true||typeof input.owner_match!=='boolean'||typeof input.manual_confirmed!=='boolean'||typeof input.held!=='boolean')return result('reject','unverified_source_context');
  if(input.owner_match!==true)return result('reject','owner_not_established');
  if(input.manual_confirmed||input.held)return result('needs_review','protected_manual_value');
  const value=key(input.raw_value),context=object(input.context)?input.context:{};
  const scoped=accepted.filter(r=>r.category===input.category&&r.language===input.language&&
   r.document_types.some(t=>key(t)===key(input.document_type))&&r.field_paths.includes(input.field_path));
  const matched=[],blocked=[];
  for(const r of scoped){
   const aliases=[r.canonical_value,...r.aliases].map(key);
   const exact=aliases.includes(value);
   const partial=!exact&&['phrases','templates'].includes(r.category)&&value.length>=12&&aliases.some(a=>a.startsWith(value+' '));
   if(!exact&&!partial)continue;
   if(Object.entries(r.matching_constraints.context).some(([k,v])=>!Object.hasOwn(context,k)||context[k]!==v)){blocked.push('context_mismatch');continue;}
   if(r.valid_from!=null&&(!day(input.document_date)||input.document_date<r.valid_from||input.document_date>r.valid_to)){blocked.push('date_outside_rule');continue;}
   matched.push({rule_id:r.id,rule_version:r.version,source_reference:r.source_reference,canonical_value:r.canonical_value,
    allowed_action:r.allowed_action,match_kind:partial?'partial_template':'exact_alias',
    matching_context:{document_type:input.document_type,field_path:input.field_path,language:input.language,
     document_date:input.document_date??null,context:structuredClone(r.matching_constraints.context)},
    // Automatic presentation is restricted to approved fact-free boilerplate.
    can_auto:r.category==='phrases'&&boilerplateFields.has(input.field_path)&&r.allowed_action==='auto_normalize'&&r.matching_constraints.fact_free===true&&
     !/[\d{}<>\[\]]/u.test(r.canonical_value)&&exact});
  }
  if(!matched.length)return result(blocked.length?'needs_review':'reject',blocked.length?[...new Set(blocked)].sort()[0]:'no_matching_rule');
  if(matched.some(r=>r.match_kind==='partial_template'))return result('needs_review','incomplete_template',matched);
  if(new Set(matched.map(r=>key(r.canonical_value))).size>1)return result('needs_review','ambiguous_rules',matched);
  if(matched.every(r=>r.canonical_value===input.raw_value))return result('reject','already_canonical',matched);
  if(input.category==='personal'||matched.some(r=>r.allowed_action==='needs_review'))return result('needs_review','requires_human_review',matched);
  const decision=matched.every(r=>r.can_auto)?'auto_normalize':'suggest';
  return result(decision,decision==='auto_normalize'?'verified_boilerplate':'verified_contextual_alias',matched,matched[0].canonical_value);
 }
 return Object.freeze({policy_version:RULE_POLICY_VERSION,version,accepted_count:accepted.length,rejectedRules,match});
}
