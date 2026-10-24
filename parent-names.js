// Name notation only. Does not establish identity, modify records, or infer a surname change.
(function(root){
'use strict';
const norm=value=>String(value??'').normalize('NFKC').replace(/[’ʼ`]/g,"'").trim().replace(/\s+/g,' ').toLocaleLowerCase('uk');
function parts(value){
 const match=norm(value).match(/^([а-яіїєґ][а-яіїєґ'-]+)(?:\s*\(([а-яіїєґ][а-яіїєґ'-]+)\))?\s+([а-яіїєґ][а-яіїєґ'-]+)(?:\s+([а-яіїєґ][а-яіїєґ'-]+))?$/u);
 return match&&{surname:match[1],alias:match[2],given:match[3],patronymic:match[4]};
}
function maidenNameMatch(values){
 const parsed=values.filter(v=>typeof v==='string'&&v.trim()).map(parts);
 if(parsed.length<2||parsed.some(v=>!v?.patronymic)||!parsed.some(v=>v.alias))return false;
 return ['surname','given','patronymic','alias'].every(key=>new Set(parsed.map(v=>v[key]).filter(Boolean)).size===1);
}
const api={parts,maidenNameMatch};root.CRMParentNames=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
