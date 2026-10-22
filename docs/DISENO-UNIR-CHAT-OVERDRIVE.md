# Diseño: ¿unir Chat con Overdrive?

Documento de evaluación (solo lectura del código; no se tocó nada). Nota de nombres: en la interfaz el modo se llama **Overdrive**,
en el código es `tasks` (`ModeId = 'chat' | 'code' | 'tasks' | 'routines' | 'gallery'`, `src/shared/types.ts:4`). Aquí uso Overdrive = `tasks`.

## 1. Cómo funcionan hoy

### Chat (conversaciones sin carpeta)

- **Un solo motor, sin sandbox.** Chat usa el sidecar principal de OpenCode (`src/main/opencode/server.ts:136-180`), que arranca con
  `cwd = chatDirectory` (una carpeta interna de la app, no una carpeta de la persona) y con el entorno mínimo. No hay Seatbelt:
  el aislamiento es solo el agente.
- **El agente `chat` no puede tocar el disco.** `resources/opencode/agents/chat.md:1-15` y `src/main/opencode/config.ts:35-60`:
  `"*": deny`; solo `webfetch`, `websearch`, `question`; `read` está anunciado pero con un patrón que no coincide con nada
  (`CHAT_READ_SENTINEL = '/__lazunox_sin_acceso__'`, `config.ts:18`). El prompt ya dice «para trabajar dentro de una carpeta sugiere
  Overdrive» (`chat.md:18-20`).
- **Sesión efímera = sesión de OpenCode en `chatDirectory`.** Se crea con `client.session.create({ directory, agent: 'chat',
  metadata: { mode: 'chat' } })` al enviar el primer mensaje (`src/renderer/src/features/chat/actions.ts:76`). Estado de UI en
  `features/chat/store.ts:1-89` (conversación activa, fijadas en localStorage, preguntas pendientes). Origen de sesión `MAIN_SOURCE`
  (`src/renderer/src/stores/sessions.ts:54`), que es lo que distingue Chat de Overdrive en la lista unificada.
- **Adjuntos solo `data:`.** `sendChatMessage` rechaza cualquier URL que no sea `data:` (`actions.ts:58-62`, `lib/attachments.ts:145`)
  porque el motor lee `file://` sin pasar por los permisos del agente. PDFs se adaptan a texto/imágenes en el renderer
  (`pdfToText`/`pdfToImages`, `actions.ts:13-14`).
- **Proyectos de Chat** (F8-B185): contexto de archivos de la persona inyectado en el `system` vía `projects:context`
  (`actions.ts:282`; `src/main/projects/service.ts`). No dan acceso a carpeta: se leen y se resumen en `main`.
- **Control remoto:** el celular opera Chat con clase **M** y el agente fijado: en `chatDirs` solo se admite `agent: 'chat'`
  (`src/main/remote/policy.ts:797-803`, `875-888`); `file://` prohibido en Chat (`:833`); `projects:context` es **X** (`:515`).

### Overdrive (tareas autónomas con carpeta)

- **Servidor propio por carpeta y sandbox.** `TasksManager.start(folder, fullAccess)` (`src/main/tasks/manager.ts:847-900`) exige carpeta
  aprobada (`isApproved`, `:418`; `approveFolder`, `:428`), la revalida en Windows y levanta un `opencode serve` dentro de Seatbelt
  (`src/main/tasks/sandbox.ts:133-200`, perfil deny-by-default en `sandbox-profile.ts`). Las claves reales viven fuera, tras
  `CredentialProxy`; el sandbox solo ve un centinela. La salida de red pasa por `EgressProxy` con lista blanca (`proxy-policy.ts`).
  Proveedores limitados a `SANDBOX_PROVIDER_IDS` (`src/shared/sandbox-providers.ts:11`; el renderer bloquea el envío con otro,
  `tasks/impl/actions.ts:520-530`).
- **Agente `tasks`** (`resources/opencode/agents/tasks.md:1-30`): `"*": allow`, `bash` con `ask` para borrar, `deny` para `sudo` y
  `git push`. Los permisos que quedan en `ask` llegan como tarjetas (`PermissionPrompt*.tsx`, `features/tasks/impl`) y el
  «Modo auto» los puede resolver con reglas puras (`src/main/tasks/auto-approver.ts`, `auto-mode.ts`).
- **Carpetas.** Lista de prohibidas (`folder-policy.ts`: home, Library, userData, montajes de red…), carpetas extra enlazadas
  (`linkFolder`, `manager.ts:572`), «Control total» opcional con consentimiento (`:641-775`) y puerta del plan
  (`lazunox-plan-gate`, `opencode-config.ts`; solo en el servidor de acceso total).
