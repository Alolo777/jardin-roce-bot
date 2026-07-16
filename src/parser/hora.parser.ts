export interface HoraParseada {
  texto: string
  tipo: 'exacta' | 'periodo' | 'no_detectada'
}

const HORA_EXACTA = /\b(a\s+las\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i
const PERIODOS = /\b(en\s+la\s+ma[ñn]ana|por\s+la\s+ma[ñn]ana|temprano|al\s+abrir|en\s+la\s+tarde|por\s+la\s+tarde|mediod[ií]a|al\s+mediod[ií]a|en\s+la\s+noche|por\s+la\s+noche|al\s+anochecer)\b/i

export function parseHora(texto: string): HoraParseada {
  const match = texto.match(HORA_EXACTA)
  if (match) {
    const hora = match[2]
    const minutos = match[3] || '00'
    const ampm = (match[4] || '').toLowerCase()
    const textoHora = ampm ? `${hora}:${minutos} ${ampm}` : `${hora}:${minutos}`
    return { texto: textoHora, tipo: 'exacta' }
  }

  const periodo = texto.match(PERIODOS)
  if (periodo) return { texto: periodo[0].trim(), tipo: 'periodo' }

  return { texto: '', tipo: 'no_detectada' }
}

export function extraerHora(texto: string): string | null {
  const r = parseHora(texto)
  return r.tipo !== 'no_detectada' ? r.texto : null
}
