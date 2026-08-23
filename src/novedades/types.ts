// src/novedades/types.ts
// Motor de Novedades — detección diaria de temas pendientes por chat
// para el panel de administradores (DEC-084).

// Tipos oficiales de novedad. El backend decide la categoría; el LLM
// únicamente clasifica dentro de estas opciones y redacta el resumen.
export enum TipoNovedad {
  COTIZACION_PENDIENTE = 'cotizacion_pendiente',
  PEDIDO_SIN_TRATAR = 'pedido_sin_tratar',
  CAMBIO_FECHA = 'cambio_fecha',
  MODIFICACION_ARREGLO = 'modificacion_arreglo',
  PAGO_PENDIENTE = 'pago_pendiente',
  ENTREGA_PROGRAMADA = 'entrega_programada',
  ESPERANDO_RESPUESTA_EQUIPO = 'esperando_respuesta_equipo',
  DUDA_SIN_RESPONDER = 'duda_sin_responder',
  QUEJA = 'queja',
  OTRO = 'otro',
}

export type PrioridadNovedad = 'baja' | 'media' | 'alta'

export interface Novedad {
  // Teléfono normalizado del cliente (+52...)
  telefono: string
  // Nombre si se conoce (pedido/caso); opcional
  cliente?: string
  tipo: TipoNovedad
  // Resumen breve en lenguaje natural (máx ~140 caracteres)
  resumen: string
  prioridad: PrioridadNovedad
  // 'reglas' = detectado por señales de la base de datos (sin LLM)
  // 'ia' = extraído del análisis diario de conversaciones
  fuente: 'reglas' | 'ia'
}

export interface NovedadesDiarias {
  // Fecha CDMX (YYYY-MM-DD) del día ANALIZADO (el día anterior a la generación)
  fechaAnalizada: string
  // 'dia_anterior' = job automático de las 3 am | 'reciente' = manual, últimas 48 h
  tipoVentana?: 'dia_anterior' | 'reciente'
  // ISO del momento de generación
  generadaEn: string
  novedades: Novedad[]
}

// Entrada compacta de un chat para el análisis IA diario
export interface TranscripcionChat {
  telefono: string
  lineas: string[]
}

// Resultado crudo que devuelve el LLM por chat
export interface NovedadIA {
  telefono: string
  tipo: string
  resumen: string
  prioridad?: string
}
