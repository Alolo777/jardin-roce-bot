import express from 'express'

// Constantes de configuración
const BOT_QR_TTL_MS = 60_000
const QR_SCAN_GRACE_MS = 15 * 60_000

export interface BotContext {
  getPausado: () => boolean
  setPausado: (v: boolean) => void
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

  app.listen(port, () => {
    console.log(`🌐 Servidor web en puerto ${port}`)
    console.log(`⚠️ Bot escuchando en :${port}. Next.js debe usar otro puerto (default 3000).`)
  })
}
