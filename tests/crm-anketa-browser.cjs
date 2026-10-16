const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/eugen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});try{
 const page=await browser.newPage();await page.goto('about:blank');
 await page.addScriptTag({path:'C:/Users/eugen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pdf-lib/dist/pdf-lib.min.js'});
 await page.addScriptTag({url:'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'});
 await page.addScriptTag({content:'window.loadExternalScript=async()=>{}'});await page.addScriptTag({path:path.join(__dirname,'../anketa-pdf.js')});
 const result=await page.evaluate(async()=>{
  const out=await PDFLib.PDFDocument.create();let seed=42;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed&255};
  for(let i=0;i<4;i++){
   const canvas=document.createElement('canvas');canvas.width=2200;canvas.height=2200;const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(2200,2200);
   for(let j=0;j<pixels.data.length;j+=4){pixels.data[j]=random();pixels.data[j+1]=random();pixels.data[j+2]=random();pixels.data[j+3]=255;}ctx.putImageData(pixels,0,0);
   const imageBlob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.99)),image=await out.embedJpg(await imageBlob.arrayBuffer());out.addPage([595.28,841.89]).drawImage(image,{x:99.21,y:50,width:450,height:740});canvas.width=canvas.height=0;
  }
  // Padding outside the PDF keeps its pages valid and guarantees a compression path.
  const bytes=await out.save(),source=new Blob([bytes,new Uint8Array(Math.max(0,10_100_000-bytes.length))],{type:'application/pdf'});
  const compressed=await CRMAnketaPDF.ensure(source),pdf=await PDFLib.PDFDocument.load(await compressed.arrayBuffer());
  return {before:source.size,after:compressed.size,pages:pdf.getPageCount(),sizes:pdf.getPages().map(p=>p.getSize())};
 });
 assert(result.before>10_000_000);assert(result.after<=10_000_000);assert.equal(result.pages,4);assert(result.sizes.every(s=>s.width===595.28&&s.height===841.89));console.log('PASS actual browser PDF compression: '+JSON.stringify(result));
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