- **Puntos de restauración.** Antes de cada envío el renderer pide una copia de la carpeta (`saveRestorePoint`,
  `tasks/impl/actions.ts:~580`); `src/main/tasks/restore-points.ts` (817 líneas) la guarda y permite listar/aplicar/rehacer
  (`tasks:restore:*`, `src/shared/ipc-tasks.ts:1314-1322`).
- **Sesión:** `client.session.create({ directory: sdkDir(folder), agent, model, metadata: { mode: 'tasks', fullAccess, folders } })`
  (`tasks/impl/actions.ts:558-570`); el mensaje va con `agent: tasks|computer`. Estado en `features/tasks/impl` y en
  `renderer/src/stores/` (`sessions.ts`, `eventRouter.ts`).
- **Remoto:** `tasks:approveFolder` es **D**, `tasks:start` es M (D si `fullAccess`), `tasks:grantFullAccess` y `fullAccess:consent`
  son D, `restore:apply` es D (`policy.ts:300-307`, `445-448`). Todo acotado al ámbito de carpetas aprobadas.

### Code (para completar el cuadro)

Tercer modo: agentes `plan`/`build`, permisos por `PermissionMode` (`src/shared/permission-rules.ts:22`, `features/code/impl/permission-rules.ts`),
sin Seatbelt (sidecar principal, carpeta real). Es la ruta «con carpeta pero sin sandbox».

### Resumen de diferencias

| Aspecto | Chat | Overdrive |
| --- | --- | --- |
| Servidor | sidecar principal, sin sandbox | un `serve` por carpeta, Seatbelt/WSL |
| Carpeta | `chatDirectory` interna | carpeta aprobada de la persona |
| Agente | `chat` (deny `*`) | `tasks` / `computer` |
| Adjuntos | `data:` solamente | se copian a la carpeta (`withAttachments`) |
| Modelos | cualquier proveedor | solo proveedores con clave de API del sandbox |
| Deshacer | no hay (nada se escribe) | punto de restauración por mensaje |
| Remoto | M, agente fijo `chat` | M/D según canal, ámbito de carpetas |

## 2. Qué significaría unirlos

### Opción A: «promover» una conversación a tarea Overdrive

Botón «Seguir en una carpeta» en una conversación de Chat. La persona elige/aprueba una carpeta (flujo existente
`tasks:pickFolder` → `approveFolder`), se crea una sesión `tasks` nueva en el servidor sandboxeado y se le pasa un **resumen** de la
conversación (texto, no la sesión). La sesión de Chat original queda intacta (enlazada con `metadata.promotedTo`).

- Es posible sin tocar zonas intocables: solo usa `approveFolder`/`start`/`session.create` ya existentes.
- No se puede mover la sesión de un servidor a otro (cada `opencode serve` tiene su propia base de datos): hay que **copiar contexto**.
  Lo razonable es resumir (hay `compactChat`, `actions.ts:246`) o pasar los últimos N mensajes como primer prompt.
- Los adjuntos `data:` de Chat se pueden escribir en la carpeta aprobada con el flujo de `tasks:importFiles`/`withAttachments`.

### Opción B: un solo modo con selector «trabajar en una carpeta»

Un único compositor; sin carpeta = agente `chat`, con carpeta = `tasks` (y quizá `build`). Es la opción de más impacto:

- Hay que cambiar de servidor y de agente **a mitad de conversación** (misma sesión visible, dos sesiones de motor detrás) o aceptar
  que quitar/poner la carpeta crea una sesión nueva.
- Fusiona stores (`useChat` + `useTasks`), listas, sidebar, atajos, onboarding, remoto (`chatDirs` vs `allowedDirs`) y capturas.
- Obliga a decidir el modelo de permisos único. Riesgo alto de «abrir» Chat por error (ver §3).
- Desaparece la garantía simple «Chat no puede tocar tu disco», que hoy es fácil de explicar y de auditar.

### Opción C: no unir, solo atajos

- En Chat: botón/sugerencia «Abrir en Overdrive con esta carpeta» que precarga el borrador (texto o resumen) en el compositor de
  Overdrive. Ya existe el patrón de borradores por modo (`setDraft('chat:…')`, `app/App.tsx:100`).
- En Overdrive: «Preguntar sin carpeta» que abre Chat con el texto.
- Coste bajo, cero cambios de seguridad; la persona sigue viendo dos modos pero con puente.

## 3. Riesgos

### Seguridad

