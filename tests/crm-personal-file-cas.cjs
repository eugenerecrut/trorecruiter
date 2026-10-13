const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','candidate-card-v2.js'),'utf8');
const helperStart=source.indexOf('  async function savePersonalFileCAS(');
const helperEnd=source.indexOf('\n  function input(',helperStart);
assert(helperStart>=0&&helperEnd>helperStart);
const helper=source.slice(helperStart,helperEnd);
const context=vm.createContext({});
vm.runInContext(helper,context);
const save=context.savePersonalFileCAS;
const oldVersion='2026-10-13T13:20:00.000000+00:00';
const aiVersion='2026-10-13T13:21:00.000001+00:00';
const savedVersion='2026-10-13T13:22:00.123456+00:00';
const row=()=>({id:'pf-1',candidate_id:'c1',address:'original',updated_at:oldVersion});
const patch=()=>({candidate_id:'c1',address:'manual',updated_at:'2026-10-13T13:22:00.123Z'});

// Model the database's matching and unique-key behavior, independently of the save helper.
function database(initial,{beforeWrite,error}={}){
  const state={row:initial?structuredClone(initial):null,writes:0};
  const client={from(table){
    assert.equal(table,'personal_files');
    let operation,payload;const filters=[];
    const query={
      update(value){operation='update';payload=value;return query;},
      insert(value){operation='insert';payload=value;return query;},
      eq(key,value){filters.push([key,value]);return query;},
      is(key,value){assert.equal(value,null);filters.push([key,null]);return query;},
      select(){return query;},single:execute,maybeSingle:execute
    };
    async function execute(){
      if(beforeWrite){beforeWrite(state);beforeWrite=null;}
      if(error)return {data:null,error};
      if(operation==='insert'&&state.row)return {data:null,error:{code:'23505',message:'duplicate candidate_id'}};
      if(operation==='update'&&(!state.row||filters.some(([key,value])=>(state.row[key]??null)!==value)))return {data:null,error:null};
      state.row={id:'pf-1',...state.row,...structuredClone(payload),updated_at:savedVersion};
      state.writes++;
      return {data:structuredClone(state.row),error:null};
    }
    return query;
  }};
  return {state,client};
}

test('An unchanged personal file saves and returns its database version',async()=>{
  const db=database(row());const result=await save(db.client,'c1',patch(),row());
  assert.equal(result.error,null);assert.equal(result.data.address,'manual');
  assert.equal(result.data.updated_at,savedVersion);assert.equal(db.state.writes,1);
});

test('AI transfer between candidate save and personal file save preserves the newer AI fields',async()=>{
  const db=database(row(),{beforeWrite(state){state.row={...state.row,address:'new AI address',updated_at:aiVersion};}});
  const result=await save(db.client,'c1',patch(),row());
  assert(result.error);assert.equal(result.data,null);assert.equal(db.state.writes,0);
  assert.equal(db.state.row.address,'new AI address');assert.equal(db.state.row.updated_at,aiVersion);
});

test('A missing original row is never recreated by an existing-row save',async()=>{
  const db=database(null);const result=await save(db.client,'c1',patch(),row());
  assert(result.error);assert.equal(db.state.row,null);assert.equal(db.state.writes,0);
});

test('Null versions match only an unchanged null version',async()=>{
  const previous={...row(),updated_at:null};const unchanged=database(previous);
  assert.equal((await save(unchanged.client,'c1',patch(),previous)).error,null);
  const changed=database({...previous,updated_at:aiVersion,address:'AI'});
  assert((await save(changed.client,'c1',patch(),previous)).error);
  assert.equal(changed.state.row.address,'AI');assert.equal(changed.state.writes,0);
});

test('A genuinely absent personal file is inserted once',async()=>{
  const db=database(null);const result=await save(db.client,'c1',patch(),null);
  assert.equal(result.error,null);assert.equal(result.data.id,'pf-1');assert.equal(db.state.writes,1);
});

test('A concurrent insert is reported as a conflict and is never overwritten',async()=>{
  const db=database(null,{beforeWrite(state){state.row={...row(),address:'concurrent AI',updated_at:aiVersion};}});
  const result=await save(db.client,'c1',patch(),null);
  assert(result.error);assert.match(result.error.message,/залишені у формі/);
  assert.equal(db.state.row.address,'concurrent AI');assert.equal(db.state.writes,0);
});

test('Database errors are returned without a write fallback',async()=>{
  const error={code:'42501',message:'permission denied'};const db=database(row(),{error});
  assert.equal((await save(db.client,'c1',patch(),row())).error,error);
  assert.equal(db.state.writes,0);
});

function cardSave(client,previous){
  const start=source.indexOf('      const pfPatch = {');
  const end=source.indexOf('\n    };',start);
  assert(start>=0&&end>start);
  const fd=new Map([['address','manual']]);
  const ctx=vm.createContext({
    supabaseClient:client,candidateId:'c1',pf:previous?structuredClone(previous):{},personalFileExists:!!previous,
    fd,unit:false,status:{textContent:''},cardState:{dirty:true},workflowDraft:null,
    c:{profile_data:{passport_number:'AI number'},updated_at:aiVersion},candidatePatch:{profile_data:{}},profile:{},
    window:{CRMPhone:{normalize:value=>value}}
  });
  vm.runInContext(helper+'\nasync function finishCardSave(){\n'+source.slice(start,end)+'\n}',ctx);
  return ctx;
}

test('Card reports a partial candidate save and retains unsaved form state on file conflict',async()=>{
  const db=database({...row(),address:'AI',updated_at:aiVersion});const card=cardSave(db.client,row());
  assert.equal(await card.finishCardSave(),false);
  assert.match(card.status.textContent,/Кандидата збережено, але особову справу/);
  assert.equal(card.cardState.dirty,true);assert.equal(card.pf.updated_at,oldVersion);
  assert.equal(card.c.profile_data.passport_number,'AI number');assert.equal(db.state.row.address,'AI');
});

test('Card uses the returned file version on the next save after insert',async()=>{
  const db=database(null);const card=cardSave(db.client,null);
  assert.equal(await card.finishCardSave(),true);assert.equal(card.personalFileExists,true);
  assert.equal(card.pf.updated_at,savedVersion);assert.equal(card.cardState.dirty,false);
  card.fd.set('address','second edit');card.cardState.dirty=true;
  assert.equal(await card.finishCardSave(),true);assert.equal(db.state.row.address,'second edit');
  assert.equal(db.state.writes,2);
});
