import { detectarCancelacion } from '../decision/intent-detector'

export interface EvaluacionCancelacion {
  detectada: boolean
  instruccion: string
}

const INSTRUCCION =
  'Responde con empatía. Di que notificarás al equipo. ' +
  'NO prometas reembolsos ni descuentos. El sistema notificará automáticamente al administrador.'

export function evaluarCancelacion(
  texto: string
): EvaluacionCancelacion {
  const detectada = detectarCancelacion(texto)

  return {
    detectada,
    instruccion: detectada ? INSTRUCCION : '',
  }
}
