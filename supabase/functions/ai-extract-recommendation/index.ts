import { withSupabase } from 'npm:@supabase/server'

const corsHeaders = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
const schema={type:'object',properties:{personal:{type:'object',properties:{full_name:{type:'string'},sex:{type:'string',enum:['male','female']},birth_date:{type:'string'},phone:{type:'string'},address:{type:'string'},rnokpp:{type:'string'},military_rank:{type:'string'},tcc:{type:'string'},civilian_profession:{type:'string'}},required:['full_name','birth_date','phone','address','rnokpp','military_rank','tcc','civilian_profession']},service:{type:'object',properties:{military_unit:{type:'string'},desired_unit:{type:'string'},desired_position:{type:'string'},shpk:{type:'string'},military_specialty:{type:'string'},tariff_grade:{type:'string'},service_type:{type:'string'},recommender_unit:{type:'string'},recruiter_name:{type:'string'},signatory:{type:'string'}},required:['military_unit','desired_unit','desired_position','shpk','military_specialty','tariff_grade','service_type','recommender_unit','recruiter_name','signatory']},relatives:{type:'array',items:{type:'object',properties:{relation:{type:'string'},full_name:{type:'string'},birth_date:{type:'string'},birth_place:{type:'string'},citizenship:{type:'string'},address:{type:'string'},phone:{type:'string'},workplace:{type:'string'},position:{type:'string'},notes:{type:'string'}},required:['relation','full_name','birth_date','birth_place','citizenship','address','phone','workplace','position','notes']}},meta:{type:'object',properties:{source:{type:'string'},missing_fields:{type:'array',items:{type:'string'}},warnings:{type:'array',items:{type:'string'}}},required:['source','missing_fields','warnings']}},required:['personal','service','relatives','meta']}
const systemPrompt=['Ти модуль структурованої виборки для внутрішньої CRM PSK_RECRUTER.','Аналізуй лише наданий текст документа. Не вигадуй і не доповнюй відсутні дані.','Для кандидата визнач стать лише за його ПІБ (особливо по батькові та граматичною формою імені). Поверни male або female, тільки якщо впевненість висока; інакше не повертай поле sex. Не визначай стать за підписантом, рекрутером чи іншою згаданою особою.','Для відсутніх або нечитабельних значень повертай порожній рядок.','Зберігай ПІБ, назви підрозділів, військові частини, ВОС, ШПК та службові формулювання максимально близько до документа.','Розрізняй підписанта рекомендаційного листа та рекрутера/контактну особу, якщо вони вказані окремо.','Службові дані рекомендаційного листа повинні потрапляти до service, а не до personal.','Якщо в документі прямо зазначені батько, мати, чоловік, дружина, брат, сестра або інший близький родич кандидата — сформуй окремий об’єкт у relatives.','Для relatives relation: Батько, Мати, Чоловік, Дружина, Брат, Сестра або Інше.','Не створюй родича лише на підставі згадки сторонньої особи, якщо з документа не видно, що це родич кандидата.','Якщо близьких родичів у документі немає — relatives = [].','Дата народження: YYYY-MM-DD, якщо її можна однозначно визначити; інакше порожній рядок.','РНОКПП: тільки якщо він прямо є в тексті документа.','meta.source: Рекомендаційний лист.'].join('\n')
async function fetchGeminiWithRetries(apiKey:string,model:string,requestBody:unknown):Promise<Response>{
  const deadline=Date.now()+110000;
  let lastResponse:Response|undefined;
  let lastResponseBody:string|undefined;
  let lastError:unknown;
  for(let attempt=1;attempt<=6;attempt++){
    const remaining=deadline-Date.now();
    if(remaining<=0)break;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),Math.min(8000,remaining));
    try{
      lastResponse=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
        method:'POST',
        headers:{'x-goog-api-key':apiKey,'Content-Type':'application/json'},
        body:JSON.stringify(requestBody),
        signal:controller.signal,
      });
      lastError=undefined;
    }catch(error){
      lastResponse=undefined;
      lastError=error;
    }finally{
      clearTimeout(timer);
    }
    if(lastResponse?.ok)return lastResponse;
    if(lastResponse&&![429,500,502,503,504].includes(lastResponse.status))return lastResponse;
    if(lastResponse)lastResponseBody=await lastResponse.text().catch(()=> '');
    if(attempt===6)break;
    const pause=Math.min(1000*Math.pow(2,attempt-1),10000,Math.max(0,deadline-Date.now()));
    if(pause<=0)break;
    console.warn('Gemini transient error; retrying',{model,attempt,status:lastResponse?.status??'network',pauseMs:pause});
    await new Promise(resolve=>setTimeout(resolve,pause));
  }
  if(lastResponse)return new Response(lastResponseBody??'',{status:lastResponse.status,statusText:lastResponse.statusText,headers:lastResponse.headers});
  throw lastError??new Error('Gemini retry deadline reached before a response');
}

