# Manual de Operación — Jardín RoCe 🌸

## Si pasa esto... haz esto otro

---

### 🟢 El bot funciona normalmente
- **Dashboard:** Abre `/admin` → ves "WhatsApp: Conectado" y "Flora: Activa"
- **Los clientes:** Llegan solos, Flora los atiende
- **Ventas:** Llegan alertas a Telegram

### 🔴 El bot no responde / WhatsApp desconectado
1. Ve a `/admin` → mira si hay QR
2. **Sí hay QR** → Abre WhatsApp en tu celular → Menú ⋮ → WhatsApp Web → Escanea
3. **No hay QR** → Reinicia: `npm run bot` (o `systemctl restart floreria-bot`)
4. Si no se arregla en 10 min → Contacta al desarrollador

### 🟡 Bot activo pero responde mal
1. Ve a `/admin/prompt` → Revisa el system prompt
2. Corrige la instrucción que esté fallando
3. Guarda → el cambio se aplica en la siguiente conversación
4. Si siguió mal → pausa el bot: botón "Flora activa" en el menú de arriba
5. Contesta al cliente manualmente desde WhatsApp
6. Reanuda cuando esté listo

### 🧠 Quiero cambiar cómo habla Flora
1. Ve a `/admin/prompt`
2. Edita el textarea
3. Guarda
4. El historial de cambios está en el botón "📜 Historial"

### 🌷 Subir nuevo arreglo
1. Ve a `/admin/inventario`
2. Llena: Nombre, Precio, Descripción (opcional), Foto
3. Da clic en "Subir arreglo"
4. Flora lo mostrará automáticamente

### 🚚 Marcar arreglo como vendido/apartado
1. Ve a `/admin/inventario`
2. Busca la tarjeta del arreglo
3. Cambia el estado: Disponible → Apartado → Vendido

### 🏘️ Agregar zona de envío
1. Ve a `/admin/municipios`
2. Agrega manualmente o importa CSV
3. Columnas del CSV: `municipio, codigo_postal, colonia(opcional), zona, precio_envio`
4. Para exportar: clic en "Exportar CSV"

### 🔇 Silenciar un número (repartidor, admin)
1. Ve a `/admin/ignorados`
2. Agrega el número con descripción
3. Ese número será ignorado por Flora

### 📊 Ver ventas del día
1. Ve a `/admin` → El panel muestra ventas hoy
2. Las alertas de Telegram te notifican cada venta

### 💬 Cliente se queja / quiere cancelar
1. Flora detecta automáticamente las palabras clave
2. Recibirás una alerta en Telegram con 🚫 o ⚠️
3. Contesta al cliente directamente desde WhatsApp
4. Si necesitas cancelar: habla con el cliente, gestiona el reembolso

### ⏸️ Pausar el bot
1. Botón en la barra de navegación del admin: "Flora activa" → clic
2. Cambia a "Flora dormida"
3. Tú atiendes manualmente desde WhatsApp
4. Para reanudar: clic otra vez

### 🔄 El prompt se actualizó solo
- Hay historial en `/admin/prompt` → botón "📜 Historial"
- Ahí puedes ver quién cambió qué y cuándo
- Si algo salió mal, puedes restaurar contenido anterior

### 📱 Cliente pregunta por algo NO floral
- Flora ya está entrenada para redirigir al tema floral
- Si insiste, Flora responderá amablemente que solo sabe de flores

### 📦 Quiero ver reporte de ventas
- Las ventas se guardan automáticamente en `reporte_ventas`
- Disponible en el panel de admin y alertas de Telegram

### ⚙️ Comandos rápidos (servidor)
```bash
# Ver estado del bot
systemctl status floreria-bot

# Reiniciar bot
systemctl restart floreria-bot

# Ver logs en vivo
journalctl -u floreria-bot -f

# Iniciar manualmente
cd /home/alonso/floreria-agent-service
npm run bot:prod
```

---

## Contacto de soporte
- **WhatsApp:** +52 241 123 4567
- **Solo si:** El bot no arranca después de reiniciar, o hay un error técnico no listado aquí
