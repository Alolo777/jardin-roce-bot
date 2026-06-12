'use client'

import { useState, useEffect } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-client'
import QRCode from 'qrcode'

type QrState = {
  image: string | null
  expiresIn: number | null
  source: 'bot' | 'supabase' | null
}

export default function QrSection() {
  const [qrState, setQrState] = useState<QrState>({ image: null, expiresIn: null, source: null })
  const supabase = createSupabaseBrowserClient()

  useEffect(() => {
    let cancelled = false

    async function cargarQr() {
      try {
        const statusRes = await fetch('/api/bot/qr', { cache: 'no-store' })
        const status = statusRes.ok ? await statusRes.json() : null

        if (status?.qr) {
          const url = await QRCode.toDataURL(status.qr, {
            width: 360,
            margin: 2,
            color: { dark: '#1a1a2e', light: '#ffffff' },
          })
          if (!cancelled) setQrState({ image: url, expiresIn: status.qrExpiresInSeconds ?? null, source: 'bot' })
          return
        }

        const { data } = await supabase
          .from('configuracion_agente')
          .select('qr_code')
          .eq('id', 1)
          .single()

        if (data?.qr_code) {
          const url = await QRCode.toDataURL(data.qr_code, {
            width: 360,
            margin: 2,
            color: { dark: '#1a1a2e', light: '#ffffff' },
          })
          if (!cancelled) setQrState({ image: url, expiresIn: null, source: 'supabase' })
        } else {
          if (!cancelled) setQrState({ image: null, expiresIn: null, source: null })
        }
      } catch { /* silently retry */ }
    }

    cargarQr()
    const interval = setInterval(cargarQr, 1000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  if (!qrState.image) return null

  const expiraPronto = qrState.expiresIn !== null && qrState.expiresIn <= 15

  return (
    <div className="bg-amber-50 border-2 border-amber-300 rounded-3xl p-6 text-center animate-bloom shadow-lg shadow-amber-100/60">
      <div className="relative flex items-center justify-center gap-2 mb-3">
        <span className="relative flex w-3 h-3">
          <span className="absolute inset-0 bg-amber-500 rounded-full animate-ping opacity-75" />
          <span className="absolute inset-0 bg-amber-500 rounded-full" />
        </span>
        <p className="text-amber-800 font-bold text-lg">📱 Vincular WhatsApp</p>
      </div>
      <p className="text-amber-600 text-sm mb-4">
        La sesión expiró. Escanea este código ahora; se actualiza automáticamente cuando WhatsApp genere uno nuevo.
      </p>
      <div className="inline-flex flex-col items-center rounded-3xl bg-white p-3 shadow-xl ring-2 ring-amber-200">
        <img src={qrState.image} alt="QR de WhatsApp" className="rounded-2xl" />
        <div className={`mt-3 rounded-full px-3 py-1 text-xs font-semibold ${expiraPronto ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
          {qrState.expiresIn === null ? 'QR listo para escanear' : qrState.expiresIn > 0 ? `Escanéalo ahora: expira en ${qrState.expiresIn}s` : 'Esperando nuevo QR...'}
        </div>
      </div>
      <p className="text-amber-700 text-sm mt-4 leading-relaxed">
        Abre WhatsApp en tu celular →<br />
        Menú <strong>⋮</strong> → <strong>WhatsApp Web</strong> → Escanea
      </p>
      {qrState.source === 'supabase' && (
        <p className="text-xs text-amber-500 mt-3">
          Si no escanea, espera unos segundos: aparecerá el QR nuevo automáticamente.
        </p>
      )}
    </div>
  )
}
