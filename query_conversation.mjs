import { createClient } from '@supabase/supabase-js'

const supa = createClient(
  'https://wfeqmdzmozthfwsqjhwo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmZXFtZHptb3p0aGZ3c3FqaHdvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTk5MjY1OSwiZXhwIjoyMDk1NTY4NjU5fQ.EY9OcKBuN95o7BjTIX38DfTzS0sUYjsn-tTWz49iju8'
)

async function main() {
  const { data: historial, error: histErr } = await supa
    .from('historial_chat')
    .select('*')
    .order('creado_en', { ascending: false })
    .limit(30)

  if (histErr) { console.error('Error:', histErr.message); return }

  console.log('='.repeat(80))
  console.log('ULTIMOS 30 MENSAJES DEL HISTORIAL_CHAT')
  console.log('='.repeat(80))
  console.log()

  let userCount = 0, floraCount = 0, equipoCount = 0, sistemaCount = 0, unknownCount = 0
  const rolesMap = {}

  for (const m of historial) {
    const fecha = new Date(m.creado_en).toLocaleString('es-MX')
    const rol = m.rol || '?'
    const origen = m.origen || '?'
    const contenido = (m.contenido || '').substring(0, 120)
    let clase = ''
    if (rol === 'user') { userCount++; clase = '👤 CLIENTE' }
    else if (origen === 'equipo') { equipoCount++; clase = '👥 EQUIPO' }
    else if (origen === 'sistema') { sistemaCount++; clase = '⚙️ SISTEMA' }
    else if (origen === 'flora') { floraCount++; clase = '🌸 FLORA IA' }
    else { floraCount++; clase = '🌸 FLORA IA' }

    const key = rol + '/' + origen
    rolesMap[key] = (rolesMap[key] || 0) + 1

    console.log('[' + fecha + '] ' + clase)
    console.log('  rol=' + rol + ' origen=' + origen)
    console.log('  msg: ' + contenido)
    if ((m.contenido||'').length > 120) console.log('  ...(' + m.contenido.length + ' chars total)')
    console.log()
  }

  console.log('--- RESUMEN ---')
  console.log('Clientes: ' + userCount + ' | Flora: ' + floraCount + ' | Equipo: ' + equipoCount + ' | Sistema: ' + sistemaCount)
  console.log()
  console.log('--- DISTRIBUCION roles ---')
  for (const [k,v] of Object.entries(rolesMap).sort((a,b)=>b[1]-a[1])) console.log('  ' + k + ': ' + v)
}

main().catch(e => console.error('Fatal:', e.message))
