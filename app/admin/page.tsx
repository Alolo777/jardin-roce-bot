import Link from 'next/link'
import QrSection from '@/componets/admin/QrSection'

const FEATURES = [
  {
    href: '/admin/inventario',
    icon: '🌸',
    title: 'Inventario del Día',
    desc: 'Sube fotos, asigna precios y actualiza el catálogo que Flora ofrece hoy a tus clientes.',
    gradient: 'from-rose-400 to-pink-400',
    shadow: 'shadow-rose-200/40',
  },
  {
    href: '/admin/prompt',
    icon: '🌿',
    title: 'Cerebro de Flora',
    desc: 'Edita las instrucciones y la personalidad de la IA. Cambia cómo habla, qué reglas sigue y cómo vende.',
    gradient: 'from-emerald-400 to-teal-400',
    shadow: 'shadow-emerald-200/40',
  },
]

export default function AdminDashboard() {
  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div className="relative overflow-hidden bg-gradient-to-br from-rose-500 via-pink-500 to-rose-400 rounded-3xl p-8 shadow-xl shadow-rose-200/40">
        <div className="absolute top-0 right-0 w-48 h-48 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/4" />
        <div className="relative">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-3xl animate-float">🌸</span>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">¡Bienvenida, Flor!</h1>
          </div>
          <p className="text-white/80 text-sm sm:text-base max-w-xl">
            Hoy es un día hermoso para atender tu florería. Aquí puedes gestionar lo que Flora
            mostrará y dirá a tus clientes.
          </p>
        </div>
      </div>

      {/* QR section */}
      <QrSection />

      {/* Feature cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {FEATURES.map((f, i) => (
          <Link
            key={f.href}
            href={f.href}
            className="group relative overflow-hidden bg-white rounded-3xl shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 border border-gray-100/80"
            style={{ animationDelay: `${i * 150}ms` }}
          >
            {/* Gradient top accent */}
            <div className={`h-2 bg-gradient-to-r ${f.gradient}`} />

            <div className="p-8">
              <div className="flex items-start gap-5">
                <div className={`flex-shrink-0 w-14 h-14 rounded-2xl bg-gradient-to-br ${f.gradient} flex items-center justify-center shadow-lg ${f.shadow} group-hover:scale-110 transition-transform duration-300`}>
                  <span className="text-2xl">{f.icon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold text-gray-800 group-hover:text-rose-600 transition-colors">
                    {f.title}
                  </h2>
                  <p className="text-gray-500 text-sm mt-2 leading-relaxed">
                    {f.desc}
                  </p>
                </div>
              </div>

              <div className="mt-6 flex items-center text-sm font-medium text-rose-500 group-hover:text-rose-600 transition-colors">
                <span>Entrar</span>
                <span className="ml-1.5 group-hover:translate-x-1 transition-transform">→</span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Quick tip */}
      <div className="bg-amber-50/70 border border-amber-200/60 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <span className="text-xl mt-0.5">🌱</span>
          <div>
            <p className="text-sm text-amber-800 font-medium">Tip del día</p>
            <p className="text-sm text-amber-700/80 mt-1">
              Recuerda subir los arreglos del día temprano para que Flora pueda mostrarlos
              a los clientes desde que abren.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
