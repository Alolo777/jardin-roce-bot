export interface VentaCerrada {
  cliente: string
  producto: string
  total: string
  direccion: string
  rawToken?: string
}

export interface ZonaEnvio {
  id: string
  zona: string
  precio: number
  palabras_clave: string
  creado_en: string
}

export interface MunicipioEnvio {
  id: string
  municipio: string
  codigo_postal: string
  colonia: string | null
  zona: string
  precio_envio: number
  creado_en: string
}

export interface NumeroIgnorado {
  id: string
  numero: string
  descripcion: string | null
  creado_en: string
}

export interface AIResponse {
  mensaje: string
}

export interface HistorialPrompt {
  id: string
  prompt_anterior: string
  prompt_nuevo: string
  editado_por: string
  creado_en: string
}

export interface Reclamacion {
  id: string
  cliente_telefono: string
  tipo: 'cancelacion' | 'queja' | 'devolucion' | 'otro'
  descripcion: string
  arreglo_referencia: string | null
  estado: 'pendiente' | 'en_proceso' | 'resuelto'
  creado_en: string
  actualizado_en: string
}

export interface ReporteVenta {
  id: string
  cliente_telefono: string | null
  cliente_nombre: string | null
  producto: string
  precio_total: number
  direccion_entrega: string | null
  metodo_pago: string | null
  estado: 'pagado' | 'entregado' | 'cancelado'
  creado_en: string
}

export interface BotStatusFull {
  pausado: boolean
  connected: boolean
  estado?: string
  estadoDetalle?: string
  reconnecting?: boolean
  qr?: string | null
  qrGeneradoEn?: string | null
  qrAgeSeconds?: number | null
  qrExpiresInSeconds?: number | null
  qrScanGraceSeconds?: number | null
  qrVencido?: boolean
  ultimaActividad: string | null
  ventasHoy: number
  totalVentasHoy?: number
  clientesAtendidosHoy: number
  version?: string
}

export interface PedidoBot {
  id: string
  cliente_id: string
  telefono: string | null
  estado: 'cotizacion' | 'apartado' | 'pagado' | 'entregado' | 'cancelado'
  cliente_nombre: string | null
  producto: string | null
  arreglo_id: string | null
  precio_arreglo: number | null
  zona_envio: string | null
  precio_envio: number | null
  direccion: string | null
  sucursal: string | null
  metodo_pago: string | null
  nota: string | null
  total: number | null
  ultimo_mensaje: string | null
  requiere_revision: boolean
  creado_en: string
  actualizado_en: string
}
