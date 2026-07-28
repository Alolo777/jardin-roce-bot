const STOP_PUNTUACION = /[,.\n;:!?¡¿()\-–—]+/

const STOP_WORDS = [
  'y', 'e', 'o', 'u', 'de', 'del', 'para', 'por', 'con', 'sin', 'en', 'el', 'la', 'los', 'las',
  'un', 'una', 'se', 'le', 'me', 'te', 'que', 'es', 'fue', 'será', 'sera', 'esta', 'está',
  'pero', 'más', 'mas', 'muy', 'ya', 'si', 'sí', 'también', 'tambien', 'solo', 'sólo',
  'como', 'cómo', 'cuando', 'cuándo', 'donde', 'dónde', 'quien', 'quién', 'gracias', 'hola',
  'buenas', 'ok', 'okay', 'vale', 'dale', 'va', 'pls',
  'cree', 'creen', 'creo', 'crees', 'necesito', 'necesita', 'necesitan', 'quisiera',
  'quiere', 'quiero', 'quieren', 'podría', 'podria', 'podrías', 'podrias', 'podríamos',
  'podriamos', 'estaría', 'estaria', 'estarían', 'estarian', 'sería', 'seria',
  'puede', 'puedo', 'pueden', 'piensa', 'pienso', 'dice', 'digo', 'dijo',
  'sabe', 'sé', 'sabes', 'saben', 'recoger', 'entrega', 'entregan', 'envio', 'envío',
  'direccion', 'dirección', 'transferencia', 'comprobante', 'pago', 'mañana', 'hoy',
  'viernes', 'lunes', 'martes', 'miercoles', 'miércoles', 'jueves', 'sabado', 'sábado',
  'domingo', 'ramo', 'sucursal', 'centro', 'norte', 'sur', 'listo', 'arreglo',
  'gracias', 'aperte', 'aparta', 'apartas', 'apartan',
]
const STOP_WORDS_JOINED = STOP_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
const STOP_WORDS_REGEX = new RegExp(`\\b(${STOP_WORDS_JOINED})\\b`, 'i')

const STOP_PATTERN = new RegExp(`${STOP_PUNTUACION.source}|${STOP_WORDS_REGEX.source}`, 'i')

const NO_ES_NOMBRE_REGEX = /\b(hola|buenas|gracias|ok|okay|okey|si|sí|está|esta|bien|vale|dale|va|ramo|sucursal|centro|norte|sur|envio|envío|mañana|hoy|viernes|lunes|martes|miercoles|miércoles|jueves|sabado|sábado|domingo|recoger|entrega|entregan|direccion|dirección|transferencia|comprobante|pago|podría|podria|necesito|quisiera|quiere|quiero|tiene|tienen|listo)\b/i
const NO_INDEPENDIENTE = /(?:^|[\s,.;:!?¡¿])no(?:$|[\s,.;:!?¡¿])/i

function esNoNombre(texto: string): boolean {
  return NO_ES_NOMBRE_REGEX.test(texto) || NO_INDEPENDIENTE.test(texto)
}

function cortarEnStop(texto: string): string {
  const porPuntuacion = texto.split(STOP_PUNTUACION)[0].trim()
  const palabras = porPuntuacion.split(/\s+/)
  const resultado: string[] = []
  for (const p of palabras) {
    if (STOP_WORDS_REGEX.test(p)) break
    resultado.push(p)
  }
  return resultado.join(' ').trim()
}

export function parseNombre(texto: string): string | null {
  const limpio = texto.trim()
  if (!limpio) return null

  const matchNombre = limpio.match(/(?:a\s+nombre\s+de|apartar\s+a\s+nombre\s+de|se\s+lo\s+aparto\s+a\s+nombre\s+de)[:\s]*([^\n]{1,120})/i)
  if (matchNombre) {
    const raw = matchNombre[1]
    const nombre = cortarEnStop(raw).slice(0, 80)
    if (nombre && nombre.length >= 2 && !esNoNombre(nombre)) return nombre
    return null
  }

  const matchSimple = limpio.match(/(?:nombre\s+de|a\s+qu[eé]\s+nombre|para\s+quien|para\s+qui[eé]n|ponerle)[:\s]*([a-záéíóúñA-ZÁÉÍÓÚÑ\s']{1,80})/i)
  if (matchSimple) {
    const raw = matchSimple[1]
    const nombre = cortarEnStop(raw).slice(0, 80)
    if (nombre && nombre.length >= 2 && !esNoNombre(nombre)) return nombre
  }

  const palabras = limpio.split(/\s+/)
  if (palabras.length >= 2 && palabras.length <= 6 && /^[a-záéíóúñA-ZÁÉÍÓÚÑ']+$/i.test(limpio.replace(/\s+/g, ''))) {
    if (esNoNombre(limpio)) return null
    return limpio.replace(/\s+/g, ' ').trim().slice(0, 80)
  }

  return null
}

export function pareceNombreCliente(texto: string): boolean {
  const limpio = texto.trim()
  const palabras = limpio.split(/\s+/)
  if (palabras.length < 2 || palabras.length > 6) return false
  if (!/^[a-záéíóúñA-ZÁÉÍÓÚÑ']+$/i.test(limpio.replace(/\s+/g, ''))) return false
  return !esNoNombre(limpio)
}
