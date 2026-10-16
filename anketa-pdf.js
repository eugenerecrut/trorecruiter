// Limit applies to the generated copy, never to source documents in Storage.
(function(root){
'use strict';
const MAX_BYTES=10_000_000;
function assertSize(blob){if(blob.size>MAX_BYTES)throw Error('PDF «Анкета» перевищує 10 МБ. Потрібна оптимізація копій документів; пакет не збережено.');return blob;}
async function ensure(blob,progress=()=>{}){
 if(blob.size<=MAX_BYTES)return blob;
 await Promise.all([loadExternalScript('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js','PDFLib'),loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js','pdfjsLib')]);
 const bytes=new Uint8Array(await blob.arrayBuffer()),original=await root.PDFLib.PDFDocument.load(bytes);
 // Rasterization must not silently discard embedded Word originals or signatures.
 if(original.catalog.has(root.PDFLib.PDFName.of('AcroForm'))||original.catalog.lookupMaybe(root.PDFLib.PDFName.of('Names'),root.PDFLib.PDFDict)?.has(root.PDFLib.PDFName.of('EmbeddedFiles')))throw Error('PDF «Анкета» перевищує 10 МБ і містить форми або вкладення. Додайте компактні PDF-копії документів.');
 root.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
 const task=root.pdfjsLib.getDocument({data:bytes.slice(),isEvalSupported:false}),pdf=await task.promise;
 try{
  for(const [dpi,quality] of [[160,.82],[140,.76],[120,.70]]){
   const out=await root.PDFLib.PDFDocument.create();
   for(let i=1;i<=pdf.numPages;i++){
    progress('Оптимізація PDF «Анкета»: '+i+'/'+pdf.numPages+' · '+dpi+' dpi');
    const page=await pdf.getPage(i),viewport=page.getViewport({scale:dpi/72}),canvas=document.createElement('canvas');
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    try{
     const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw Error('Не вдалося створити зображення сторінки');
     await page.render({canvasContext:ctx,viewport,background:'#ffffff'}).promise;
     const imageBlob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Не вдалося стиснути сторінку')),'image/jpeg',quality));
     const image=await out.embedJpg(await imageBlob.arrayBuffer()),size=original.getPage(i-1).getSize();
     out.addPage([size.width,size.height]).drawImage(image,{x:0,y:0,width:size.width,height:size.height});
    }finally{canvas.width=canvas.height=0;page.cleanup();}
   }
   if(out.getPageCount()!==original.getPageCount())throw Error('Кількість сторінок після оптимізації не збігається');
   const result=new Blob([await out.save()],{type:'application/pdf'});
   if(result.size<=MAX_BYTES)return result;
  }
 }finally{await pdf.destroy();}
 throw Error('Не вдалося вмістити PDF «Анкета» у 10 МБ зі збереженням читабельності. Додайте компактніші сканкопії.');
}
const api={MAX_BYTES,assertSize,ensure};root.CRMAnketaPDF=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
