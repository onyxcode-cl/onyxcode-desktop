# Telegram: avisos y permisos con botones (entrega 1, F8-B187)

Control de Lazunox desde el celular con **un bot de Telegram que crea cada persona** (gratis, sin empresa, sin servidor, sin puertos, sin
`cloudflared`). Esta entrega hace solo dos cosas:

1. **Avisos**: una conversación terminó, el agente tiene una pregunta, hubo un error o parece atascada.
2. **Permisos con botones**: cuando el motor pide un permiso, el bot manda el comando o la acción completa y dos botones, «Permitir una vez» y
   «Rechazar» (no hay «siempre»). Al pulsar, se responde ese permiso en el motor igual que lo hace la pantalla.

**No** inicia tareas, **no** lee ni continúa conversaciones, y **ningún texto que llegue por Telegram llega al motor** (eso es la entrega 2).
Comandos del bot: `/start`, `/estado`, `/desvincular` (en inglés también `/status` y `/unlink`).

Código: `src/main/telegram/` · IPC: `src/main/ipc/telegram-handlers.ts` · Ajustes › Telegram:
`src/renderer/src/features/settings/impl/TelegramSection.tsx` · servidor de Telegram falso: `e2e/fake-telegram/server.mjs`.

## 1. Investigación

### 1.1 Cómo `main` ve los eventos del motor y responde permisos

- Hoy el **renderer** abre UN flujo SSE `/global/event` con el cliente del SDK v2 (`startEventStream` en `src/renderer/src/lib/opencode.ts`) y su
  store de Code reacciona a `permission.asked` / `permission.v2.asked` (ponen la tarjeta), `permission.replied` / `permission.v2.replied` (la
  quitan), `question.asked` y `session.status` / `session.idle` (`src/renderer/src/features/code/impl/store.ts`). Responde con
  `client.permission.reply({ requestID, reply, directory })` (API v1) o `client.v2.session.permission.reply({ sessionID, requestID, reply })`.
- `main` ya conoce las credenciales del motor (`OpencodeServer.start()` devuelve `{ baseUrl, authorization }`). Basta con que `main` cree su propio
  cliente del SDK (`createOpencodeClient`) y abra **su propia suscripción** `client.global.event()`. El motor admite varios suscriptores.
- Decisión: módulo aparte `src/main/telegram/engine-link.ts` (≈ 270 líneas) que (a) abre el flujo con reconexión y retroceso, (b) normaliza solo
  lo que el puente necesita (`normalizeEngineEvent`, función pura probada), (c) responde permisos con las mismas dos llamadas que la pantalla, y
  (d) consulta `GET /permission` para saber si un permiso sigue pendiente. Al reconectar pide los pendientes (mejor esfuerzo) para no perder uno
  que se pidió mientras el flujo estuvo cortado.
- Solo escucha mientras hay un chat vinculado y el interruptor está encendido; si no, no hay flujo ni polling.
- **Alcance de esta entrega: el motor principal** (Chat y Code, y las rutinas que corren allí). El modo Tareas (Overdrive) tiene sus propios
  servidores aislados y su propio aprobador en `main` (`tasks/auto-approver.ts`); no se conectó a Telegram (queda como hueco declarado, ver §8).

### 1.2 Qué se reutilizó del control remoto y de la PWA pausados

Solo **reglas e ideas**, ningún código sin auditar (el remoto está pausado y su rama `feat/remoto-por-sesion` no está auditada):

| Idea del remoto | Cómo quedó en Telegram |
| --- | --- |
| Denegar por defecto; los canales nuevos tienen clase en `remote/policy.ts` | Los 8 canales `telegram:*` son clase **X** y el evento `telegram:state-changed` es `deny`: el celular/PWA no los toca. |
| El código de 6 dígitos se confirma en el Mac; el vínculo tiene intentos limitados | Código de 6 dígitos que muestra la app, 10 min, un solo uso, 5 intentos y bloqueo de 15 min. |
| Auditoría local sin secretos (`remote-audit.jsonl`) | `telegram-audit.jsonl`: solo tipo, hora, huella del chat (8 hex), tipo de permiso; nunca comando, token ni número de chat. |
| Tope de aprobaciones de comandos por hora | Tope de 30 «Permitir» por hora (rechazar siempre se puede). |
| Almacén cifrado con el auxiliar del Llavero que no cambia entre versiones | Mismo almacén (`KeyboxSafeStorage` / `safeStorage`), archivo propio `telegram-token.bin`. |
| Aprobar comandos desde el celular = decisión explícita del dueño | Aquí la decisión es explícita: activar Telegram, crear el bot y vincular el chat. |

