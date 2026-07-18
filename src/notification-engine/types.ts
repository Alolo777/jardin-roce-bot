import type { EventType, EventPayload } from '../events/types'
import type { Caso, PedidoActual } from '../models/types'

export interface CampoTimeline {
  valor: string | number | null
  fuente: 'db' | 'evento' | 'memoria' | 'desconocida'
  confianza: number
  timestamp: string | null
}

export interface TimelineData {
  telefono: string
  clienteId: string | null
  caso: Caso | null
  pedido: PedidoActual | null
  historial: { rol: string; contenido: string; creadoEn: string }[]
  ultimaActividad: string | null
  estadoActual: string | null
  existePedidoActivo: boolean
  pedidoCanceladoOArchivado: boolean
}

export interface CampoExtraido {
  valor: string | number | null
  confianza: number
  fuente: 'evento' | 'timeline' | 'parser'
  advertencia?: string
}

export interface DatosExtraidos {
  tipoEvento: EventType
  prioridad: 'baja' | 'media' | 'alta' | 'critica'
  requiereRevision: boolean
  razonRevision: string | null
  campos: {
    nombre: CampoExtraido
    sucursal: CampoExtraido
    fecha: CampoExtraido
    hora: CampoExtraido
    precio: CampoExtraido
    producto: CampoExtraido
    estado: CampoExtraido
    metodoPago: CampoExtraido
    telefono: CampoExtraido
  }
  payloadRaw: EventPayload
}

export interface Conflicto {
  campo: string
  tipo: 'ESTADO' | 'FECHA' | 'HORA' | 'SUCURSAL' | 'PRECIO' | 'PRODUCTO' | 'NOMBRE' | 'PAGO' | 'BLOQUEO'
  descripcion: string
  valorEvento: string
  valorTimeline: string
  severity: 'error' | 'warning'
}

export type AccionNotificacion = 'NOTIFICAR' | 'ALERTA' | 'BLOQUEAR'

export interface ResultadoDeteccion {
  ok: boolean
  accion: AccionNotificacion
  conflictos: Conflicto[]
  razonBloqueo: string | null
}

export type EstadoNotificacion = 'pendiente' | 'enviando' | 'enviada' | 'fallo' | 'bloqueada'

export interface DatosVerificados {
  nombre: string | null
  sucursal: string | null
  fecha: string | null
  hora: string | null
  precio: number | null
  producto: string | null
  estado: string | null
  metodoPago: string | null
  telefono: string
  pedidoId: string | null
  casoId: string | null
  prioridad: 'baja' | 'media' | 'alta' | 'critica'
  requiereRevision: boolean
  razonRevision: string | null
  advertencias: string[]
}


