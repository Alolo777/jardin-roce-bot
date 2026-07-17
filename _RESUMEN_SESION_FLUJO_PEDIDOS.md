# Resumen de Sesion - Ajustes Flujo de Pedidos

Fecha: 2026-06-28

## Objetivo

Hacer mas robusto el flujo de Flora para evitar errores cuando un cliente deja una cotizacion inconclusa, inicia una compra nueva con fotos disponibles, manda comprobantes por transferencia o aparta para recoger en sucursal.

## Cambios Realizados

### 1. Comprobantes despues de cuenta BBVA

Problema:
- Cuando Flora ya habia enviado la cuenta BBVA y el cliente mandaba foto del comprobante, el bot podia clasificar la imagen como foto de referencia.

Cambio:
- Se amplio `contextoEsperaComprobante()` para detectar frases como `mandame tu comprobante`, `pon tu nombre en concepto`, `BBVA`, `4152`, `Devi America` y `cuando este listo`.
- Se agrego `respuestaPideComprobante()` para marcar el pedido como `esperando_pago` cuando Flora manda instrucciones de transferencia.
- Se amplio el historial reciente usado para clasificar imagenes de 3 a 8 mensajes.

Resultado esperado:
- Si el cliente envia una imagen despues de que Flora pidio comprobante, se registra como comprobante y se manda alerta de pago, no como cotizacion.

Commit relacionado:
- `0e84659 fix: detecta comprobantes tras cuenta BBVA`

### 2. Fotos disponibles y precios viejos

Problema:
- Si el cliente tenia una cotizacion vieja de $400/$600 y despues pedia `ramitos disponibles hoy`, el bot podia reutilizar el precio anterior cuando el cliente decia `este` o `que precio tiene` sobre fotos nuevas enviadas por el equipo.

Cambio:
- Se agrego memoria temporal `FOTOS_DISPONIBLES_RECIENTES`.
- Cuando el cliente pide fotos o ramos disponibles, se limpia el pedido activo anterior con `resetearPedidoActivo()`.
- Cuando el equipo manda imagenes o dice algo como `esos tenemos disponibles`, el bot marca que hay fotos disponibles recientes.
- Si el cliente elige una foto reciente, el bot crea un pedido nuevo como `Ramo elegido de fotos disponibles`, sin precio confirmado.
- Si pregunta precio, el bot no reutiliza precios anteriores y pide confirmacion al equipo.

Resultado esperado:
- El bot ya no debe decir que un ramo nuevo vale $600 solo porque ese precio existia en una cotizacion anterior.

Commit relacionado:
- `b71366e fix: evita precios viejos en fotos disponibles`

### 3. Precio de envio separado del precio del ramo

Problema:
- Cuando el cliente mandaba direccion y luego el empleado respondia `Le saldria en 80`, el bot podia confundir ese precio como precio del ramo.

Cambio:
- Se agrego `esperandoPrecioEnvio` al pedido en curso.
- Cuando el cliente comparte direccion o link de Maps, el pedido queda marcado como esperando precio de envio.
- Si el empleado responde con un precio mientras esa marca esta activa, el bot lo guarda como envio.

Resultado esperado:
- Los precios de envio se guardan como envio y no reemplazan el precio del arreglo.

Commit relacionado:
- `b71366e fix: evita precios viejos en fotos disponibles`

### 4. Dashboard sin sumar envio al monto de venta

Problema:
- Las ventas con envio se registraban en el dashboard con el total completo, por ejemplo ramo $250 + envio $45 = $295.
- Se queria que el dashboard registrara solo el precio del ramo.

Cambio:
- Se agrego `totalDashboardPedido()`.
- `ventaCerradaHandler()` ahora registra en `reporte_ventas` solo el precio del arreglo cuando existe en el estado del pedido.
- La alerta operativa de Telegram conserva el desglose con envio.

Resultado esperado:
- Dashboard: muestra venta del ramo por $250.
- Telegram: sigue mostrando ramo $250, envio $45 y total operativo $295.

### 5. Apartados en sucursal con pago al recoger

Problema:
- Cuando el cliente decia que pasaria a sucursal y pagaria al recoger, Flora respondia que el ramo quedaba apartado, pero no se registraba en dashboard ni enviaba alerta operativa completa.

Cambio:
- `pedidoApartadoHandler()` ahora tambien registra en `reporte_ventas` como apartado.
- Se registra con metodo `Efectivo al recoger` o `Tarjeta al recoger` segun el estado del pedido.
- El flujo automatico de apartado en sucursal ahora responde al cliente con confirmacion y manda alerta.
- La ruta de confirmacion corta marca `ventaCerrada = true` para evitar que el flujo continue hacia la IA despues de registrar.

