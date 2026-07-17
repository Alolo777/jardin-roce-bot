// test-apis.mjs — Prueba directa de ambos proveedores de IA
// Uso: node test-apis.mjs

import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '.env'), quiet: true })
dotenv.config({ path: resolve(__dirname, '.env.local'), quiet: true })
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'

const PROMPT = 'Responde en una línea: ¿cuánto cuesta un ramo de rosas?'
const PROMPT_LARGO = 'Eres Flora, asistente floral de Jardín RoCe. ' +
  'Responde de forma amable y profesional. El cliente preguntó: "Buenas tardes, vi estos ramos en sus redes sociales y me gustaría cotizar en cuanto salen". ' +
  'El cliente envió 3 fotos de referencia. ' +
  'Historial: ["Hola buenas tardes", "me gustaría cotizar unos ramos por favor"]. ' +
  'Responde confirmando recepción de las fotos y que el equipo revisará los precios. ' +
  'Máximo 3 oraciones.'
const TIEMPOS = []

async function testGitHubModels() {
  console.log('\n═══════════════════════════════════════════')
  console.log('🧪 1. GitHub Models (Azure)')
  console.log('═══════════════════════════════════════════')

  if (!process.env.GITHUB_TOKEN) {
    console.log('❌ GITHUB_TOKEN no configurado')
    return
  }

  const client = new OpenAI({
    baseURL: 'https://models.inference.ai.azure.com',
    apiKey: process.env.GITHUB_TOKEN,
  })

  const model = process.env.GITHUB_REVIEW_MODEL || 'gpt-4o-mini'
  console.log(`   Modelo: ${model}`)
  console.log(`   Token: ${process.env.GITHUB_TOKEN.slice(0, 20)}...`)

  for (const timeout of [5000, 10000, 15000, 30000]) {
    const inicio = Date.now()
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: PROMPT }],
        max_tokens: 100,
      }, {
        timeout: timeout,
        signal: AbortSignal.timeout(timeout),
      })
      const ms = Date.now() - inicio
      TIEMPOS.push({ provider: 'github', timeout, ms, ok: true })
      console.log(`   ✅ Timeout ${timeout}ms → ${ms}ms`)
      console.log(`   Respuesta: "${response.choices[0]?.message?.content?.slice(0, 100)}"`)

      // Prueba 2: prompt largo (simula conversación real)
      console.log(`\n   --- Prueba con prompt largo ---`)
      const inicio2 = Date.now()
      const response2 = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: 'Eres Flora, asistente floral de Jardín RoCe. Responde amablemente.' },
          { role: 'user', content: 'Buenas tardes' },
          { role: 'assistant', content: '¡Buenas tardes! ¿En qué puedo ayudarte?' },
          { role: 'user', content: PROMPT_LARGO },
        ],
        max_tokens: 200,
      }, {
        timeout: 30000,
        signal: AbortSignal.timeout(30000),
      })
      const ms2 = Date.now() - inicio2
      TIEMPOS.push({ provider: 'github-largo', timeout: 30000, ms: ms2, ok: true })
      console.log(`   ✅ → ${ms2}ms`)
      console.log(`   Respuesta: "${response2.choices[0]?.message?.content?.slice(0, 150)}"`)
      return
    } catch (err) {
      const ms = Date.now() - inicio
      TIEMPOS.push({ provider: 'github', timeout, ms, ok: false, error: err.message })
      console.log(`   ❌ Timeout ${timeout}ms → falló en ${ms}ms: ${err.message?.slice(0, 120)}`)
    }
  }

  // Último intento sin timeout límite (solo el default del SDK)
  try {
    const inicio = Date.now()
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: PROMPT }],
      max_tokens: 100,
    })
    const ms = Date.now() - inicio
    TIEMPOS.push({ provider: 'github', timeout: 0, ms, ok: true })
    console.log(`   ✅ Sin límite → ${ms}ms`)
    console.log(`   Respuesta: "${response.choices[0]?.message?.content?.slice(0, 100)}"`)
  } catch (err) {
    const ms = Date.now() - inicio || 0
    TIEMPOS.push({ provider: 'github', timeout: 0, ms, ok: false, error: err.message })
    console.log(`   ❌ Sin límite → falló: ${err.message?.slice(0, 120)}`)
  }
}

async function testGemini() {
  console.log('\n═══════════════════════════════════════════')
  console.log('🧪 2. Google Gemini')
  console.log('═══════════════════════════════════════════')

  if (!process.env.GEMINI_API_KEY) {
    console.log('❌ GEMINI_API_KEY no configurado')
    return
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
  console.log(`   Modelo: gemini-2.0-flash`)
  console.log(`   API Key: ${process.env.GEMINI_API_KEY.slice(0, 10)}...`)

  const inicio = Date.now()
  try {
    const result = await model.generateContent(PROMPT, {
      timeout: 20000,
    })
    const ms = Date.now() - inicio
    TIEMPOS.push({ provider: 'gemini', timeout: 20000, ms, ok: true })
    console.log(`   ✅ → ${ms}ms`)
    console.log(`   Respuesta: "${result.response.text()?.slice(0, 100)}"`)

    // Prueba 2: mismo prompt largo
    console.log(`\n   --- Prueba con prompt largo ---`)
    const model2 = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
    const inicio2 = Date.now()
    const result2 = await model2.generateContent({
      contents: [
        { role: 'user', parts: [{ text: PROMPT_LARGO }] },
      ],
    })
    const ms2 = Date.now() - inicio2
    TIEMPOS.push({ provider: 'gemini-largo', timeout: 20000, ms: ms2, ok: true })
    console.log(`   ✅ → ${ms2}ms`)
    console.log(`   Respuesta: "${result2.response.text()?.slice(0, 150)}"`)
  } catch (err) {
    const ms = Date.now() - inicio
    TIEMPOS.push({ provider: 'gemini', ms, ok: false, error: err.message })
    console.log(`   ❌ → ${ms}ms: ${err.message?.slice(0, 200)}`)
    if (err.message?.includes('429') || err.message?.includes('quota') || err.message?.includes('rate')) {
      console.log('   ⚠️  ERROR DE CUOTA — probablemente el plan free de Gemini está agotado')
    }
  }
}

function mostrarResumen() {
  console.log('\n═══════════════════════════════════════════')
  console.log('📊 RESUMEN')
  console.log('═══════════════════════════════════════════')
  for (const t of TIEMPOS) {
    const estado = t.ok ? '✅' : '❌'
    const label = t.provider === 'github' ? `GitHub(${t.timeout}ms)` : 'Gemini'
    console.log(`   ${estado} ${label}: ${t.ms}ms ${t.ok ? '' : '— ' + (t.error?.slice(0, 80) || '')}`)
  }
}

async function main() {
  console.log('🔍 Prueba de proveedores de IA')
  console.log(`   Hora: ${new Date().toISOString()}`)

  await testGitHubModels()
  await testGemini()
  mostrarResumen()
}

main().catch(console.error)
