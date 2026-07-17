const STOP_PATTERN = /[,.\n;:!?¡¿]|\b(y|e|o|u|de|del|para|por|con|sin|en|el|la|los|las|un|una|se|le|me|te|que|es|fue|será|sera|esta|está|pero|más|mas|muy|ya|si|sí|también|tambien|solo|sólo|como|cómo|cuando|cuándo|donde|dónde|quien|quién|gracias|hola|buenas|ok|okay|vale|dale|va|pls|por\s+favor)\b/i
const STOP_NO = /(?:^|[\s,.;:!?¡¿])no(?:$|[\s,.;:!?¡¿])/i

const NO_ES_NOMBRE_REGEX = /\b(hola|buenas|gracias|ok|okay|okey|si|sí|está|esta|bien|vale|dale|va|ramo|sucursal|centro|norte|sur|envio|envío|mañana|hoy|viernes|lunes|martes|miercoles|miércoles|jueves|sabado|sábado|domingo|recoger|entrega|entregan|direccion|dirección|transferencia|comprobante|pago|podría|podria|necesito|quisiera|quiere|quiero|tiene|tienen|listo)\b/i
const NO_INDEPENDIENTE = /(?:^|[\s,.;:!?¡¿])no(?:$|[\s,.;:!?¡¿])/i

function esNoNombre(texto: string): boolean {
  return NO_ES_NOMBRE_REGEX.test(texto) || NO_INDEPENDIENTE.test(texto)
}

export function parseNombre(texto: string): string | null {
  const limpio = texto.trim()
  if (!limpio) return null

  const matchNombre = limpio.match(/(?:a\s+nombre\s+de|nombre\s+de|apartar\s+a\s+nombre\s+de|se\s+lo\s+aparto\s+a\s+nombre\s+de)[:\s]*([^\n]{1,100})/i)
  if (matchNombre) {
    const raw = matchNombre[1]
    const cortado = raw.split(STOP_PATTERN)[0]
    const nombre = cortado?.replace(/\s+/g, ' ').trim().slice(0, 80)
    if (nombre && nombre.length >= 3 && !esNoNombre(nombre)) return nombre
    return null
  }

  if (/^[a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){1,4}$/i.test(limpio)) {
    if (esNoNombre(limpio)) return null
    return limpio.slice(0, 80)
  }

  return null
}

export function pareceNombreCliente(texto: string): boolean {
  const limpio = texto.trim()
  if (!/^[a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){1,4}$/i.test(limpio)) return false
  return !esNoNombre(limpio)
}
