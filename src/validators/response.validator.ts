import { obtenerTextoCuenta } from './pago.validator'
import { SUCURSALES_INFO } from './sucursal.validator'
import { obtenerPreciosReferencia, obtenerHorarios, obtenerPrecios } from '../config/configuracion.service'
import { obtenerInventarioDisponible } from '../config/inventario.service'
import { normalizarTexto } from '../conversation/conversation.service'
import type { ProductoDetalle } from '../models/types'
import { ahoraCdmx } from '../whatsapp/message-utils'

interface ValidationResult {
  valido: boolean
  razon?: string
}

const PRECIO_REGEX = /\$\s*\d+(?:[.,]\d+)?/g
const HORA_REGEX = /\b(\d{1,2}):(\d{2})\s*(am|pm|hrs|horas)?\b/i

// Convierte cada hora mencionada a HH:MM en reloj de 24 h. Respeta el meridiano
// (am/pm) para que "3:00 pm" no se interprete como 3:00 AM al comparar contra
// apertura/cierre (BUG-022).
function extraerHoras(texto: string): string[] {
  const horas: string[] = []
  let match: RegExpExecArray | null
  const re = new RegExp(HORA_REGEX.source, 'gi')
  while ((match = re.exec(texto)) !== null) {
    let h = Number(match[1])
    const m = Number(match[2])
    const meridiem = (match[3] || '').toLowerCase()
    if (meridiem === 'pm' && h < 12) h += 12
    else if (meridiem === 'am' && h === 12) h = 0
    horas.push(`00${h}:${match[2]}`.slice(-5))
  }
  return horas
}

function extraerPrecios(texto: string): number[] {
  const precios: number[] = []
  let match: RegExpExecArray | null
  const re = new RegExp(PRECIO_REGEX.source, 'gi')
  while ((match = re.exec(texto)) !== null) {
    const num = parseFloat(match[0].replace(/[$,]/g, ''))
    if (!isNaN(num)) precios.push(num)
  }
  return precios
}

const FRASES_CONFIRMACION_INVENTARIO = [
  /\bs[ií],?\s+tenemos\b/i,
  /\blo tenemos disponible\b/i,
  /\bs[ií],?\s+hay\b/i,
  /\bhay\s+existencia\b/i,
  /\btenemos\s+(en\s+)?stock\b/i,
  /\bcontamos\s+con\b/i,
  /\bs[ií],?\s+se\s+puede\b/i,
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
  /\bs[ií],?\s+(podemos|alcanzamos|nos\s+damos\s+tiempo)\b/i,
  /\bs[ií],?\s+est[aá]\s+a\s+tiempo\b/i,
  /\blo\s+tenemos?\s+(?:a\s+las|para\s+las)\b/i,
]

const PRECIO_FLORES_REFERENCIA: Record<string, number> = obtenerPreciosReferencia()

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

// ──────────────────────────────────────────────────────────────────
// Módulo 4.2: validaciones adicionales para evitar alucinaciones.
// ──────────────────────────────────────────────────────────────────

const PRECIO_INVENTADO_MIN = 100

function preciosAutorizados(contexto: string): Set<number> {
  const set = new Set<number>(extraerPrecios(contexto))
  for (const p of Object.values(PRECIO_FLORES_REFERENCIA)) set.add(p)
  const precios = obtenerPrecios()
  if (precios.precioMinimo > 0) set.add(precios.precioMinimo)
  return set
}

function validarPreciosRespuesta(respuesta: string, contexto: string): string | null {
  const precios = extraerPrecios(respuesta)
  if (precios.length === 0) return null

  const autorizados = preciosAutorizados(contexto)
  const lista = [...autorizados]
  const esDerivado = (p: number): boolean => {
    for (const a of lista) {
      for (const b of lista) {
        if (a + b === p || Math.abs(a + b - p) <= 1) return true
      }
    }
    return false
  }

  for (const precio of precios) {
    if (precio <= PRECIO_INVENTADO_MIN) continue
    if (autorizados.has(precio)) continue
    if (esDerivado(precio)) continue
    return `Precio $${precio} no verificado en contexto (posible alucinación)`
  }
  return null
}

function validarSucursalRespuesta(respuesta: string): string | null {
  const nombres = Object.keys(SUCURSALES_INFO)
  const mencionadas: string[] = []
  const re = /\bsucursal(?:es)?\s+(?:de\s+|en\s+)?([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(respuesta)) !== null) {
    mencionadas.push(match[1])
  }
  for (const m of mencionadas) {
    if (!nombres.some(n => n.toLowerCase() === m.toLowerCase())) {
      return `Sucursal no reconocida: ${m}`
    }
  }
  return null
}

function validarEntregaFecha(respuesta: string, contexto: string): string | null {
  const match = respuesta.match(/\b(?:se\s+entrega|entregamos|est[aá]r[aá]\s+listo)\s+(?:el\s+)?(\d{1,2}(?:\s+de\s+[a-záéíóúñ]+)?|hoy|mañana)\b/i)
  if (!match) return null
  const fecha = match[1].toLowerCase()
  if (!contexto.toLowerCase().includes(fecha)) {
    return `Confirmó entrega para "${match[1]}" sin respaldo en el contexto`
  }
  return null
}

