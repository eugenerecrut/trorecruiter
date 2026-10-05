const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=n=>fs.readFileSync(path.join(root,n),'utf8');
const creation=read('script.js').split('<form id="candidateForm"')[1].split('</form>')[0];
const names=[...creation.matchAll(/name="([^"]+)"/g)].map(m=>m[1]);
assert.equal(names.length,new Set(names).size,'New candidate fields must be unique');
for(const name of ['full_name','phone','recommender_unit','signatory','service_type','shpk','tariff_grade','recruiter_name'])assert(names.includes(name));
assert(read('ai-recommendation-bridge.js').includes('actions?actions.before(panel):form.append(panel)'));
const source=read('documents.js');
const start=source.indexOf("  let activeFilter='all';");
const end=source.indexOf("  content.querySelector('#docSearch').addEventListener",start);
assert(start>=0&&end>start);
const rows=[
 {title:'Копія паспорта/ID Картки',file:'ІД_картка_кандидата.pdf',dataset:{missing:'false',review:'false',additional:'false'}},
 {title:'Довідка ВЛК',file:'Медичний_висновок.pdf',dataset:{missing:'false',review:'true',additional:'false'}},
 {title:'Припис про направлення',file:'',dataset:{missing:'true',review:'false',additional:'false'}}
].map(r=>({...r,cells:[{textContent:r.title}],querySelectorAll:()=>[{textContent:r.file}]}));
const search={value:''},empty={hidden:true};
const buttons=['all','missing','review','errors','additional'].map(key=>({dataset:{docFilter:key},classList:{toggle(){}},setAttribute(name,value){this[name]=value}}));
const context={body:{querySelectorAll:()=>rows},content:{querySelector:s=>s==='#docSearch'?search:empty,querySelectorAll:()=>buttons}};
vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nthis.applyFilter=filter;',context);
function check(key,query,titles){search.value=query;context.applyFilter(key);assert.deepEqual(rows.filter(r=>!r.hidden).map(r=>r.title),titles);assert.equal(empty.hidden,!!titles.length);assert.equal(buttons.find(b=>b.dataset.docFilter===key)['aria-pressed'],'true')}
check('all','ID',['Копія паспорта/ID Картки']);
check('all','ІД_КАРТКА',['Копія паспорта/ID Картки']);
check('review','медичний',['Довідка ВЛК']);
check('missing','медичний',[]);
check('missing','',['Припис про направлення']);
check('all','',rows.map(r=>r.title));
const settings=read('scanner-settings.html');
assert(settings.includes('crm-mobile.css?v=1.1.0.413'));
assert(settings.includes('crm-release.js?v=1.1.0.413'));
assert(settings.includes('<details class="scanner-help">'));
console.log('PASS: unique creation fields, preserved data inputs, combined document search/filters, settings assets; no database writes.');
