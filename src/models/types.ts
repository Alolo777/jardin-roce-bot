export enum EstadoPedido {
  NUEVO = 'NUEVO',
  COTIZANDO = 'COTIZANDO',
  PRECIO_CONFIRMADO = 'PRECIO_CONFIRMADO',
  ESPERANDO_DATOS = 'ESPERANDO_DATOS',
  ESPERANDO_PAGO = 'ESPERANDO_PAGO',
  APARTADO = 'APARTADO',
  EN_PRODUCCION = 'EN_PRODUCCION',
  LISTO = 'LISTO',
  ENTREGADO = 'ENTREGADO',
  ARCHIVADO = 'ARCHIVADO',
  CANCELADO = 'CANCELADO',
  QUEJA = 'QUEJA',
  POSTVENTA = 'POSTVENTA',
}

export enum EstadoCaso {
  ACTIVO = 'ACTIVO',
  ARCHIVADO = 'ARCHIVADO',
}

export enum TipoCaso {
  COTIZACION = 'COTIZACION',
  PEDIDO = 'PEDIDO',
  DUDA = 'DUDA',
  QUEJA = 'QUEJA',
  POSTVENTA = 'POSTVENTA',
  INFORMACION = 'INFORMACION',
}

export enum Intencion {
  SALUDO = 'SALUDO',
  DESPEDIDA = 'DESPEDIDA',
  CATALOGO = 'CATALOGO',
  FOTOS = 'FOTOS',
  PRECIO = 'PRECIO',
  COTIZACION = 'COTIZACION',
  PERSONALIZADO = 'PERSONALIZADO',
  PEDIDO = 'PEDIDO',
  PAGO = 'PAGO',
  COMPROBANTE = 'COMPROBANTE',
  TRANSFERENCIA = 'TRANSFERENCIA',
  UBICACION = 'UBICACION',
  HORARIOS = 'HORARIOS',
  ENVIO = 'ENVIO',
  RECOGER = 'RECOGER',
  CAMBIO = 'CAMBIO',
  CANCELACION = 'CANCELACION',
  QUEJA = 'QUEJA',
  HUMANO = 'HUMANO',
  POSTVENTA = 'POSTVENTA',
  OTRO = 'OTRO',
}

export enum Prioridad {
  BAJA = 'baja',
  MEDIA = 'media',
  ALTA = 'alta',
  CRITICA = 'critica',
}

export interface ArregloInfo {
  nombre: string
  precio: number
  id?: string
}

export interface EnvioInfo {
  zona: string
  precio: number
}

export interface PedidoExtra {
  nombre: string
  precio: number
}

export interface PedidoActual {
  id?: string
  estado?: EstadoPedido
  estadoFlujo?: string
  telefono?: string
  nombre?: string
  arreglo?: ArregloInfo
  productoPersonalizado?: string
  precioPersonalizado?: number
  extras?: PedidoExtra[]
  envio?: EnvioInfo
  direccion?: string
  sucursal?: string
  fechaEntrega?: string
  horaEntrega?: string
  metodoPago?: 'transferencia' | 'efectivo_recoger' | 'tarjeta_recoger' | string
  nota?: string
  detallesEspeciales?: string
  fotoReferenciaBase64?: string
  fotoReferenciaMimetype?: string
  fotoReferenciaCaption?: string
  fotoReferenciaRecibidaEn?: string
  esperandoPrecioEnvio?: boolean
  precioConfirmadoPor?: 'equipo' | 'ia' | 'cliente' | 'manual'
  cerradoEn?: string
  creadoEn?: string
  actualizadoEn?: string
}

export interface Caso {
  id: string
  clienteId: string
  telefono: string
  tipo: TipoCaso
  estado: EstadoCaso
  prioridad: Prioridad
  pedidoId?: string
  cotizacionId?: string
  responsable?: string
  creadoEn: string
  ultimaActividad: string
  archivadoEn?: string
}

export interface Cotizacion {
  id: string
  casoId: string
  telefono: string
  productos?: string
  presupuesto?: number
  respuesta?: string
  creadoEn: string
  archivadaEn?: string
}
