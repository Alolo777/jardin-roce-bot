export interface FechaParseada {
  texto: string
  tipo: 'relativo' | 'dia_semana' | 'fecha_especifica' | 'no_detectada'
}

const DIAS = /lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo/i
const FECHA_NUMERICA = /\b(\d{1,2})\s*de\s+([a-záéíóúñ]+)\b/i
const RELATIVOS = /\b(hoy|ma[ñn]ana|pasado\s+ma[ñn]ana|este\s+fin\s+de\s+semana|esta\s+semana|la\s+pr[oó]xima\s+semana)\b/i

export function parseFecha(texto: string): FechaParseada {
  const relativo = texto.match(RELATIVOS)
  if (relativo) return { texto: relativo[0].trim(), tipo: 'relativo' }

  const dia = texto.match(DIAS)
  if (dia) return { texto: dia[0].trim(), tipo: 'dia_semana' }

  const fecha = texto.match(FECHA_NUMERICA)
  if (fecha) return { texto: fecha[0].trim(), tipo: 'fecha_especifica' }

  return { texto: '', tipo: 'no_detectada' }
}

export function extraerFecha(texto: string): string | null {
  const r = parseFecha(texto)
  return r.tipo !== 'no_detectada' ? r.texto : null
}
