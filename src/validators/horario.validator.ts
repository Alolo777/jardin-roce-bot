import { ahoraCdmx, estaEnHorario } from '../whatsapp/message-utils'
import { obtenerHorarios, HORARIOS_DEFAULT } from '../config/configuracion.service'

export const HORARIO_APERTURA = HORARIOS_DEFAULT.apertura
export const HORARIO_CIERRE_SEMANA = HORARIOS_DEFAULT.cierreSemana
export const HORARIO_CIERRE_FIN_SEMANA = HORARIOS_DEFAULT.cierreFinSemana

export interface InfoHorario {
  abierto: boolean
  horaActual: string
  horaApertura: number
  horaCierre: number
  mensajeBackend: string
}

export function validarHorario(): InfoHorario {
  const ahora = ahoraCdmx()
  const horarios = obtenerHorarios()
  const esFinDeSemana = ahora.dia === 0 || ahora.dia === 6
  const horaCierre = esFinDeSemana ? horarios.cierreFinSemana : horarios.cierreSemana
  const abierto = estaEnHorario()

  let mensajeBackend: string
  if (abierto) {
    mensajeBackend = `Hora actual CDMX: ${ahora.etiqueta}. Estamos abiertos (cierre: ${horaCierre}:00).`
  } else if (ahora.hora < horarios.apertura) {
    mensajeBackend = `Hora actual CDMX: ${ahora.etiqueta}. Abrimos a las ${horarios.apertura}:00.`
  } else {
    mensajeBackend = `Hora actual CDMX: ${ahora.etiqueta}. Cerramos a las ${horaCierre}:00, abrimos mañana a las ${horarios.apertura}:00.`
  }

  return { abierto, horaActual: ahora.etiqueta, horaApertura: horarios.apertura, horaCierre, mensajeBackend }
}

export function esHorarioAnticipado(hora: string): boolean {
  const match = hora.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i)
  if (!match) return false
  let h = parseInt(match[1], 10)
  const ampm = (match[3] || '').toLowerCase().replace(/\./g, '')
  if (ampm === 'pm' && h < 12) h += 12
  if (ampm === 'am' && h === 12) h = 0
  return h < obtenerHorarios().apertura
}

// BUG-006: horario de HOY y MAÑANA calculado en codigo (backend), no por el LLM.
// Devuelve el texto a inyectar como anotacion de sistema confiable.
// L-V: {cierreSemana} | S-D: {cierreFinSemana}.
const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

function cerrarDe(dia: number): number {
  const horarios = obtenerHorarios()
  return dia === 0 || dia === 6 ? horarios.cierreFinSemana : horarios.cierreSemana
}

export function horarioHoyManana(): { hoy: string; manana: string } {
  const ahora = ahoraCdmx()
  const horarios = obtenerHorarios()
  const nombreHoy = DIAS_SEMANA[ahora.dia] ?? 'hoy'
  const mananaDia = (ahora.dia + 1) % 7
  const nombreManana = DIAS_SEMANA[mananaDia] ?? 'mañana'

  const hoy = `${nombreHoy.charAt(0).toUpperCase() + nombreHoy.slice(1)}: ${horarios.apertura}:00 a ${cerrarDe(ahora.dia)}:00`
  const manana = `${nombreManana.charAt(0).toUpperCase() + nombreManana.slice(1)}: ${horarios.apertura}:00 a ${cerrarDe(mananaDia)}:00`

  return { hoy, manana }
}
