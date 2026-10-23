export const OWNER_ID = '7c74b122-3940-40a8-a32f-fe2b6776c173';
const ORIGIN = 'https://eugenerecrut.github.io';
export function createHandler(createClient, env) {
  return async function handler(req) {
    const headers = {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ORIGIN,
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store', 'Vary': 'Origin'};
    const reply = (status, body) => new Response(JSON.stringify(body), {status, headers});
    if (req.headers.get('Origin') && req.headers.get('Origin') !== ORIGIN) return reply(403, {error: 'Доступ заборонено'});
    if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers});
    if (req.method !== 'POST') return reply(405, {error: 'Метод не підтримується'});
    const authorization = req.headers.get('Authorization') || '';
    if (!/^Bearer\s+\S+$/i.test(authorization)) return reply(401, {error: 'Увійдіть до CRM'});
    try {
      const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {auth: {persistSession: false, autoRefreshToken: false}});
      const {data: auth, error: authError} = await admin.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
      if (authError || !auth?.user) return reply(401, {error: 'Сесія недійсна. Увійдіть знову'});
      if (auth.user.id !== OWNER_ID || Date.parse(auth.user.banned_until || '') > Date.now()) return reply(403, {error: 'Керування користувачами доступне лише власнику CRM'});
      const raw = await req.text();
      if (raw.length > 16000) return reply(413, {error: 'Запит завеликий'});
      let body;
      try {body = JSON.parse(raw);} catch {return reply(400, {error: 'Некоректний запит'});}
      if (!body || typeof body !== 'object') return reply(400, {error: 'Некоректний запит'});
      const clean = user => ({id: user.id, email: user.email || '', full_name: String(user.user_metadata?.full_name || ''),
        department: String(user.user_metadata?.department || ''), position: String(user.user_metadata?.position || ''),
        created_at: user.created_at, last_sign_in_at: user.last_sign_in_at, owner: user.id === OWNER_ID,
        technical: user.app_metadata?.crm_account_type==='splav_processor'});
      if (body.action === 'access') return reply(200, {allowed: true});
      if (body.action === 'probe_splav') {
        const boot=await admin.rpc('crm_splav_worker_bootstrap');
        if(boot.error||!boot.data)return reply(409,{error:'СПЛАВ не активований'});
        const processor=createClient(env('SUPABASE_URL'),env('SUPABASE_ANON_KEY')||env('SUPABASE_PUBLISHABLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
        const signed=await processor.auth.signInWithPassword({email:boot.data.email,password:boot.data.password});
        if(signed.error||!signed.data?.user)return reply(503,{error:'Не вдалося перевірити службовий вхід'});
        try{
          const self=await processor.from('crm_staff').select('role,active').eq('user_id',signed.data.user.id).single();
          const forbidden=await processor.rpc('crm_splav_worker_bootstrap');
          const management=await processor.functions.invoke('crm-user-admin',{body:{action:'access'}});
          const status=await admin.rpc('crm_splav_worker_status');
          if(self.error||self.data?.role!=='processor'||!self.data?.active||forbidden.error?.code!=='42501'||management.error?.context?.status!==403||status.error)return reply(409,{error:'Перевірка обмежень доступу не пройдена'});
          let isolated=null;
          if(status.data.running===0){
            const cases=await processor.from('candidates').select('id',{count:'exact',head:true});
            const documents=await processor.from('documents').select('id',{count:'exact',head:true});
            const files=await processor.storage.from('candidate-documents').list('',{limit:1});
            const rechecked=await admin.rpc('crm_splav_worker_status');
            if(!rechecked.error&&rechecked.data.running===0){
              isolated=!cases.error&&!documents.error&&!files.error&&cases.count===0&&documents.count===0&&files.data.length===0;
              if(!isolated)return reply(409,{error:'Виявлено доступ поза дорученням'});
            }
          }
          return reply(200,{probe:{signed_in:true,role:'processor',admin_denied:true,bootstrap_denied:true,idle_isolation:isolated}});
        }finally{await processor.auth.signOut({scope:'local'});}
      }
      if (body.action === 'status_splav' || body.action === 'disable_splav') {
        if(body.action==='disable_splav'){
          const disabled=await admin.rpc('crm_splav_disable_worker');if(disabled.error)throw disabled.error;
        }
        const status=await admin.rpc('crm_splav_worker_status');if(status.error)throw status.error;
        if(body.action==='disable_splav'&&status.data?.id){const banned=await admin.auth.admin.updateUserById(status.data.id,{ban_duration:'876000h'});if(banned.error)throw banned.error;}
        return reply(200,{worker:status.data});
      }
      if (body.action === 'provision_splav' || body.action === 'activate_splav') {
        // Owner-authorized, deliberately inactive bootstrap. No credential leaves this function.
        const email = 'splav-worker@trorecruiter.invalid';
        let worker = null;
        for (let page=1; page<=100; page++) {
          const {data,error} = await admin.auth.admin.listUsers({page,perPage:100});
          if (error) throw error;
          worker = data.users.find(user=>String(user.email||'').toLowerCase()===email);
          if (worker || data.users.length<100) break;
          if (page===100) return reply(409,{error:'Не завершено перевірку службового логіна'});
        }
        if (worker && worker.app_metadata?.crm_account_type!=='splav_processor') return reply(409,{error:'Службовий логін зайнятий іншим обліковим записом'});
        if(body.action==='activate_splav'){
          if(!worker)return reply(409,{error:'Спочатку створіть службовий запис СПЛАВ'});
          const current=await admin.rpc('crm_splav_worker_status');if(current.error)throw current.error;
          if(current.data?.active&&current.data?.enabled)return reply(200,{worker:current.data});
          const schedulerKey=env('SUPABASE_ANON_KEY');
          if(!schedulerKey)return reply(503,{error:'Для планувальника з перевіркою JWT потрібен серверний SUPABASE_ANON_KEY; доступ не активовано'});
          const bytes=()=>{const value=new Uint8Array(48);crypto.getRandomValues(value);return Array.from(value,b=>b.toString(16).padStart(2,'0')).join('');};
          const password='Aa9!'+bytes().slice(0,60),dispatch=bytes();
          const updated=await admin.auth.admin.updateUserById(worker.id,{password,ban_duration:'none'});if(updated.error)throw updated.error;
          const configured=await admin.rpc('crm_splav_configure_worker',{worker_id:worker.id,worker_password:password,dispatch_key:dispatch,
            public_key:schedulerKey,project_url:env('SUPABASE_URL')});
          if(configured.error){
            await admin.rpc('crm_splav_disable_worker');await admin.auth.admin.updateUserById(worker.id,{ban_duration:'876000h'});
            return reply(503,{error:'Активацію не завершено; доступ СПЛАВ вимкнено'});
          }
          const status=await admin.rpc('crm_splav_worker_status');if(status.error)throw status.error;
          return reply(200,{worker:status.data});
        }
        if (!worker) {
          const random = new Uint8Array(32);crypto.getRandomValues(random);
          const password = 'Aa9!'+Array.from(random,byte=>byte.toString(16).padStart(2,'0')).join('').slice(4);
          const {data,error} = await admin.auth.admin.createUser({email,password,email_confirm:true,ban_duration:'876000h',
            app_metadata:{crm_account_type:'splav_processor'},user_metadata:{full_name:'СПЛАВ',username:'splav-worker'}});
          if (error) return reply(409,{error:'Не вдалося створити службовий запис. Перевірте стан перед повторною спробою'});
          worker = data.user;
        }
        const {data:staff,error} = await admin.from('crm_staff').select('role,active').eq('user_id',worker.id).single();
        if (error || staff?.role!=='processor' || staff?.active!==false) return reply(409,{error:'Стан доступу СПЛАВ потребує перевірки; активацію не виконано'});
        return reply(200,{worker:{id:worker.id,display_name:'СПЛАВ',role:'processor',active:false,ready:false},message:'Службовий запис створено без доступу. Активація — після перевірки черги.'});
      }
      if (body.action === 'list') {
        const page = Number(body.page || 1);
        if (!Number.isInteger(page) || page < 1 || page > 10000) return reply(400, {error: 'Некоректна сторінка'});
        const {data, error} = await admin.auth.admin.listUsers({page, perPage: 50});
        if (error) throw error;
        return reply(200, {users: data.users.map(clean), page, hasMore: data.users.length === 50});
      }
      if (!['create', 'update', 'password'].includes(body.action)) return reply(400, {error: 'Невідома дія'});
      const fields = {};
      if (body.action !== 'password') {
        for (const key of ['full_name', 'department', 'position']) {
          if (typeof body[key] !== 'string' || body[key].length > 200) return reply(400, {error: 'Перевірте ПІБ, підрозділ і посаду'});
          fields[key] = body[key].trim();
        }
        if (!fields.full_name) return reply(400, {error: 'Вкажіть ПІБ користувача'});
      }
      if (body.action === 'password' || body.action === 'create') {
        if (typeof body.password !== 'string' || body.password.length < 10 || body.password.length > 128) return reply(400, {error: 'Пароль має містити від 10 до 128 символів'});
      }
      if (body.action === 'create') {
        const login = String(body.login || '').trim().toLowerCase();
        if ((!/^[a-z0-9._-]{3,64}$/.test(login) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login)) || login.length > 254) return reply(400, {error: 'Вкажіть email або логін із 3–64 латинських літер, цифр, крапки, дефіса чи підкреслення'});
        const email = login.includes('@') ? login : login + '@trorecruiter.invalid';
        if(email==='splav-worker@trorecruiter.invalid')return reply(409,{error:'Цей логін зарезервовано для панелі СПЛАВ'});
        const {data, error} = await admin.auth.admin.createUser({email, password: body.password, email_confirm: true,
          user_metadata: {...fields, username: login.includes('@') ? undefined : login}});
        if (error) return reply(400, {error: /already|registered|exists/i.test(error.message) ? 'Такий користувач уже існує' : 'Не вдалося створити користувача. Перевірте логін і вимоги до пароля'});
        return reply(200, {user: clean(data.user)});
      }
      if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) return reply(400, {error: 'Некоректний користувач'});
      if (body.action === 'password' && body.id === OWNER_ID) return reply(400, {error: 'Власний пароль змінюйте через відновлення доступу'});
      const {data: existing, error: lookupError} = await admin.auth.admin.getUserById(body.id);
      if (lookupError || !existing?.user) return reply(404, {error: 'Користувача не знайдено'});
      if(existing.user.app_metadata?.crm_account_type==='splav_processor')return reply(409,{error:'Керуйте службовим записом через панель СПЛАВ; звичайна зміна пароля заборонена'});
      const patch = body.action === 'password' ? {password: body.password} : {user_metadata: {...existing.user.user_metadata, ...fields}};
      const {data, error} = await admin.auth.admin.updateUserById(body.id, patch);
      if (error) return reply(400, {error: 'Не вдалося зберегти зміни. Перевірте введені дані'});
      return reply(200, {user: clean(data.user)});
    } catch (_) {return reply(500, {error: 'Сервіс користувачів тимчасово недоступний'});}
  };
}
