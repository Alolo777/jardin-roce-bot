import { detectarQueja } from '../decision/intent-detector'

export interface EvaluacionQueja {
  detectada: boolean
  instruccion: string
}

const INSTRUCCION =
  'Responde con empatía. Pide disculpas y di que lo reportas al equipo. ' +
  'NO ofrezcas compensaciones ni descuentos. El sistema notificará automáticamente.'

export function evaluarQueja(
  texto: string
): EvaluacionQueja {
  const detectada = detectarQueja(texto)

  return {
    detectada,
    instruccion: detectada ? INSTRUCCION : '',
  }
}
