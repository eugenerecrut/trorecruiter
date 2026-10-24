// Adapter for the pinned PDFium 3.0.0 ABI. Native geometry is not OCR or verified content.
export function nativePageZones(page, {originalWidth: width, originalHeight: height}) {
 let pointer=0;const module=page?.module;
 try {
  if(![width,height].every(n=>Number.isFinite(n)&&n>0)||!module||module._FPDFPage_GetRotation(page.pageIdx)!==0||module._FPDFPage_GetAnnotCount(page.pageIdx)!==0)return null;
  const count=page.getObjectCount();if(!Number.isInteger(count)||count<1||count>2000)return null;
  pointer=module.wasmExports.malloc(16);if(!pointer)return null;
  for(const name of ['_FPDFPage_GetMediaBox','_FPDFPage_GetCropBox']){
   if(typeof module[name]!=='function')return null;
   const present=module[name](page.pageIdx,pointer,pointer+4,pointer+8,pointer+12);
   if(!present){if(name==='_FPDFPage_GetCropBox')continue;return null;}
   const values=Array.from(module.HEAPF32.subarray(pointer/4,pointer/4+4));
   if(values.some((v,i)=>!Number.isFinite(v)||Math.abs(v-[0,0,width,height][i])>.05))return null;
  }
  const lines=[],graphics=[];let characters=0;
  for(let i=0;i<count;i++){
   const object=page.getObject(i);
   // Keep every vector object visible for review instead of silently discarding
   // underlines, signatures or handwritten vector strokes as decoration.
   if(object.type==='path'){
    if(!module._FPDFPageObj_GetBounds(object.objectIdx,pointer,pointer+4,pointer+8,pointer+12))return null;
    const [left,bottom,right,top]=Array.from(module.HEAPF32.subarray(pointer/4,pointer/4+4));
    if(![left,bottom,right,top].every(Number.isFinite)||right<left||top<bottom||left<0||bottom<0||right>width||top>height)return null;
    const padding=2;
    graphics.push({left:Math.max(0,left-padding),right:Math.min(width,right+padding),top:Math.max(0,height-top-padding),bottom:Math.min(height,height-bottom+padding)});
    continue;
   }
   if(object.type!=='text')return null;
   const text=object.getText().trim();if(!text)continue;characters+=text.length;
   if(characters>120000||text.includes('\uFFFD')||!module._FPDFPageObj_GetBounds(object.objectIdx,pointer,pointer+4,pointer+8,pointer+12))return null;
   const [left,bottom,right,top]=Array.from(module.HEAPF32.subarray(pointer/4,pointer/4+4));
   if(![left,bottom,right,top].every(Number.isFinite)||right<=left||top<=bottom||left<-.05||bottom<-.05||right>width+.05||top>height+.05)return null;
   const rect={left:Math.max(0,left),right:Math.min(width,right),top:Math.max(0,height-top),bottom:Math.min(height,height-bottom),h:top-bottom};
   let line=lines.find(l=>Math.abs(l.bottom-rect.bottom)<=Math.max(l.h,rect.h)*.5);
   if(line){line.left=Math.min(line.left,rect.left);line.right=Math.max(line.right,rect.right);line.top=Math.min(line.top,rect.top);line.bottom=Math.max(line.bottom,rect.bottom);line.h=Math.max(line.h,rect.h);}
   else lines.push(rect);
  }
  if(characters<80||lines.length<3)return null;
  lines.sort((a,b)=>a.top-b.top||a.left-b.left);const blocks=[];
  for(const line of lines){const last=blocks.at(-1);if(last&&line.top-last.bottom<Math.max(last.h,line.h)*1.2){last.left=Math.min(last.left,line.left);last.right=Math.max(last.right,line.right);last.bottom=Math.max(last.bottom,line.bottom);last.h=Math.max(last.h,line.h);}else blocks.push({...line});}
  // The existing coordinator accepts at most six zones. Never silently drop content.
  if(blocks.length+graphics.length>6)return null;
  const zone=(r,label,reason,kind='text')=>({label,kind,reason,box:{x:r.left/width,y:r.top/height,w:(r.right-r.left)/width,h:(r.bottom-r.top)/height}});
  return [...blocks.map((r,i)=>zone(r,'Текстовий блок '+(i+1),'Межі з текстового шару PDF; зміст не підтверджений.')),
   ...graphics.map((r,i)=>zone(r,'Графічний фрагмент '+(i+1),'Контур PDF: може містити лінію, підпис або рукописний запис. Потрібна візуальна перевірка.','other'))];
 }catch{return null;}finally{if(pointer)module.wasmExports.free(pointer);}
}