Resultado esperado:
- Un pedido de sucursal con pago al recoger aparece en dashboard como apartado y manda alerta al equipo.

### 6. Fecha/hora aproximada para sucursal

Problema:
- Frases como `manana temprano` no eran suficientes para cerrar/apartar, porque el detector no reconocia `temprano` como hora.

Cambio:
- `extraerFechaHoraPedido()` ahora reconoce `temprano` y `al abrir` como hora aproximada.

Resultado esperado:
- `manana temprano` o `manana al abrir` permite cerrar/apartar cuando ya hay nombre, precio y sucursal.

## Verificacion Hecha

Se verifico `bot.ts` con TypeScript aislado:

```bash
npx tsc --noEmit --pretty false --skipLibCheck --esModuleInterop --moduleResolution bundler --module esnext --target es2022 bot.ts
```

Resultado:
- Sin errores.

## Notas Pendientes

- `npm run test:flows` ya venia fallando porque `_prompt_actualizado.txt` no contiene la frase esperada `No adivines`.
- `npm run build:local` ya venia fallando por un `implicit any` en `lib/googleSheets.ts`.
- El archivo `_PLAN_MEJORAS_FLUJO_PEDIDOS.md` sigue sin seguimiento y no fue incluido en estos commits porque ya existia como archivo pendiente separado.

---

# Actualizacion de Sesion - Imagenes, Silenciados y Extras

Fecha: 2026-07-02

## Objetivo

Resolver problemas recientes del bot en conversaciones reales:
- Numeros silenciados seguian recibiendo respuesta.
- Fotos posteriores dentro de una venta se confundian entre referencia floral y comprobante de pago.
- Cobros extras, como nota personalizada de $10, podian confundirse con precio del ramo.

## Cambios Realizados

### 1. Numeros silenciados ahora respetan variantes de WhatsApp/Baileys

Problema:
- El bot comparaba solo `remoteJid` limpiado contra `numeros_ignorados`.
- Baileys puede entregar el remitente como `@lid`, `@s.whatsapp.net`, con sufijo de dispositivo o en campos alternos como `senderPn`, `remoteJidAlt`, `participantAlt`.
- Por eso un numero guardado como digitos en Supabase podia no coincidir y Flora respondia igual.

Archivos modificados:
- `bot.ts`

Cambio:
- En `manejarMensajeEntrante()` ahora se resuelve `obtenerNumeroReal(msg)` antes de decidir responder.
- Se comparan variantes de varios candidatos:
  - `numeroRealParaIgnorar`
  - `remoteJid`
  - `participant`
  - `remoteJidAlt`
  - `participantAlt`
  - `senderPn`
- Cada candidato pasa por `jidANumero()` y `variantesTelefono()`.

Resultado esperado:
- Si un numero esta en `numeros_ignorados`, Flora no responde aunque WhatsApp lo entregue con otro formato.

Commit relacionado:
- `3206fe0 fix: respeta numeros silenciados`

### 2. Clasificacion visual de imagenes con GitHub Models

Problema:
- `procesarMediaAcumulado()` clasificaba imagenes solo por texto/historial.
- Si el pedido estaba en `esperando_pago`, una foto sin texto podia asumirse como comprobante aunque fuera otra foto de flores.
- Si el cliente volvia a pedir cotizacion o mandaba otra referencia despues de hablar de pago, se podian mandar alertas equivocadas.

Archivos modificados:
- `lib/ai.ts`
- `bot.ts`

Cambio en `lib/ai.ts`:
- Se agrego `clasificarImagenVenta()`.
- Usa GitHub Models con entrada multimodal para clasificar imagenes en:
  - `comprobante`
  - `referencia`
  - `otra`
  - `incierto`
- Pide respuesta JSON corta para evitar texto libre.
- Envia maximo 2 imagenes por lote.
- Usa timeout de 12 segundos y retry limitado.
- Si falla, devuelve `incierto` y no rompe el bot.

Cambio en `bot.ts`:
- `procesarMediaAcumulado()` mantiene las reglas rapidas por texto.
- Solo llama vision cuando hay ambiguedad:
  - hay imagen,
  - no hay texto claro de pago,
  - no hay texto claro de cotizacion/referencia,
  - el contexto previo sugiere comprobante o pago.
