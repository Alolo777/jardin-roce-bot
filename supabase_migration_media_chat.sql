-- MIGRACIÓN: Agregar columnas intención y contexto a media_chat
-- Permite clasificar imágenes por contexto de conversación

ALTER TABLE public.media_chat
ADD COLUMN IF NOT EXISTS intencion TEXT DEFAULT 'sin_definir';

ALTER TABLE public.media_chat
ADD COLUMN IF NOT EXISTS contexto TEXT DEFAULT '';

-- Índice para consultas por teléfono e intención
CREATE INDEX IF NOT EXISTS idx_media_chat_telefono_intencion
ON public.media_chat (telefono, intencion);

-- Vista para que el admin vea imágenes con contexto
CREATE OR REPLACE VIEW public.v_media_chat_con_contexto AS
SELECT
  id,
  cliente_id,
  telefono,
  origen,
  tipo,
  mimetype,
  caption,
  base64,
  intencion,
  contexto,
  creado_en
FROM public.media_chat;
