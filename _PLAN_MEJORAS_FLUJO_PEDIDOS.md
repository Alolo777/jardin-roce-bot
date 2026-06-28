# Plan de Mejoras — Flujo de Pedidos Flora

Este documento resume los cambios que queremos implementar para que Flora atienda mejor, no mezcle pedidos, mande alertas correctas y registre bien ventas/apartados.

## Contexto

Proyecto: `floreria-agent-service` / bot Jardín RoCe.

Canales:
- WhatsApp por Baileys en `bot.ts`.
- Prompt activo en Supabase: `configuracion_bot.clave = 'system_prompt'`.
- Prompt local de referencia: `_prompt_actualizado.txt`.
- Dashboard: `/admin`, API `app/api/bot/status/route.ts`.
- Pedidos operativos: tabla `pedidos_bot`.
- Ventas pagadas: tabla `reporte_ventas`.

Situación actual:
- El bot ya recibe imágenes de referencia y puede reenviarlas a Telegram/WhatsApp empleados.
- El historial ya se subió a 30 turnos.
- Se corrigió el crash de media `buffer.toString(...) is not a function`.
- Se corrigió parcialmente la clasificación de foto referencia vs comprobante.
- Sigue faltando formalizar el flujo completo de estados para evitar mezclas y mejorar alertas/dashboard.

## Decisiones De Negocio Confirmadas

1. Solo debe existir un pedido activo por cliente.
2. Si un pedido ya se cerró/apartó y el cliente pide otro, el nuevo pedido debe iniciar desde cero.
3. Cotizaciones y pedidos personalizados con foto deben pasar al equipo, no cerrarse automáticamente por la IA.
4. Cuenta como venta cuando:
   - El cliente paga por transferencia.
   - El cliente manda comprobante.
   - El cliente confirma que pagará en efectivo/tarjeta al recoger en sucursal.
5. Efectivo/tarjeta en sucursal debe contar como venta/apartado operativo en dashboard.
6. Las fotos de referencia deben guardarse asociadas al pedido, con número, nombre y datos relevantes.
7. El equipo contesta desde otras cuentas vinculadas al mismo número de WhatsApp.
8. Cuando se cierra un pedido, Flora no debe seguir insistiendo en vender más. Si el cliente vuelve con otra solicitud, inicia otro pedido.
9. Las alertas deben incluir número, nombre, notas especiales, colores/flores, fotos de referencia, precio del ramo, envío, hora/fecha, método de pago y sucursal/dirección.
10. El bot debe pedir fecha/hora antes de cerrar/apartar cuando falte ese dato.

## Objetivo Principal

Convertir el flujo de Flora en un sistema de estados de pedido donde:
- El código decide el estado y la notificación correcta.
- La IA redacta mensajes naturales, pero no decide sola si algo es venta, cotización o comprobante.
- El historial sirve como apoyo, pero la última solicitud del cliente tiene prioridad.

## Estados Recomendados

Implementar un campo operativo como `estado_flujo` o usar una columna nueva en `pedidos_bot`.

Estados sugeridos:
- `sin_pedido`
- `cotizando`
- `esperando_precio_equipo`
- `precio_confirmado`
- `esperando_fecha_hora`
- `esperando_entrega`
- `esperando_nombre`
- `esperando_pago`
- `apartado_sucursal`
- `pagado_transferencia`
- `cerrado`
- `cancelado`

Mapeo con estado actual `pedidos_bot.estado`:
- `cotizacion`: cotizando, esperando_precio_equipo, precio_confirmado, esperando_datos.
- `apartado`: apartado_sucursal, esperando_pago, confirmado sin comprobante.
- `pagado`: pagado_transferencia.
- `entregado`: cerrado/entregado.
- `cancelado`: cancelado.

## Migración Recomendada

Actualizar `supabase_migration_pedidos_bot.sql` o crear una migración nueva.

Columnas nuevas sugeridas en `pedidos_bot`:
- `estado_flujo text`
- `fecha_entrega text`
- `hora_entrega text`
- `foto_referencia_url text`
- `foto_referencia_base64 text` opcional, si no se usa Storage.
- `foto_referencia_mimetype text`
- `foto_referencia_caption text`
- `foto_referencia_recibida_en timestamptz`
- `resumen_pedido text`
- `detalles_especiales text`
- `precio_confirmado_por text` valores: `equipo`, `ia`, `cliente`, `manual`.
- `cerrado_en timestamptz`

Nota:
- Implementar fallback en código si estas columnas aún no existen, para que el bot no se caiga antes de correr migración.