**No** se reutilizó la lista de denegación de comandos (`command-denylist.ts`, heurística no auditada para este uso): el mensaje muestra el comando
completo para que la persona decida. Auditarla y sumarla queda para la entrega 2.

### 1.3 Dos respondedores (pantalla y Telegram): gana el primero

El motor es el árbitro: solo acepta una respuesta por permiso y devuelve 404 (`PermissionNotFoundError`) a la segunda. El puente lo usa así:

- Cada permiso enviado tiene un registro en `main` (`pending`) y un identificador de botón corto (`ButtonBook`).
- **Gana la pantalla**: llega `permission.replied` con el id → el mensaje de Telegram se **edita** («Respondido en el computador: permitido /
  permitido siempre / rechazado») y se quitan los botones. Un botón pulsado después responde «Ya respondido en el computador» y no toca el motor.
- **Gana Telegram**: se marca «respondiendo», se comprueba con `GET /permission` que sigue pendiente, se responde en el motor, se edita el mensaje
  («Permitido una vez / Rechazado desde Telegram») y la tarjeta de la pantalla desaparece sola porque llega `permission.replied`.
- **Carrera exacta**: si la respuesta de Telegram falla con «no encontrado» (o falla y mientras tanto llegó el aviso de la pantalla), se trata como
  «ganó la pantalla».
- **Periodo de gracia de 1,2 s** antes de enviar: si la pantalla lo contesta enseguida (p. ej. la aprobación automática de comandos de solo lectura
  que ya hace Code), no se manda nada.
- Si el motor no pudo responder (error distinto de 404), el botón **se reabre** (se puede reintentar hasta que caduque) y se avisa «hazlo en el
  computador».

### 1.4 Límites de la API de Telegram que cuentan

| Límite | Cómo se respeta |
| --- | --- |
| `callback_data` ≤ 64 **bytes** | `p:<12 caracteres base64url aleatorios>:<a\|r>` = 16 bytes. `main` guarda el mapa id → permiso/chat; caduca (30 min) y es de un solo uso. Un id nunca contiene el id del permiso ni datos. |
| Mensaje ≤ 4096 caracteres (se cuentan los visibles, después de entidades) | El cuerpo se arma tapar → recortar → escapar y se mide **ya escapado** (`safeBlock`); un comando de `<&>` repetido, que al escapar crece 4–5 veces, sigue cabiendo. Se deja una reserva de 220 caracteres para la línea de resultado al editar. |
| 429 con `parameters.retry_after` | `TelegramApi` espera `retry_after` (tope 60 s) y reintenta hasta 3 veces las escrituras; `getUpdates` lo respeta en su bucle. Las escrituras van en serie con 350 ms de separación (~1 mensaje por segundo por chat). |
| `parse_mode` | **HTML** (solo `<b>`, `<i>`, `<code>`, `<pre>`); todo texto dinámico se escapa (`& < >`) SIEMPRE. El servidor falso rechaza con 400 cualquier `<` o `&` sin escapar, como el real. |
| Ediciones limitadas / «message is not modified» | Cada mensaje de permiso se edita una vez (resultado) y a lo sumo otra (caducidad); un error de edición se registra y no rompe nada. |
| `getUpdates` y webhooks | Long polling de 25 s (`allowed_updates: message, callback_query`), con el `offset` guardado en disco **después** de atender cada mensaje. Un 409 (otra aplicación lee el bot) se informa y se reintenta cada 30 s; un 401 detiene todo y pide una clave nueva. |
| Un bot solo puede escribir a quien le escribió primero | Por eso el orden `/start` → código. |

## 2. Diseño

