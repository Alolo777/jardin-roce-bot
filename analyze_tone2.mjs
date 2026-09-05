import { createClient } from '@supabase/supabase-js'

const supa = createClient(
  'https://wfeqmdzmozthfwsqjhwo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmZXFtZHptb3p0aGZ3c3FqaHdvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTk5MjY1OSwiZXhwIjoyMDk1NTY4NjU5fQ.EY9OcKBuN95o7BjTIX38DfTzS0sUYjsn-tTWz49iju8'
)

async function main() {
  const { data: all } = await supa.from('historial_chat').select('*').order('creado_en', {ascending: true}).limit(500)
  if (!all) return

  const floraMsgs = all.filter(m => (m.origen || '').trim() === 'flora' && m.contenido && m.contenido.length > 20)
  console.log('Total mensajes Flora con contenido real:', floraMsgs.length)
  console.log()

  const presentacion = floraMsgs.filter(m => /Flora|presentación|saludaste|qué gusto/.test(m.contenido))
  const foto = floraMsgs.filter(m => /recib.*fot|imagen/.test(m.contenido))
  const pago = floraMsgs.filter(m => /comprobante/.test(m.contenido))
  const conPregunta = floraMsgs.filter(m => /[¿?]/.test(m.contenido))
  const cortesia = floraMsgs.filter(m => /gracias|disculpe|por favor|amable|buenos días/.test(m.contenido))
  const conPrecio = floraMsgs.filter(m => m.contenido.includes('$'))
  const conEmoji = floraMsgs.filter(m => /[🌸💐🌷🎉🌻☺️🌺🍀💚🌵]/.test(m.contenido))
  
  console.log('--- CLASIFICACIÓN DE TONO ---')
  console.log('Presentacion:', presentacion.length)
  console.log('Confirmacion foto:', foto.length)
  console.log('Confirmacion pago:', pago.length)
  console.log('Con pregunta:', conPregunta.length)
  console.log('Cortesia:', cortesia.length)
  console.log('Con precio $:', conPrecio.length)
  console.log('Con emoji:', conEmoji.length)
  console.log()

  console.log('--- EJEMPLOS DE TONO DE FLORA ---')
  floraMsgs.slice(0, 6).forEach(m => {
    const fecha = new Date(m.creado_en).toLocaleString('es-MX', {hour: '2-digit', minute: '2-digit'})
    console.log(`\n[${fecha}] (${m.contenido.length} chars)`)
    console.log(m.contenido.substring(0, 250))
  })
  
  const longitudes = floraMsgs.map(m => m.contenido.length)
  console.log(`\n--- ESTADÍSTICAS ---`)
  console.log('Longitud promedio: ' + (longitudes.reduce((a,b)=>a+b,0)/longitudes.length).toFixed(0) + ' chars')
  console.log('Max: ' + Math.max(...longitudes) + ' | Min: ' + Math.min(...longitudes))
  
  // Verificar que Flora responde con texto completo al cliente
  console.log('\n--- VERIFICACIÓN DE MENSAJES CON TEXTO COMPLETO ---')
  const conTextoReal = floraMsgs.filter(m => m.contenido && m.contenido.length > 50 && !m.contenido.includes('envió una foto'))
  console.log(`Mensajes de Flora con texto real (>50 chars, no "envió foto"): ${conTextoReal.length}`)
  conTextoReal.slice(0, 3).forEach(m => {
    console.log(`  "${m.contenido.substring(0, 100)}..."`)
  })
}

main().catch(e => console.error('Fatal:', e.message))
