// ════════════════════════════════════════════════════════════════
// ENUMS
// ════════════════════════════════════════════════════════════════

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

export enum MetodoPago {
  TRANSFERENCIA = 'transferencia',
  EFECTIVO_RECOGER = 'efectivo_recoger',
  TARJETA_RECOGER = 'tarjeta_recoger',
  PENDIENTE = 'pendiente',
}

export enum EstadoFlujo {
  COTIZANDO = 'cotizando',
  PRECIO_CONFIRMADO = 'precio_confirmado',
  ESPERANDO_PRECIO_EQUIPO = 'esperando_precio_equipo',
  ESPERANDO_FECHA_HORA = 'esperando_fecha_hora',
  ESPERANDO_DATOS = 'esperando_datos',
  ESPERANDO_NOMBRE = 'esperando_nombre',
  ESPERANDO_PAGO = 'esperando_pago',
  ESPERANDO_ENTREGA = 'esperando_entrega',
  APARTADO_SUCURSAL = 'apartado_sucursal',
  PAGADO_TRANSFERENCIA = 'pagado_transferencia',
  CERRADO = 'cerrado',
  CANCELADO = 'cancelado',
}

export enum TipoEnvio {
  DOMICILIO = 'domicilio',
  SUCURSAL = 'sucursal',
}

export enum FuenteConfirmacionPrecio {
  EQUIPO = 'equipo',
  IA = 'ia',
  CLIENTE = 'cliente',
  MANUAL = 'manual',
}

export enum EstadoReclamacion {
  PENDIENTE = 'pendiente',
  EN_PROCESO = 'en_proceso',
  RESUELTO = 'resuelto',
}

export enum TipoReclamacion {
  CANCELACION = 'cancelacion',
  QUEJA = 'queja',
  DEVOLUCION = 'devolucion',
  OTRO = 'otro',
}

// ════════════════════════════════════════════════════════════════
// INTERFACES EXISTENTES
// ════════════════════════════════════════════════════════════════

export interface ArregloInfo {
  nombre: string
  precio: number
  id?: string
  categoria?: string
  descripcion?: string
  imagenUrl?: string
  disponible?: boolean
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
  sucursal_por_confirmar?: boolean
  fechaEntrega?: string
  horaEntrega?: string
  metodoPago?: MetodoPago | string
  nota?: string
  detallesEspeciales?: string
  fotoReferenciaBase64?: string
  fotoReferenciaMimetype?: string
  fotoReferenciaCaption?: string
  fotoReferenciaRecibidaEn?: string
  esperandoPrecioEnvio?: boolean
  precioConfirmadoPor?: FuenteConfirmacionPrecio | string
  casoId?: string
  transiciones?: TransicionEstado[]
  cerradoEn?: string
  creadoEn?: string
  actualizadoEn?: string
}

export interface PedidoResumenDTO {
  id: string
  clienteId: string
  telefono?: string
  nombre?: string
  estado?: string
  estadoFlujo?: string
  producto?: string
  precio?: number | null
  precioConfirmadoPor?: string
  sucursal?: string
  direccion?: string
  fechaEntrega?: string
  horaEntrega?: string
  metodoPago?: string
  nota?: string
  extras?: PedidoExtra[]
  tieneFotoReferencia: boolean
  requiereAtencionEquipo?: boolean
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

// ════════════════════════════════════════════════════════════════
// NUEVAS INTERFACES — FASE 2: MODELO DE DATOS
// ════════════════════════════════════════════════════════════════

export interface Sucursal {
  id: string
  nombre: string
  direccion: string
  telefono: string
  horario: string
  latitud?: number
  longitud?: number
  mapsUrl?: string
  activa: boolean
}

export interface Direccion {
  calle: string
  numero?: string
  colonia: string
  municipio: string
  estado: string
  codigoPostal: string
  referencia?: string
  coordenadas?: { lat: number; lng: number }
}

export interface Funcionario {
  id: string
  nombre: string
  telefono: string
  rol: 'admin' | 'vendedor' | 'diseniador' | 'delivery'
  activo: boolean
  creadoEn: string
}

export interface ProductoDetalle {
  id: string
  nombre: string
  precio: number
  categoria: string
  descripcion?: string
  imagenUrl?: string
  disponible: boolean
  existencias?: number
  temporada?: string
}

export interface Pago {
  id: string
  pedidoId: string
  metodo: MetodoPago
  monto: number
  montoPendiente: number
  comprobanteUrl?: string
  comprobanteRecibidoEn?: string
  confirmadoEn?: string
  confirmadoPor?: string
  estado: 'pendiente' | 'parcial' | 'completado' | 'reembolsado'
  creadoEn: string
}

export interface Notificacion {
  id: string
  tipo: string
  telefono: string
  titulo: string
  mensaje: string
  canal: 'telegram' | 'whatsapp' | 'email'
  estado: 'pendiente' | 'enviada' | 'fallo'
  leida: boolean
  creadoEn: string
  enviadaEn?: string
}

export interface TransicionEstado {
  desde: EstadoPedido
  hasta: EstadoPedido
  timestamp: string
  usuario?: string
  motivo?: string
  automatica: boolean
}

export interface MetricaBot {
  mensajesProcesados: number
  llamadasIA: number
  erroresIA: number
  pedidosCreados: number
  pedidosCompletados: number
  tiempoRespuestaPromedio: number
  clientesAtendidos: number
  ultimaActualizacion: string
}

export interface ConversationState {
  telefono: string
  clienteId: string | null
  existeHistorial: boolean
  ultimoMensaje: { rol: 'user' | 'assistant'; contenido: string; timestamp: string } | null
  horasInactivo: number
  esNuevoCliente: boolean
  totalMensajes: number
  ultimaActividad: string | null
}
