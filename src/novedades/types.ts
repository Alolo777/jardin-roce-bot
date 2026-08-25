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
  // DEC-086: estado breve de TODOS los chats analizados (incluso cerrados),
  // para que el admin vea qué se hablo en cada conversación.
  estadosChats?: EstadoChatDia[]
  // DEC-088: análisis profundo por conversación (opcional, corrida posterior)
  profundo?: AnalisisProfundo
}

// Resumen de una conversación analizada (aunque no tenga novedad)
export interface EstadoChatDia {
  telefono: string
  cliente?: string
  // Qué se hablo y en qué quedó (máx ~100 caracteres)
  estado: string
}

// DEC-088: análisis PROFUNDO por conversación (1 llamada IA por chat,
// espaciadas 15–25 s). Vive dentro del digest como `profundo`.
export interface DetalleChatDia {
  telefono: string
  categoria: string // venta_cerrada | cotizacion | pedido_en_proceso | duda | queja | postventa | saludo | otro
  resumen: string // 2–4 líneas detalladas
  puntosClave: string[]
  requiereRevision: boolean
  motivoRevision?: string
  preguntasAbiertas: string[] // ej: "¿Ya recogió su pedido del sábado 11 am?"
  fechasMencionadas?: string[]
}

export interface AnalisisProfundo {
  generadoEn: string
  tipoVentana: 'dia_anterior' | 'reciente'
  totalChats: number
  // Compuesto sin IA: "10 chats: 4 ventas cerradas, 2 cotizaciones…"
  resumenGlobal: string
  detalleChats: DetalleChatDia[]
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
