'use client'

import { useState, useEffect } from 'react'
import type { MunicipioEnvio } from '@/lib/types'

function FilaMunicipio({ municipio, onEdit, onDelete }: { municipio: MunicipioEnvio; onEdit: (buscar?: string) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const [editando, setEditando] = useState(false)
  const [zona, setZona] = useState(municipio.zona)
  const [precio, setPrecio] = useState(String(municipio.precio_envio))
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    if (zona === municipio.zona && parseFloat(precio) === municipio.precio_envio) {
      setEditando(false); return
    }
    setGuardando(true)
    try {
      const res = await fetch(`/api/municipios/${municipio.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zona, precio_envio: parseFloat(precio) }),
      })
      if (!res.ok) throw new Error()
      setEditando(false)
      onEdit()
    } catch {
      setZona(municipio.zona)
      setPrecio(String(municipio.precio_envio))
      setEditando(false)
    } finally {
      setGuardando(false)
    }
  }

  if (editando) {
    return (
      <tr className="bg-amber-50/50">
        <td className="px-4 py-3 font-medium text-gray-800">{municipio.municipio}</td>
        <td className="px-4 py-3 text-gray-500">{municipio.codigo_postal}</td>
        <td className="px-4 py-3 text-gray-500">{municipio.colonia || '—'}</td>
        <td className="px-4 py-3">
          <input type="text" value={zona} onChange={e => setZona(e.target.value)}
            className="w-full border border-emerald-300 rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-emerald-400 outline-none"
            disabled={guardando} />
        </td>
        <td className="px-4 py-3">
          <input type="number" value={precio} onChange={e => setPrecio(e.target.value)}
            min="1" step="0.01"
            className="w-24 ml-auto block text-right border border-emerald-300 rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-emerald-400 outline-none"
            disabled={guardando} />
        </td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-1">
            <button onClick={guardar} disabled={guardando}
              className="text-xs text-emerald-600 hover:bg-emerald-100 rounded-lg px-2 py-1.5 transition font-medium">
              {guardando ? '...' : '✓'}
            </button>
            <button onClick={() => { setEditando(false); setZona(municipio.zona); setPrecio(String(municipio.precio_envio)) }}
              className="text-xs text-gray-400 hover:bg-gray-100 rounded-lg px-2 py-1.5 transition">
              ✕
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className="hover:bg-emerald-50/30 transition-colors group">
      <td className="px-4 py-3 font-medium text-gray-800">{municipio.municipio}</td>
      <td className="px-4 py-3 text-gray-500">{municipio.codigo_postal}</td>
      <td className="px-4 py-3 text-gray-500">{municipio.colonia || '—'}</td>
      <td className="px-4 py-3">
        <span className="bg-emerald-100 text-emerald-700 text-xs font-medium px-2.5 py-1 rounded-full">
          {municipio.zona}
        </span>
      </td>
      <td className="px-4 py-3 text-right font-semibold text-gray-800">
        ${municipio.precio_envio.toFixed(2)}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => setEditando(true)}
            className="text-xs text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg px-2 py-1.5 transition">
            Editar
          </button>
          <button onClick={() => onDelete(municipio.id)}
            className="text-xs text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg px-2 py-1.5 transition">
            Eliminar
          </button>
        </div>
      </td>
    </tr>
  )
}

export default function MunicipiosPage() {
  const [municipios, setMunicipios] = useState<MunicipioEnvio[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')

  const [municipio, setMunicipio] = useState('')
  const [codigoPostal, setCodigoPostal] = useState('')
  const [colonia, setColonia] = useState('')
  const [zona, setZona] = useState('')
  const [precioEnvio, setPrecioEnvio] = useState('')

  const [csvTexto, setCsvTexto] = useState('')
  const [importando, setImportando] = useState(false)
  const [mensajeImport, setMensajeImport] = useState<string | null>(null)
  const [importExitoso, setImportExitoso] = useState(false)
  const [exportando, setExportando] = useState(false)

  async function cargarMunicipios(buscar?: string) {
    try {
      const params = buscar ? `?q=${encodeURIComponent(buscar)}` : ''
      const res = await fetch(`/api/municipios${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMunicipios(data.municipios)
    } catch {
      setError('No se pudieron cargar los municipios')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargarMunicipios() }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      if (busqueda) cargarMunicipios(busqueda)
      else cargarMunicipios()
    }, 300)
    return () => clearTimeout(t)
  }, [busqueda])

  async function agregar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const res = await fetch('/api/municipios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          municipio, codigo_postal: codigoPostal,
          colonia: colonia || undefined, zona,
          precio_envio: parseFloat(precioEnvio),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMunicipio(''); setCodigoPostal(''); setColonia(''); setZona(''); setPrecioEnvio('')
      await cargarMunicipios(busqueda)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al agregar')
    }
  }

  async function eliminar(id: string) {
    if (!confirm('Eliminar este registro?')) return
    try {
      const res = await fetch(`/api/municipios/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setMunicipios(prev => prev.filter(m => m.id !== id))
    } catch {
      setError('No se pudo eliminar el registro')
    }
  }

  async function importarCsv() {
    if (!csvTexto.trim()) return
    setImportando(true)
    setMensajeImport(null)
    setImportExitoso(false)
    try {
      const lineas = csvTexto.trim().split('\n')
      const cabeceras = lineas[0].split(',').map(h => h.trim().toLowerCase().replace(/[\s-]/g, '_'))
      const esperadas = ['municipio', 'codigo_postal', 'zona', 'precio_envio']
      const tieneColonia = cabeceras.includes('colonia')

      const idxMunicipio = cabeceras.indexOf('municipio')
      const idxCp = cabeceras.indexOf('codigo_postal')
      const idxColonia = cabeceras.indexOf('colonia')
      const idxZona = cabeceras.indexOf('zona')
      const idxPrecio = cabeceras.indexOf('precio_envio')

      if (idxMunicipio === -1 || idxCp === -1 || idxZona === -1 || idxPrecio === -1) {
        setMensajeImport('El CSV debe tener columnas: municipio, codigo_postal, zona, precio_envio (y opcional: colonia)')
        setImportando(false)
        return
      }

      const registros = lineas.slice(1).map(linea => {
        const cols = linea.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
        return {
          municipio: cols[idxMunicipio],
          codigo_postal: cols[idxCp],
          colonia: tieneColonia ? cols[idxColonia] : null,
          zona: cols[idxZona],
          precio_envio: cols[idxPrecio],
        }
      }).filter(r => r.municipio && r.zona && r.precio_envio)

      const res = await fetch('/api/municipios/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registros }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMensajeImport(`✅ ${data.importados} municipios importados exitosamente`)
      setImportExitoso(true)
      setCsvTexto('')
      await cargarMunicipios(busqueda)
    } catch (err) {
      setMensajeImport(`Error: ${err instanceof Error ? err.message : 'Error al importar'}`)
    } finally {
      setImportando(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">🏘️ Municipios de Envío</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {municipios.length} municipios/colonias registrados
          </p>
        </div>
        <button onClick={async () => {
          setExportando(true)
          try {
            const res = await fetch('/api/municipios/export')
            if (!res.ok) throw new Error('No hay datos')
            const blob = await res.blob()
            const url = window.URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `municipios_envio_${new Date().toISOString().split('T')[0]}.csv`
            a.click()
            window.URL.revokeObjectURL(url)
          } catch (err) {
            alert(err instanceof Error ? err.message : 'Error al exportar')
          } finally { setExportando(false) }
        }} disabled={exportando}
          className="flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition shadow-sm disabled:opacity-50">
          <span>📥</span>
          <span className="hidden sm:inline">{exportando ? 'Exportando...' : 'Exportar CSV'}</span>
        </button>
      </div>

      {/* Buscador */}
      <div>
        <input
          type="text" value={busqueda} onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por municipio, colonia o código postal..."
          className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-400 outline-none bg-white"
        />
      </div>

      {/* Formulario agregar manual */}
      <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-emerald-100/80 p-6">
        <div className="flex items-center gap-2 mb-5">
          <span className="w-1 h-6 bg-gradient-to-b from-emerald-400 to-teal-400 rounded-full" />
          <h2 className="text-lg font-semibold text-gray-800">Agregar manualmente</h2>
        </div>
        <form onSubmit={agregar} className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Municipio</label>
            <input type="text" value={municipio} onChange={e => setMunicipio(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-400 outline-none" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">C.P.</label>
            <input type="text" value={codigoPostal} onChange={e => setCodigoPostal(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-400 outline-none" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Colonia (opc)</label>
            <input type="text" value={colonia} onChange={e => setColonia(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-400 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Zona</label>
            <input type="text" value={zona} onChange={e => setZona(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-400 outline-none" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Precio envío</label>
            <input type="number" value={precioEnvio} onChange={e => setPrecioEnvio(e.target.value)}
              min="1" step="0.01"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-400 outline-none" required />
          </div>
          <div className="md:col-span-5">
            <button type="submit"
              className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-medium px-6 py-2 rounded-xl transition shadow-md">
              + Agregar
            </button>
          </div>
        </form>
      </div>

      {/* Importar CSV */}
      <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-amber-100/80 p-6">
        <div className="flex items-center gap-2 mb-5">
          <span className="w-1 h-6 bg-gradient-to-b from-amber-400 to-orange-400 rounded-full" />
          <h2 className="text-lg font-semibold text-gray-800">Importar CSV</h2>
        </div>
        <p className="text-xs text-gray-400 mb-3">
          Columnas esperadas: <code>municipio, codigo_postal, zona, precio_envio</code> (y opcional: <code>colonia</code>)
        </p>
        <textarea
          value={csvTexto} onChange={e => setCsvTexto(e.target.value)}
          rows={8}
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-xs font-mono focus:ring-2 focus:ring-amber-400 outline-none"
          placeholder="municipio, codigo_postal, colonia, zona, precio_envio&#10;San Andrés Ahuashuatepec, 90300, , Zona 1, 40&#10;Apizaco Centro, 90300, Centro, Zona 1, 40"
        />
        <div className="flex items-center gap-3 mt-3">
          <button onClick={importarCsv} disabled={importando || !csvTexto.trim()}
            className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-40 text-white font-medium px-6 py-2 rounded-xl transition shadow-md">
            {importando ? 'Importando...' : '📥 Importar CSV'}
          </button>
          {mensajeImport && (
            <span className={`text-sm ${importExitoso ? 'text-emerald-600' : 'text-rose-600'}`}>
              {mensajeImport}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="text-sm text-rose-700 bg-rose-50 rounded-xl px-4 py-3">{error}</div>
      )}

      {/* Tabla */}
      {cargando ? (
        <div className="space-y-2">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="h-12 bg-white rounded-xl animate-pulse border border-gray-100" />
          ))}
        </div>
      ) : municipios.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-6xl mb-4 opacity-50">🏘️</div>
          <p className="text-gray-400 text-lg">No hay municipios registrados</p>
          <p className="text-gray-300 text-sm mt-1">Agrega uno o importa tu CSV</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-100/80">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3">Municipio</th>
                <th className="text-left px-4 py-3">C.P.</th>
                <th className="text-left px-4 py-3">Colonia</th>
                <th className="text-left px-4 py-3">Zona</th>
                <th className="text-right px-4 py-3">Precio</th>
                <th className="text-right px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {municipios.map(m => (
                <FilaMunicipio key={m.id} municipio={m} onEdit={cargarMunicipios} onDelete={eliminar} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
