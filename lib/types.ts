export interface ArregloDiario {
  id: string
  nombre: string
  descripcion: string | null
  precio: number
  foto_url: string
  estado: 'disponible' | 'apartado' | 'vendido'
  creado_en: string
  actualizado_en: string
}

export interface VentaCerrada {
  cliente: string
  producto: string
  total: string
  direccion: string
  rawToken: string
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
  mensaje: string               // Texto limpio para enviar al cliente
  ventaCerrada: VentaCerrada | null  // Datos de venta si se detectó el token
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
  ultimaActividad: string | null
  ventasHoy: number
  clientesAtendidosHoy: number
  version: string
}