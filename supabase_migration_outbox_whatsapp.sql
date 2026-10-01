-- =============================================================================
-- Pestaña WhatsApp del dashboard — outbox de mensajes del equipo
-- Fecha: 2026-10-01
--
-- Flujo:
--   Dashboard (Vercel) escribe en `mensajes_outbox_equipo` con estado
--   'pendiente'. El bot (VM Google) lee la tabla cada ~4s, envía el texto
--   por WhatsApp con Baileys y marca la fila como 'enviado' o 'error'.
--
-- Pausa por chat: reutiliza `numeros_ignorados` (el bot ya filtra esos
-- números en message-entry.ts). Las filas creadas por el dashboard usan
-- descripcion = 'Toma humana desde dashboard' para distinguirlas de los
-- silenciados permanentes (repartidor, admins).
--
-- INSTRUCCIONES:
--   1. Ejecutar este script en Supabase (SQL Editor).
--   2. Activar Realtime para `historial_chat` y `mensajes_outbox_equipo`:
--      Database > Replication > supabase_realtime > marcar ambas tablas.
--      (El bloque DO al final lo intenta automáticamente; si falla,
--      hacerlo manual desde el panel.)
-- =============================================================================

-- 1. Outbox de mensajes del equipo ------------------------------------------
CREATE TABLE IF NOT EXISTS mensajes_outbox_equipo (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefono      TEXT NOT NULL,
  texto         TEXT NOT NULL CHECK (char_length(texto) BETWEEN 1 AND 1000),
  estado        TEXT NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente', 'enviando', 'enviado', 'error')),
  intentos      INTEGER NOT NULL DEFAULT 0,
  creado_por    TEXT NOT NULL DEFAULT 'admin',
  error_detalle TEXT,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  enviado_en    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outbox_estado_creado
  ON mensajes_outbox_equipo (estado, creado_en ASC)
  WHERE estado = 'pendiente';

ALTER TABLE mensajes_outbox_equipo ENABLE ROW LEVEL SECURITY;

-- Misma convención que el resto de tablas del proyecto: el bot y las API
-- routes usan service_role (bypassea RLS); esta política cubre acceso
-- directo con rol autenticado.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mensajes_outbox_equipo'
      AND policyname = 'service_role_all_outbox_equipo'
  ) THEN
    CREATE POLICY "service_role_all_outbox_equipo" ON mensajes_outbox_equipo
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END
$$;

-- 2. Realtime para el dashboard (bandeja en vivo) ----------------------------
-- Todo por SQL: NO necesitas el menú Database > Replication del panel.
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE mensajes_outbox_equipo;
  EXCEPTION WHEN duplicate_object THEN
    -- ya estaba agregada, nada que hacer
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE historial_chat;
  EXCEPTION WHEN duplicate_object THEN
    -- ya estaba agregada, nada que hacer
  END;
END
$$;

-- 3. Permiso de LECTURA para el Realtime del dashboard -----------------------
-- `historial_chat` tiene RLS activado pero SIN políticas: el navegador
-- (que usa tu sesión de admin) quedaría bloqueado y el tiempo real no
-- llegaría. Esta política permite leer a usuarios logueados. El acceso
-- anónimo (sin login) sigue bloqueado. Escritura: solo service_role
-- (el bot y las API routes la bypassean, sin cambios).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'historial_chat'
      AND policyname = 'dashboard_realtime_historial_chat'
  ) THEN
    CREATE POLICY "dashboard_realtime_historial_chat" ON historial_chat
      FOR SELECT TO authenticated USING (true);
  END IF;
END
$$;
GRANT SELECT ON historial_chat TO authenticated;
GRANT SELECT ON mensajes_outbox_equipo TO authenticated;