1. **Permisos y agente.** Hoy el agente `chat` tiene `"*": deny` y los modelos nunca ven `bash`/`edit`. Si una sola sesión pudiera
   cambiar de agente, un fallo de interfaz que deje `agent: 'tasks'` en un `chatDirectory` le daría disco al modelo **sin sandbox**
   (el sidecar principal no está en Seatbelt). Regla a fijar: promover = **sesión nueva en servidor sandboxeado**, nunca cambiar el agente
   de una sesión del sidecar principal.
2. **Seatbelt y sandbox.** No hay que tocarlos (zona intocable, AGENTS.md §7). Cualquier unión debe pasar por `TasksManager.start`
   tal cual. Ojo con Windows: Tareas exige WSL listo y no elevado; Chat funciona siempre. Una pantalla única tendría que explicar
   el caso «Overdrive no disponible» sin romper Chat.
3. **Proveedores y claves.** Overdrive solo funciona con proveedores del sandbox (`SANDBOX_PROVIDER_IDS`); Chat acepta cualquiera.
   Al promover, el modelo de la conversación puede no estar disponible (aviso claro, no cambiarlo a escondidas; ya hay precedente en
   `actions.ts:520-530`). Las claves no deben viajar nunca en el resumen ni en `metadata`; el resumen es texto de la conversación
   (puede contener secretos que la persona pegó: avisar antes de copiarlo a una carpeta que quedará en disco).
4. **Archivos adjuntos.** Chat solo admite `data:`; Overdrive copia a la carpeta. Si se unifican compositores, hay que mantener
   el rechazo de `file://` en Chat (`policy.ts:833`, `actions.ts:59`) y que `adaptFilesForModel` (PDF a texto) no cambie lo que
   el agente `tasks` recibe sin que se note. Un adjunto promovido pasa de «solo en memoria de la sesión» a «archivo persistente
   en la carpeta»: tiene que ser una acción visible.
5. **Control remoto (clase X/D/M).** `policy.ts` distingue ámbitos: `chatDirs` solo acepta agente `chat` (`:797-803`, `:884`).
   Una conversación promovida cae en `allowedDirs`. Canales nuevos (p. ej. `chat:promote`) deben nacer **X** (la promoción
   escribe archivos y aprueba una carpeta; `approveFolder` ya es D). Si se hiciera la opción B, `agentOutcome` y `sessionCreate`
   tendrían que reescribirse y cada cambio de ámbito es un hueco potencial; además el celular no debe poder «subir» una conversación
   de Chat a Overdrive, ni aprobar carpetas. Telegram igual (permisos desde fuera del Mac).
6. **Datos que se filtran entre modos.** Memoria e instrucciones de Chat (`projects:context`, X en remoto) vs memoria de carpeta
   (`.lazunox/memoria.md`). Al promover no se deben mezclar los contextos de proyecto de Chat con el AGENTS.md de la carpeta sin que la
   persona lo vea.

### Datos y migración

- Las sesiones viven en bases de datos de servidores distintos; no hay migración in-place. Opción A no migra nada (crea sesión nueva).
  Opción B, si cambia dónde viven las conversaciones, **sí** migra: miles de sesiones de Chat en `chatDirectory`, fijadas en
  localStorage (`chat.pinned`), proyectos (`projects/store.ts`), archivadas (`isArchivedSession`). Mucho riesgo para poco valor.
- `metadata.mode` ('chat'/'tasks') se usa para filtrar y para uso/estadísticas (`usage-source.ts:20 modeOf` decide por directorio).
  Una conversación «híbrida» rompería esas cuentas y la galería (`gallery.origin.*`).
- Opción A necesita un campo nuevo en `metadata` (`promotedFrom`/`promotedTo`): barato, retrocompatible (campo opcional).
- Puntos de restauración y «Deshacer» solo existen con carpeta: una conversación mixta tendría deshacer a medias (confuso).

### UX

- Hoy la frontera es clara: «Chat no toca tu computador; Overdrive sí, en la carpeta que elijas». Unir diluye eso, y la gente
  mayor/no técnica es justo el público de Chat. Un selector de carpeta dentro del chat puede dar falsa sensación de seguridad
  («le di una carpeta» ≠ «está en un sandbox con puntos de restauración»).
- El primer uso de Overdrive tiene fricción real (aprobar carpeta, preparar sandbox, onboarding `Onboarding.tsx`). Promover desde
  Chat tiene que enseñar eso en el momento, no esconderlo.
- Tarjetas de permisos, plan, entregables y panel de cambios existen solo en Overdrive; en un modo único habría que mostrarlos
  condicionalmente.
- Textos y guardias: cada cadena nueva en `es`/`en`, `visible-terms`, `i18n-coverage`.

### Pruebas

