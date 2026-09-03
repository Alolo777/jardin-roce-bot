import express from 'express'
import { metrics } from '../../lib/metrics.service'
import { PedidoResumenDTO, EstadoPedido } from '../models/types'

// Constantes de configuración
const BOT_QR_TTL_MS = 60_000
const QR_SCAN_GRACE_MS = 15 * 60_000

export interface DiagnosticoChat {
  clienteId: string
  pedidoEnCurso: Record<string, unknown> | null
  ventaCerrada: boolean
  arregloElegido: unknown | null
  pedidoEngine: Record<string, unknown> | null
  casoActivo: unknown | null
  tienePrecio: boolean
  tieneNombre: boolean
  fechaHora: { fecha?: string; hora?: string } | null
  tieneFotoReferencia: boolean
  estadoFlujo: string | null
}

export interface ResumenOperativo {
  requierenAtencion: {
    telefono: string
    cliente: string | null
    motivo: string
    hace: string
  }[]
  esperandoPago: {
    telefono: string
    cliente: string | null
    producto: string
    total: number
    hace: string
  }[]
  pedidosHoy: number
  ventasHoy: number
}

export interface BotContext {
  getPausado: () => boolean
  setPausado: (v: boolean) => void | Promise<void>
  reiniciarProceso: (motivo: string, contarCrash?: boolean) => never
  getEstado: () => string
  getEstadoDetalle: () => string
  getReconectando: () => boolean
  getReady: () => boolean
  getQrActual: () => string | null
  getQrGeneradoEn: () => number | null
  getUltimaActividad: () => number
  getSock: () => any | null
  obtenerVentasHoy: () => Promise<{ total: number; cantidad: number }>
  obtenerClientesAtendidosHoy: () => Promise<number>
  getDiagnosticoChat: (chatId: string) => DiagnosticoChat | null
  syncPedidoFromDashboard: (clienteId: string, updates: Record<string, unknown>) => Promise<void>
  obtenerResumenOperativo: () => Promise<ResumenOperativo>
  listarPedidosActivos: () => PedidoResumenDTO[]
  obtenerDetallePedido: (id: string) => PedidoResumenDTO | null
  actualizarPrecioPedido: (id: string, precio: number) => Promise<{ ok: boolean; error?: string }>
  cambiarEstadoPedido: (id: string, estado: string) => Promise<{ ok: boolean; error?: string }>
  // DEC-084 / BUG-024: regeneración manual del digest de novedades (48h)
  regenerarNovedades: () => Promise<{ ok: boolean; total: number; mensaje: string }>
  obtenerNovedadesMensaje: () => Promise<string>
}

