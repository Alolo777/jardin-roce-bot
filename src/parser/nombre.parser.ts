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
  'sabe', 'sé', 'sabes', 'saben',
  'transferencia', 'comprobante',
  'aperte', 'aparta', 'apartas', 'apartan',
  'luego', 'después', 'despues', 'ahí', 'ahi', 'alli', 'allí', 'listo', 'claro', 'bueno',
  'adelante', 'porfavor', 'exacto', 'perfecto', 'entonces',
]
const STOP_WORDS_JOINED = STOP_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
const STOP_WORDS_REGEX = new RegExp(`\\b(${STOP_WORDS_JOINED})\\b`, 'i')
const STOP_WORDS_SET = new Set(STOP_WORDS)

const MAX_WORDS = 5
const MIN_LENGTH = 2

const REGEX_PALABRA_NOMBRE = /^[a-zA-ZáéíóúÁÉÍÓÚÑñ']+$/
const REGEX_URL = /(?:https?:\/\/|www\.|\.(?:com|mx|net|org)(?:\/|$))/i
const PALABRAS_URL = new Set(['http', 'https', 'www', 'ftp'])

const NO_ES_NOMBRE_REGEX = /\b(hola|buenas|gracias|ok|okay|okey|si|sí|está|esta|bien|vale|dale|va|luego|listo|claro|bueno|adelante|después|despues|ahí|ahi|alli|allí|exacto|perfecto|porfavor|entonces|sucursal|envio|envío|mañana|hoy|viernes|lunes|martes|miercoles|miércoles|jueves|sabado|sábado|domingo|transferencia|comprobante|pago|podría|podria|necesito|quisiera)\b/i
const NO_INDEPENDIENTE = /(?:^|[\s,.;:!?¡¿])no(?:$|[\s,.;:!?¡¿])/i
const FRASES_NO_NOMBRE = ['por favor', 'está bien', 'esta bien', 'de acuerdo', 'muy bien']

function esNoNombre(texto: string): boolean {
  const bajo = texto.toLowerCase().trim()
  if (FRASES_NO_NOMBRE.includes(bajo)) return true
  return NO_ES_NOMBRE_REGEX.test(texto) || NO_INDEPENDIENTE.test(texto)
}

function cortarEnStop(texto: string): string {
  const porPuntuacion = texto.split(STOP_PUNTUACION)[0].trim()
  const palabras = porPuntuacion.split(/\s+/)
  const resultado: string[] = []
  for (const p of palabras) {
    if (STOP_WORDS_REGEX.test(p)) break
    if (PALABRAS_URL.has(p.toLowerCase())) break
    if (!REGEX_PALABRA_NOMBRE.test(p)) break
    resultado.push(p)
  }
  return resultado.join(' ').trim()
}

export function esNombrePlausible(nombre: string): boolean {
  const limpio = nombre.trim()
  if (limpio.length < MIN_LENGTH || limpio.length > 80) return false
  const palabras = limpio.split(/\s+/)
  if (palabras.length < 1 || palabras.length > MAX_WORDS) return false
  if (REGEX_URL.test(limpio)) return false
  if (palabras.some(p => PALABRAS_URL.has(p.toLowerCase()))) return false
  if (!palabras.every(p => REGEX_PALABRA_NOMBRE.test(p))) return false
  if (STOP_WORDS_SET.has(limpio.toLowerCase())) return false
  if (esNoNombre(limpio)) return false
  return true
}

export function parseNombre(texto: string): string | null {
  const limpio = texto.trim()
  if (!limpio) return null

  const matchNombre = limpio.match(/(?:a\s+nombre\s+de|apartar\s+a\s+nombre\s+de|se\s+lo\s+aparto\s+a\s+nombre\s+de)[:\s]*([^\n]{1,120})/i)
  if (matchNombre) {
    const nombre = cortarEnStop(matchNombre[1]).slice(0, 80)
    if (esNombrePlausible(nombre)) return nombre
    return null
  }

  const matchSimple = limpio.match(/(?:nombre\s+de|a\s+qu[eé]\s+nombre|para\s+quien|para\s+qui[eé]n|ponerle)[:\s]*([a-záéíóúñA-ZÁÉÍÓÚÑ\s']{1,80})/i)
  if (matchSimple) {
    const nombre = cortarEnStop(matchSimple[1]).slice(0, 80)
    if (esNombrePlausible(nombre)) return nombre
  }

  const palabras = limpio.split(/\s+/)
  if (palabras.length >= 2 && palabras.length <= MAX_WORDS && /^[a-záéíóúñA-ZÁÉÍÓÚÑ']+$/i.test(limpio.replace(/\s+/g, ''))) {
    if (esNombrePlausible(limpio)) return limpio.replace(/\s+/g, ' ').trim().slice(0, 80)
  }

  return null
}

export function pareceNombreCliente(texto: string): boolean {
  const limpio = texto.trim()
  const palabras = limpio.split(/\s+/)
  if (palabras.length < 2 || palabras.length > MAX_WORDS) return false
  return esNombrePlausible(limpio)
}
