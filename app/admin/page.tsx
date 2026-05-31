import Link from 'next/link';

export default function AdminDashboard() {
  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-gray-800 mb-2">🌺 Panel de Control</h1>
        <p className="text-gray-500 mb-8">Administración general del Agente Jardín RoCe</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Tarjeta Inventario */}
          <Link 
            href="/admin/inventario" 
            className="block p-8 bg-white rounded-2xl shadow-sm hover:shadow-lg transition-all border border-gray-100 hover:border-pink-200"
          >
            <div className="text-4xl mb-4">📸</div>
            <h2 className="text-2xl font-semibold text-gray-800 mb-2">Inventario del Día</h2>
            <p className="text-gray-600">
              Sube fotos de los arreglos, asigna precios y actualiza el catálogo que Flora ofrece a los clientes hoy.
            </p>
          </Link>

          {/* Tarjeta Prompt */}
          <Link 
            href="/admin/prompt" 
            className="block p-8 bg-white rounded-2xl shadow-sm hover:shadow-lg transition-all border border-gray-100 hover:border-purple-200"
          >
            <div className="text-4xl mb-4">🧠</div>
            <h2 className="text-2xl font-semibold text-gray-800 mb-2">Cerebro de Flora</h2>
            <p className="text-gray-600">
              Edita las instrucciones base de la Inteligencia Artificial, ajusta su personalidad y reglas de venta.
            </p>
          </Link>

        </div>
      </div>
    </main>
  );
}