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

export interface AIResponse {
  mensaje: string               // Texto limpio para enviar al cliente
  ventaCerrada: VentaCerrada | null  // Datos de venta si se detectó el token
}