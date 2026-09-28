// Резервне розпізнавання РНОКПП без залежності від AI.
(function(){
  function extractRnokpp(text){
    const s=String(text||'');
    const labelled=s.match(/(?:РНОКПП|РНОКПП\s*\/|реєстрац(?:ійний|ійного)\s*(?:номер|номеру)|податков(?:ий|ого)\s*номер)[^\d]{0,80}(\d[\s\-\u00A0]?){10}/iu);
    if(labelled){const n=(labelled[0].match(/\d/g)||[]).join('');if(n.length===10)return n;}
    const candidates=s.match(/(?:\d[\s\-\u00A0]?){10,}/g)||[];
    for(const x of candidates){const n=(x.match(/\d/g)||[]).join('');if(n.length===10)return n;}
    return null;
  }
  window.extractRnokppFallback=extractRnokpp;
  const original=window.classifyStoredDocument;
  if(typeof original!=='function')return;
  window.classifyStoredDocument=async function(path,name,text){
    try{
      const value=await original(path,name,text);
      if(value&&value.extracted&&!value.extracted.rnokpp){const n=extractRnokpp(text);if(n)value.extracted.rnokpp=n;}
      return value;
    }catch(e){
      const n=extractRnokpp(text);
      if(n){
        return {document_type:'Копія паспорта/ID Картки',confidence:0,extracted:{rnokpp:n},warnings:['AI тимчасово недоступний. РНОКПП витягнуто резервним OCR.']};
      }
      throw e;
    }
  };
  window.classifyStoredDocumentWithFallback=window.classifyStoredDocument;
})();
