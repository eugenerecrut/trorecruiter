import { withSupabase } from 'npm:@supabase/server'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    personal: {
      type: 'object',
      additionalProperties: false,
      properties: {
        full_name: { type: ['string', 'null'] },
        birth_date: { type: ['string', 'null'] },
        phone: { type: ['string', 'null'] },
        address: { type: ['string', 'null'] },
        rnokpp: { type: ['string', 'null'] },
        military_rank: { type: ['string', 'null'] },
        tcc: { type: ['string', 'null'] },
        civilian_profession: { type: ['string', 'null'] },
      },
      required: [
        'full_name','birth_date','phone','address',
        'rnokpp','military_rank','tcc','civilian_profession'
      ],
    },
    service: {
      type: 'object',
      additionalProperties: false,
      properties: {
        military_unit: { type: ['string', 'null'] },
        desired_unit: { type: ['string', 'null'] },
        desired_position: { type: ['string', 'null'] },
        shpk: { type: ['string', 'null'] },
        military_specialty: { type: ['string', 'null'] },
        tariff_grade: { type: ['string', 'null'] },
        service_type: { type: ['string', 'null'] },
        recommender_unit: { type: ['string', 'null'] },
        recruiter_name: { type: ['string', 'null'] },
        signatory: { type: ['string', 'null'] },
      },
      required: [
        'military_unit','desired_unit','desired_position','shpk',
        'military_specialty','tariff_grade','service_type',
        'recommender_unit','recruiter_name','signatory'
      ],
    },
    meta: {
      type: 'object',
      additionalProperties: false,
      properties: {
        source: { type: 'string' },
        missing_fields: { type: 'array', items: { type: 'string' } },
        warnings: { type: 'array', items: { type: 'string' } },
      },
      required: ['source','missing_fields','warnings'],
    },
  },
  required: ['personal','service','meta'],
}

const systemPrompt = [
  'Ти модуль структурованої виборки для внутрішньої CRM PSK_RECRUTER.',
  'Аналізуй лише наданий текст документа.',
  'Не вигадуй і не доповнюй відсутні дані.',
  'Якщо значення немає або воно нечитабельне — поверни null та додай поле до missing_fields.',
  'Зберігай ПІБ, назви підрозділів, військові частини, ВОС, ШПК та службові формулювання максимально близько до документа.',
  'Розрізняй підписанта рекомендаційного листа та рекрутера/контактну особу, якщо вони вказані окремо.',
  'Службові дані recommendation letter повинні потрапляти до service, а не до personal.',
  'Дата народження: YYYY-MM-DD, якщо її можна однозначно визначити з документа; інакше null.',
  'РНОКПП: тільки якщо він прямо є в тексті документа.',
  'meta.source для цього запиту: Рекомендаційний лист.',
].join('\n')

async function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

    // Gemini API key stored in Supabase Edge Function Secrets.
    // The second name keeps compatibility with the secret already created in the dashboard.
    const apiKey = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('Gemini API Key')
    if (!apiKey) return jsonResponse({ error: 'GEMINI_API_KEY не налаштовано в Supabase Secrets.' }, 500)

    let body: { text?: string }
    try {
      body = await req.json()
    } catch {
      return jsonResponse({ error: 'Некоректний JSON запиту.' }, 400)
    }

    const text = String(body?.text || '').trim()
    if (!text) return jsonResponse({ error: 'Не передано текст документа.' }, 400)
    if (text.length > 50000) return jsonResponse({ error: 'Документ завеликий для AI-виборки.' }, 413)

    const userEmail = String(ctx.userClaims?.email || '')
    const input = [
      'Користувач CRM: ' + userEmail,
      '',
      'ТЕКСТ ДОКУМЕНТА:',
      text,
    ].join('\n')

    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash-lite'
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: input }],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: schema,
          },
        }),
      },
    )

    if (!geminiResponse.ok) {
      const details = await geminiResponse.text()
      console.error('Gemini error:', details)
      return jsonResponse({ error: 'AI-сервіс Gemini повернув помилку.', details }, 502)
    }

    const result = await geminiResponse.json()
    const outputText = String(
      result?.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part?.text || '')
        .join('') || '',
    ).trim()

    if (!outputText) {
      console.error('Gemini empty output:', JSON.stringify(result))
      return jsonResponse({ error: 'Gemini не повернув структуровану виборку.' }, 502)
    }

    let extracted: unknown
    try {
      extracted = JSON.parse(outputText)
    } catch {
      console.error('Invalid Gemini structured output:', outputText)
      return jsonResponse({ error: 'Gemini повернув некоректний структурований результат.' }, 502)
    }

    return jsonResponse({
      extracted,
      model,
      user_email: userEmail,
    })
  }),
}
