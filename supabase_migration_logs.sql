-- Migración: Tabla logs
-- Creada: 2026-07-17
-- Propósito: Almacenar logs estructurados del bot para depuración y monitoreo

CREATE TABLE IF NOT EXISTS logs (
  id BIGSERIAL PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  module TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
CREATE INDEX IF NOT EXISTS idx_logs_module ON logs(module);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_level_created ON logs(level, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_module_created ON logs(module, created_at DESC);

-- Política de seguridad: solo lectura para anon (si RLS está activo)
ALTER TABLE logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'logs' AND policyname = 'Todos pueden insertar logs'
  ) THEN
    CREATE POLICY "Todos pueden insertar logs"
      ON logs FOR INSERT
      TO anon, authenticated
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'logs' AND policyname = 'Solo authenticated puede leer logs'
  ) THEN
    CREATE POLICY "Solo authenticated puede leer logs"
      ON logs FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;
