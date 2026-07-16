import { detectarCancelacion } from '../decision/intent-detector'
import type { ClasificacionConversacion } from '../../lib/ai'

export interface EvaluacionCancelacion {
  detectada: boolean
  descartadaPorIA: boolean
  instruccion: string
}

const INSTRUCCION =
  'Responde con empatía. Di que notificarás al equipo. ' +
  'NO prometas reembolsos ni descuentos. El sistema notificará automáticamente al administrador.'

export function evaluarCancelacion(
  texto: string,
  clasificacionIA: ClasificacionConversacion
): EvaluacionCancelacion {
  const detectada =
    detectarCancelacion(texto) ||
    (clasificacionIA.intencion === 'cancelacion' && clasificacionIA.confianza >= 0.65)

  const descartadaPorIA =
    detectarCancelacion(texto) &&
    clasificacionIA.confianza >= 0.75 &&
    clasificacionIA.intencion !== 'cancelacion'

  return {
    detectada,
    descartadaPorIA,
    instruccion: detectada && !descartadaPorIA ? INSTRUCCION : '',
  }
}
