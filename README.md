# Flora — Asistente Virtual de Jardín RoCe

**Flora** es un sistema CRM conversacional especializado en florerías. Su canal principal es WhatsApp, y está diseñada para administrar el ciclo completo de atención al cliente: desde el primer mensaje hasta la postventa, pasando por cotización, pedido, pago, producción y entrega.

> No es un chatbot. Es una empleada digital cuyo backend toma todas las decisiones críticas. El LLM (OpenAI/GitHub Models) únicamente redacta respuestas con base en información validada por el sistema.

---

## Stack Tecnológico

| Componente | Tecnología |
|---|---|
| Runtime | Node.js 22 + TypeScript 5 |
| WhatsApp | `@whiskeysockets/baileys` v7 (sin navegador) |
| IA | OpenAI SDK → GitHub Models (Azure `gpt-4o-mini` / `gpt-4o`) |
| Base de datos | Supabase (PostgreSQL) |
| Bot API Express | Express 5 (puerto 10000) |
| Dashboard | Next.js 16 + React 19 + Tailwind 4 |
| Autenticación | NextAuth |
| Infraestructura | Docker en GCP e2-micro (bot) + Vercel (dashboard) |

---

## Arquitectura

```
WhatsApp → Conversation Engine → Decision Engine → Case Engine
                                                      ↓
                                               Order Engine
                                                      ↓
                                            Validation Engine
                                                      ↓
                                              Event Engine
                                                    ↙    ↘
                                          Telegram     Prompt Builder
                                                          ↓
                                                       OpenAI
                                                          ↓
                                                   WhatsApp ←
```

### Motores Internos

| Módulo | Ruta | Responsabilidad |
|---|---|---|
| **Decision Engine** | `src/decision/` | Clasifica intención (20 tipos), prioridad, detecta cambios de tema |
| **Conversation Engine** | `src/conversation/` | Historial en Supabase, deduplicación, caché de clientes |
| **Case Engine** | `src/casos/` | Ciclo de vida de casos (crear, archivar, detectar cambio de tema) |
| **Order Engine** | `src/pedidos/` | Máquina de estados del pedido, transiciones, persistencia |
| **Event Engine** | `src/events/` | EventBus con tipado fuerte, retry, suscripción por tipo |
| **Parsers** | `src/parser/` | Nombre, fecha, hora, sucursal, dirección, precio, teléfono |
| **Validators** | `src/validators/` | Horario, sucursal, envío, pago, cancelación, queja |
| **Notification Engine** | `src/notification-engine/` | Pipeline de notificaciones, detección de conflictos, auditoría |
| **Prompt Builder** | `src/openai/` | Construye contexto dinámico para el LLM |

### Máquina de Estados del Pedido

```
NUEVO → COTIZANDO → PRECIO_CONFIRMADO → ESPERANDO_DATOS
       → ESPERANDO_PAGO → APARTADO → EN_PRODUCCION → LISTO
       → ENTREGADO → ARCHIVADO

Alternativos: CANCELADO, QUEJA, POSTVENTA
```

Cada transición se valida contra una tabla de transiciones permitidas y emite eventos al `EventBus`.

---

## Requisitos

- Node.js 22+
- npm
- Cuenta en **Supabase** (con las migraciones SQL ya aplicadas)
- Cuenta en **GitHub** (para GitHub Models — Azure OpenAI)
- Cuenta de **Telegram** (opcional, para notificaciones operativas)
- **Google Cloud** (opcional, para deploy del bot)

---

## Variables de Entorno

Usa `.env.example` como plantilla. Cópiala a `.env.local` y completa los valores:

```bash
cp .env.example .env.local
```

### Variables Requeridas

| Variable | Descripción |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key de Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (para operaciones admin) |
| `GITHUB_TOKEN` | Token de GitHub con acceso a GitHub Models |
| `GITHUB_MODEL` | Modelo principal (ej: `gpt-4o-mini`) |
| `GITHUB_REVIEW_MODEL` | Modelo para clasificación/revisión |
| `GITHUB_VISION_TOKEN` | Token con acceso a Vision API |
| `TELEGRAM_BOT_TOKEN` | Token del bot de Telegram |
| `TELEGRAM_CHAT_ID` | IDs de chat de Telegram (separados por coma) |
| `GOOGLE_SHEET_ID` | ID del Google Sheet de respaldo |
| `GOOGLE_CLIENT_EMAIL` | Email de cuenta de servicio Google |
| `GOOGLE_PRIVATE_KEY` | Llave privada de Google Service Account |
| `ADMIN_EMAIL` | Email del admin del dashboard |
| `ADMIN_PASSWORD` | Contraseña del dashboard |

