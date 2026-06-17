# Changelog — 17 Jun 2026

## Arquitectura del proyecto (resumen)

```
WhatsApp Web ←→ whatsapp-web.js (Puppeteer/Chromium) → bot.ts → lib/ai.ts (GPT-4o-mini) → Supabase
```

- `bot.ts`: Monolito (~2547 lines) con todo el flujo: recepción, detección de intención, contexto, IA, envío, watchdog
- Chromium sin headless en GCP e2-micro (1GB RAM) con flags extremos de ahorro de memoria
- Watchdog cada 2 min: chequea estado, detecta zombies, fuerza reinicio/reconexión
- Mensajes huérfanos se rescatan vía `recuperarMensajesPerdidos()` después de reconexión

---

## Problemas detectados (producción, logs de hoy)

### 1. Mensaje nunca entregado pese a "✅ Listo"
- `message.reply` → ❌ "Failed to find row in chat table"
- `chat.sendMessage` (fallback) → ❌ "Lid is missing in chat table"
- El código seguía como si nada y logueaba `✅ Listo para ...`
- **Causa raíz:** Mensajes rescatados usan un `lid` que WhatsApp Web aún no tiene indexado en su base de datos local

### 2. Bot entra en UNPAIRED y nunca se recupera
- Después de las recargas de Chromium y los fallos de envío, el estado cambia a `UNPAIRED`
- Watchdog veía `UNPAIRED`, logueaba "esperando próximo ciclo" y hacía `return` — **acción = 0**

---

## Cambios realizados

### Archivo: `bot.ts`

#### a) Tercer fallback de envío (línea ~1620)
```
message.reply → falló → chat.sendMessage → falló → whatsappClient.sendMessage(clienteId, msg)
```
`whatsappClient.sendMessage()` usa una ruta diferente y funciona aunque el chat table esté desincronizado.

#### b) "✅ Listo" condicional (línea ~1836)
- Solo se loguea si `mensajeEnviado === true`
- Si fallan los 3 métodos → `❌ No se pudo enviar mensaje a ... — los 3 métodos fallaron`

#### c) Watchdog reconecta automáticamente en UNPAIRED (línea ~2173)
- Estados reconectables: `UNPAIRED`, `DISCONNECTED`, `UNKNOWN`, `PROXYBLOCK`, `DEPRECATED_VERSION`
- Al detectarlos → llama `reconectarWhatsapp()` inmediatamente
- Ya no resetea `ultimaActividad` evitando falsos positivos

---

## Commits

| Commit | Descripción |
|--------|-------------|
| `8fc4503` | fix: disable dumpio and GCM to stabilize Chromium, reduce reloads |
| `b6dd863` | fix: detect zombie state faster after WA Web reload with page health check |
| `01ae65c` | fix: third send fallback via whatsappClient.sendMessage, conditional ✅ Listo, watchdog auto-reconnect on UNPAIRED |
| `e4b99e2` | fix: timeout 90s en initialize() + watchdog force-exit si reconexión atorada >3 min |
| `12f7a91` | fix: refactor inicializarBot(), force-ready 120s, retry media con reintento 3x |
| `478cb8a` | fix: envio score 180, validador tolera ramo+envio, imagen comprobante cierra venta + telegram |

---

### d) Timeout en reconexión + watchdog anti-atoro (fix #2)
- `whatsappClient.initialize()` ahora tiene **timeout de 90s** via `Promise.race` — si cuelga, lanza error y el `catch` hace `process.exit(1)`
- Nueva variable `RECONNECT_START` para trackear cuándo empezó la reconexión
- Watchdog verifica: si `BOT_RECONNECTING` lleva **>3 min activo**, fuerza `process.exit(1)` (en ambos lugares donde antes ignoraba el estado)
- `RECONNECT_START` se resetea al reconectar exitosamente o al fallar
- **Problema que resuelve:** Bot quedaba atorado para siempre en "Reconexión/recarga en curso — esperando..." porque `initialize()` colgaba sin resolver (por RAM insuficiente en e2-micro) y el watchdog no tenía timeout

### e) Refactor: extraer `inicializarBot()` + force-ready si `ready` no llega (fix #3)
- El evento `ready` de whatsapp-web.js es **intermitente**: a veces el estado es CONNECTED pero `ready` nunca se dispara
- Se extrajo toda la lógica de inicialización a `inicializarBot(origen)` — llamada desde `ready` Y desde el startup watchdog
- Startup watchdog: si tras **120s CONNECTED sin `ready`**, fuerza `inicializarBot('forzado')` automáticamente
- **Problema que resuelve:** Antes el bot esperaba 600s y reiniciaba en ciclo infinito si `ready` no llegaba — ahora opera aunque `ready` nunca dispare

### f) Retry al enviar fotos con `enviarMediaConReintento()` (fix #4)
- Nueva función con hasta 3 intentos y backoff progresivo (3s, 6s)
- Captura específica del error `"media entry was not created"` que ocurría cuando WhatsApp Web no estaba listo
- Los errores de recarga/contexto destruido siguen abortando el lote inmediatamente
- **Problema que resuelve:** `Error enviando "Ramo 3 girasoles": upload failed: media entry was not created` — ahora reintenta y eventualmente funciona

---

## Pruebas para verificar la solución

1. **Simular fallo de envío en mensaje rescatado:**
   - Detener el bot, enviar un WhatsApp, arrancar el bot
   - El bot rescata el mensaje, intenta responder
   - Verificar que `whatsappClient.sendMessage()` entrega el mensaje aunque `message.reply` falle
   - En logs: debe aparecer `✅ Listo`, no `❌ No se pudo enviar`

2. **Simular UNPAIRED:**
   - Desde el teléfono: WhatsApp > Dispositivos vinculados > Cerrar sesión
   - Watchdog debe detectar UNPAIRED en máximo 2 min y llamar `reconectarWhatsapp()`
   - Debe generar nuevo QR (visible en `/admin`)
   - Escanear QR → bot debe volver a CONNECTED

3. **Verificar estabilidad post-cambios:**
   - Dejar corriendo 30+ min
   - Sin recargas continuas ni UNPAIRED espontáneo
   - Los mensajes se responden sin errores de chat table

---

## Fixes adicionales (ronda 2)

### g) Score de envío más estricto (120 → 180)
- Se elevó el umbral `esMatchFuerte` de 120 a 180 en `buscarPrecioEnvio()`
- **Problema que resuelve:** Zonas con score bajo (como "Cuaxomulco" con score 130) ahora se marcan como ambiguas y la AI pide más datos en vez de dar un precio incorrecto

### h) Validador de precios tolera ramo + envío
- `validarPreciosEnRespuesta()` ahora acepta un parámetro `envioPrecio` opcional
- Si el monto mencionado = precio_arreglo + precio_envío, se considera válido
- **Problema que resuelve:** IA decía "$310 MXN" ($260 ramo + $50 envío) y el validador lo marcaba como error, impidiendo apartar el arreglo

### i) Imagen de comprobante cierra venta y se reenvía a Telegram
- `enviarFotoTelegram()` en `lib/telegram.ts` — envía foto en base64 a Telegram via `sendPhoto`
- Cuando un cliente en proceso de compra envía una imagen, el bot:
  - Agradece y confirma registro del comprobante
  - Descarga la imagen y la reenvía a Telegram con caption
  - Marca la venta como cerrada con todos los datos del pedido
- **Problema que resuelve:** Antes decía "solo puedo leer mensajes de texto" — ahora procesa comprobantes automáticamente
