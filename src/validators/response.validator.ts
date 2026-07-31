import { validarHorario } from './horario.validator'
import { obtenerTextoCuenta } from './pago.validator'
import { validarSucursal } from './sucursal.validator'

interface ValidationResult {
  valido: boolean
  razon?: string
}

const PRECIO_REGEX = /\$\s*\d+(?:[.,]\d+)?/g
const HORA_REGEX = /\b(\d{1,2}):(\d{2})\s*(?:am|pm|hrs|horas)?\b/i

function extraerHoras(texto: string): string[] {
  const horas: string[] = []
  let match: RegExpExecArray | null
  const re = new RegExp(HORA_REGEX.source, 'gi')
  while ((match = re.exec(texto)) !== null) {
    horas.push(`${match[1]}:${match[2]}`)
  }
  return horas
}

function extraerPrecios(texto: string): number[] {
  const precios: number[] = []
  let match: RegExpExecArray | null
  while ((match = PRECIO_REGEX.exec(texto)) !== null) {
    const num = parseFloat(match[0].replace(/[$,]/g, ''))
    if (!isNaN(num)) precios.push(num)
  }
  return precios
}

const FRASES_CONFIRMACION_INVENTARIO = [
  /\bs[ií] tenemos\b/i,
  /\blo tenemos disponible\b/i,
  /\bs[ií] hay\b/i,
  /\bhay\s+existencia\b/i,
  /\btenemos\s+(en\s+)?stock\b/i,
  /\bcontamos\s+con\b/i,
  /\bs[ií]\s+se\s+puede\b/i,
]

const FRASES_CONFIRMACION_PAGO = [
  /\bpago\s+(recibido|confirmado|completado)\b/i,
  /\bya\s+(pag[oó]|liquid[oó]|cubri[oó])\b/i,
  /\bpagaste\s+completo\b/i,
]

const FRASES_CONFIRMACION_ENTREGA = [
  /\b(?:ya\s+)?est[aá]\s+listo\b/i,
  /\bya\s+se\s+entreg[oó]\b/i,
  /\bya\s+lo\s+(entregamos|enviamos|mandamos)\b/i,
]

const FRASES_CONFIRMACION_HORARIO = [
  /\bs[ií]\s+(podemos|alcanzamos|nos\s+damos\s+tiempo)\b/i,
  /\bs[ií]\s+est[aá]\s+a\s+tiempo\b/i,
  /\blo\s+tenemos?\s+(?:a\s+las|para\s+las)\b/i,
]

const PRECIO_FLORES_REFERENCIA: Record<string, number> = {
  'rosa': 25,
  'hortensia': 40,
  'lishianthus': 35,
  'margarita': 20,
  'gerbera': 30,
  'lily': 35,
  'girasol': 35,
  'tulip[aá]n': 40,
  'clavel': 15,
}

export interface PrecioExtraido {
  producto: string
  precio: number
  confianza: 'normal' | 'baja'
}

export function extraerPreciosRespuesta(texto: string): PrecioExtraido[] {
  const encontrados: PrecioExtraido[] = []
  const preciosNumericos = extraerPrecios(texto)
  if (preciosNumericos.length === 0) return encontrados

  const textoLower = texto.toLowerCase()
  for (const [flor, precioRef] of Object.entries(PRECIO_FLORES_REFERENCIA)) {
    const regex = new RegExp(`\\b${flor}[a-z]*\\b`, 'i')
    if (regex.test(textoLower)) {
      const precioMencionado = preciosNumericos.find(p => Math.abs(p - precioRef) <= 5)
      if (!precioMencionado) {
        const preciosCercanos = preciosNumericos.filter(p => Math.abs(p - precioRef) <= 15)
        for (const p of preciosCercanos) {
          encontrados.push({ producto: flor, precio: p, confianza: Math.abs(p - precioRef) <= 5 ? 'normal' : 'baja' })
        }
      }
    }
  }

  return encontrados
}

export function validarRespuestaIA(respuesta: string, contexto: string): ValidationResult {
  const textoLower = respuesta.toLowerCase()

  const horasMencionadas = extraerHoras(respuesta)
  if (horasMencionadas.length > 0) {
    const horarioBackend = validarHorario()
    for (const hora of horasMencionadas) {
      const [h, m] = hora.split(':').map(Number)
      if (isNaN(h)) continue
      const minutos = h * 60 + (m || 0)
      const aperturaMin = 10 * 60
      const cierreMinSemana = 19 * 60
      const cierreMinFinSemana = 17 * 60
      const esFinde = [0, 6].includes(new Date().getDay())
      const cierreMin = esFinde ? cierreMinFinSemana : cierreMinSemana

      if (minutos < aperturaMin || minutos >= cierreMin) {
        for (const frase of FRASES_CONFIRMACION_HORARIO) {
          if (frase.test(respuesta)) {
            return { valido: false, razon: `El LLM confirmó horario (${hora}) fuera del horario de atención (${aperturaMin / 60}:00-${Math.floor(cierreMin / 60)}:00)` }
          }
        }
      }
    }
  }

  for (const frase of FRASES_CONFIRMACION_INVENTARIO) {
    if (frase.test(textoLower)) {
      return { valido: false, razon: 'El LLM confirmó disponibilidad de inventario sin respaldo del backend' }
    }
  }

  for (const frase of FRASES_CONFIRMACION_ENTREGA) {
    if (frase.test(textoLower)) {
      return { valido: false, razon: 'El LLM confirmó entrega o producción sin respaldo del backend' }
    }
  }

  const contextLower = contexto.toLowerCase()
  const hayPagoEnContexto = /\b(transferencia|comprobante|pago|cuenta\s+bbva)\b/i.test(contextLower)
  if (hayPagoEnContexto) {
    for (const frase of FRASES_CONFIRMACION_PAGO) {
      if (frase.test(textoLower)) {
        return { valido: false, razon: 'El LLM confirmó pago sin respaldo del backend' }
      }
    }
  }

  return { valido: true }
}

export function sanitizarRespuestaIA(respuesta: string): string {
  let texto = respuesta

  texto = texto.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$2')
  texto = texto.replace(/\[([^\]]*)\]\(([^)]+)\)/g, '$2')
  texto = texto.replace(/https:\/\/[^\s]+supabase\.co\/storage\/[^\s]*/gi, '')
  texto = texto.replace(/\[(?:CLIENTE|CONTEXTO|INSTRUCCION|ARREGLO|TODOS|EXPRESIÓN|POSIBLE)[^\]]*\]\n?/gi, '')
  texto = texto.replace(/\n{3,}/g, '\n\n')

  return texto.trim()
}
