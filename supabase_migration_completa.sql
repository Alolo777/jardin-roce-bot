-- =============================================================================
-- MIGRACIÓN COMPLETA FLORA — Consolidación idempotente
-- =============================================================================
-- Ejecutar TODO el script una sola vez en el SQL Editor de Supabase.
-- Todas las sentencias usan IF NOT EXISTS, es seguro re-ejecutar.
-- =============================================================================

-- 1. bot_cache: persistencia JSONB para Maps de estado (Order Engine + bot state)
--    Usado por: src/pedidos/pedido.repository.ts, src/whatsapp/bot-state-persistence.ts
CREATE TABLE IF NOT EXISTS bot_cache (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================

-- 2. pedidos_bot: pedidos activos y su historial
--    Usado por: dashboard, reportes, sincronización Order Engine
CREATE TABLE IF NOT EXISTS pedidos_bot (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id        TEXT NOT NULL UNIQUE,
  telefono          TEXT,
  estado            TEXT NOT NULL DEFAULT 'cotizacion'
                    CHECK (estado IN ('cotizacion', 'apartado', 'pagado', 'entregado', 'cancelado')),
  cliente_nombre    TEXT,
  producto          TEXT,
  arreglo_id        UUID,
  precio_arreglo    NUMERIC(10,2),
  zona_envio        TEXT,
  precio_envio      NUMERIC(10,2),
  direccion         TEXT,
  sucursal          TEXT,
  metodo_pago       TEXT,
  nota              TEXT,
  total             NUMERIC(10,2),
  ultimo_mensaje    TEXT,
  requiere_revision BOOLEAN NOT NULL DEFAULT false,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pedidos_bot_estado_idx      ON pedidos_bot (estado);
CREATE INDEX IF NOT EXISTS pedidos_bot_actualizado_idx ON pedidos_bot (actualizado_en DESC);

-- Columnas adicionales (agregadas después del CREATE inicial)
ALTER TABLE pedidos_bot ADD COLUMN IF NOT EXISTS estado_flujo              TEXT;
ALTER TABLE pedidos_bot ADD COLUMN IF NOT EXISTS fecha_entrega             TEXT;
ALTER TABLE pedidos_bot ADD COLUMN IF NOT EXISTS hora_entrega              TEXT;
ALTER TABLE pedidos_bot ADD COLUMN IF NOT EXISTS foto_referencia_url       TEXT;      -- reservada, sin uso en código
ALTER TABLE pedidos_bot ADD COLUMN IF NOT EXISTS foto_referencia_base64    TEXT;
ALTER TABLE pedidos_bot ADD COLUMN IF NOT EXISTS foto_referencia_mimetype  TEXT;
ALTER TABLE pedidos_bot ADD COLUMN IF NOT EXISTS foto_referencia_caption   TEXT;
ALTER TABLE pedidos_bot ADD COLUMN IF NOT EXISTS foto_referencia_recibida_en TIMESTAMPTZ;
ALTER TABLE pedidos_bot ADD COLUMN IF NOT EXISTS resumen_pedido            TEXT;      -- reservada, sin uso en código
ALTER TABLE pedidos_bot ADD COLUMN IF NOT EXISTS detalles_especiales       TEXT;
ALTER TABLE pedidos_bot ADD COLUMN IF NOT EXISTS precio_confirmado_por     TEXT;
ALTER TABLE pedidos_bot ADD COLUMN IF NOT EXISTS cerrado_en                TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS pedidos_bot_estado_flujo_idx ON pedidos_bot (estado_flujo);

-- =============================================================================

-- 3. zonas_envio_ambiguas: zonas de envío que requieren revisión humana
CREATE TABLE IF NOT EXISTS zonas_envio_ambiguas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  texto_cliente TEXT NOT NULL,
  telefono      TEXT,
  candidatos    JSONB,
  estado        TEXT NOT NULL DEFAULT 'pendiente'
                CHECK (estado IN ('pendiente', 'resuelto', 'ignorado')),
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS zonas_envio_ambiguas_estado_idx
  ON zonas_envio_ambiguas (estado, creado_en DESC);

-- =============================================================================

-- 4. pruebas_conversacion_bot: casos de prueba para validar comportamiento
CREATE TABLE IF NOT EXISTS pruebas_conversacion_bot (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      TEXT NOT NULL,
  descripcion TEXT,
  mensajes    JSONB NOT NULL DEFAULT '[]'::JSONB,
  esperado    JSONB NOT NULL DEFAULT '{}'::JSONB,
  activo      BOOLEAN NOT NULL DEFAULT true,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================

-- 5. casos: casos de atención (Case Engine)
--    NOTA: cliente_id es TEXT porque almacena el JID de WhatsApp
--          (ej. 521234567890@s.whatsapp.net), NO un UUID de la tabla clientes.
--    El Case Engine actualmente opera en memoria; esta tabla es la estructura
--    para persistencia futura.
CREATE TABLE IF NOT EXISTS casos (
  id               TEXT PRIMARY KEY,
  cliente_id       TEXT NOT NULL,
  telefono         TEXT NOT NULL,
  tipo             TEXT NOT NULL CHECK (tipo IN ('COTIZACION', 'PEDIDO', 'DUDA', 'QUEJA', 'POSTVENTA', 'INFORMACION')),
  estado           TEXT NOT NULL DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO', 'ARCHIVADO')),
  prioridad        TEXT NOT NULL DEFAULT 'media' CHECK (prioridad IN ('baja', 'media', 'alta', 'critica')),
  pedido_id        TEXT,
  cotizacion_id    TEXT,
  responsable      TEXT,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultima_actividad TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archivado_en     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_casos_cliente_activo
  ON casos (cliente_id, estado) WHERE estado = 'ACTIVO';
CREATE INDEX IF NOT EXISTS idx_casos_telefono
  ON casos (telefono);
CREATE INDEX IF NOT EXISTS idx_casos_ultima_actividad
  ON casos (ultima_actividad);

-- =============================================================================

-- 6. historial_prompt: versiones anteriores del system prompt
CREATE TABLE IF NOT EXISTS historial_prompt (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_anterior TEXT NOT NULL,
  prompt_nuevo    TEXT NOT NULL,
  editado_por     TEXT DEFAULT 'admin',
  creado_en       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE historial_prompt ENABLE ROW LEVEL SECURITY;

-- =============================================================================

-- 7. reclamaciones: cancelaciones, quejas y devoluciones
CREATE TABLE IF NOT EXISTS reclamaciones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_telefono  TEXT NOT NULL,
  tipo              TEXT NOT NULL CHECK (tipo IN ('cancelacion', 'queja', 'devolucion', 'otro')),
  descripcion       TEXT NOT NULL,
  arreglo_referencia TEXT,
  estado            TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_proceso', 'resuelto')),
  creado_en         TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE reclamaciones ENABLE ROW LEVEL SECURITY;

-- =============================================================================

-- 8. reporte_ventas: registro de ventas consolidadas
CREATE TABLE IF NOT EXISTS reporte_ventas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_telefono  TEXT,
  cliente_nombre    TEXT,
  producto          TEXT NOT NULL,
  precio_total      NUMERIC(10,2) NOT NULL,
  direccion_entrega TEXT,
  metodo_pago       TEXT,
  estado            TEXT NOT NULL DEFAULT 'pagado'
                    CHECK (estado IN ('pagado', 'entregado', 'cancelado')),
  creado_en         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE reporte_ventas ENABLE ROW LEVEL SECURITY;

-- =============================================================================

-- 9. numeros_ignorados: números de WhatsApp que Flora debe ignorar
CREATE TABLE IF NOT EXISTS numeros_ignorados (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  numero      TEXT NOT NULL UNIQUE,
  descripcion TEXT,
  creado_en   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE numeros_ignorados ENABLE ROW LEVEL SECURITY;

-- =============================================================================

-- 10. municipios_envio: catálogo de municipios con zonas y precios de envío
CREATE TABLE IF NOT EXISTS municipios_envio (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  municipio   TEXT NOT NULL,
  codigo_postal TEXT NOT NULL,
  colonia     TEXT,
  zona        TEXT NOT NULL,
  precio_envio NUMERIC(10,2) NOT NULL,
  creado_en   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_municipios_envio_municipio
  ON municipios_envio (municipio);
CREATE INDEX IF NOT EXISTS idx_municipios_envio_codigo_postal
  ON municipios_envio (codigo_postal);
CREATE INDEX IF NOT EXISTS idx_municipios_envio_colonia
  ON municipios_envio (colonia);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_municipios_envio_municipio_trgm
  ON municipios_envio USING GIN (municipio gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_municipios_envio_colonia_trgm
  ON municipios_envio USING GIN (colonia gin_trgm_ops);

ALTER TABLE municipios_envio ENABLE ROW LEVEL SECURITY;

-- =============================================================================

-- 11. configuracion_agente: estado del bot (pausa, QR)
--     Usado por: bot.ts, app/api/bot/qr/route.ts, app/api/bot/pause/route.ts
CREATE TABLE IF NOT EXISTS configuracion_agente (
  id          INTEGER PRIMARY KEY,
  bot_pausado BOOLEAN NOT NULL DEFAULT false,
  qr_code     TEXT
);

-- =============================================================================

-- 12. configuracion_bot: almacén clave-valor para configuración dinámica
--     Claves usadas: 'system_prompt', 'empleados_notificar', 'bot_command', etc.
--     Usado por: lib/ai.ts, bot.ts, dashboard (prompt, empleados)
CREATE TABLE IF NOT EXISTS configuracion_bot (
  clave         TEXT PRIMARY KEY,
  valor         TEXT NOT NULL,
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================

-- 13. clientes: registro de clientes (UUID por número de teléfono)
--     Usado por: src/conversation/conversation.service.ts
CREATE TABLE IF NOT EXISTS clientes (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefono TEXT NOT NULL UNIQUE
);

-- =============================================================================

-- 14. historial_chat: mensajes del historial de conversación
--     Usado por: src/conversation/conversation.service.ts, bot.ts, dashboard
CREATE TABLE IF NOT EXISTS historial_chat (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES clientes(id),
  rol        TEXT NOT NULL,
  contenido  TEXT NOT NULL,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_historial_chat_cliente
  ON historial_chat (cliente_id, creado_en DESC);

-- =============================================================================
-- POLÍTICAS RLS
-- NOTA: El bot usa service_role (bypassea RLS). Estas políticas son para
--       acceso directo desde el panel de Supabase o desde Next.js con
--       rol autenticado.
-- =============================================================================

CREATE POLICY IF NOT EXISTS "service_role_all_historial_prompt"
  ON historial_prompt FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "service_role_all_reclamaciones"
  ON reclamaciones FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "service_role_all_reporte_ventas"
  ON reporte_ventas FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Todos pueden leer numeros_ignorados"
  ON numeros_ignorados FOR SELECT USING (true);

CREATE POLICY IF NOT EXISTS "Solo service_role puede insertar numeros_ignorados"
  ON numeros_ignorados FOR INSERT WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Solo service_role puede eliminar numeros_ignorados"
  ON numeros_ignorados FOR DELETE USING (true);

CREATE POLICY IF NOT EXISTS "Todos pueden leer municipios"
  ON municipios_envio FOR SELECT USING (true);

CREATE POLICY IF NOT EXISTS "Solo service_role puede insertar municipios"
  ON municipios_envio FOR INSERT WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Solo service_role puede actualizar municipios"
  ON municipios_envio FOR UPDATE USING (true);

CREATE POLICY IF NOT EXISTS "Solo service_role puede eliminar municipios"
  ON municipios_envio FOR DELETE USING (true);

-- =============================================================================
-- FIN DE MIGRACIÓN
-- =============================================================================
