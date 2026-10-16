const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const api=require('../anketa-pdf.js');
test('10 MB cap is inclusive and enforced before upload',async()=>{
 const small=new Blob([new Uint8Array(api.MAX_BYTES)]);assert.equal(await api.ensure(small),small);
 assert.throws(()=>api.assertSize({size:api.MAX_BYTES+1}),/10 МБ/);assert.equal(api.assertSize(small),small);
 const source=fs.readFileSync(require('node:path').join(__dirname,'../crm-workflow.js'),'utf8');assert(source.includes("if(kind==='anketa')CRMAnketaPDF.assertSize(blob)"));assert(source.includes('CRMAnketaPDF.ensure(merged'));assert(source.includes('CRMAnketaPDF.ensure(r.data'));
});
function mock(sizes,attachments=false){
 let pass=0,destroyed=false,rendered=0;const original={catalog:{has:()=>false,lookupMaybe:()=>attachments?{has:()=>true}:null},getPage:()=>({getSize:()=>({width:595,height:842})}),getPageCount:()=>2};
 const PDFLib={PDFName:{of:s=>s},PDFDict:class{},PDFDocument:{load:async()=>original,create:async()=>{let count=0;return {embedJpg:async()=>({}),addPage(size){assert.deepEqual(Array.from(size),[595,842]);count++;return {drawImage(){}}},getPageCount:()=>count,save:async()=>new Uint8Array(sizes[pass++])}}}};
 const pdf={numPages:2,getPage:async()=>({getViewport:()=>({width:800,height:1100}),render:()=>{rendered++;return {promise:Promise.resolve()}},cleanup(){}}),destroy:async()=>destroyed=true};
 const c=vm.createContext({Blob,Uint8Array,loadExternalScript:async()=>{},document:{createElement:()=>({getContext:()=>({}),toBlob:fn=>fn(new Blob(['jpeg']))})},PDFLib,pdfjsLib:{GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve(pdf)})}});c.window=c;vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../anketa-pdf.js'),'utf8'),c);
 return {api:c.CRMAnketaPDF,stats:()=>({pass,destroyed,rendered})};
}
test('optimization retries without dropping pages and retains source Blob',async()=>{
 const m=mock([10_000_001,9_000_000]),source=new Blob([new Uint8Array(10_000_001)]),out=await m.api.ensure(source);
 assert.equal(out.size,9_000_000);assert.equal(source.size,10_000_001);assert.deepEqual(m.stats(),{pass:2,destroyed:true,rendered:4});
});
test('oversized result and embedded originals never silently download',async()=>{
 const source=new Blob([new Uint8Array(10_000_001)]),m=mock([10_000_001,10_000_001,10_000_001]);await assert.rejects(m.api.ensure(source),/10 МБ/);assert(m.stats().destroyed);
 await assert.rejects(mock([],true).api.ensure(source),/вкладення/);
});
