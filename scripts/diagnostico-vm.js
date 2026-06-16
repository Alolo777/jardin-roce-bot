/**
 * Script de diagnóstico para la VM de Google Cloud.
 * Corre con: node scripts/diagnostico-vm.js
 * Verifica Chrome, Puppeteer y conexión a Supabase.
 */
const { execSync } = require('child_process')

function run(cmd) {
  try {
    return execSync(cmd, { timeout: 15000, encoding: 'utf8' }).trim()
  } catch (e) {
    return `ERROR: ${e.message}`
  }
}

console.log('=== DIAGNÓSTICO VM JARDÍN ROCE ===\n')

console.log('1. Chrome/Chromium:')
const chrome = run('which google-chrome chromium chromium-browser 2>/dev/null || echo "NO ENCONTRADO"')
console.log(`   Ruta: ${chrome}`)

const chromeVer = run('google-chrome --version 2>/dev/null || chromium --version 2>/dev/null || echo "NO DISPONIBLE"')
console.log(`   Versión: ${chromeVer}`)

console.log('\n2. Puppeteer:')
try {
  const puppeteer = require('puppeteer-core')
  console.log(`   puppeteer-core: ${puppeteer?.name || 'ok'}`)
} catch (e) {
  console.log(`   puppeteer-core: NO INSTALADO (${e.message})`)
}

console.log('\n3. Directorio .wwebjs_auth:')
const fs = require('fs')
const authPath = './.wwebjs_auth'
if (fs.existsSync(authPath)) {
  const items = fs.readdirSync(authPath)
  console.log(`   Existe: sí (${items.length} entradas)`)
} else {
  console.log(`   Existe: NO — se generará al iniciar el bot`)
}

console.log('\n4. Variables de entorno:')
const envVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'BOT_PORT', 'PUPPETEER_EXECUTABLE_PATH', 'WWEBJS_DATA_PATH']
for (const v of envVars) {
  const val = process.env[v]
  console.log(`   ${v}: ${val ? (v.includes('KEY') ? '****' : val) : 'NO DEFINIDA'}`)
}

console.log('\n5. Sistema:')
const mem = run('free -h | grep Mem || echo "N/A"')
console.log(`   Memoria: ${mem}`)
const disk = run('df -h . | tail -1')
console.log(`   Disco: ${disk}`)
const nodeVer = run('node --version')
console.log(`   Node: ${nodeVer}`)
const npmVer = run('npm --version')
console.log(`   npm: ${npmVer}`)

console.log('\n6. Conexión a Supabase:')
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_KEY || '')
supabase.from('configuracion_bot').select('clave').limit(1).then(({ data, error }) => {
  if (error) console.log(`   ERROR: ${error.message}`)
  else console.log(`   OK: ${data?.length ?? 0} filas en configuracion_bot`)
  console.log('\n=== DIAGNÓSTICO COMPLETADO ===')
}).catch(e => console.log(`   ERROR: ${e.message}`))
