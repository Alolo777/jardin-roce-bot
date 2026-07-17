-- Migración: tabla casos
-- Fecha: 2026-07-17 (corregida: cliente_id TEXT en lugar de UUID REFERENCES clientes(id))
-- Descripción: Almacenamiento persistente para el Case Engine
-- NOTA: cliente_id es TEXT porque almacena el JID de WhatsApp
--       (ej. 521234567890@s.whatsapp.net), NO un UUID de la tabla clientes.

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
