const PRECIO_TOTAL = /\b(?:total|saldr[ií]a|ser[ií]a|est[aá](?:r[ií]a)?(?:\s+en)?|queda(?:r[ií]a)?(?:\s+en)?|qued[óo](?:\s+en)?|quedan|precio|son|sale|salen|cuesta|cuestan|costar[ií]a|costo|aprox(?:imadamente)?)\b[^$\d]{0,40}\$?\s*(\d{2,6}(?:[,.]\d{2})?)/i
const PRECIO_MONEDA = /\$\s*(\d{2,6}(?:[,.]\d{2})?)/
const PRECIO_MONEDA_DESPUES = /\b(\d{2,6}(?:[,.]\d{2})?)\s*(?:\$|mxn|pesos?)\b/i
const PRECIO_SOLO_NUMERO = /^\s*(?:\$|mxn|pesos?\s*)?(\d{2,6}(?:[,.]\d{2})?)\s*(?:\$|mxn|pesos?)?\.?\s*$/i

export function parsePrecio(texto: string): number | null {
  const matchTotal = texto.match(PRECIO_TOTAL)
  if (matchTotal) return Number(matchTotal[1].replace(/,/g, '')) || null

  const matchMoneda = texto.match(PRECIO_MONEDA)
  if (matchMoneda) return Number(matchMoneda[1].replace(/,/g, '')) || null

  const matchDespues = texto.match(PRECIO_MONEDA_DESPUES)
  if (matchDespues) return Number(matchDespues[1].replace(/,/g, '')) || null

  const matchSolo = texto.match(PRECIO_SOLO_NUMERO)
  if (matchSolo) return Number(matchSolo[1].replace(/,/g, '')) || null

  return null
}

export interface PrecioParseado {
  monto: number | null
  texto: string | null
}
