const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};

const fields=['full_name','birth_date','birth_year','birth_place','sex','rnokpp','passport_data','phone','email','address','education','civilian_profession','marital_status','has_children','children_info','worked_before','served_before','military_rank','military_service_history','military_unit','desired_unit','desired_position','military_specialty','shpk','tariff_grade','service_type','recommender_unit','signatory','recruiter_name','decision','motivation','document_number','document_date','name_gender','name_nominative','name_genitive','name_cases'];

const relative={type:'object',additionalProperties:false,properties:{relation:{type:'string'},full_name:{type:'string'},birth_date:{type:'string'},birth_place:{type:'string'},citizenship:{type:'string'},address:{type:'string'},phone:{type:'string'},workplace:{type:'string'},position:{type:'string'},notes:{type:'string'}},required:['relation','full_name','birth_date','birth_place','citizenship','address','phone','workplace','position','notes']};

const schema={type:'object',additionalProperties:false,properties:{document_type:{type:'string'},candidate_name:{type:['string','null']},confidence:{type:'number'},extracted:{type:'object',additionalProperties:false,properties:Object.fromEntries(fields.map(f=>[f,{type:['string','null']}]).concat([['relatives',{type:'array',items:relative}]])),required:[...fields,'relatives']},warnings:{type:'array',items:{type:'string'}},meta:{type:'object',additionalProperties:false,properties:{source:{type:'string'},missing_fields:{type:'array',items:{type:'string'}},conflicts:{type:'array',items:{type:'string'}}},required:['source','missing_fields','conflicts']}},required:['document_type','candidate_name','confidence','extracted','warnings','meta']};

const prompt=`Ти модуль аналізу документів CRM PSK_RECRUTER. Аналізуй наданий документ візуально та OCR-текст, якщо він є. Не вигадуй дані. Визнач тип документа українською та витягни тільки те, що прямо видно або однозначно випливає з документа.

КРИТИЧНО ДЛЯ РОДИЧІВ: якщо це свідоцтво про народження і в ньому зазначені батько та/або мати дитини-кандидата, ОБОВ'ЯЗКОВО створи окремі об'єкти у extracted.relatives з relation='Батько' та relation='Мати'. ПІБ дитини записуй у extracted.full_name, а батьків — тільки в relatives. Якщо це свідоцтво про шлюб — другого з подружжя запиши як Чоловік або Дружина. Якщо свідоцтво про розірвання шлюбу прямо містить другого з подружжя — також створи відповідного родича. Для кожного родича заповнюй лише поля, які є в документі; решта — порожній рядок. Якщо родичів немає, relatives=[].

Для дитини у свідоцтві про народження заповни birth_date та birth_place. Не записуй дані батьків у персональні поля кандидата. Якщо документ містить кілька осіб, кандидатом вважай особу, якій належить документ. Дати форматуйте YYYY-MM-DD, коли це можливо. РНОКПП — лише якщо він прямо є. Для полів без даних — null у extracted і порожні рядки для relatives. warnings та meta.missing_fields використовуй для відсутніх або сумнівних даних.`;

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8'}})}
function rnokpp(text:string){const m=String(text||'').replace(/\u00a0/g,' ').match(/(?:РНОКПП|ІПН|податков(?:ий|ого)\s*(?:номер|№))[^0-9]{0,100}(\d{10})/iu);return m?.[1]||null}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  let body:any;try{body=await req.json()}catch{return json({error:'Некоректний JSON'},400)}
  const text=String(body?.text||'').trim();
  const fileUrl=String(body?.file_url||'').trim();
  const fileName=String(body?.file_name||'document').trim();
  if(!text&&!fileUrl)return json({error:'Не передано текст або файл'},400);
  const key=Deno.env.get('GEMINI_API_KEY')||Deno.env.get('Gemini API Key');
  if(!key)return json({error:'GEMINI_API_KEY не налаштовано в Supabase Secrets.'},500);
  const model=Deno.env.get('GEMINI_MODEL')||'gemini-3.5-flash-lite';

  const parts:any[]=[{text:prompt+'\nНазва файлу: '+fileName}];
  if(text)parts.push({text:'OCR-текст (допоміжний; може містити помилки):\n'+text.slice(0,50000)});
  if(fileUrl){
    try{
      const fr=await fetch(fileUrl);
      if(!fr.ok)return json({error:`Не вдалося прочитати файл: HTTP ${fr.status}`},502);
      const ab=await fr.arrayBuffer();
      if(ab.byteLength>15000000)return json({error:'Файл завеликий для Gemini. Максимум 15 МБ.'},413);
      const mime=String(fr.headers.get('content-type')||'').split(';')[0]||(/\.pdf$/i.test(fileName)?'application/pdf':/\.png$/i.test(fileName)?'image/png':'image/jpeg');
      let binary='';const bytes=new Uint8Array(ab);const chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+chunk,bytes.length)));const b64=btoa(binary);
      parts.push({inlineData:{mimeType:mime,data:b64}});
    }catch(e){console.error('file fetch error',e);return json({error:'Не вдалося завантажити документ для Gemini.'},502)}
  }

  const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts}],generationConfig:{responseMimeType:'application/json',responseSchema:schema}})});
  if(!r.ok){const raw=await r.text();console.error('Gemini document error',raw);return json({error:'AI-сервіс Gemini повернув помилку.',details:raw},502)}
  const out=await r.json();const outputText=String(out?.candidates?.[0]?.content?.parts?.map((p:any)=>p?.text||'').join('')||'').trim();
  if(!outputText)return json({error:'Gemini не повернув структуровану виборку.'},502);
  let parsed:any;try{parsed=JSON.parse(outputText)}catch(e){console.error('Gemini JSON parse error',outputText);return json({error:'Gemini повернув некоректний JSON.'},502)}
  if(parsed?.extracted&&!parsed.extracted.rnokpp){const fallback=rnokpp(text);if(fallback)parsed.extracted.rnokpp=fallback}
  if(!Array.isArray(parsed?.extracted?.relatives))parsed.extracted.relatives=[];
  return json({...parsed,model});
});