```
Ajustes › Telegram ──IPC (clase X, esquema estricto)──▶ TelegramService (main)
                                                          │   ├─ TelegramStore   userData/telegram-state.json  (sin secretos)
                                                          │   │                  userData/telegram-token.bin   (safeStorage / Llavero)
                                                          │   │                  userData/telegram-audit.jsonl (sin secretos)
                                                          │   ├─ TelegramApi     https://api.telegram.org (fijo)  ◀── getUpdates (long polling)
                                                          │   └─ EngineLink      SSE /global/event + permission.reply ──▶ motor OpenCode
```

Estados (`TelegramState.phase`): `off` (interruptor apagado, **por defecto**) → `no-bot` → `idle` → `linking` (código a la vista) → `linked`.

- **El polling solo corre con un chat vinculado o con un código vigente.** Sin ninguna de las dos cosas no hay red. Apagada la función, la app no hace
  ni una llamada a Telegram (prueba «apagada, no hace ninguna llamada de red al arrancar»).
- **Interruptores**: «Telegram activado» (apagarlo desvincula y detiene el polling y la escucha del motor); «Detener todo ahora» (corta al instante,
  sin avisar a Telegram, conserva la clave); «Quitar el bot» (con confirmación; además borra la clave del almacén seguro).
- **Mensaje de prueba** (espera de 10 s entre envíos).
- Los avisos: «terminó» solo si trabajó ≥ 8 s y no es un subagente; deduplicado (llegan `session.status` e `session.idle`); «atascada» tras 5 min sin
  movimiento y sin permiso ni pregunta pendientes (una sola vez); pregunta del agente (una vez por pregunta; se responde en el computador); error
  (detalle tapado; una vez cada 30 s por sesión). Tope de 12 avisos por minuto; los permisos nunca se descartan por ese tope.

## 3. Seguridad

| Control | Dónde | Prueba |
| --- | --- | --- |
| Token **jamás** en logs, en `opencode.json` ni en la pantalla: la ventana solo ve `botConfigured` y los últimos 4 caracteres; el token entra una vez por `telegram:saveToken` y nunca vuelve | `service.ts` (`getState`), `api.ts` (errores tapados), `text.ts` (`scrubToken`) | `service.test.ts` «el token no aparece en ningún archivo en claro…», «el estado que ve la ventana…»; `api.test.ts` «error de red…»; escenario `telegram-codigo` (la clave no está en el DOM) y `telegram-e2e` (sin la clave en claro en todo el perfil temporal) |
| Token cifrado en reposo; **sin almacén seguro NO se guarda** (no hay respaldo en texto plano) | `store.ts`, `ipc/telegram-handlers.ts` | «sin almacén seguro NO se guarda la clave» |
| Dirección base **fija** `https://api.telegram.org`; solo en la app **sin empaquetar** una variable de entorno (`LAZUNOX_TELEGRAM_API_BASE`) puede apuntar a un servidor **local** (`127.0.0.1`/`localhost`/`[::1]` por `http`); nunca desde ajustes, archivos ni la ventana | `api.ts` (`resolveApiBase`) | `api.test.ts` «dirección base» (empaquetada ignora la variable; rechaza `evil.example`, `127.0.0.1.evil.example`, `127.0.0.1@evil.example`…) |
| Allowlist de **un** chat privado; todo lo demás (otros chats, grupos, canales, bots, ediciones, otros tipos de update) se ignora **sin responder** | `service.ts` (`onMessage`, `onCallback`) | «un solo dueño…»: otro chat, grupo, canal, `edited_message`, `channel_post`, callback ajeno |
| Código de vinculación: 6 dígitos, 10 min, un solo uso, 5 intentos y bloqueo de 15 min, comparación en tiempo constante, no se puede pedir otro durante el bloqueo | `guards.ts` (`LinkCode`) | `guards.test.ts`, «vinculación» en `service.test.ts` |
| Límite de mensajes entrantes (30/min); el exceso se descarta sin responder | `guards.ts` (`MinuteLimiter`) | «límite de mensajes por minuto» |
| Botones: id corto aleatorio (72 bits), vigencia 30 min, un solo uso, ligados al chat dueño y al permiso, tope de 30 «Permitir»/hora | `guards.ts` (`ButtonBook`), `service.ts` | `guards.test.ts`, «permisos con botones», «tope de “Permitir” por hora» |
| El texto de Telegram **nunca** llega al motor (no hay ninguna llamada del puente al motor que lleve texto del chat; solo `permission.reply` con ids del propio motor) | `service.ts` (`onOwnerText`), `engine-link.ts` | «el texto del dueño NUNCA llega al motor», «el motor no recibe nada de Telegram» |
| Lo que SALE: tapar → recortar → escapar; comando completo hasta 2400 caracteres, más allá inicio + final con aviso de lo omitido | `text.ts`, `messages.ts` | «lo que sale a Telegram…» (claves, HTML, 20 000 caracteres, `<&>` ×5000) |
| Auditoría local sin secretos de vinculación, desvinculación, permiso enviado/respondido (por Telegram o por pantalla) | `store.ts` | «manda el comando completo…» (la auditoría no contiene el comando ni el número de chat) |
| IPC: 8 canales `telegram:*`, esquema estricto (`schemas.ts`), clase **X** (`remote/policy.ts`), solo la ventana principal | `ipc-extras.ts`, `schemas.ts`, `policy.ts` | `policy.test.ts`, `schemas.test.ts` |
| Reinicio sin repetir mensajes (offset en disco, por bot) | `service.ts` (`pollLoop`) | «retoma el vínculo y NO repite los mensajes ya atendidos» |

