// Резервне розпізнавання РНОКПП без залежності від AI.
(function(){
  function extractRnokpp(text){
    const s=String(text||'').replace(/[\u00A0\u200B]/g,' ');
    const labelled=s.match(/(?:РНОКПП|РНОКП|ІПН|реєстрац(?:ійний|ійного)\s*(?:номер|номеру)|податков(?:ий|ого)\s*номер)[^\d]{0,100}((?:\d[\s\-]?){10})/iu);
    if(labelled){const n=(labelled[1].match(/\d/g)||[]).join('');if(/^\d{10}$/.test(n)&&!/^0{10}$/.test(n))return n;}
    const candidates=s.match(/(?:\d[\s\-]?){10,}/g)||[];
    for(const x of candidates){const n=(x.match(/\d/g)||[]).join('');if(/^\d{10}$/.test(n)&&!/^0{10}$/.test(n))return n;}
    return null;
  }
  window.extractRnokppFallback=extractRnokpp;
  let installed=false;
  function install(){
    if(installed||typeof window.classifyStoredDocument!=='function')return;
    const original=window.classifyStoredDocument;
    window.classifyStoredDocument=async function(path,name,text){
      try{
        const value=await original(path,name,text);
        if(value&&value.extracted&&!value.extracted.rnokpp){const n=extractRnokpp(text);if(n){value.extracted.rnokpp=n;value.warnings=Array.isArray(value.warnings)?value.warnings:[];value.warnings.push('РНОКПП витягнуто резервним OCR.');}}
        return value;
      }catch(e){
        const n=extractRnokpp(text);
        if(n)return {document_type:'Копія паспорта/ID Картки',confidence:0,extracted:{rnokpp:n},warnings:['AI тимчасово недоступний. РНОКПП витягнуто резервним OCR.']};
        throw e;
      }
    };
    window.classifyStoredDocumentWithFallback=window.classifyStoredDocument;
    installed=true;
  }
  install();
  if(!installed){const timer=setInterval(()=>{install();if(installed)clearInterval(timer);},100);setTimeout(()=>clearInterval(timer),15000);}
})();
