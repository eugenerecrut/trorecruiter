import {createContextDictionary} from './contextual-ocr-rules.mjs';

export const REGISTRY_VERSION='crm-code-policy-1';
const source='https://github.com/eugenerecrut/trorecruiter/blob/6f4a6fc5f2509386d741b09626855224d1a7714a/education-document.js';
// Bootstrap existing published code policy, not learned facts or new aliases.
// Exporting the original table keeps education-document.js its sole owner.
export function createCRMRuleRegistry(education,{enabled=true}={}){
 if(enabled===false)return createContextDictionary({version:REGISTRY_VERSION+'-disabled',rules:[]});
 const policy=education?.degreePolicy;
 if(policy?.version!=='education-degree-1'||!Array.isArray(policy.aliases)||!policy.aliases.length||typeof education.normalizeDegree!=='function')
  throw new Error('Education normalization policy unavailable');
 const rules=policy.aliases.map(({alias,canonical})=>{
  if(typeof alias!=='string'||typeof canonical!=='string'||education.normalizeDegree(alias)!==canonical||!Object.hasOwn(education.ranks||{},canonical))
   throw new Error('Education normalization policy mismatch');
  return {id:'education.degree.'+alias,version:policy.version,category:'education',canonical_value:canonical,aliases:[alias],
   document_types:['education'],field_paths:['education.degree'],language:'uk',valid_from:null,valid_to:null,
   source_reference:source,verification_status:'verified',allowed_action:'suggest',matching_constraints:{context:{}},
   approval_metadata:{approved_by:'published-code-policy',approved_at:'2026-10-23',reference:'git:6f4a6fc5f2509386d741b09626855224d1a7714a'}};
 });
 const dictionary=createContextDictionary({version:REGISTRY_VERSION,rules});
 if(dictionary.rejectedRules.length)throw new Error('Invalid bundled normalization registry');
 return dictionary;
}