**Aviso honesto en la interfaz**: «Telegram no cifra de extremo a extremo los mensajes de los bots y puede ver su contenido. El computador debe estar
encendido con Lazunox abierto.» (`telegram.privacy.body`.)

### Lo que el puente NO protege (decirlo claro)

- Quien tome control de la **cuenta de Telegram** de la persona (o de su teléfono desbloqueado) puede pulsar «Permitir una vez» en los permisos que
  lleguen. Es el costo de la comodidad; por eso el interruptor está apagado por defecto, hay tope de 30 «Permitir» por hora, y «Detener todo ahora» y
  «Desvincular» existen. Quien tenga el **token** (por ejemplo, un compañero que lo vio al crearlo) puede enviar mensajes falsos «del bot» a la
  persona, pero no puede responder permisos (los botones solo valen para el chat dueño y los ids son aleatorios y de un solo uso) ni leer nada que
  no se le haya enviado al bot.
- Un comando malicioso con trucos visuales (caracteres de dirección, espacios) se limpia de caracteres de control, pero la persona sigue siendo el
  último control: debe leer lo que aprueba.
- Telegram (la empresa) ve el contenido de los mensajes del bot.
- El token de un bot que alguien más reutilice con `getUpdates` provoca 409; el puente lo informa y no lo "roba" (no llama a `deleteWebhook`).

## 4. Pruebas

Dirigidas (no corras la suite completa en el Mac; eso va al VPS):

```
npx vitest run src/main/telegram src/renderer/src/features/settings/impl/TelegramSection.test.tsx
npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json
```

- `e2e/fake-telegram/server.mjs`: servidor de Telegram **falso** (`getMe`, `getUpdates` con offset y long polling simulado, `sendMessage`,
  `editMessageText`, `answerCallbackQuery`). Imita 401, 403, 409, 429 con `retry_after`, mensajes > 4096, `callback_data` > 64 bytes, HTML mal
  escapado y «message is not modified». Suelto: `node e2e/fake-telegram/server.mjs <token> [puerto]`.
- `src/main/telegram/*.test.ts`: 84 pruebas (guardas, texto, API, normalización de eventos del motor y el servicio completo contra el servidor falso).
- Escenarios `telegram*` de `scripts/shot-desktop.mjs` (app real de Electron, perfil y XDG temporales, `--use-mock-keychain`, motor falso de OpenCode,
  servidor de Telegram falso, `LAZUNOX_TELEGRAM_API_BASE`): `docs/CAPTURAS-ESCRITORIO.md`.

## 5. Prueba contra Telegram REAL (la hace Ben cuando cree su bot)

Nada de esto se hizo todavía: ningún agente creó bots reales ni usó credenciales.

1. En Telegram, abre **@BotFather**, escribe `/newbot`, elige un nombre y un usuario que termine en `bot`. Copia la clave que te da (nunca la pegues
   en el repositorio, en un commit ni en el chat con la IA).
