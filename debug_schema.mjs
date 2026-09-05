import { createClient } from '@supabase/supabase-js'

const supa = createClient(
  'https://wfeqmdzmozthfwsqjhwo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmZXFtZHptb3p0aGZ3c3FqaHdvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTk5MjY1OSwiZXhwIjoyMDk1NTY4NjU5fQ.EY9OcKBuN95o7BjTIX38DfTzS0sUYjsn-tTWz49iju8'
)

async function main() {
  // Verificar el schema de la tabla
  const { data: sample, error } = await supa.from('historial_chat').select('*').order('creado_en', {ascending: true}).limit(3)
  
  if (error) {
    console.log('Error:', error.message)
    return
  }
  
  console.log('=== SCHEMA DE historic_chat (primeros 3 registros) ===')
  if (sample && sample.length > 0) {
    console.log('Columnas disponibles:', Object.keys(sample[0]))
    console.log()
    
    sample.forEach((m, i) => {
      console.log(`Registro ${i+1}:`)
      for (const [k, v] of Object.entries(m)) {
        console.log(`  ${k}: ${typeof v === 'string' && v.length > 50 ? v.substring(0,50)+'...' : v}`)
      }
      console.log()
    })
  }
  
  // Intentar con un filtro específico
  console.log('\n=== BÚSQUEDA POR role ===')
  const { data: byRole } = await supa.from('historial_chat').select('*').eq('role', 'assistant').limit(5)
  if (byRole && byRole.length > 0) {
    console.log('Registros con role=assistant:')
    byRole.forEach(m => {
      console.log(`  origen="${m.origen}" contenido="${(m.contenido||'').substring(0,60)}"`)
    })
  }
  
  console.log('\n=== BÚSQUEDA POR origen ===')
  const { data: byOrigen } = await supa.from('historial_chat').select('*').eq('origen', 'flora').limit(5)
  if (byOrigen && byOrigen.length > 0) {
    console.log('Registros con origen=flora:')
    byOrigen.forEach(m => {
      console.log(`  id=${m.id} contenido="${(m.contenido||'').substring(0,80)}"`)
    })
  } else {
    console.log('NO se encontraron registros con origen=flora usando eq()')
    
    // Intentar con like
    const { data: likeOrigen } = await supa.from('historial_chat').select('*').like('origen', '%flora%').limit(5)
    if (likeOrigen && likeOrigen.length > 0) {
      console.log('\nCon like %flora%:')
      likeOrigen.forEach(m => {
        console.log(`  origen="${m.origen}" contenido="${(m.contenido||'').substring(0,80)}"`)
      })
    }
  }
}

main().catch(e => console.error('Fatal:', e.message))
