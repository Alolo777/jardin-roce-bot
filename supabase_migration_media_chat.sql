-- =============================================================================
-- MIGRACIÓN: media_chat — últimas imágenes/documentos enviados por chat (DEC-085)
-- Fecha: 2026-08-23
-- Idempotente. CÓMO APLICAR: Supabase Dashboard → SQL Editor → Run.
--
-- Propósito: cuando un administrador pregunta por un chat ("¿qué pasó con
-- el 7890?"), el sistema adjunta hasta 2 imágenes recientes del chat al modelo
-- de visión para describir qué son (dirección, comprobante, referencia...).
-- Se conservan SOLO las últimas 2 por teléfono (la poda la hace el código).
-- =============================================================================

CREATE TABLE IF NOT EXISTS media_chat (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id TEXT NOT NULL,              -- JID de WhatsApp (clave del Order Engine)
  telefono   TEXT,                       -- número real normalizado (dígitos)
  origen     TEXT NOT NULL DEFAULT 'cliente', -- cliente | equipo
  tipo       TEXT NOT NULL DEFAULT 'imagen',  -- imagen | documento
  mimetype   TEXT,
  caption    TEXT,
  base64     TEXT NOT NULL,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE media_chat ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS media_chat_telefono_idx ON media_chat (telefono, creado_en DESC);