- Opción C: tests de renderer (borrador precargado) + un E2E corto. Bajo.
- Opción A: pruebas unitarias del armado de resumen/contexto, del flujo de carpeta (reutiliza `approveFolder`), de `policy.ts`
  (canal nuevo X, tests ya exigen clase), IPC schema estricto, i18n, y un E2E con OpenCode falso. Más una prueba real por CDP con
  modelo gratuito (la memoria del proyecto pide probar la app real, no solo el arnés).
- Opción B: reescribir buena parte de `sessions.*.test.ts`, `eventRouter`, `policy.test`, E2E de chat y de tareas, y repetir la
  batería de seguridad (A1–A20 del sandbox no se alteran, pero el cambio de agente en sesión exige tests nuevos de «no se escapa»).
  Suites pesadas van al VPS, no al Mac (memoria de Ben).

## 4. Recomendación

**Hacer C primero y A después, solo si C se usa. No hacer B.**

Razones: A y C no tocan el sandbox ni el modelo de permisos; mantienen la promesa simple de Chat; reutilizan flujos ya probados
(`approveFolder`, `start`, restore points). B es una reescritura de seguridad y de stores para una ganancia sobre todo cosmética.

### Plan por etapas pequeñas

1. **Etapa 1 (C, mínima).** En una conversación de Chat, botón «Continuar en Overdrive…» que: abre el selector de carpeta existente,
   cambia a modo Overdrive y deja en el borrador el resumen/últimos mensajes. Sin crear sesión ni escribir archivos todavía. Solo
   renderer: `features/chat` + `setDraft` del modo tasks. Sin canales IPC nuevos.
2. **Etapa 2 (A-lite).** Si en la etapa 1 la gente lo usa: al enviar, la sesión `tasks` nace con
   `metadata.promotedFrom = <chatSessionID>` y la conversación de Chat muestra «Continuada en Overdrive» con enlace. Aún sin copiar
   adjuntos.
3. **Etapa 3 (A completa).** Adjuntos: pasar los `data:` a la carpeta con una confirmación visible («se guardarán estos 2 archivos
   en la carpeta X»). Aviso de modelo no disponible en el sandbox. Si hace falta un canal (p. ej. guardar adjuntos), clase X en
   `policy.ts` + sección en `docs/SEGURIDAD.md` + ID `F8-B<n>` en el changelog.
4. **Etapa 4 (opcional).** Atajo inverso «Preguntar sin carpeta», y que Overdrive sugiera Chat para consultas sin archivos.
5. Evaluar uso (qué porcentaje promueve, dónde abandona) antes de pensar en algo más profundo.

### Prototipo mínimo que se puede hacer ya

Solo la etapa 1, detrás de un botón en `ChatView` (`features/chat/ChatView.tsx`): construir el texto con `userMessageContent`/mensajes de
`useSessions` (ya hay `export.ts` en `features/chat` que serializa la conversación), llamar `useUi.getState().setMode('tasks')`
(`stores/ui.ts:68`) y guardar el borrador. Sin tocar `src/main`, sin esquemas IPC, sin zonas intocables. Se prueba con un test de
componente y una pasada manual con el modelo gratuito por CDP. Estimación: 1 día, un commit.

## 5. Preguntas abiertas para Ben

1. ¿Qué dolor concreto quieres resolver? (a) la gente no sabe que existe Overdrive, (b) la conversación se pierde al cambiar de modo,
   (c) quieres un solo lugar para todo. La respuesta decide entre C, A o B.
2. Al promover, ¿copiamos un **resumen** (menos tokens, puede perder detalle) o los **últimos mensajes literales**? ¿Quién decide qué se
   pasa: la IA o la persona editando el borrador?
3. ¿Los adjuntos de Chat deben pasar a la carpeta automáticamente, o solo los que la persona marque?
4. ¿Puede el celular (control remoto) promover una conversación? Mi propuesta: no (clase X), porque implica aprobar carpeta y escribir
   archivos.
5. Modelos: si el proveedor de la conversación no existe en el sandbox, ¿bloqueamos con aviso (como hoy) o proponemos uno gratuito
   compatible?
6. ¿Y Code? ¿Se incluye en la misma idea («continuar en Code») o queda fuera?
7. ¿Aceptas que la sesión de Chat original siga existiendo aparte (y se pueda borrar por separado) y que no haya sincronización
   posterior entre las dos?
8. En Windows, si Overdrive no está listo (WSL), ¿el botón se oculta o explica cómo activarlo?
9. ¿Medimos el uso de la promoción (contador local, sin enviar nada fuera) para decidir si vale la pena la etapa 3?