export function startServer(ctx: BotContext): void {
  const app = express()
  const port = process.env.BOT_PORT || 10000

  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Content-Type')
    if (_req.method === 'OPTIONS') return res.sendStatus(200)
    next()
  })
  app.use(express.json())

  app.get('/', (_req, res) => res.send('🌸 Jardín RoCe Bot (Baileys) — en línea.'))

  app.post('/pause', (_req, res) => {
    ctx.setPausado(true)
    console.log('[server] ⏸️ Pausado vía API')
    res.json({ ok: true, pausado: true })
  })

  app.post('/resume', (_req, res) => {
    ctx.setPausado(false)
    console.log('[server] ▶️ Reanudado vía API')
    res.json({ ok: true, pausado: false })
  })

  app.post('/reconnect', (_req, res) => {
    console.warn('[server] 🔄 Reinicio manual solicitado vía API')
    res.json({ ok: true, mensaje: 'Reinicio solicitado. El proceso volverá a levantar con systemd.' })
    setTimeout(() => ctx.reiniciarProceso('Reinicio manual desde dashboard', false), 500)
  })

  app.post('/recover', (_req, res) => {
    console.warn('[server] 🛟 Rescate manual solicitado vía API')
    res.json({ ok: true, mensaje: 'Rescate iniciado. Se reiniciará la conexión para forzar sincronización.' })
    setTimeout(() => ctx.reiniciarProceso('Rescate manual desde dashboard', false), 500)
  })

  app.get('/qr', (_req, res) => {
    const ageMs = ctx.getQrGeneradoEn() ? Date.now() - ctx.getQrGeneradoEn()! : null
    res.json({
      qr: ctx.getQrActual(),
      qrGeneradoEn: ctx.getQrGeneradoEn() ? new Date(ctx.getQrGeneradoEn()!).toISOString() : null,
      qrAgeSeconds: ageMs === null ? null : Math.round(ageMs / 1000),
      qrExpiresInSeconds: ageMs === null ? null : Math.max(0, Math.ceil((BOT_QR_TTL_MS - ageMs) / 1000)),
      qrScanGraceSeconds: ageMs === null ? null : Math.max(0, Math.ceil((QR_SCAN_GRACE_MS - ageMs) / 1000)),
      qrVencido: ageMs === null ? false : ageMs > BOT_QR_TTL_MS,
    })
  })

  app.get('/status', async (_req, res) => {
    try {
      const ventas = await ctx.obtenerVentasHoy()
      const clientes = await ctx.obtenerClientesAtendidosHoy()
      const minutosInactivo = Math.round((Date.now() - ctx.getUltimaActividad()) / 60_000)
      const qrAgeMs = ctx.getQrGeneradoEn() ? Date.now() - ctx.getQrGeneradoEn()! : null
      res.json({
        pausado: ctx.getPausado(),
        connected: ctx.getReady() && !!ctx.getSock()?.user,
        estado: ctx.getEstado(),
        estadoDetalle: ctx.getEstadoDetalle(),
        reconnecting: ctx.getReconectando(),
        qr: ctx.getQrActual(),
        qrGeneradoEn: ctx.getQrGeneradoEn() ? new Date(ctx.getQrGeneradoEn()!).toISOString() : null,
        qrAgeSeconds: qrAgeMs === null ? null : Math.round(qrAgeMs / 1000),
        qrExpiresInSeconds: qrAgeMs === null ? null : Math.max(0, Math.ceil((BOT_QR_TTL_MS - qrAgeMs) / 1000)),
        qrScanGraceSeconds: qrAgeMs === null ? null : Math.max(0, Math.ceil((QR_SCAN_GRACE_MS - qrAgeMs) / 1000)),
        qrVencido: qrAgeMs === null ? false : qrAgeMs > BOT_QR_TTL_MS,
        ultimaActividad: `${minutosInactivo} min`,
        ventasHoy: ventas.cantidad,
        totalVentasHoy: ventas.total,
        clientesAtendidosHoy: clientes,
        libreria: 'baileys',
        baileysVersion: '7.0.0-rc13',
        version: '3.0.0',
        uptime: Math.round(process.uptime() / 60) + ' min',
      })
    } catch {
      res.json({
        pausado: ctx.getPausado(),
        connected: ctx.getReady() && !!ctx.getSock()?.user,
        estado: ctx.getEstado(),
        estadoDetalle: ctx.getEstadoDetalle(),
      })
    }
  })

  app.post('/api/pedidos/sync', async (req, res) => {
    const { cliente_id, updates } = req.body || {}
    if (!cliente_id || !updates) return res.status(400).json({ error: 'Falta cliente_id o updates' })
    try {
      await ctx.syncPedidoFromDashboard(cliente_id, updates)
      res.json({ ok: true })
    } catch (err) {
      console.error('[server] Error syncing pedido:', err)
      res.status(500).json({ error: 'Error syncing pedido' })
    }
  })

  app.get('/api/pedidos', (_req, res) => {
    try {
      const pedidos = ctx.listarPedidosActivos()
      res.json({ pedidos, cantidad: pedidos.length })
    } catch (err) {
      console.error('[server] Error en GET /api/pedidos:', err)
      res.status(500).json({ error: 'Error listando pedidos' })
    }
  })

  app.get('/api/pedidos/:id', (req, res) => {
    try {
      const detalle = ctx.obtenerDetallePedido(req.params.id)
      if (!detalle) return res.status(404).json({ error: 'Pedido no encontrado' })
      res.json(detalle)
    } catch (err) {
      console.error('[server] Error en GET /api/pedidos/:id:', err)
      res.status(500).json({ error: 'Error obteniendo pedido' })
    }
  })

  app.post('/api/pedidos/:id/precio', async (req, res) => {
    const precio = Number(req.body?.precio)
    if (!Number.isFinite(precio) || precio < 0) return res.status(400).json({ error: 'Precio inválido' })
    try {
      const resultado = await ctx.actualizarPrecioPedido(req.params.id, precio)
      if (!resultado.ok) return res.status(404).json({ error: resultado.error ?? 'Pedido no encontrado' })
      res.json({ ok: true })
    } catch (err) {
      console.error('[server] Error en POST /api/pedidos/:id/precio:', err)
      res.status(500).json({ error: 'Error actualizando precio' })
    }
  })

  app.post('/api/pedidos/:id/estado', async (req, res) => {
    const estado = String(req.body?.estado ?? '').toUpperCase()
    if (!Object.values(EstadoPedido).includes(estado as EstadoPedido)) {
      return res.status(400).json({ error: `Estado inválido: ${estado}` })
    }
    try {
      const resultado = await ctx.cambiarEstadoPedido(req.params.id, estado)
      if (!resultado.ok) return res.status(400).json({ error: resultado.error ?? 'No se pudo cambiar el estado' })
      res.json({ ok: true })
    } catch (err) {
      console.error('[server] Error en POST /api/pedidos/:id/estado:', err)
      res.status(500).json({ error: 'Error cambiando estado' })
    }
  })

  app.get('/diag/:chatId', (req, res) => {
    const { chatId } = req.params
    if (!chatId) return res.status(400).json({ error: 'Falta chatId' })
    const diag = ctx.getDiagnosticoChat(chatId)
    if (!diag) return res.status(404).json({ error: 'Chat no encontrado' })
    res.json(diag)
  })

  app.get('/api/resumen', async (_req, res) => {
    try {
      const resumen = await ctx.obtenerResumenOperativo()
      res.json(resumen)
    } catch (err) {
      console.error('[server] Error en /api/resumen:', err)
      res.status(500).json({ error: 'Error obteniendo resumen operativo' })
    }
  })

  // DEC-084: novedades — ver el digest actual y regenerarlo manualmente
  app.get('/api/novedades', async (_req, res) => {
    try {
      const mensaje = await ctx.obtenerNovedadesMensaje()
      res.json({ mensaje })
    } catch (err) {
      console.error('[server] Error en GET /api/novedades:', err)
      res.status(500).json({ error: 'Error obteniendo novedades' })
    }
  })

  app.post('/api/novedades/regenerar', async (_req, res) => {
    try {
      const resultado = await ctx.regenerarNovedades()
      console.log(`[server] 🔄 Novedades regeneradas vía API: ${resultado.total} novedad(es)`)
      res.json(resultado)
    } catch (err) {
      console.error('[server] Error en POST /api/novedades/regenerar:', err)
      res.status(500).json({ error: 'Error regenerando novedades' })
    }
  })

  app.get('/metrics', (_req, res) => {
    res.json(metrics.getSnapshot())
  })

  app.listen(port, () => {
    console.log(`🌐 Servidor web en puerto ${port}`)
    console.log(`⚠️ Bot escuchando en :${port}. Next.js debe usar otro puerto (default 3000).`)
  })
}