---

## Instalación y Ejecución

### 1. Clonar e instalar dependencias

```bash
git clone <repo-url> floreria-agent-service
cd floreria-agent-service
npm install
```

### 2. Configurar Supabase

Las migraciones SQL están en archivos `supabase_migration_*.sql` en la raíz. Si es la primera vez, ejecútalos en orden en el SQL Editor de Supabase:

```
supabase_migration_historial.sql
supabase_migration_pedidos_bot.sql
supabase_migration_casos.sql
supabase_migration_bot_cache.sql
supabase_migration_municipios.sql
supabase_migration_logs.sql
supabase_migration_ignorados.sql
supabase_migration_completa.sql
```

> Ya aplicado en producción — solo necesario si clonas la BD desde cero.

Luego, en la tabla `configuracion_bot`, inserta el system prompt:

```bash
npx tsx --env-file=.env.local scripts/update-system-prompt.ts
```

### 3. Ejecutar el Bot (WhatsApp)

```bash
# Modo desarrollo (hot reload)
npm run bot:dev

# Modo producción
npm run bot

# Con límite de memoria explícito
npm run bot:prod
```

El bot se conectará a WhatsApp escaneando un código QR en la terminal. En el primer arranque se genera la carpeta `.baileys_auth/` con la sesión.

### 4. Ejecutar el Dashboard (Next.js)

```bash
# Desarrollo
npm run dev

# Producción
npm run build && npm start
```

El dashboard corre en el puerto 3000 por defecto.

---

## Estructura del Proyecto

```
├── bot.ts                    # Entry point del bot WhatsApp (orquestador)
├── Dockerfile                # Imagen Docker para GCP
├── lib/                      # Código legacy (IA, Supabase, Telegram, tipos)
│   ├── ai.ts                 # Motor LLM (OpenAI, clasificación, revisión)
│   ├── supabase.ts           # Cliente Supabase admin
│   ├── telegram.ts           # Cliente Telegram
│   └── types.ts              # Tipos compartidos legacy
├── src/                      # Arquitectura nueva (modular)
│   ├── api/server.ts         # Express API (status, QR, diag, sync)
│   ├── casos/                # Case Engine
│   ├── conversation/         # Conversation Engine
│   ├── decision/             # Decision Engine + intent-detector
│   ├── events/               # EventBus, tipos, suscriptores
│   ├── models/types.ts       # Enums e interfaces oficiales
│   ├── notification-engine/  # Pipeline de notificaciones
│   ├── openai/prompt.builder.ts  # Prompt Builder
│   ├── orchestrator.ts       # Pre-procesamiento de mensajes
│   ├── parser/               # Parsers especializados (7 tipos)
│   ├── pedidos/              # Order Engine
│   ├── validators/           # Validadores de reglas de negocio
│   └── whatsapp/             # Utilidades, estado, handlers
├── app/                      # Dashboard Next.js (App Router)
├── tests/                    # Pruebas de integración
├── scripts/                  # Utilidades (build, update-prompt)
└── supabase_migration_*.sql  # Migraciones de BD
```

---

## Pruebas

```bash
# Pruebas de flujo de conversación
npm run test:flows

# Pruebas de conexión del EventBus
npm run test:wire

# Pruebas de validación de horarios
npm run test:horario
```

---

## Diagrama de Flujo de un Mensaje

Cada mensaje de WhatsApp sigue este orden exacto:

1. Guardar mensaje en Supabase
2. Actualizar historial de conversación
3. Actualizar última actividad del cliente
4. Buscar/crear caso activo
5. Buscar/crear pedido activo
6. Analizar intención (Decision Engine)
7. Detectar cambio de tema
8. Actualizar estado del caso/pedido
9. Ejecutar validaciones (horario, sucursal, envío, pago)
10. Emitir eventos necesarios
11. Construir contexto para el LLM (Prompt Builder)
12. Enviar a OpenAI (con clasificación + revisión)
13. Validar respuesta (Response Validator)
14. Enviar a WhatsApp
15. Guardar respuesta en historial

---