## Cambios En `bot.ts`

### 1. Un Solo Pedido Activo

Funciones relacionadas:
- `pedidoActual(clienteId)`
- `resetearPedidoCliente(clienteId)`
- `resetearPedidoActivo(clienteId)`
- `ventaDesdeEstado(clienteId)`
- `persistirPedido(...)`

Comportamiento requerido:
- Si el cliente dice: `es aparte`, `ese ya había finalizado`, `este es otro ramo`, `otro pedido`, `otro ramo`, limpiar pedido activo anterior.
- No borrar historial, solo el estado operativo del pedido.
- El siguiente mensaje/foto debe pertenecer al pedido nuevo.

### 2. Clasificación De Imágenes Por Última Acción

Funciones relacionadas:
- `esTextoComprobante(texto)`
- `esTextoReferenciaOCotizacion(texto)`
- Bloque `MEDIA_POR_CLIENTE` dentro de `procesarMensaje`.

Regla requerida:
- Si el turno actual dice `ramo así`, `cotizar`, `precio`, `foto de referencia`, `como la imagen`, gana cotización/referencia.
- No marcar comprobante solo porque en historial viejo aparece `BBVA`, `transferencia`, `pago`.
- Solo marcar comprobante si el turno actual o contexto muy reciente habla de pago/comprobante.

### 3. Guardar Foto De Referencia En Pedido

Cuando una imagen se clasifica como referencia:
- Reenviarla a Telegram.
- Reenviarla por WhatsApp a empleados.
- Guardarla en `pedidos_bot` asociada al pedido activo.
- Cambiar estado a `esperando_precio_equipo`.
- Guardar `productoPersonalizado` si no existe: `Ramo personalizado con foto de referencia`.

Opciones de almacenamiento:
- Mejor opción: subir la imagen a Supabase Storage y guardar URL.
- Opción rápida: guardar base64 en columna text, aunque puede crecer mucho.

### 4. Precio Respondido Por Equipo

Actualmente, si `fromMe` y el agente dice `Estaría en 400$`, el bot puede guardar ese precio.

Mejorar:
- Si mensaje de agente contiene precio, guardar:
  - `precioPersonalizado`
  - `precio_confirmado_por = 'equipo'`
  - `estado_flujo = 'precio_confirmado'`
  - `estado = 'cotizacion'`
- No responder al cliente porque fue mensaje humano.

### 5. Cierre Por Efectivo/Tarjeta En Sucursal

Regla:
- Si hay producto + precio + nombre + sucursal + cliente dice efectivo/tarjeta al recoger, cerrar como venta/apartado de sucursal.
- Mandar alerta `PEDIDO APARTADO` con método `Efectivo al recoger` o `Tarjeta al recoger`.
- Contarlo en dashboard.
- Limpiar pedido activo para evitar mezclar con el siguiente.

Funciones relacionadas:
- `pedidoApartadoHandler(...)`
- `ventaDesdeEstado(...)`
- `persistirPedido(...)`

### 6. Cierre Por Transferencia

Regla:
- Si hay producto + precio + nombre + entrega/sucursal + el cliente dice `ya pagué`, `listo`, `comprobante`, `ya transferí`, cerrar como pagado.
- Si solo dice `le transfiero`, pero no comprobante/listo, guardar como `esperando_pago` o `apartado`, no pagado.
- Si manda foto en contexto de pago, clasificar como comprobante.

Funciones relacionadas:
- `ventaCerradaHandler(...)`
- `registrarVenta(...)`
- `persistirPedido(..., 'pagado')`

### 7. Fecha Y Hora Antes De Cerrar

Agregar extracción simple:
- Detectar frases como `viernes`, `mañana`, `hoy`, `29 de junio`, `1 de julio`.
- Detectar hora si aparece `5pm`, `a las 4`, `por la tarde`, `en la mañana`.

Regla:
- Si falta fecha/hora y el cliente quiere apartar, Flora debe preguntar una sola cosa: `¿Para qué fecha y hora lo necesitas? 🌷`.
- No cerrar alerta final sin fecha/hora si es pedido para preparar.

### 8. Resumen Operativo Del Pedido

Crear helper recomendado:
- `resumirPedidoOperativo(clienteId, historial)`

Debe devolver:
- cliente_nombre
- telefono
- producto
- detalles_especiales
- precio_arreglo
- precio_envio
- total
- entrega
- sucursal/direccion
- fecha/hora
- metodo_pago
- tiene_foto_referencia

Usarlo para:
- Telegram venta.
- Telegram apartado.
- Dashboard.
- Persistencia en `pedidos_bot.resumen_pedido`.

