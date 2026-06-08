# Jardín RoCe — System Architecture & AI Assistant Guide

## ⚡ Objective

An AI-powered WhatsApp commerce assistant for **Jardín RoCe**, a Mexican flower shop in Apizaco, Tlaxcala. The system handles customer conversations via WhatsApp, manages inventory, processes sales, coordinates shipping, and provides admin controls — all autonomously through an AI agent named **Flora**.

**End goal:** A fully autonomous sales agent that handles 90%+ of customer interactions without human intervention, with graceful fallbacks for edge cases.

---

## 🏗 Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│  WhatsApp Client (Web)                                       │
│  User ↔ whatsapp-web.js (Puppeteer/Chromium)                 │
└────────────────────────┬─────────────────────────────────────┘
                         │ message_create event
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  bot.ts (1499 lines) — Main Bot Logic                        │
│                                                              │
│  manejarMensajeEntrante → rate limit → pause check → route   │
│    ├─ 📦 procesarPedidoWeb (web cotizador orders)            │
│    └─ 💬 procesarMensaje (all other messages)                │
│         ├─ Intent detection (inventario/catalogo/cotizador)  │
│         ├─ Context construction (inventory, shipping, etc.)  │
│         ├─ getAIResponse() → GPT-4o-mini via GitHub Models   │
│         ├─ Price validation (post-AI)                        │
│         ├─ Send reply + photos                               │
│         └─ Telegram alerts (sales, complaints, etc.)         │
│                                                              │
│  + Express server :10000 (status, pause, qr endpoints)        │
│  + Watchdog (zombie detection, crash recovery, memory mgmt)  │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  Next.js 16 — Admin Panel (port 3000)                        │
│                                                              │
│  /admin          → Dashboard + Bot Status + QR + Sales       │
│  /admin/inventario → CRUD arreglos_diarios                   │
│  /admin/prompt   → Edit System Prompt + history              │
│  /admin/municipios → Manage shipping zones + CSV import/export│
│  /admin/ignorados → Silenced phone numbers                    │
│  /admin/login    → Supabase Auth (email/password)             │
│                                                              │
│  API Routes (server-side, use service_role key):              │
│  GET/PUT  /api/prompt                                        │
│  GET      /api/prompt/history                                 │
│  GET/POST /api/inventario, PATCH/DELETE /api/inventario/[id] │
│  GET/POST /api/municipios, PUT/DELETE /api/municipios/[id]   │
│  POST     /api/municipios/import                              │
│  GET      /api/municipios/export                              │
│  GET/POST /api/ignorados, DELETE /api/ignorados/[id]          │
│  POST     /api/bot/pause                                      │
│  GET      /api/bot/status                                     │
│  GET/POST /api/reclamaciones                                  │
│  GET      /api/envios, DELETE /api/envios/[id] (legacy)       │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  Supabase (PostgreSQL + Storage)                             │
│                                                              │
│  Tables:                                                     │
│  ├─ arreglos_diarios         Inventory (name, price, photo)  │
│  ├─ clientes                 Registered clients (phone→UUID) │
│  ├─ historial_chat           Conversation history            │
│  ├─ municipios_envio         Shipping zones (precise data)   │
│  ├─ zonas_envio              Legacy shipping zones (keywords)│
│  ├─ configuracion_bot        System prompt storage (K/V)     │
│  ├─ configuracion_agente     Bot state (pause, QR code)      │
│  ├─ numeros_ignorados        Silenced phone numbers          │
│  ├─ historial_prompt         Prompt change history (NEW)     │
│  ├─ reclamaciones            Complaints/cancellations (NEW)  │
│  └─ reporte_ventas           Sales records (NEW)             │
│                                                              │
│  Storage bucket: arreglos-fotos (arrangement photos)         │
│  Auth: email/password for admin panel                        │
└──────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  Telegram Bot — Real-time Alerts to Admin                    │
│                                                              │
│  • New sale              (🌸 VENTA CERRADA)                  │
│  • Web order received    (🛒 PEDIDO VÍA COTIZADOR WEB)       │
│  • Shipping quote        (🌷 CLIENTE QUIERE COTIZACIÓN)      │
│  • Frustrated customer   (⚠️ CLIENTE NECESITA ATENCIÓN)      │
│  • Cancellation request  (🚫 SOLICITUD DE CANCELACIÓN) (NEW) │
│  • Complaint report      (⚠️ QUEJA DEL CLIENTE) (NEW)        │
│  • Disconnection alert   (📱 BOT DESCONECTADO)               │
│  • Daily summary         (☀️ BOT SIGUE DESCONECTADO)         │
└──────────────────────────────────────────────────────────────┘
```

---

## 💬 Conversation Flow (Detailed)

### 1. Message Reception (`bot.ts:1342`)
- `message_create` event from whatsapp-web.js
- Filters: group messages, broadcasts, LID without body, silenced numbers
- If `fromMe` (admin replying): saves to history as `[Agente: ...]`, skips processing
- If media type (image/video/audio): replies "solo texto"
- Rate limiting: max 8 msg/30s per client → "Voy un poco rápido"
- Bot pause check (5s cache + mutex)
- Routes: web order (`procesarPedidoWeb`) or normal message (`procesarMensaje`)
- Per-client queue: sequential processing via `encolarPorCliente`

### 2. Web Order Processing (`procesarPedidoWeb`)
- Triggers on text containing: `NUEVO PEDIDO` + `Florería RoCé` + `TOTAL A COBRAR`
- Parses: total, flowers, accessories, size, wrapping, delivery, notes, image URL
- Replies with: payment instructions (BBVA account)
- Sends Telegram alert with full order details

### 3. Normal Message Processing (`procesarMensaje`)

**a. Pre-processing (776-791)**
- Truncate to 1000 chars
- Check frustration keywords (21 keywords)
- Save to historial_chat
- Check quoted/reply messages → match to arrangement photo

**b. Intent Detection (499-519)**
```
inventario → "disponible", "fotos", "muestrame", "que tienes", "ramitos"
catalogo   → "catalogo", "drive", "ver mas", "otros ramos"
cotizador  → "cotizar", "cuanto cuesta", "armar un ramo", "pagina", "diseñar"
normal     → everything else (includes payment, shipping, etc.)
```
- If `VENTAS_CERRADAS` set → always returns `normal`
- If `FOTOS_PENDIENTES` → detects affirmative responses to photo offer

**c. Context Construction (797-1090)**
- Greeting context (first-time users): random from 5 options
- Date/time injection: `[Fecha actual: ...]` + horario context
- For `inventario`: adds list of available arrangements, sets `enviarFotos=true`
- For `catalogo`: adds Google Drive link
- For `cotizador`: in-hours → offer today's arrangements first; out-of-hours → web cotizador
- Google Maps detection: asks for neighborhood/municipality
- Municipality/zip detection: `buscarPrecioEnvio()` → exact shipping cost
- Quote/reply detection: identifies which arrangement photo user replied to
- **NEW** Cancellation detection → adds empathy context
- **NEW** Complaint detection → adds "report to team" context
- **NEW** Special events detection (wedding, funeral, etc.) → adds event-specific guidance
- Payment confirmation (KW_PAGO): adds close-sale instructions
- Post-sale state: does NOT offer new arrangements

**d. AI Call via `lib/ai.ts` (getAIResponse)**
- Loads system prompt from Supabase (60s cache, fallback to expired cache)
- Appends inventory context if provided
- Calls GitHub Models (Azure): `gpt-4o-mini` or env override
- Retry with exponential backoff: 3 attempts (500ms/1s/2s + jitter)
- Timeout: 15 seconds (AbortController)
- Max tokens: 800, Temperature: 0.7
- Empty response fallback: "Lo siento, no pude procesar..."
- Parses `[VENTA_CERRADA: ...]` token from response

**e. Post-Processing (1100-1270)**
- **NEW** Price validation: `validarPreciosEnRespuesta()` checks mentioned prices against real inventory, logs warnings on hallucination
- Clean response: remove markdown links, Supabase URLs, internal annotations
- Typing simulation delay (600-2500ms based on message length)
- Send reply
- **NEW** Cancel/Complaint alerts: if keywords detected, send Telegram alert
- Ventas: if token detected → Telegram alert + mark arrangement as `apartado` + save to `reporte_ventas`
- Fallback: if client confirmed payment but AI didn't generate token → still alert
- Manual override: if "venta cerrada" typed → same flow
- Telegram alerts for: shipping quote, cotizador, frustration (first 2 occurrences)

**f. Photo Sending (674-702)**
- Downloads images from Supabase Storage
- Sends with caption (name + price + description)
- 200ms delay between photos
- Handles "Execution context destroyed" (aborts batch)

**g. Error Handling (1083-1117)**
- Puppeteer errors (context destroyed, protocol error, target closed) → silent return
- Other errors → "mareo digital" apology + retry (unless rescued message)

### 4. Orphaned Message Recovery (1125-1166)
- 10s after ready: fetches chats with unread count > 0
- Processes in batches of 2
- Injects into `manejarMensajeEntrante`
- Failed rescued messages: silent failure (no "mareo digital")

---

## 🗄 Database Schema

### `arreglos_diarios` — Daily arrangements
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Auto-generated |
| nombre | TEXT | Arrangement name |
| descripcion | TEXT | Optional description |
| precio | NUMERIC(10,2) | Price in MXN |
| foto_url | TEXT | Supabase Storage URL |
| estado | TEXT | 'disponible' \| 'apartado' \| 'vendido' |
| creado_en | TIMESTAMPTZ | Created at |
| actualizado_en | TIMESTAMPTZ | Updated at |

### `clientes` — Client registry
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Auto-generated |
| telefono | TEXT | Phone number (format: +52...) |
| creado_en | TIMESTAMPTZ | Created at |

### `historial_chat` — Conversation history
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Auto-generated |
| cliente_id | UUID FK→clientes | Client reference |
| rol | TEXT | 'user' \| 'assistant' |
| contenido | TEXT | Message content |
| creado_en | TIMESTAMPTZ | Created at |

### `municipios_envio` — Shipping zones (precise)
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Auto-generated |
| municipio | TEXT | Municipality name |
| codigo_postal | TEXT | ZIP code |
| colonia | TEXT | Optional neighborhood |
| zona | TEXT | Zone name (e.g. "Cercana") |
| precio_envio | NUMERIC(10,2) | Shipping price |
| creado_en | TIMESTAMPTZ | Created at |

### `zonas_envio` — Legacy shipping zones
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Auto-generated |
| zona | TEXT | Zone name |
| precio | NUMERIC(10,2) | Shipping price |
| palabras_clave | TEXT | Comma-separated keywords |
| creado_en | TIMESTAMPTZ | Created at |

### `configuracion_bot` — System prompt storage
| Column | Type | Description |
|--------|------|-------------|
| clave | TEXT PK | 'system_prompt' |
| valor | TEXT | Prompt content |
| actualizado_en | TIMESTAMPTZ | Updated at |

### `configuracion_agente` — Bot state
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Always 1 |
| qr_code | TEXT | Current QR for WhatsApp Web |
| bot_pausado | BOOLEAN | Is bot paused |

### `numeros_ignorados` — Silenced numbers
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Auto-generated |
| numero | TEXT | Phone number (digits only) |
| descripcion | TEXT | Optional note |
| creado_en | TIMESTAMPTZ | Created at |

### `historial_prompt` — Prompt change history (NEW)
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Auto-generated |
| prompt_anterior | TEXT | Previous prompt |
| prompt_nuevo | TEXT | New prompt |
| editado_por | TEXT | 'admin' (default) |
| creado_en | TIMESTAMPTZ | Created at |

### `reclamaciones` — Complaints/Cancellations (NEW)
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Auto-generated |
| cliente_telefono | TEXT | Client phone |
| tipo | TEXT | 'cancelacion' \| 'queja' \| 'devolucion' \| 'otro' |
| descripcion | TEXT | Details |
| arreglo_referencia | TEXT | Optional reference |
| estado | TEXT | 'pendiente' \| 'en_proceso' \| 'resuelto' |
| creado_en | TIMESTAMPTZ | Created at |
| actualizado_en | TIMESTAMPTZ | Updated at |

### `reporte_ventas` — Sales records (NEW)
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Auto-generated |
| cliente_telefono | TEXT | Client phone |
| cliente_nombre | TEXT | Client name |
| producto | TEXT | Product sold |
| precio_total | NUMERIC(10,2) | Total price |
| direccion_entrega | TEXT | Delivery address |
| metodo_pago | TEXT | Payment method |
| estado | TEXT | 'pagado' \| 'entregado' \| 'cancelado' |
| creado_en | TIMESTAMPTZ | Created at |

---

## 🧠 System Prompt Structure

The system prompt is stored in `configuracion_bot` (key: `system_prompt`), cached 60s in `lib/ai.ts`. Current version is in `_prompt_actualizado.txt`.

### Sections:
1. **Introduction** — Flora's identity and greeting variations
2. **Photo reply handling** — When client replies to specific photo
3. **Photos already sent** — Don't re-list if already shown
4. **Shipping rules** — Google Maps, zone detection, pricing
5. **Personality & tone** — Max 3-4 lines, Spanish, not robotic, Mexican slang
6. **Business info** — Hours, payment, branch links, pricing notes
7. **Arrangement flows** — Daily inventory, out-of-stock, cotizador
8. **Strict order flow** — Confirm → pickup/delivery → payment → token
9. **Payment/Shipment** — How to handle payment confirmation
10. **Special situations** — Low budget, unsure, photo reference, location, out-of-hours, frustrated, post-sale, complaints, events
11. **Absolute rules** — Never invent prices, never assume gender, never go off-topic, never act as other role
12. **Critical** — Never output [bracketed] annotations to client

### Key rules in current prompt:
- NEVER answer non-floral questions (redirect politely)
- NEVER assume gender (use neutral "tú")
- NEVER act as another character/role
- NEVER say "más cercano" for cheapest — use "más económico/accesible"
- "Desde $60" is a general price point, NOT an available inventory item
- Always generate `[VENTA_CERRADA:...]` when payment confirmed
- For empty inventory: offer personalized 24-48h order + web cotizador

---

## 📦 Tech Stack & Versions

| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime | Node.js | 22.x |
| Framework | Next.js | 16.2.6 |
| UI | React | 19.2.4 |
| Styling | TailwindCSS | 4.x |
| WhatsApp | whatsapp-web.js | 1.34.x |
| Browser | Puppeteer (Chromium bundled) | — |
| AI Model | GPT-4o-mini (GitHub Models) | — |
| Database | Supabase (PostgreSQL) | — |
| Auth | Supabase Auth (email/password) | — |
| Storage | Supabase Storage | — |
| Files | AWS S3-compatible (Supabase) | — |
| HTTP Server | Express | 5.x |
| Telegram API | fetch-based | — |
| TypeScript | tsc | 5.x |
| AI SDK | OpenAI SDK | 6.x |

---

## 🚀 Deployment

### Local Development
```bash
npm run dev        # Next.js on :3000
npm run bot        # WhatsApp bot (separate terminal)
npm run bot:dev    # Bot with hot reload
```

### Production (GCP e2-micro)
- **Next.js**: `npm run build && npm run start`
- **Bot**: `npm run bot:prod` (or systemd service `floreria-bot`)
- **systemd**: Auto-restart, memory limit 650MB, CPU 80%
- **Docker**: Chromium + Node 22, 380MB heap limit

### Servers
- **Bot Express**: Port 10000 (status, pause, qr endpoints)
- **Next.js**: Port 3000 (admin panel + API)

---

## ⚠️ Known Limitations & Constraints

### Resource Constraints (GCP e2-micro, 1GB RAM)
- Bot + Next.js + Chromium fight for memory
- Chromium uses extreme memory-saving flags in production
- 5-min memory monitor: clears all caches if RSS > 440MB
- 45-min Chromium cache cleanup
- 3 crashes in 10 min → deletes WhatsApp session (starts fresh)

### AI Limitations
- Model: GPT-4o-mini (cheap but can hallucinate)
- 800 max tokens per response (limits creativity)
- 15s timeout (AI may be slow)
- 3 retry attempts with backoff
- No fallback if ALL 3 retries fail → "mareo digital" message
- Price validation is WARNING only (does NOT block the message)

### WhatsApp Limitations
- Session stored locally (`.wwebjs_auth/`) — fragile
- LID (Low-Integrity Device) numbers need special handling
- QR expires after ~60s if not scanned
- Zombie detection: 15 min without activity → restart
- No webhook verification on cotizador messages
- Puppeteer can crash from memory pressure

### Conversation Gaps (not fully covered)
- **Facturación** — No invoicing flow
- **Pedidos anticipados** — No scheduling for future dates
- **Descuentos/promociones** — No discount management
- **Múltiples productos en una venta** — Each sale = 1 product
- **Pago con tarjeta en línea** — Only BBVA transfer or cash on pickup
- **Notificaciones al cliente post-venta** — No tracking updates
- **Integración con inventario físico** — Relies on admin manually updating status

### Code Quality Issues
- `bot.ts` is 1726 lines (monolithic, should be split)
- No test coverage
- Google Sheets integration (`lib/googleSheets.ts`) is dead code (imported but never called)
- Empty `lib/sheets.ts` file
- `app/page.tsx` is default Next.js boilerplate
- Hardcoded values: BBVA account, Google Drive URL, cotizador URL, dashboard URL

---

## 🔮 Roadmap & Future Improvements

### 1. Immediate Fixes (pre-production)
- [x] Off-topic rules in prompt
- [x] Gender neutrality
- [x] Post-AI price validation
- [x] Cancel/complaint flows
- [x] Special events handling
- [ ] Refactor `bot.ts` into modules
- [ ] Add webhook HMAC for cotizador verification

### 2. Short-term
- [ ] Invoicing flow (RFC, CFDI data collection)
- [ ] Advance order scheduling (date picker flow)
- [ ] Discount/promotion codes
- [ ] Multiple products per sale
- [ ] Post-sale tracking messages
- [ ] Export reporte_ventas CSV
- [ ] Unit tests (vitest)

### 3. Medium-term
- [ ] Real inventory sync (physical stock → digital)
- [ ] Admin panel for reclamaciones (mark as resolved)
- [ ] Bot auto-reply templates for common scenarios
- [ ] Dashboard charts (sales trends, popular products)

### 4. Long-term
- [ ] Multi-branch support (separate inventory per sucursal)
- [ ] Online payment gateway (Stripe/MercadoPago)
- [ ] Customer loyalty program
- [ ] Mobile app for admin

---

## 🛠 How to Contribute

### Key Files to Know

| File | Purpose | Lines |
|------|---------|-------|
| `bot.ts` | Main bot logic | ~1726 |
| `lib/ai.ts` | AI integration (prompt loading, retry, token parsing) | ~199 |
| `lib/telegram.ts` | Telegram alert functions | ~271 |
| `lib/types.ts` | TypeScript interfaces | ~88 |
| `lib/supabase.ts` | Admin Supabase client (service_role) | ~42 |
| `lib/supabase-client.ts` | Browser Supabase client (anon key) | ~8 |
| `componets/admin/ArregloCard.tsx` | Arrangement card component | ~67 |
| `componets/admin/PromptEditor.tsx` | Prompt editor component | ~72 |
| `componets/admin/SubirArregloForm.tsx` | Upload form component | ~108 |
| `componets/admin/QrSection.tsx` | QR display component | ~57 |
| `app/admin/page.tsx` | Admin dashboard | ~176 |
| `app/admin/layout.tsx` | Admin layout (nav, pause, QR) | ~217 |
| `_prompt_actualizado.txt` | System prompt content | ~200+ |
| `_MANUAL_OPERACION.md` | Operations manual | ~103 |
| `supabase_migration_historial.sql` | New tables SQL | ~41 |

### Common Tasks
- **Edit AI behavior**: Update `_prompt_actualizado.txt`, then paste in `/admin/prompt`
- **Add alert type**: Add function in `lib/telegram.ts`, call from `bot.ts`
- **Add intent detection**: Add keywords in `KW_INVENTARIO`/`KW_CATALOGO`/`KW_COTIZADOR`
- **Add context injection**: Add if-block in `procesarMensaje` context section (800-910)
- **Add API route**: Create file in `app/api/<name>/route.ts`
- **Add admin page**: Create file in `app/admin/<name>/page.tsx`

### Coding Conventions
- TypeScript, strict mode
- TailwindCSS for styling, gradient backgrounds, rounded-2xl/3xl
- React 19, functional components, hooks
- Next.js 16 App Router (file-based routing)
- Supabase Admin API for server-side, Browser API for client
- Imports: `@/` alias for root
- Spanish comments and variable names where domain-specific
- Error-first logging with `[module]` prefix

### Testing
- No tests currently — add vitest + supertest for API routes
- Manual testing: run bot, send WhatsApp messages

---

## 📞 Support Contacts
- **Developer**: WhatsApp available (emergency only)
- **System prompt issues**: `/admin/prompt` to edit
- **Bot not running**: SSH → `systemctl restart floreria-bot`
- **WhatsApp disconnected**: Scan QR in `/admin`

---

*This document should be updated whenever significant architectural changes are made.*
