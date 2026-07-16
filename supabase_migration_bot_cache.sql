-- Bot Cache: persistencia para Maps de estado en src/whatsapp/bot-state.ts
CREATE TABLE IF NOT EXISTS bot_cache (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
