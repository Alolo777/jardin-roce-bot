// scripts/check-apis.mts
// Verificación manual de conectividad de todas las APIs configuradas en .env.
// Uso (desde la raíz del proyecto):
//   npm run check:apis
// Cada check intenta una llamada mínima real y reporta OK / FALLO.
// No modifica datos ni envía notificaciones a clientes.

type Result = { name: string; ok: boolean; detail: string }

async function check(
  name: string,
  fn: () => Promise<string>
): Promise<Result> {
  try {
    const detail = await fn()
    return { name, ok: true, detail }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { name, ok: false, detail: msg }
  }
}

async function requestJson(url: string, init?: RequestInit): Promise<any> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    const text = await res.text()
    let json: any = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    if (!res.ok) {
      const msg = json?.error?.message ?? json?.message ?? json?.detail ?? text.slice(0, 140)
      throw new Error(`HTTP ${res.status}: ${msg}`)
    }
    return json
  } finally {
    clearTimeout(timeout)
  }
}

// ─── GEMINI ─────────────────────────────────────────────────────
async function checkGemini(): Promise<string> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY no configurada')
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'
  const json = await requestJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Responde solo: OK' }] }] }),
    }
  )
  const texto = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '(sin texto)'
  return `model=${model} → ${texto}`
}

// ─── OPENROUTER ─────────────────────────────────────────────────
export async function checkOpenRouter(): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error('OPENROUTER_API_KEY no configurada')
  const model = process.env.OPENROUTER_MODEL || 'openrouter/free'
  const json = await requestJson('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://jardin-roce.local',
      'X-Title': 'Jardin RoCe',
    },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Responde solo: OK' }], max_tokens: 5 }),
  })
  const texto = json?.choices?.[0]?.message?.content ?? '(sin texto)'
  return `model=${model} → ${String(texto).slice(0, 40)}`
}

// ─── GROQ ───────────────────────────────────────────────────────
async function checkGroq(): Promise<string> {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY no configurada')
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
  const json = await requestJson('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Responde solo: OK' }], max_tokens: 5 }),
  })
  const texto = json?.choices?.[0]?.message?.content ?? '(sin texto)'
  return `model=${model} → ${String(texto).slice(0, 40)}`
}

// ─── CEREBRAS ───────────────────────────────────────────────────
async function checkCerebras(): Promise<string> {
  const key = process.env.CEREBRAS_API_KEY
  if (!key) throw new Error('CEREBRAS_API_KEY no configurada')
  const model = process.env.CEREBRAS_MODEL || 'gpt-oss-120b'
  const json = await requestJson('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Responde solo: OK' }], max_tokens: 5 }),
  })
  const texto = json?.choices?.[0]?.message?.content ?? '(sin texto)'
  return `model=${model} → ${String(texto).slice(0, 40)}`
}

// ─── GITHUB MODELS (IA1 / IA2) ──────────────────────────────────
async function checkGithubModels(tokenEnv: string, label: string): Promise<string> {
  const token = process.env[tokenEnv]
  if (!token) throw new Error(`${tokenEnv} no configurada`)
  const model = process.env[tokenEnv === 'IA1_TOKEN' ? 'IA1_MODEL' : 'IA2_MODEL'] || 'gpt-4o-mini'
  const json = await requestJson('https://models.inference.ai.azure.com/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Responde solo: OK' }], max_tokens: 5 }),
  })
  const texto = json?.choices?.[0]?.message?.content ?? '(sin texto)'
  return `${label} model=${model} → ${String(texto).slice(0, 40)}`
}

// ─── TELEGRAM ───────────────────────────────────────────────────
async function checkTelegram(): Promise<string> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN no configurada')
  const json = await requestJson(`https://api.telegram.org/bot${token}/getMe`)
  return `bot=@${json?.result?.username} (${json?.ok ? 'OK' : 'error'})`
}

// ─── SUPABASE ───────────────────────────────────────────────────
async function checkSupabase(): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase URL/ANON_KEY no configuradas')
  const json = await requestJson(`${url}/rest/v1/clientes?limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  return `${Array.isArray(json) ? json.length : '?'} fila(s) OK`
}

async function main(): Promise<void> {
  const checks: Result[] = []

  checks.push(await check('Gemini (primaria)', checkGemini))
  checks.push(await check('OpenRouter', checkOpenRouter))
  checks.push(await check('Groq', checkGroq))
  checks.push(await check('Cerebras', checkCerebras))
  checks.push(await check('IA1 (GitHub Models)', () => checkGithubModels('IA1_TOKEN', 'IA1')))
  checks.push(await check('IA2 (GitHub Models)', () => checkGithubModels('IA2_TOKEN', 'IA2')))
  checks.push(await check('Telegram', checkTelegram))
  checks.push(await check('Supabase', checkSupabase))

  console.log('\n=== VERIFICACIÓN DE APIs — Jardín RoCe ===\n')
  for (const c of checks) {
    const badge = c.ok ? '✅ OK' : '❌ FALLO'
    console.log(`${badge}  ${c.name}`)
    console.log(`     ${c.detail}`)
  }

  const okCount = checks.filter(c => c.ok).length
  const total = checks.length
  console.log(`\nResumen: ${okCount}/${total} OK`)
  console.log(okCount === total ? 'Todas las APIs configuradas responden.' : 'ALGUNAS APIs fallaron — revisa las claves o créditos.')

  process.exit(okCount === total ? 0 : 1)
}

main().catch(err => {
  console.error('Error inesperado:', err)
  process.exit(1)
})