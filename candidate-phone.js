(function(){
  'use strict';
  function normalize(value){
    const text=String(value??'').trim();
    if(!text)return '';
    if(!/^[+\d\s().-]+$/.test(text))return text;
    const compact=text.replace(/[\s().-]/g,'');
    if(/^0\d{9}$/.test(compact))return '+38'+compact;
    if(/^380\d{9}$/.test(compact))return '+'+compact;
    if(/^\+380\d{9}$/.test(compact))return compact;
    return text;
  }
  window.CRMPhone={normalize};
  document.addEventListener('focusout',function(event){
    const field=event.target;
    if(field.matches?.('input[name="phone"],input[name="phone_secondary"]')){
      const value=normalize(field.value);
      if(value!==field.value){field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));}
    }
  });
})();
