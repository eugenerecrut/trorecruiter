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
        created_at: user.created_at, last_sign_in_at: user.last_sign_in_at, owner: user.id === OWNER_ID});
      if (body.action === 'access') return reply(200, {allowed: true});
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
        const {data, error} = await admin.auth.admin.createUser({email, password: body.password, email_confirm: true,
          user_metadata: {...fields, username: login.includes('@') ? undefined : login}});
        if (error) return reply(400, {error: /already|registered|exists/i.test(error.message) ? 'Такий користувач уже існує' : 'Не вдалося створити користувача. Перевірте логін і вимоги до пароля'});
        return reply(200, {user: clean(data.user)});
      }
      if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) return reply(400, {error: 'Некоректний користувач'});
      if (body.action === 'password' && body.id === OWNER_ID) return reply(400, {error: 'Власний пароль змінюйте через відновлення доступу'});
      const {data: existing, error: lookupError} = await admin.auth.admin.getUserById(body.id);
      if (lookupError || !existing?.user) return reply(404, {error: 'Користувача не знайдено'});
      const patch = body.action === 'password' ? {password: body.password} : {user_metadata: {...existing.user.user_metadata, ...fields}};
      const {data, error} = await admin.auth.admin.updateUserById(body.id, patch);
      if (error) return reply(400, {error: 'Не вдалося зберегти зміни. Перевірте введені дані'});
      return reply(200, {user: clean(data.user)});
    } catch (_) {return reply(500, {error: 'Сервіс користувачів тимчасово недоступний'});}
  };
}