2. Abre Lazunox (instalado o `npm run dev` con perfil temporal si no quieres tocar el real), **Ajustes › Telegram**, lee el aviso y enciende
   «Telegram activado».
3. Paso 2: pega la clave y «Guardar clave». Debe decir «Clave guardada (termina en XXXX)» y «Bot: @tu_bot».
4. Pasos 3 y 4: abre el bot, escribe `/start`; el bot pide el código. Escribe el código de 6 dígitos de la pantalla. La app debe pasar a
   «Vinculado a …» y el bot confirma.
5. «Enviar mensaje de prueba»: debe llegar a tu Telegram.
6. En **Code** (carpeta de prueba, modo «Preguntar siempre») pide algo como «ejecuta `echo hola` con bash» y comprueba el mensaje con el comando y
   los dos botones. Pulsa «Permitir una vez»: el mensaje se edita y la tarjeta de la pantalla desaparece.
7. Repite y contesta **primero en la pantalla**: el mensaje de Telegram debe editarse a «Respondido en el computador…».
8. Pide un trabajo largo (> 8 s) y comprueba el aviso «Terminó: …».

Lista de comprobación (marca cada una):

- [ ] El token no aparece en `~/Library/Application Support/Lazunox` en claro (`grep -r "<parte secreta>"` sin resultados; solo existe `telegram-token.bin`).
- [ ] El token no aparece en `opencode.json`, en los registros de Diagnóstico ni en la pantalla.
- [ ] Un segundo Telegram (otra cuenta) que le escribe al bot no recibe respuesta alguna; un grupo al que invites al bot tampoco.
- [ ] Un código equivocado 5 veces bloquea; el correcto durante el bloqueo no sirve; «Código nuevo» vuelve a funcionar tras 15 min.
- [ ] El código caduca a los 10 min y el bot deja de contestar (revisar que `getUpdates` ya no se repite: Actividad de red).
- [ ] Un comando con una clave de mentira (`curl -H "Authorization: Bearer abc…"`) llega con la clave tapada («…»).
- [ ] Un comando larguísimo llega recortado con inicio y final.
- [ ] Reiniciar Lazunox no repite los mensajes de la última hora ni los permisos ya respondidos.
- [ ] «Desvincular», «Detener todo ahora» y «Quitar el bot» hacen lo que dicen (y tras «Quitar el bot» ya no existe `telegram-token.bin`).
- [ ] `telegram-audit.jsonl` tiene las vinculaciones y los permisos respondidos, sin comandos ni números de chat.
- [ ] Con internet cortado, la pantalla dice «no se pudo hablar con Telegram» y al volver sigue funcionando sin vincular de nuevo.
- [ ] Windows (cuando se pruebe): mismo recorrido; el almacén seguro es el de Windows (`safeStorage`).

## 6. Riesgos y límites conocidos

- **No verificado contra Telegram real ni en Windows.** El servidor falso reproduce las reglas documentadas de la API, no su comportamiento completo.
- **Modo Tareas (Overdrive) no está conectado**: sus permisos no llegan a Telegram (aísla sus propios servidores). Dicho aquí para que nadie crea lo contrario.
- `GET /permission` solo lista los permisos de la instancia de una carpeta; la recuperación al reconectar es de mejor esfuerzo.
- El orden de edición/respuesta tiene una ventana mínima (milisegundos) en la que ambas partes pueden creer que ganaron; el motor decide (404 a la segunda) y el
  puente corrige el mensaje.
- Una persona con acceso a la cuenta de Telegram puede aceptar permisos (ver §3).
- El código de vinculación se muestra en la pantalla y viaja por IPC a la ventana principal (es lo que la persona debe ver); no se escribe en disco.
- La pestaña de Ajustes › Telegram no existe en el celular/PWA (a propósito).

## 7. Entrega 2 (no hecha)

Seguir sesiones con avance en vivo (mensaje editado cada pocos segundos, salidas largas como archivo), iniciar tareas y voz, auditoría de seguridad
propia y, antes de eso, decidir si se suma la lista de denegación de comandos tras auditarla.
