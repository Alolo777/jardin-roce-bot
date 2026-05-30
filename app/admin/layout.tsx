import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-client'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navbar */}
      <nav className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🌸</span>
            <span className="font-bold text-gray-800">Jardin RoCe Admin</span>
          </div>
          <div className="flex items-center gap-6">
            <Link
              href="/admin/inventario"
              className="text-sm font-medium text-gray-600 hover:text-rose-500 transition"
            >
              📦 Inventario del Día
            </Link>
            <Link
              href="/admin/prompt"
              className="text-sm font-medium text-gray-600 hover:text-rose-500 transition"
            >
              🤖 Prompt del Agente
            </Link>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  )
}