const GOOGLE_MAPS_REGEX = /https?:\/\/(?:www\.)?(?:google\.[a-z]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl)[^\s]*/i
const DIRECCION_PATTERN = /\b(calle|av|avenida|boulevard|blvd|privada|cerrada|andador|carretera|colonia|col\.|fraccionamiento|fracc\.|residencial|unidad|manzana|lote|edificio|departamento|depto|int|edif)\b/i
const NUMERO_EXTERNO = /\b(?:no\.?\s*|número\s*|num\s*)?(\d{1,5})\s*(?:,\s*)?/i

export interface DireccionParseada {
  direccion: string | null
  confianza: 'alta' | 'baja' | 'ninguna'
  esLinkMaps?: boolean
}

export function parseDireccion(texto: string): DireccionParseada {
  const esLink = GOOGLE_MAPS_REGEX.test(texto)
  if (esLink) {
    // BUG-007 (opcion A): conservar el link como direccion, pero se marca para
    // que el flujo pida confirmar la calle en texto (el short-link no trae calle).
    return {
      direccion: texto.trim().slice(0, 200).replace(/\s+/g, ' '),
      confianza: 'alta',
      esLinkMaps: true,
    }
  }

  if (DIRECCION_PATTERN.test(texto)) {
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