function jsonResponse(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json; charset=utf-8'}})}
export default{fetch:withSupabase({auth:'user'},async(req,ctx)=>{if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});if(req.method!=='POST')return jsonResponse({error:'Method not allowed'},405);
    // This legacy text endpoint has no leased-job contract. Never grant it to the worker.
    const backend = Deno.env.get('SUPABASE_URL')
    const publicKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
    const authorization = req.headers.get('Authorization')
    const userId = String(ctx.userClaims?.sub || '')
    if (!backend || !publicKey || !authorization || !userId) return jsonResponse({error:'Потрібна чинна сесія'},401)
    const staffResponse = await fetch(backend+'/rest/v1/crm_staff?user_id=eq.'+encodeURIComponent(userId)+'&active=eq.true&select=role&limit=1', {headers:{Authorization:authorization,apikey:publicKey}})
    if (!staffResponse.ok) return jsonResponse({error:'Доступ заборонено'},403)
    const staff = await staffResponse.json()
    if (!Array.isArray(staff) || !staff.length || staff[0].role==='processor') return jsonResponse({error:'Доступ лише активним працівникам CRM'},403)

const apiKey=Deno.env.get('GEMINI_API_KEY')||Deno.env.get('Gemini API Key');if(!apiKey)return jsonResponse({error:'GEMINI_API_KEY не налаштовано в Supabase Secrets.'},500);let body:{text?:string};try{body=await req.json()}catch{return jsonResponse({error:'Некоректний JSON запиту.'},400)}const text=String(body?.text||'').trim();if(!text)return jsonResponse({error:'Не передано текст документа.'},400);if(text.length>50000)return jsonResponse({error:'Документ завеликий для AI-виборки.'},413);const userEmail=String(ctx.userClaims?.email||'');const input=['Користувач CRM: '+userEmail,'','ТЕКСТ ДОКУМЕНТА:',text].join('\n');const model='gemini-3.5-flash-lite';try{const r=await fetchGeminiWithRetries(apiKey,model,{systemInstruction:{parts:[{text:systemPrompt}]},contents:[{role:'user',parts:[{text:input}]}],generationConfig:{responseMimeType:'application/json',responseSchema:schema,temperature:0}});if(!r.ok){const details=await r.text();console.error('Gemini error:',details);return jsonResponse({error:'AI-сервіс Gemini повернув помилку.',details,model},502)}const result=await r.json();const outputText=String(result?.candidates?.[0]?.content?.parts?.map((p:{text?:string})=>p?.text||'').join('')||'').trim();if(!outputText)return jsonResponse({error:'Gemini не повернув структуровану виборку.',model},502);let extracted:unknown;try{extracted=JSON.parse(outputText)}catch{console.error('Invalid Gemini structured output:',outputText);return jsonResponse({error:'Gemini повернув некоректний структурований результат.',model},502)}return jsonResponse({extracted,model,user_email:userEmail})}catch(e){console.error('Gemini request exception:',e);return jsonResponse({error:'Помилка під час звернення до Gemini.',details:String(e),model},502)}})}
