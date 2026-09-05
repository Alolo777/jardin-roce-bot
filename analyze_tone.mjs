import { createClient } from '@supabase/supabase-js'

const supa = createClient(
  'https://wfeqmdzmozthfwsqjhwo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmZXFtZHptb3p0aGZ3c3FqaHdvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTk5MjY1OSwiZXhwIjoyMDk1NTY4NjU5fQ.EY9OcKBuN95o7BjTIX38DfTzS0sUYjsn-tTWz49iju8'
)

async function main() {
  // Obtener la conversación más completa con Flora
  const { data: all } = await supa
    .from('historial_chat')
    .select('*')
    .order('creado_en', { ascending: true })
    .limit(500)

  if (!all) return

  // Buscar la conversación del cliente 61186271907846 (la que tiene Flora respondiendo)
  // Primero obtener el cliente_id
  const { data: clientes } = await supa
    .from('clientes')
    .select('id, telefono')
    
  if (!clientes) return

  // Encontrar el cliente con teléfono 61186271907846
  const targetClient = clientes.find(c => c.telefono === '+5261186271907846' || c.telefono === '61186271907846')
  
  if (targetClient) {
    const { data: hist } = await supa
      .from('historial_chat')
      .select('*')
      .eq('cliente_id', targetClient.id)
      .order('creado_en', { ascending: true })
    
    if (hist) {
      console.log('='.repeat(80))
      console.log('CONVERSACIÓN COMPLETA CON FLORA - Cliente 61186271907846')
      console.log('='.repeat(80))
      console.log()
      
      // Agrupar por "turno" (cada par cliente+respuesta)
      let turno = 0
      for (let i = 0; i < hist.length; i++) {
        const m = hist[i]
        const fecha = new Date(m.creado_en).toLocaleString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        const rol = m.rol || '?'
        const origen = m.origen || 'null'
        const contenido = m.contenido || ''
        
        let clase = ''
        if (rol === 'user') clase = '👤 CLIENTE'
        else if (origen === 'equipo') clase = '👥 EQUIPO ✅'
        else if (origen === 'flora') clase = '🌸 FLORA'
        else if (origen === 'sistema') clase = '⚙️ SISTEMA'
        else clase = `❓ ${origen}`
        
        // Detectar si es un mensaje del sistema de revisión
        const esRevision = contenido.includes('Flora omitió respuesta')
        const esAgente = contenido.startsWith('[Agente:')
        
        // Limpiar contenido para mostrar
        let contenidoLimpio = contenido
        if (esAgente) {
          contenidoLimpio = contenido.replace(/^\[Agente:\s*/, '').replace(/\]$/, '')
        }
        if (contenidoLimpio.length > 300) contenidoLimpio = contenidoLimpio.substring(0, 300) + '...'
        
        if (rol === 'user') turno++
        
        console.log(`Turno ${turno} [${fecha}] ${clase}`)
        console.log(`  origen="${origen}" role="${rol}"`)
        console.log(`  ${contenidoLimpio}`)
        if (esRevision) {
          console.log(`  ⚠️ ESTE FUE RECHAZADO POR LA REVISORA`)
        }
        console.log()
      }
    }
  }
  
  // También buscar la conversación donde el cliente tiene texto real
  console.log('\n' + '='.repeat(80))
  console.log('ANÁLISIS DE TONO - MENSAJES DE FLORA')
  console.log('='.repeat(80))
  
  const floraMsgs = all.filter(m => m.origen === 'flora' && m.contenido && m.contenido.length > 20)
  console.log(`\nTotal mensajes de Flora con contenido real: ${floraMsgs.length}`)
  console.log()
  
  // Análisis de tono
  const tonos = {
    'presentacion': floraMsgs.filter(m => m.contenido.includes('Soy Flora') || m.contenido.includes('Flora 🌸')).length,
    'confirmacion_foto': floraMsgs.filter(m => m.contenido.includes('recibí la foto') || m.contenido.includes('recibí tu imagen')).length,
    'confirmacion_pago': floraMsgs.filter(m => m.contenido.includes('recibí tu comprobante')).length,
    'pregunta': floraMsgs.filter(m => m.contenido.includes('¿') || m.contenido.includes('?')).length,
    'cortesia': floraMsgs.filter(m => m.contenido.includes('gracias') || m.contenido.includes('disculpe') || m.contenido.includes('por favor')).length,
    'otro': floraMsgs.length - 0
  }
  
  console.log('Clasificación de tono de Flora:')
  for (const [k, v] of Object.entries(tonos)) {
    console.log(`  ${k}: ${v}`)
  }
  
  // Promedio de longitud de mensajes de Flora
  const longitudes = floraMsgs.map(m => m.contenido.length)
  const promedio = longitudes.reduce((a, b) => a + b, 0) / longitudes.length
  console.log(`\nLongitud promedio de mensajes de Flora: ${promedio.toFixed(0)} chars`)
  console.log(`Máx: ${Math.max(...longitudes)} | Mín: ${Math.min(...longitudes)}`)
  
  // Verificar si Flora está usando el formato correcto de precios
  const conPrecios = floraMsgs.filter(m => m.contenido.includes('$'))
  console.log(`\nMensajes de Flora con precios ($): ${conPrecios.length}`)
  conPrecios.forEach(m => console.log(`  "${(m.contenido||'').substring(0,100)}"`))
  
  // Verificar si Flora usa emojis correctamente
  const conEmojis = floraMsgs.filter(m => /[🌸💐🌷🎉🌻☺️🌺]/.test(m.contenido || ''))
  console.log(`\nMensajes de Flora con emojis: ${conEmojis.length} de ${floraMsgs.length}`)
}

main().catch(e => console.error('Fatal:', e.message))
