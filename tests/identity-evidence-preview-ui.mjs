import test from 'node:test';
import assert from 'node:assert/strict';
import {mountIdentityEvidencePreview} from '../identity-evidence-preview-ui.mjs';
import {previewFromSnapshot} from '../identity-evidence-preview.mjs';

// A small DOM port for lifecycle tests. No network or CRM writer is available.
function setup(load){
 const ownerDocument={createElement:tag=>new Element(tag)};
 class Element{
  constructor(tag){this.tag=tag;this.ownerDocument=ownerDocument;this.dataset={};this.children=[];this.listeners={};this.isConnected=true;}
  append(child){this.children.push(child);}
  replaceChildren(...children){this.children=children;}
  after(child){this.next=child;}
  addEventListener(type,fn){this.listeners[type]=fn;}
  emit(type,event={}){return this.listeners[type]?.(event);}
 }
 const candidate={id:'fixture',full_name:'Прикладенко Тест Тестович',birth_date:'1991-04-15'};
 const snapshot={candidate,documents:[{id:'doc',candidate_id:candidate.id,document_type:'Паспорт',verification_status:'Підтверджено',
  ai_processed_at:'revision',storage_path:'fixture.pdf',ai_extracted:{...candidate,birth_place:'Тестове місто'}}]};
 const values=Object.fromEntries(['name_nominative','birth_date','birth_place','rnokpp'].map(name=>[name,{name,value:name==='name_nominative'?candidate.full_name:candidate[name]||''}]));
 const form=new Element('form');form.querySelector=selector=>values[selector.match(/name="([^"]+)"/)[1]];
 const host=new Element('section');
 const details=mountIdentityEvidencePreview({form,host,getSnapshot:()=>snapshot,load:load||(async()=>({previewFromSnapshot}))});
 const text=()=>details.children.map(e=>e.textContent).join('\n');
 const open=async()=>{details.open=true;await details.emit('toggle');};
 return {details,form,values,snapshot,text,open};
}

test('preview loads on opening and never writes into form or snapshot',async()=>{
 let loads=0;const ui=setup(async()=>{loads++;return {previewFromSnapshot};});
 const before=JSON.stringify({values:ui.values,snapshot:ui.snapshot});
 assert.equal(loads,0);await ui.open();assert.equal(loads,1);
 assert.match(ui.text(),/Тестове місто/);
 assert.equal(JSON.stringify({values:ui.values,snapshot:ui.snapshot}),before);
});

test('manual edits suppress stale proposals, reverting restores them, reopening reads fresh documents',async()=>{
 const ui=setup();await ui.open();
 ui.values.birth_place.value='Ручний запис';await ui.form.emit('input',{target:ui.values.birth_place});
 assert.match(ui.text(),/Є незбережені зміни/);assert.doesNotMatch(ui.text(),/Тестове місто/);
 ui.values.birth_place.value='';await ui.form.emit('change',{target:ui.values.birth_place});
 assert.match(ui.text(),/Тестове місто/);
 ui.details.open=false;await ui.details.emit('toggle');
 ui.snapshot.documents[0].deleted_at='now';await ui.open();
 assert.doesNotMatch(ui.text(),/Тестове місто/);
});

test('a closed or replaced card ignores late module loading',async()=>{
 let resolve;const ui=setup(()=>new Promise(r=>{resolve=r;}));
 const pending=ui.open();ui.details.open=false;await ui.details.emit('toggle');
 resolve({previewFromSnapshot});await pending;assert.equal(ui.details.children.length,1);
 const pendingAgain=ui.open();ui.form.isConnected=false;resolve({previewFromSnapshot});await pendingAgain;
 assert.equal(ui.details.children.length,1);
});

test('failed loading can be retried without accumulating old messages',async()=>{
 let attempts=0;const ui=setup(async()=>{if(++attempts===1)throw Error('offline');return {previewFromSnapshot};});
 await ui.open();assert.match(ui.text(),/недоступна/);
 ui.details.open=false;await ui.details.emit('toggle');await ui.open();
 assert.doesNotMatch(ui.text(),/недоступна/);assert.equal(ui.details.children.length,4);
});
