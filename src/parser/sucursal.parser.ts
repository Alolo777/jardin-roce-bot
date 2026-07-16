export interface SucursalParseada {
  sucursal: string | null
  confianza: 'alta' | 'baja' | 'ninguna'
}

const SUCURSALES: Record<string, string[]> = {
  'Norte': ['norte', 'norte de la ciudad', 'zona norte'],
  'Centro': ['centro', 'centro de la ciudad', 'zona centro', 'céntro', 'el centro'],
  'Sur': ['sur', 'zona sur'],
  'Apizaco': ['apizaco', 'apizaco sucursal'],
}

const PALABRAS_GENERICAS = /\b(recoger|recojo|paso|pasare|pasaré|sucursal|local|tienda|voy|ir|llego|llegar)\b/i

export function parseSucursal(texto: string): SucursalParseada {
  const textoLower = texto.toLowerCase()

  for (const [nombre, keywords] of Object.entries(SUCURSALES)) {
    for (const kw of keywords) {
      if (textoLower.includes(kw)) {
        return { sucursal: nombre, confianza: 'alta' }
      }
    }
  }

  if (PALABRAS_GENERICAS.test(texto)) {
    return { sucursal: null, confianza: 'baja' }
  }

  return { sucursal: null, confianza: 'ninguna' }
}

export function extraerSucursal(texto: string): string | null {
  const r = parseSucursal(texto)
  return r.confianza === 'alta' ? r.sucursal : null
}
