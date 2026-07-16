import { detectarQueja } from '../decision/intent-detector'
import type { ClasificacionConversacion } from '../../lib/ai'

export interface EvaluacionQueja {
  detectada: boolean
  descartadaPorIA: boolean
  instruccion: string
}

const INSTRUCCION =
  'Responde con empatía. Pide disculpas y di que lo reportas al equipo. ' +
  'NO ofrezcas compensaciones ni descuentos. El sistema notificará automáticamente.'

export function evaluarQueja(
  texto: string,
  clasificacionIA: ClasificacionConversacion
): EvaluacionQueja {
  const detectada =
    detectarQueja(texto) ||
    (clasificacionIA.intencion === 'queja' && clasificacionIA.confianza >= 0.65)

  const descartadaPorIA =
    detectarQueja(texto) &&
    clasificacionIA.confianza >= 0.75 &&
    clasificacionIA.intencion !== 'queja'

  return {
    detectada,
    descartadaPorIA,
    instruccion: detectada && !descartadaPorIA ? INSTRUCCION : '',
  }
}