const STOPWORDS_NOMBRE = new Set(['ramo', 'ramos', 'de', 'las', 'los', 'del', 'la', 'el', 'con', 'en', 'un', 'una', 'para'])

export function esProductoMencionado(respuesta: string, inventario: ProductoDetalle[]): boolean {
  const tokens = new Set(singularizarTodo(normalizarTexto(respuesta)).split(/\s+/).filter(t => t.length >= 4 && !STOPWORDS_NOMBRE.has(t)))
  if (tokens.size === 0) return false
  return inventario.some((p) => {
    const nombreTokens = singularizarTodo(normalizarTexto(p.nombre)).split(/\s+/).filter(t => t.length >= 4 && !STOPWORDS_NOMBRE.has(t))
    return nombreTokens.some(t => tokens.has(t))
  })
}

function singularizar(palabra: string): string {
  if (palabra.endsWith('es') && palabra.length > 4) return palabra.slice(0, -2)
  if (palabra.endsWith('s') && palabra.length > 3) return palabra.slice(0, -1)
  return palabra
}

function singularizarTodo(texto: string): string {
  return texto.split(/\s+/).map(singularizar).join(' ')
}

function mencionaProductoDisponible(respuesta: string): boolean {
  return esProductoMencionado(respuesta, obtenerInventarioDisponible())
}

export function validarRespuestaIA(respuesta: string, contexto: string): ValidationResult {
  const textoLower = respuesta.toLowerCase()

  const horasMencionadas = extraerHoras(respuesta)
  if (horasMencionadas.length > 0) {
    const horarios = obtenerHorarios()
    const aperturaMin = horarios.apertura * 60
    const cierreMinSemana = horarios.cierreSemana * 60
    const cierreMinFinSemana = horarios.cierreFinSemana * 60
    for (const hora of horasMencionadas) {
      const [h, m] = hora.split(':').map(Number)
      if (isNaN(h)) continue
      const minutos = h * 60 + (m || 0)
      const esFinde = [0, 6].includes(ahoraCdmx().dia)
      const cierreMin = esFinde ? cierreMinFinSemana : cierreMinSemana

      if (minutos < aperturaMin || minutos >= cierreMin) {
        for (const frase of FRASES_CONFIRMACION_HORARIO) {
          if (frase.test(respuesta)) {
            return { valido: false, razon: `El LLM confirmó horario (${hora}) fuera del horario de atención (${horarios.apertura}:00-${Math.floor(cierreMin / 60)}:00)` }
          }
        }
      }
    }
  }

  for (const frase of FRASES_CONFIRMACION_INVENTARIO) {
    if (frase.test(textoLower)) {
      if (!mencionaProductoDisponible(respuesta)) {
        return { valido: false, razon: 'El LLM confirmó disponibilidad de inventario sin respaldo del backend' }
      }
    }
  }

  for (const frase of FRASES_CONFIRMACION_ENTREGA) {
    if (frase.test(textoLower)) {
      return { valido: false, razon: 'El LLM confirmó entrega o producción sin respaldo del backend' }
    }
  }

  const errorEntregaFecha = validarEntregaFecha(respuesta, contexto)
  if (errorEntregaFecha) {
    return { valido: false, razon: errorEntregaFecha }
  }

  const errorPrecio = validarPreciosRespuesta(respuesta, contexto)
  if (errorPrecio) {
    return { valido: false, razon: errorPrecio }
  }

  const errorSucursal = validarSucursalRespuesta(respuesta)
  if (errorSucursal) {
    return { valido: false, razon: errorSucursal }
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

// Anotaciones internas del historial que `formatearHistorialConFechas`
// (lib/ai.ts) agrega a cada mensaje y que el LLM puede imitar dentro de su
// respuesta: `[dd/mm/yyyy H:MM am] [RESPUESTA DE FLORA]` o `[EQUIPO HUMANO,
// VERIFICADO]`. Nunca deben llegar al cliente.
const MARCA_FECHA_ANOTACION_RE = /\[\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?)\]\s*/gi
const ANOTACION_INTERNA_RE = /\[(?:RESPUESTA DE FLORA|EQUIPO HUMANO, VERIFICADO|ANOTACIÓN DEL SISTEMA)\]\s*/gi

export function sanitizarRespuestaIA(respuesta: string): string {
  let texto = respuesta

  // BUG-021: quitar prefijos de anotación interna del historial que el LLM
  // pueda imitar (ej. "[19/08/2026 8:26 am] [RESPUESTA DE FLORA] ¡Claro!...")
  texto = texto.replace(MARCA_FECHA_ANOTACION_RE, '')
  texto = texto.replace(ANOTACION_INTERNA_RE, '')

  texto = texto.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$2')
  texto = texto.replace(/\[([^\]]*)\]\(([^)]+)\)/g, '$2')
  texto = texto.replace(/https:\/\/[^\s]+supabase\.co\/storage\/[^\s]*/gi, '')
  texto = texto.replace(/\[(?:CLIENTE|CONTEXTO|INSTRUCCION|ARREGLO|TODOS|EXPRESIÓN|POSIBLE)[^\]]*\]\n?/gi, '')
  texto = texto.replace(/\n{3,}/g, '\n\n')
  texto = texto.replace(/[ \t]{2,}/g, ' ')

  return texto.trim()
}