- Si vision dice `referencia`, se fuerza cotizacion/referencia aunque el historial venia de pago.
- Si vision dice `comprobante`, se mantiene flujo de pago.
- Si vision dice `otra`, se manda como imagen generica/atencion humana.

Resultado esperado:
- Foto de flores enviada despues de contexto de pago ya no debe cerrarse como comprobante.
- Captura/ticket/recibo enviado despues de cuenta BBVA debe seguir como comprobante.
- Menos llamadas al modelo: solo en casos ambiguos, no en cada imagen.

Commit relacionado:
- `714ed83 feat: mejora clasificacion de imagenes y extras`

### 3. Extras de pedido separados del precio del ramo

Problema:
- Extras como nota, tarjeta o dedicatoria cuestan $10.
- La IA podia interpretar esos $10 como precio del ramo o mezclarlo con flores/envio.

Archivos modificados:
- `bot.ts`
- `lib/telegram.ts`

Cambio en `bot.ts`:
- Se agrego `PedidoExtra` y `extras?: PedidoExtra[]` al estado `PedidoEnCurso`.
- Se agregaron helpers:
  - `detectarExtrasPedido(texto)`
  - `agregarExtrasPedido(clienteId, extras)`
  - `totalExtrasPedido(clienteId)`
  - `extrasPedidoTexto(clienteId)`
  - `detallesConExtras(clienteId, detalles)`
- Actualmente detecta como extra de $10:
  - `nota`
  - `notita`
  - `nota personalizada`
  - `tarjeta`
  - `dedicatoria`
  - `mensaje escrito`
  - `mensaje impreso`
  - `papelito`
- `totalPedidoNumerico()` ahora suma ramo + extras + envio.
- `ventaDesdeEstado()` muestra desglose: `ramo $X + extras $Y + envio $Z`.
- `resumirPedidoOperativo()` incluye `extras`.
- `persistirPedido()` guarda extras dentro de `detalles_especiales` si no existe columna especifica.
- `procesarMensaje()` inyecta contexto a la IA:
  - los extras no son precio del ramo,
  - `$10` por nota/tarjeta/dedicatoria es solo extra,
  - mantener ramo, extras, envio y total separados.

Cambio en `lib/telegram.ts`:
- `DatosVentaCerrada` y `DatosApartadoPedido` aceptan `precioExtras`.
- Las alertas muestran linea separada `Extras`.

Resultado esperado:
- Flora no debe decir que el ramo cuesta $10 si el cliente pidio nota/tarjeta/dedicatoria.
- Telegram muestra:
  - `Ramo: $...`
  - `Extras: Nota personalizada $10.00 MXN`
  - `Envio: $...` si aplica
  - `Total: $...`

Commit relacionado:
- `714ed83 feat: mejora clasificacion de imagenes y extras`

## Archivos Tocados En Esta Actualizacion

- `bot.ts`: silenciamiento robusto, clasificacion de media con vision en casos ambiguos, extras del pedido, totales y contexto IA.
- `lib/ai.ts`: funcion `clasificarImagenVenta()` para vision con GitHub Models.
- `lib/telegram.ts`: soporte de `precioExtras` en alertas de venta y apartado.

## Verificacion Hecha

Comandos ejecutados:

```bash
npx tsc --noEmit
npm run test:flows
```

Resultado:
- `npx tsc --noEmit` paso sin errores.
- `npm run test:flows` sigue fallando por una asercion existente del prompt: falta texto `No adivines` en `_prompt_actualizado.txt`. No fue causado por estos cambios.

## Estado Actual Del Proyecto

- Los cambios ya fueron commiteados y subidos a `origin/main`.
- Ultimos commits relevantes:
  - `3206fe0 fix: respeta numeros silenciados`
  - `714ed83 feat: mejora clasificacion de imagenes y extras`
- El bot en VM debe actualizarse haciendo pull/redeploy desde `main`.

## Pendientes Recomendados

- Probar en conversacion real:
  - numero silenciado con formato normal y con LID si aparece,
  - foto de flores despues de pedir comprobante,
  - comprobante despues de cuenta BBVA,
  - ramo con nota personalizada de $10.
- Actualizar prompt activo en Supabase con la seccion `Extras Y Cobros Adicionales`.
- Si se quiere reporteria mas limpia, crear columna dedicada para extras en `pedidos_bot`, por ejemplo `extras jsonb`, en vez de guardarlos dentro de `detalles_especiales`.
- Ajustar `_prompt_actualizado.txt` o las pruebas para resolver el fallo existente de `npm run test:flows` por `No adivines`.