## API del Bot (Express — puerto 10000)

| Ruta | Método | Descripción |
|---|---|---|
| `/` | GET | Health check |
| `/status` | GET | Estado completo del bot |
| `/qr` | GET | QR actual (si no conectado) |
| `/pause` | POST | Pausar bot |
| `/resume` | POST | Reanudar bot |
| `/reconnect` | POST | Reiniciar conexión WhatsApp |
| `/recover` | POST | Forzar rescate |
| `/diag/:chatId` | GET | Diagnóstico de un chat |
| `/api/pedidos/sync` | POST | Sincronizar pedido desde dashboard |
| `/metrics` | GET | Métricas internas |

---

## Deploy

### Bot en GCP VM (e2-micro)

```bash
# Construir imagen
docker build -t floreria-bot .

# Ejecutar
docker run -d \
  --name floreria-bot \
  --restart unless-stopped \
  -p 10000:10000 \
  -v $(pwd)/.baileys_auth:/app/.baileys_auth \
  --env-file .env.local \
  floreria-bot
```

> La sesión de WhatsApp se persiste en `.baileys_auth/`. Montarla como volumen evita escanear QR cada reinicio.

### Dashboard en Vercel

Conecta el repositorio a Vercel. El framework se detecta automáticamente como Next.js. Configura las variables de entorno en el panel de Vercel.

---

## Mantenimiento

### Watchdog de Memoria

El bot incluye un watchdog que cada 10 minutos:
- Archiva casos inactivos (>72h)
- Archiva pedidos inactivos (>72h)
- Limpia cachés de conversación
- Limpia cachés de estado global
- Reporta uso de memoria RSS

### Persistencia de Estado

El estado global del bot (pedidos en RAM, rate limiters, dedup) se persiste en Supabase cada 30 segundos y se restaura al iniciar. Esto asegura que un reinicio no pierda pedidos activos.

### Logs

- `logger.service.ts` — Logs estructurados por nivel y módulo
- `metrics.service.ts` — Métricas de IA, mensajes, errores
- `bot-state-persistence.ts` — Persistencia periódica del estado

---

## Debugging

### Diagnóstico de un Chat

```bash
curl http://localhost:10000/diag/<chatId>
```

O desde el dashboard:

```
GET https://<vercel>/api/bot/diag/<chatId>
```

### Endpoints de Diagnóstico

- Ver QR vigente: `GET /qr`
- Estado completo: `GET /status`
- Forzar reinicio: `POST /reconnect`

### Errores Comunes

| Problema | Causa Posible | Solución |
|---|---|---|
| Bot no responde WhatsApp | Sesión expirada | Escanear QR de nuevo |
| "Provider Failure" en logs | GitHub Models sin créditos/rate limit | Verificar `GITHUB_TOKEN` |
| Pedido no se registra | Order Engine no sincronizado | Verificar `SUPABASE_SERVICE_ROLE_KEY` |
| Telegram no notifica | EventBus no suscrito | Verificar `TELEGRAM_BOT_TOKEN` |
| Error de memoria en e2-micro | RSS alto | Usar `NODE_OPTIONS=--max-old-space-size=380` |

---

## Reglas de Negocio (Backend)

Las reglas críticas viven en TypeScript, **no en el prompt**:

- `src/validators/horario.validator.ts` — Horarios de apertura por sucursal
- `src/validators/sucursal.validator.ts` — Validación de sucursales
- `src/validators/envio.validator.ts` — Zonas y costos de envío
- `src/validators/pago.validator.ts` — Cuentas bancarias e instrucciones
- `src/validators/cancelacion.validator.ts` — Política de cancelaciones
- `src/validators/queja.validator.ts` — Protocolo de quejas
- `src/pedidos/pedido.service.ts` — Máquina de estados y transiciones válidas

---

## Referencias

- [AGENTS.md](AGENTS.md) — Reglas de arquitectura para desarrolladores IA
- [DECISIONS.md](DECISIONS.md) — Decisiones técnicas históricas
- [TODO.md](TODO.md) — Estado actual del proyecto y pendientes
- [CHANGELOG.md](CHANGELOG.md) — Registro de cambios por versión
- [KNOWN_BUGS.md](KNOWN_BUGS.md) — Errores conocidos
- [PROJECT_TRACKER.md](PROJECT_TRACKER.md) — Seguimiento de implementación
