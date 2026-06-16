/**
 * Script de diagnóstico para la VM de Google Cloud.
 * Corre con: node scripts/diagnostico-vm.js
 * Verifica Chrome, Puppeteer y conexión a Supabase.
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

// Cargar .env.local si existe (como lo hace tsx --env-file)
const envPath = path.join(__dirname, '..', '.env.local')
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let val = trimmed.slice(eqIdx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
}

function run(cmd, timeout = 15000) {
  try {
    return execSync(cmd, { timeout, encoding: 'utf8', shell: '/bin/bash' }).trim()
  } catch (e) {
    return `ERROR: ${e.message}`
  }
}

console.log('=== DIAGNÓSTICO VM JARDÍN ROCE ===\n')

console.log('1. Chrome/Chromium:')
const chromePaths = ['/snap/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
for (const p of chromePaths) {
  console.log(`   ${p}: ${fs.existsSync(p) ? 'EXISTE' : 'no encontrado'}`)
}
const chromeVer = run('/snap/bin/chromium --version 2>/dev/null || /usr/bin/chromium-browser --version 2>/dev/null || echo "NO DISPONIBLE"')
console.log(`   Versión: ${chromeVer}`)

console.log('\n2. Puppeteer:')
try {
  const puppeteer = require('puppeteer-core')
  console.log(`   puppeteer-core: ok`)
} catch (e) {
  console.log(`   puppeteer-core: NO INSTALADO (${e.message})`)
}

console.log('\n3. Directorio .wwebjs_auth:')
const authPath = './.wwebjs_auth'
if (fs.existsSync(authPath)) {
  const entries = fs.readdirSync(authPath)
  const sizes = entries.map(e => ({ name: e, size: fs.statSync(path.join(authPath, e)).size }))
  console.log(`   Existe: sí (${entries.length} entradas)`)
  for (const s of sizes) console.log(`     ${s.name}: ${(s.size / 1024).toFixed(1)} KB`)
} else {
  console.log(`   Existe: NO — se generará al iniciar el bot`)
}

console.log('\n4. Variables de entorno (desde .env.local):')
const envVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'BOT_PORT', 'PUPPETEER_EXECUTABLE_PATH', 'WWEBJS_DATA_PATH']
for (const v of envVars) {
  const val = process.env[v]
  console.log(`   ${v}: ${val ? (v.includes('KEY') ? '****' : val) : 'NO DEFINIDA'}`)
}

console.log('\n5. Sistema:')
const mem = run("free -h | grep Mem || echo 'N/A'")
console.log(`   Memoria: ${mem}`)
const disk = run("df -h . | tail -1")
console.log(`   Disco: ${disk}`)
console.log(`   Node: ${process.version}`)
const npmVer = run('npm --version')
console.log(`   npm: ${npmVer}`)
const uptime = run('uptime -p')
console.log(`   Uptime: ${uptime}`)

console.log('\n6. Conexión a Supabase:')
const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_KEY
if (!supabaseUrl || !supabaseKey) {
  console.log('   ERROR: SUPABASE_URL o SUPABASE_SERVICE_KEY no definidas en .env.local')
  process.exit(1)
}
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(supabaseUrl, supabaseKey)
supabase.from('configuracion_bot').select('clave').limit(3).then(({ data, error }) => {
  if (error) {
    console.log(`   ERROR: ${error.message}`)
  } else {
    console.log(`   OK: ${data?.length ?? 0} filas en configuracion_bot`)
    for (const row of data || []) console.log(`     - ${row.clave}`)
  }
  console.log('\n=== DIAGNÓSTICO COMPLETADO ===')
}).catch(e => console.log(`   ERROR: ${e.message}`))
