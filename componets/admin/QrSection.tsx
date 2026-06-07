'use client'

import { useState, useEffect } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-client'
import QRCode from 'qrcode'

export default function QrSection() {
  const [qrImage, setQrImage] = useState<string | null>(null)
  const supabase = createSupabaseBrowserClient()

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const { data } = await supabase
          .from('configuracion_agente')
          .select('qr_code')
          .eq('id', 1)
          .single()

        if (data?.qr_code) {
          const url = await QRCode.toDataURL(data.qr_code, {
            width: 320,
            margin: 2,
            color: { dark: '#1a1a2e', light: '#ffffff' },
          })
          setQrImage(url)
        } else {
          setQrImage(null)
        }
      } catch { /* silently retry */ }
    }, 5000)

    return () => clearInterval(interval)
  }, [])

  if (!qrImage) return null

  return (
    <div className="bg-amber-50 border-2 border-amber-300 rounded-3xl p-6 text-center animate-bloom">
      <div className="relative flex items-center justify-center gap-2 mb-3">
        <span className="relative flex w-3 h-3">
          <span className="absolute inset-0 bg-amber-500 rounded-full animate-ping opacity-75" />
          <span className="absolute inset-0 bg-amber-500 rounded-full" />
        </span>
        <p className="text-amber-800 font-bold text-lg">📱 Vincular WhatsApp</p>
      </div>
      <p className="text-amber-600 text-sm mb-4">
        La sesión expiró. Escanea el código con tu celular para reconectar.
      </p>
      <img src={qrImage} alt="QR de WhatsApp" className="mx-auto rounded-2xl shadow-lg ring-2 ring-amber-200" />
      <p className="text-amber-700 text-sm mt-4 leading-relaxed">
        Abre WhatsApp en tu celular →<br />
        Menú <strong>⋮</strong> → <strong>WhatsApp Web</strong> → Escanea
      </p>
    </div>
  )
}
