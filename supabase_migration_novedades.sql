-- =============================================================================
-- MIGRACIÓN: Motor de Novedades (DEC-084) + columna origen pendiente (DEC-082)
-- Fecha: 2026-08-21
-- Idempotente: seguro de ejecutar varias veces.
--
-- CÓMO APLICAR: Supabase Dashboard → SQL Editor → pegar y Run.
--
-- NOTA: El motor de novedades NO requiere tablas nuevas. Usa:
--   - configuracion_bot (claves 'novedades_diarias' y 'admins_bot', auto-creadas por upsert)
--   - historial_chat / clientes / pedidos_bot / casos (existentes)
-- Esta migración solo garantiza la columna 'origen' (pendiente en producción
-- desde DEC-082) y agrega un índice de fecha para el barrido diario.
-- =============================================================================

-- 1) Requerido (DEC-082): etiqueta de quién escribió cada mensaje.
--    Sin esta columna, la consulta diaria del digest falla y el análisis
--    IA se degrada a solo reglas del backend.
ALTER TABLE historial_chat ADD COLUMN IF NOT EXISTS origen TEXT;

-- 2) Índice parcial ya definido en supabase_migration_completa.sql (por si falta):
CREATE INDEX IF NOT EXISTS idx_historial_chat_equipo
  ON historial_chat (cliente_id, creado_en DESC)
  WHERE origen = 'equipo';

-- 3) Recomendado (DEC-084): acelera el rango por fecha del digest diario
--    (SELECT ... WHERE creado_en >= inicio AND creado_en < fin).
CREATE INDEX IF NOT EXISTS idx_historial_chat_creado_en
  ON historial_chat (creado_en);

-- 4) Opcional: precargar la clave de administradores vacía.
--    No es obligatorio: el código y el dashboard la crean solos al guardar.
INSERT INTO configuracion_bot (clave, valor)
VALUES ('admins_bot', '')
ON CONFLICT (clave) DO NOTHING;
