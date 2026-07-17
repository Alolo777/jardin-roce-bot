import { ahoraCdmx, estaEnHorario } from '../whatsapp/message-utils'

export const HORARIO_APERTURA = 10
export const HORARIO_CIERRE_SEMANA = 19
export const HORARIO_CIERRE_FIN_SEMANA = 17

export interface InfoHorario {
  abierto: boolean
  horaActual: string
  horaApertura: number
  horaCierre: number
  mensajeBackend: string
}

export function validarHorario(): InfoHorario {
  const ahora = ahoraCdmx()
  const esFinDeSemana = ahora.dia === 0 || ahora.dia === 6
  const horaCierre = esFinDeSemana ? HORARIO_CIERRE_FIN_SEMANA : HORARIO_CIERRE_SEMANA
  const abierto = estaEnHorario()

  let mensajeBackend: string
  if (abierto) {
    mensajeBackend = `Hora actual CDMX: ${ahora.etiqueta}. Estamos abiertos (cierre: ${horaCierre}:00).`
  } else if (ahora.hora < HORARIO_APERTURA) {
    mensajeBackend = `Hora actual CDMX: ${ahora.etiqueta}. Abrimos a las ${HORARIO_APERTURA}:00.`
  } else {
    mensajeBackend = `Hora actual CDMX: ${ahora.etiqueta}. Cerramos a las ${horaCierre}:00, abrimos mañana a las ${HORARIO_APERTURA}:00.`
  }

  return { abierto, horaActual: ahora.etiqueta, horaApertura: HORARIO_APERTURA, horaCierre, mensajeBackend }
}

export function esHorarioAnticipado(hora: string): boolean {
  const match = hora.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i)
  if (!match) return false
  let h = parseInt(match[1], 10)
  const ampm = (match[3] || '').toLowerCase().replace(/\./g, '')
  if (ampm === 'pm' && h < 12) h += 12
  if (ampm === 'am' && h === 12) h = 0
  return h < HORARIO_APERTURA
}
