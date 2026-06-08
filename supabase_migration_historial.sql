-- Tabla para historial de cambios del system prompt
CREATE TABLE IF NOT EXISTS historial_prompt (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_anterior TEXT NOT NULL,
  prompt_nuevo TEXT NOT NULL,
  editado_por TEXT DEFAULT 'admin',
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE historial_prompt ENABLE ROW LEVEL SECURITY;

-- Tabla para reclamaciones, cancelaciones y quejas
CREATE TABLE IF NOT EXISTS reclamaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_telefono TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('cancelacion', 'queja', 'devolucion', 'otro')),
  descripcion TEXT NOT NULL,
  arreglo_referencia TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_proceso', 'resuelto')),
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE reclamaciones ENABLE ROW LEVEL SECURITY;

-- Tabla para reporte de ventas
CREATE TABLE IF NOT EXISTS reporte_ventas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_telefono TEXT,
  cliente_nombre TEXT,
  producto TEXT NOT NULL,
  precio_total NUMERIC(10,2) NOT NULL,
  direccion_entrega TEXT,
  metodo_pago TEXT,
  estado TEXT NOT NULL DEFAULT 'pagado' CHECK (estado IN ('pagado', 'entregado', 'cancelado')),
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE reporte_ventas ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para service_role (acceso completo)
CREATE POLICY "service_role_all_historial_prompt" ON historial_prompt
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_reclamaciones" ON reclamaciones
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_reporte_ventas" ON reporte_ventas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