## Cambios En Alertas Telegram

Actualizar o crear alertas en `lib/telegram.ts`.

### Cotización Con Foto

Formato deseado:

```text
🌷 COTIZACIÓN CON FOTO

📱 Cliente: +52...
💬 Último mensaje: ...
🖼️ Foto: enviada abajo
🧭 Contexto: pedido nuevo / pedido anterior finalizado si aplica
⚠️ Acción: cotizar precio y confirmar disponibilidad
```

### Pedido Apartado

Formato deseado:

```text
📦 PEDIDO APARTADO

👤 Cliente: José Manuel
📱 WhatsApp: +52...
💐 Producto: Ramo personalizado con 3 hortensias
📝 Detalles: flores de la foto + 3 hortensias
🖼️ Foto referencia: sí
🌷 Ramo: $400
🚚 Envío: $0 / No aplica
💰 Total: $400
📍 Entrega: Sucursal Norte
📅 Fecha/hora: Viernes, hora por confirmar
💳 Pago: Efectivo al recoger
```

### Venta Pagada

Formato igual de completo, pero con estado `pagado_transferencia`.

## Cambios En Dashboard

Archivo: `app/admin/page.tsx`
API: `app/api/bot/status/route.ts`

Agregar/mostrar:
- Cotizaciones pendientes.
- Esperando precio del equipo.
- Precio confirmado.
- Esperando datos.
- Apartados en sucursal.
- Pagados por transferencia.
- Pedidos con foto de referencia.
- Fecha/hora de entrega/recolección.
- Método de pago.
- Botón para marcar `entregado`, `cancelado`, `pagado`.
- Campos editables para completar fecha/hora, precio, nombre, sucursal, notas.

## Cambios En Prompt

Archivo local: `_prompt_actualizado.txt`
Prompt activo: Supabase `/admin/prompt`.

Reglas a reforzar:
- La última solicitud del cliente manda sobre historial viejo.
- Si el sistema indica pedido nuevo, no reutilizar datos anteriores.
- Si el sistema indica imagen recibida, no pedir reenviar.
- Cotizaciones personalizadas pasan al equipo.
- No cerrar pedido si falta fecha/hora.
- No seguir vendiendo después de cerrar; responder breve y cerrar interacción.

## Pruebas Manuales Recomendadas

### Caso 1: Foto De Referencia

Cliente:
- `Quiero un ramo así`
- manda foto

Esperado:
- Alerta de cotización, no comprobante.
- Foto enviada a Telegram y WhatsApp empleados.
- `pedidos_bot.estado_flujo = esperando_precio_equipo`.

### Caso 2: Pedido Anterior Finalizado + Nuevo Pedido

Cliente:
- `Nonono ese ya habia finalizado, este es aparte con flores de la imagen y 3 hortensias`

Esperado:
- Limpia pedido activo anterior.
- Nuevo pedido no hereda flores/precio/sucursal/nombre.

### Caso 3: Precio Del Equipo

Agente:
- `Estaría en 400$`

Esperado:
- Bot guarda precio 400.
- Estado `precio_confirmado`.

### Caso 4: Efectivo En Sucursal

Cliente:
- `Lo pago en efectivo y paso por el en sucursal norte a nombre de Jose Manuel`

Esperado:
- Alerta `PEDIDO APARTADO`.
- Cuenta en dashboard como venta/apartado.
- Limpia pedido activo.

### Caso 5: Transferencia Pagada

Cliente:
- `Ya transferí, listo, te mando comprobante`
- manda foto

Esperado:
- Alerta de venta pagada/comprobante.
- Registro en `reporte_ventas`.
- Limpia pedido activo.

## Archivos A Tocar

- `bot.ts`
- `lib/telegram.ts`
- `app/api/bot/status/route.ts`
- `app/api/pedidos/[id]/route.ts`
- `app/admin/page.tsx`
- `supabase_migration_pedidos_bot.sql` o nueva migración
- `_prompt_actualizado.txt`

## Nota Para La Nueva Sesión

Antes de editar, revisar el estado actual con:

```bash
git status --short
npx tsc --noEmit
```

Últimos commits relevantes:
- `bd2850d fix: prioriza ultimo pedido en alertas`
- `80b4a4c fix: procesa referencias y metricas de pedidos`
- `d5ca852 fix: rescata pendientes y mejora alertas WhatsApp`

Objetivo de la siguiente sesión:
Implementar el sistema de estados y persistencia operativa completa sin romper compatibilidad si aún no se ha corrido la migración.
