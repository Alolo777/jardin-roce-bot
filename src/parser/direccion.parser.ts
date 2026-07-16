const DIRECCION_PATTERN = /\b(calle|av|avenida|boulevard|blvd|privada|cerrada|andador|carretera|colonia|col\.|fraccionamiento|fracc\.|residencial|unidad|manzana|lote|edificio|departamento|depto|int|edif)\b/i
const NUMERO_EXTERNO = /\b(?:no\.?\s*|número\s*|num\s*)?(\d{1,5})\s*(?:,\s*)?/i

export interface DireccionParseada {
  direccion: string | null
  confianza: 'alta' | 'baja' | 'ninguna'
}

export function parseDireccion(texto: string): DireccionParseada {
  if (DIRECCION_PATTERN.test(texto)) {
    // Tomar primeras 100 caracteres como posible dirección
    const candidata = texto.trim().slice(0, 100).replace(/\s+/g, ' ')
    return { direccion: candidata, confianza: 'alta' }
  }

  if (/\b(domicilio|direccion|dirección|llegan?|entrega|env[ií]o\s+a|recibir[aá]\s+en|dejar\s+en|mandar\s+a)\b/i.test(texto)) {
    return { direccion: texto.trim().slice(0, 100).replace(/\s+/g, ' '), confianza: 'baja' }
  }

  return { direccion: null, confianza: 'ninguna' }
}

export function extraerDireccion(texto: string): string | null {
  const r = parseDireccion(texto)
  return r.confianza !== 'ninguna' ? r.direccion : null
}
