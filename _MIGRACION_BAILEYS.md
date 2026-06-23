# Migración: whatsapp-web.js → Baileys v7

Fecha: 2026-06-23
Autor: OpenCode (Claude)
Commits: `969cb56` (principal), `afb42a4` (limpieza inventario previa)

## ¿Por qué?

El bot se caía cada ~30 minutos en la VM de GCP e2-micro (1GB RAM).
El proceso de Chrome de whatsapp-web.js consumía 300-600MB → OOM killer lo mataba → sesión se corrompía → loop infinito de QR/LOGOUT.

Solución: Reemplazar whatsapp-web.js (depende de Puppeteer + Chrome) por Baileys (WebSocket puro, sin navegador). Consumo de RAM baja a ~40-60MB.

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `bot.ts` | Reescribo 100%: toda la lógica de conexión, eventos y envío pasa de wwjs a Baileys |
| `package.json` | Reemplazo `whatsapp-web.js` por `@whiskeysockets/baileys@7.0.0-rc13` (pinned) |
| `package-lock.json` | Actualizado automáticamente por npm |
| `app/admin/layout.tsx` | Nav: quito "Inventario", agrego "Empleados" |
| `app/admin/page.tsx` | Dashboard: mismas tarjetas |
| `app/admin/empleados/page.tsx` | Nuevo: listar/editar números de empleados |
| `app/api/empleados/route.ts` | Nueva: CRUD empleados en Supabase |
| `_prompt_actualizado.txt` | Limpio referencias a inventario, sincronizado a Supabase |

## Diferencias clave entre wwjs y Baileys

| Concepto | whatsapp-web.js | Baileys |
|---|---|---|
| Auth | `LocalAuth('./.wwebjs_auth')` | `useMultiFileAuthState('./.baileys_auth')` |
| Conexión | `new Client({...})` | `makeWASocket({ auth, ... })` |
| QR | Evento `qr` | Callback en `connection.update` |
| Ready | Evento `ready` | `connection === 'open'` |
| Mensajes entrantes | `message_create` | `messages.upsert` |
| Enviar texto | `client.sendMessage(num, text)` | `sock.sendMessage(jid, { text })` |
| Enviar media | `MessageMedia.fromFilePath()` + `client.sendMessage()` | `sock.sendMessage(jid, { image: fs.readFileSync(...) })` |
| Descargar media | `msg.downloadMedia()` | `downloadContentFromMessage(msg, 'image')` |
| Formato número | `521234567890@c.us` | `521234567890@s.whatsapp.net` |
| Escribiendo | `chat.sendStateTyping()` | `sock.sendPresenceUpdate('composing', jid)` |
| Estado conexión | `client.getState()` | Variable `BOT_CONNECTION` (local) |
| Sincronización | `getChats()` / `fetchMessages()` manual | Auto-sincroniza al reconectar |
| Dependencia | Chrome + Puppeteer (300-600MB) | Solo Node.js (~40-60MB) |

## Lo que se eliminó de bot.ts

- `import { Client, LocalAuth, MessageMedia }` y todo lo de wwjs
- `pupPage`, listen `framenavigated` (monitoreo de página)
- `verificarPaginaViva()` (keepalive de Chrome)
- `recuperarMensajesPerdidos()` (wwjs no sincroniza solo; Baileys sí)
- Limpieza periódica de `.wwebjs_cache` (caché de Chrome)
- Manejo de `@c.us` / conversión de números
- Módulo `whatsapp-web.js` + Puppeteer + Chrome

## Lo que se agregó a bot.ts

- `import { makeWASocket, useMultiFileAuthState, downloadContentFromMessage, makeInMemoryStore, Browsers }`
- `BOT_CONNECTION` para trackear estado
- `verificarVersionBaileys()`: consulta npm registry cada 24h, alerta si hay versión nueva
- Log `pino` silenciado (`level: 'silent'`)

## Funciones preservadas (sin cambios en lógica)

- `generarContextoPrompt()` con detección de eventos, quejas, cancelaciones
- `validarPreciosEnRespuesta()` (post-AI price hallucination check)
- Notificaciones Telegram (`enviarAlerta*`)
- Notificaciones a empleados (`enviarFotosCliente`, `notificarEmpleado`)
- `buscarPrecioEnvio()` (municipios → zonas fallback)
- Detección de venta cerrada (token + keywords + "venta cerrada")
- Inyección de contexto de evento especial al prompt
- Cotizador con `cotizador.ts`

## En la VM

```bash
cd ~/jardin-roce-bot
git pull
npm install
sudo systemctl stop floreria-bot
rm -rf ~/jardin-roce-bot/.baileys_auth   # sesión corrupta
sudo systemctl start floreria-bot
sudo journalctl -u floreria-bot -f --no-hostname -o cat   # ver QR
```

## Mantenimiento

- No instalar Chrome ni Puppeteer en la VM.
- `BAILEYS_DATA_PATH` env var para cambiar ruta de sesión (default `./.baileys_auth`).
- El bot avisa en logs si hay versión nueva de Baileys en npm.
- La sesión se guarda en `.baileys_auth/` — borrar = requiere escanear QR de nuevo.
