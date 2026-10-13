// Local PDF export for mandatory candidate information; no storage writes.
(function () {
  'use strict';
  const mm=72/25.4, width=210*mm, height=297*mm;
  const left=35*mm, right=15*mm, top=20*mm, bottom=20*mm;
  const separate=new Set(['Освіта','Трудовий стаж','Військова служба']);
  async function bytes(url) {
    const response=await fetch(url);
    if(!response.ok)throw new Error('Не вдалося завантажити ресурс PDF.');
    return new Uint8Array(await response.arrayBuffer());
  }
  async function create(title,fields,photo) {
    await Promise.all([
      loadExternalScript('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js','PDFLib'),
      loadExternalScript('https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js','fontkit')
    ]);
    const pdf=await PDFLib.PDFDocument.create();
    pdf.registerFontkit(window.fontkit);
    const font=await pdf.embedFont(await bytes('templates/fonts/Tinos-Regular.ttf'),{subset:true});
    pdf.setTitle(title);pdf.setCreator('PSK_RECRUTER CRM');
    let page=pdf.addPage([width,height]), y=height-top, photoBottom=height;
    let image;
    if(photo) {
      const data=await bytes(photo);
      image=data[0]===137?await pdf.embedPng(data):await pdf.embedJpg(data);
    }
    const nextPage=()=>{page=pdf.addPage([width,height]);y=height-top;photoBottom=height;};
    const available=()=>width-left-right-(y>photoBottom?50*mm:0);
    const draw=(text,size=12,center=false)=>{
      if(y<bottom+size){nextPage();}
      const x=center?left+(width-left-right-font.widthOfTextAtSize(text,size))/2:left;
      page.drawText(text,{x,y:y-size,font,size,color:PDFLib.rgb(0,0,0)});
      y-=size*1.35;
    };
    const paragraph=(value,size=12,center=false)=>{
      for(const part of String(value??'').replace(/\r/g,'').split('\n')) {
        let line='';
        for(const word of part.trim().split(/\s+/)) {
          if(!word)continue;
          if(line&&font.widthOfTextAtSize(line+' '+word,size)>available()){draw(line,size,center);line='';}
          for(const [index,char] of Array.from(word).entries()) {
            let prefix=line&&index===0?' ':'';
            if(font.widthOfTextAtSize(line+prefix+char,size)>available()&&line){draw(line,size,center);line='';prefix='';}
            line+=prefix+char;
          }
        }
        draw(line,size,center);
      }
    };
    paragraph(title,16,true);y-=12;
    if(image) {
      const boxW=45*mm,boxH=60*mm,scale=Math.min(boxW/image.width,boxH/image.height);
      const imageW=image.width*scale,imageH=image.height*scale;
      photoBottom=y-boxH;
      page.drawImage(image,{x:width-right-boxW+(boxW-imageW)/2,y:y-imageH,width:imageW,height:imageH});
    }
    for(const [label,value] of fields) {
      if(y<bottom+36)nextPage();
      if(separate.has(label)){paragraph(label+':',12.5);paragraph(value||'Не вказано');}
      else paragraph(label+': '+(value||'Не вказано'));
      y-=10;
    }
    return new Blob([await pdf.save()],{type:'application/pdf'});
  }
  async function download(title,fields,photo,name) {
    const blob=await create(title,fields,photo);
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;
    link.download='Обов’язкова_інформація_'+String(name||'Кандидат').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').trim()+'.pdf';
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  window.CRMInformationPDF={create,download};
})();
