export interface SucursalParseada {
  sucursal: string | null
  confianza: 'alta' | 'media' | 'ninguna'
}

const SUCURSALES: Record<string, string[]> = {
  'Centro': ['centro', 'sucursal centro', 'zona centro', 'el centro', 'centro de la ciudad'],
  'Norte': ['norte', 'sucursal norte', 'zona norte', 'norte de la ciudad'],
  'Sur': ['sur', 'sucursal sur', 'zona sur'],
  'Apizaco': ['apizaco', 'sucursal apizaco', 'sucursal de apizaco'],
  'Tlaxcala': ['tlaxcala', 'sucursal tlaxcala', 'sucursal de tlaxcala'],
}

const REFERENCIAS_MEDIA: Array<{ regex: RegExp; sucursal: string }> = [
  { regex: /\b(?:av\.?|avenida)\s+morelos\b/i, sucursal: 'Centro' },
  { regex: /\bpor\s+la\s+morelos\b/i, sucursal: 'Centro' },
  { regex: /\bpor\s+el\s+norte\b/i, sucursal: 'Norte' },
  { regex: /\bpor\s+el\s+sur\b/i, sucursal: 'Sur' },
]

const PALABRAS_GENERICAS = /\b(recoger|recojo|paso|pasare|pasaré|sucursal|local|tienda|voy|ir|llego|llegar)\b/i

function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function tienePalabra(texto: string, keyword: string): boolean {
  const esc = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${esc}\\b`, 'i').test(texto)
}

export function parseSucursal(texto: string): SucursalParseada {
  const textoLower = normalizar(texto)

  for (const [nombre, keywords] of Object.entries(SUCURSALES)) {
    for (const kw of keywords) {
      if (tienePalabra(textoLower, kw)) {
        return { sucursal: nombre, confianza: 'alta' }
      }
    }
  }

  for (const ref of REFERENCIAS_MEDIA) {
    if (ref.regex.test(textoLower)) {
      return { sucursal: ref.sucursal, confianza: 'media' }
    }
  }

  if (PALABRAS_GENERICAS.test(texto)) {
    return { sucursal: null, confianza: 'ninguna' }
  }

  return { sucursal: null, confianza: 'ninguna' }
}

export function extraerSucursal(texto: string): string | null {
  const r = parseSucursal(texto)
  return r.confianza === 'alta' || r.confianza === 'media' ? r.sucursal : null
}
