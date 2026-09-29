# Lote A — Cowork autónomo (plan de ejecución)

Plan diseñado por un agente Opus tras leer el código; ejecutado por agentes Sonnet en paralelo sobre el mismo
árbol de trabajo. **Objetivo:** que una tarea de Cowork se complete sola (abrir apps cerradas, teclear en ellas,
buscar en la web, tareas de varios pasos) sin bucles de permisos.

> Reglas para TODOS los paquetes
> - El árbol ya tiene cambios sin commitear en `src/main/computer/mcp-server.ts`, `src/main/computer/overlay.ts`,
>   `src/main/ipc/cowork-handlers.ts`, `src/renderer/overlay/pill.html` y `DESIGN.md`: **edita encima, nunca revertir**.
> - **No tocar** `resources/computer-use/helper.swift` ni `resources/computer-use/bin/cu-helper` (recompilar cambia la
>   firma y macOS olvida los permisos TCC). Sumas: helper.swift `d42da8a3…8013`, cu-helper `8985f8f6…258ae1`.
> - **No tocar** `src/preload/pill.ts` ni `CHANNEL_ROLES` (la píldora sigue usando solo `computer:stop`,
>   `computer:respondAccess`, `computer:showMainWindow`).
> - No renombrar nada de "OnyxCode" a "OnyxCode". Todo el texto de UI en español. Nombre del producto solo desde `src/shared/brand.ts`.
> - No hacer commits. No lanzar la app (`npm run dev`); el orquestador la reinicia al final.
> - Cada paquete edita **solo los archivos que posee**. Si necesitas algo de otro paquete, no lo edites: anótalo en tu informe final.
> - Criterio mínimo: `npm run typecheck` (node y web) sin errores atribuibles a tus archivos.

## Verificación de los bloqueos (con evidencia)

1. **Nivel de acceso.** `request_access` no tiene nivel (`mcp-server.ts` ~905-928); `type_text`/`key`/`drag` exigen `full`;
   las tarjetas preseleccionan `'click'` (`ComputerAccess.tsx` ~683 y ~754; `pill.ts` ~119 y ~183);
   `resolveAccessRequest` (`service.ts` ~296-302) sobrescribe con `grants.grant()` y puede bajar un "full";
   Cancelar/Esc/✕ hacen `deny` por app (`actions.ts` ~196-201) → `grants.deny()` **borra la concesión y la mete en denegadas**;
   `resolveAccessRequest` acepta cualquier `bundleId` del renderer sin compararlo con la tarjeta.
2. **Plan sin apps = callejón sin salida** (`required: ['apps']`, 400 en `service.ts` ~551-555, plan solo se aprueba con ≥1 app).
3. **Aprobación global y por turno**: `planApproved` booleano global (`service.ts` ~148), `resetPlanApproval()` en
   `cowork-handlers.ts` ~291-297; el plugin `onyxcode-plan-gate` cachea global. El MCP no conoce el sessionID; en el bundle de
   opencode 1.18.32 el hook `tool.execute.before` recibe `{tool, sessionID}` y el MCP se llama con el **mismo** objeto de
   args, así que el plugin puede inyectar `output.args.onyxcode_session` **mutando el objeto en sitio** (no reasignar).
   Además `callTool` atiende `screenshot` antes de `requirePlanApproved` (bug).
4. **Sandbox no abre apps** (Seatbelt deniega `open`, `osascript`, `launchctl`, `screencapture`). Las sesiones **no se comparten**
   entre modos (XDG privado del sandbox) → "continuar" = tarea nueva en el servidor de Control total.
5. **Búsqueda web**: allowlist por defecto solo `opencode.ai`; websearch usa `mcp.exa.ai` o `search.parallel.ai`
   (`hash(sessionID)%2` salvo `OPENCODE_WEBSEARCH_PROVIDER`).
6. **`question: deny`** en `computer.md` contradice el plan (`PLAN_GATE_ALLOWED_TOOLS` incluye `question`).
7. Memoria `.onyxcode/memoria.md` solo se carga al conectar (el panel pisa lo que escribió el agente) y `.onyxcode` no está en
   `SKIP_DIRS`; textos obsoletos (`mcp-server.ts:43` "5 min", `AUDIT.md:134` "red abierta").
   Extra: responder desde la píldora deja obsoleta la tarjeta de la ventana principal; la notificación de un plan sin apps sale vacía.

## B. Decisiones de diseño

### Contratos compartidos (`src/shared/ipc-cowork.ts`)

```ts
export type AppTier = 'view' | 'click' | 'full'   // sin cambios
export const APP_TIER_RANK: Record<AppTier, number> = { view: 0, click: 1, full: 2 }
/** Máximo de dos niveles (null/undefined = sin concesión). */
export function maxTier(a: AppTier | null | undefined, b: AppTier | null | undefined): AppTier | null
export const TIER_LABEL_ES: Record<AppTier, string> = { view: 'Solo ver', click: 'Ver y clic', full: 'Control total' }

export interface AccessRequestApp {
  bundleId: string
  name: string
  /** Nivel que DECLARA el agente (`levels` de request_access). Ausente = legado → 'click'. */
  requested?: AppTier
  /** Nivel ya concedido antes de esta tarjeta (null = ninguno). Lo rellena main. */
  current?: AppTier | null
  /** Está en la lista de denegadas. Lo rellena main. */
  denied?: boolean
}
export interface AccessRequest {
  id: string
  apps: AccessRequestApp[]          // puede ser [] SOLO si hay plan (plan sin apps)
  reason?: string
  plan?: string[]
  /** Sesión (tarea) de OpenCode que pidió la tarjeta (inyectada por onyxcode-plan-gate). */
  sessionId?: string
  /** Nombres que el agente pidió y no se encontraron instalados. */
  unresolved?: string[]
}
/** Preselección de la tarjeta: nunca por debajo de lo ya concedido. */
export function defaultAccessDecision(app: AccessRequestApp): AccessDecision
//  = app.denied ? (app.requested ?? 'click') : (maxTier(app.current, app.requested ?? 'click') ?? 'click')

export interface PlanApprovalState { sessionId: string; approved: boolean }
export type NetworkToggleKey = 'npmEnabled' | 'pypiEnabled' | 'webSearchEnabled'
export interface NetworkPolicyState { /* existentes */ webSearchEnabled: boolean; webSearchHosts: string[] }
```

Cambios en contratos invoke y eventos (y añadir los canales nuevos a `COWORK_INVOKE_CHANNELS` / `COWORK_EVENT_CHANNELS`):
- `'computer:respondAccess'.req`: añadir `approvePlan?: boolean` y `cancel?: boolean`.
- `'computer:session'.req`: añadir `sessionId?: string`.
- Nuevo invoke `'computer:revokePlan': { req: { sessionId: string }; res: void }`.
- Nuevo invoke `'computer:approvedPlans': { req: void; res: string[] }`.
- Nuevo evento `'computer:accessResolved': { id: string }`.
- Nuevo evento `'computer:planState': PlanApprovalState`.
- `'cowork:network:setToggle'.req.key` pasa a `NetworkToggleKey`.

### Herramienta MCP `request_access`
- Args: `apps?: string[]` (ya no obligatorio), `levels?: ('view'|'click'|'full')[]` (mismo orden que `apps`), `reason?`, `plan?`,
  `onyxcode_session?` oculto (no va en el schema; lo inyecta el plugin y siempre sobrescribe lo del modelo).
  El parser tolera también `apps: [{name, level}]`.
- Validación: sin `plan` y sin apps → error. Con `plan` y sin apps (o ninguna resuelta) → se envía el plan con `apps: []` y `unresolved`.
  Duplicados por bundleId: se conserva el `requested` más alto.
- POST a main: `{ apps: [{bundleId, name, requested}], reason, plan, session, unresolved }`.
- Respuesta de main: `{ decisions: {<bundleId>: <nivel efectivo>|'deny'}, feedback?, cancelled?, planApproved? }`.

### Reglas de concesión (main)
- **Aprobar:** nivel efectivo = `maxTier(grants.tierFor(b), decisión)`. Una tarjeta **nunca baja** un nivel; bajar solo en Ajustes (`computer:setGrant`).
- **"Denegar" por app**: explícito, mantiene `grants.deny`.
- **`cancel`** (Esc, ✕, "Cancelar"): **no toca ninguna concesión**.
- Se ignoran los bundleIds que no estén en la tarjeta pendiente.

### Máquina de estados de la aprobación del plan (main, en memoria)
- Estado: `approvedPlans: Map<sessionId, approvedAt>` + `legacyPlanApproved: boolean` (respaldo si falla la inyección).
- Aprueba: tarjeta con plan, sin `cancel` ni `feedback`, y (`approvePlan === true` o alguna app aprobada) → `approve(sessionId)`.
  Si falta `sessionId` → `legacyPlanApproved = true` con `console.warn`.
- Revoca: `cancel`/`feedback` sobre tarjeta con plan → `revoke(sessionId)`; `computer:revokePlan` (archivar/borrar tarea o botón "Revocar");
  `stop()` (kill-switch) → todas; reiniciar la app → se pierden.
- `computer:session {active:false}` **ya no revoca**; solo borra `legacyPlanApproved`.
- `isPlanApproved(s)` = `map.has(s) || legacy`. Sin sesión = `legacy || map.size > 0`.
- `GET <url>/plan-status?session=<id>` → `{ approved }`. Tarea nueva = sesión nueva = plan nuevo.

### Escalada desde el sandbox
El agente `cowork` termina su turno con la línea literal **"Necesita Control total del Mac"**. El renderer la detecta en el último mensaje
del asistente de una tarea terminada en sandbox y muestra una tarjeta con "Cambiar a Control total y continuar". Al pulsar:
`setAccessMode(true)` (abre **siempre** el `FullAccessDialog`) → se "arma" una continuación → cuando llega la conexión de Control total
para esa carpeta, `sendToTask(promptContinuación)` crea una tarea nueva. Nunca hay escalada silenciosa: dos clics explícitos + aprobación del plan.

### Red del sandbox
- `OPENCODE_WEBSEARCH_PROVIDER=exa` en el entorno del servidor sandbox (host único).
- Nuevo interruptor `webSearchEnabled` en la política de red que añade `mcp.exa.ai` (host exacto). **Activado por defecto**, visible y desactivable en Ajustes → Red de Cowork. El resto de la allowlist sigue deny-by-default.

## C. Paquetes de trabajo

**Orden:** primero PKG-A en solitario. Después PKG-B, PKG-C, PKG-D y PKG-E en paralelo (archivos disjuntos).
Tras A, `npm run typecheck` debe pasar (todos los campos nuevos son opcionales).

### PKG-A — contratos (primero)
**Posee:** `src/shared/ipc-cowork.ts`, `src/main/ipc/schemas.ts`, `src/main/cowork/proxy-policy.ts`,
`src/main/cowork/manager.ts` (**solo** la firma de `networkSetToggle`, ~línea 126).
1. `ipc-cowork.ts`: añadir exactamente los tipos y funciones de la sección B (`APP_TIER_RANK`, `maxTier`, `TIER_LABEL_ES`,
   `defaultAccessDecision`, `PlanApprovalState`, `NetworkToggleKey`). Campos nuevos de `AccessRequestApp`/`AccessRequest` opcionales;
   `webSearchEnabled` y `webSearchHosts` obligatorios en `NetworkPolicyState`. Aplicar cambios de contrato y añadir los 4 canales nuevos
   a las listas. JSDoc en español.
2. `schemas.ts`: `const sessionId = str({ max: 200, min: 1, pattern: /^[A-Za-z0-9_-]+$/ })`; `computer:session`:
   `obj({ active: bool, label: optional(str({max:500})), sessionId: optional(sessionId) })`; `computer:respondAccess`: añadir
   `approvePlan: optional(bool)` y `cancel: optional(bool)` (`decisions` ya admite `[]`); `computer:revokePlan`: `obj({ sessionId })`;
   `computer:approvedPlans`: `none`; `setToggle.key`: `literal('npmEnabled','pypiEnabled','webSearchEnabled')`. **No** tocar `CHANNEL_ROLES`.
3. `proxy-policy.ts`: `export const WEB_SEARCH_HOSTS = ['mcp.exa.ai']` (comentar binario 1.18.32 + `OPENCODE_WEBSEARCH_PROVIDER`);
   `Persisted.webSearchEnabled`, `DEFAULTS` = `true`, en `load` `raw.webSearchEnabled !== false`; `state()` devuelve `webSearchEnabled` y
   `webSearchHosts: [...WEB_SEARCH_HOSTS]`; `setToggle(key: NetworkToggleKey, …)`; `effectiveAllowlist` añade `WEB_SEARCH_HOSTS` si está activo; actualizar cabecera.
4. `manager.ts` ~126: `networkSetToggle(key: NetworkToggleKey, value: boolean)`.
**Aceptación:** `npm run typecheck` pasa. **Verificación:** bundlear `ipc-cowork.ts` con esbuild al scratchpad y comprobar:
`maxTier('full','click')==='full'`, `maxTier(null,'view')==='view'`, `defaultAccessDecision({current:'full',requested:'click'})==='full'`,
`defaultAccessDecision({requested:'full'})==='full'`, `defaultAccessDecision({})==='click'`.

### PKG-B — núcleo en main (bloqueos 1, 2, 3 y 7b)
**Posee:** `src/main/computer/service.ts`, `src/main/computer/mcp-server.ts`, `src/main/computer/grants.ts` (solo comentarios),
`src/main/ipc/cowork-handlers.ts`, `src/main/cowork/opencode-config.ts`.

`service.ts`:
1. Sustituir `planApproved` por `approvedPlans: Map<string, number>` + `legacyPlanApproved`.
2. Eventos: `planApproved: [{ sessionId?: string }]`; nuevo `planState: [PlanApprovalState]`.
3. Métodos: `approvePlanFor(sessionId?)`, `revokePlan(sessionId)` (emite `planState false`), `approvedPlanSessions(): string[]`, `endLegacyPlan()`,
   `isPlanApproved(sessionId?)` según las reglas de B; borrar `resetPlanApproval`; en `stop()` revocar todas (emitiendo `planState` por cada una) y `legacy=false`.
4. `AccessResponse = { decisions: Record<string,AccessDecision>; feedback?: string; cancelled?: boolean; planApproved?: boolean }`.
   `requestAccess(apps, reason, plan, sessionId?, unresolved?)`: enriquece cada app con `current: grants.tierFor(b)` y `denied: grants.isDenied(b)`,
   guarda `apps` y `sessionId` en `pendingAccess` y emite la tarjeta con `sessionId` y `unresolved`.
5. `resolveAccessRequest(id, decisions, opts: { feedback?; approvePlan?; cancel? })`: reglas de B (`cancel` y `feedback` no conceden nada y, si la tarjeta
   tenía plan, revocan la sesión); filtrar bundleIds que no estaban en la tarjeta; nivel efectivo = `maxTier`; resolver con
   `{decisions: efectivos, feedback, cancelled, planApproved}`. `denyAllPending` resuelve con `{decisions:{}, cancelled:true}`.
6. HTTP: `plan-status` (`startsWith(\`${path}/plan-status\`)`, lee `session` de la query). POST `/request-access`: validar `requested` contra el enum,
   `session` con patrón `[A-Za-z0-9_-]{1,200}`, `unresolved` como `string[]` ≤10 elementos ≤255 c/u; 400 solo si `!apps.length && !plan?.length`;
   devolver el `AccessResponse` completo. Actualizar comentarios.

`mcp-server.ts`:
1. Cabecera (~línea 43): "espera sin límite de tiempo (solo Detener la cancela)".
2. Schema de `request_access`: añadir `levels` (array con el enum; descripción: "nivel que necesitas por app, mismo orden que apps: 'full' si vas a
   teclear, pulsar teclas o arrastrar; 'click' si solo clic o scroll; 'view' si solo mirar"); `apps` opcional (`required: []`); la descripción explica el plan sin apps (`apps: []`).
3. Parseo según B; el POST incluye `session: args.onyxcode_session`.
4. Texto de resultado: `cancelled` → "El usuario canceló: no se concedió nada ni se aprobó el plan. No actúes; explícaselo y detente."; líneas con el nivel **efectivo**;
   con plan: "Plan aprobado: puedes actuar (terminal, archivos, web y las apps concedidas)" o que se detenga; captura si `planApproved` o alguna app aprobada.
5. Mensajes de `requireTier`: `Llama a request_access con apps: ["X"] y levels: ["<minTier>"]`.
6. `requirePlanApproved(session?)` pasa `?session=`. En `callTool`: `const session = typeof args.onyxcode_session === 'string' ? args.onyxcode_session : undefined` y quitarlo de `args`.
   **Mover la comprobación del plan antes de la rama `screenshot`**.

`opencode-config.ts` (fuente del plugin `onyxcode-plan-gate`):
1. El hook pasa a `(input, output)`. 2. **Primero la inyección:** si `input.tool` empieza por `computer_` y `output.args` es objeto → `output.args.onyxcode_session = input.sessionID`
   (mutar, **no** reasignar). 3. Después el control por sesión: `isApproved(sessionID)` con caché `Map<sessionID,{at,ok}>` y
   `GET GATE_URL+'/plan-status?session='+encodeURIComponent(sessionID)`, manteniendo fail-closed. 4. `DENY_MSG` menciona el plan sin apps.
5. Cabecera: la aprobación dura toda la tarea (sesión) hasta Revocar, Detener o archivar/borrar.

`cowork-handlers.ts`:
1. `requestAccessResolved`: además de `overlay.clearAccessRequest()`, `send('computer:accessResolved', {id})`. 2. `computer.on('planState', st => send('computer:planState', st))`.
3. Cuerpo de la notificación: si `apps` vacío, "Plan sin apps (terminal, archivos o web)".
4. `sessionWanted = { label, sessionId }`; si está activa y `computer.isPlanApproved(sessionId)` → `enterControlMode()`; al pasar a inactiva: `computer.endLegacyPlan()` sin revocar;
   el listener de `planApproved(ev)` entra en modo control si `sessionWanted` existe y (`!ev.sessionId`, o `!sessionWanted.sessionId`, o coinciden).
5. `respondAccess` → `computer.resolveAccessRequest(id, decisions, { feedback, approvePlan, cancel })`.
6. Handlers `computer:revokePlan` → `computer.revokePlan(sessionId)` y `computer:approvedPlans` → `computer.approvedPlanSessions()`.

**Aceptación:** no quedan usos de `resetPlanApproval`; `request_access` con `{plan:[…], apps:[]}` se acepta; aprobar nunca baja un nivel; la captura queda bloqueada por el MCP sin plan.
**Verificación (harness node en scratchpad, sin Electron):** `npx electron-vite build`; servidor HTTP falso con `/state`, `/tier`, `/plan-status` (registrando la query) y `/request-access`
(registrando el cuerpo, respondiendo `{decisions:{},planApproved:true}`); lanzar `node out/main/computer-mcp.js` con `COMPUTER_MCP_TOKEN` (≥32 caracteres), `CU_HELPER=/usr/bin/false`,
`COMPUTER_EVENTS_URL=<falso>`, `COMPUTER_AUTO_SCREENSHOT=0`, leer el puerto de stdout; `tools/list` (request_access sin `required` y con `levels`);
`tools/call request_access {plan:['x'],apps:[],onyxcode_session:'ses_a'}` → el falso recibe `session:'ses_a'` y `apps:[]`; `tools/call screenshot {onyxcode_session:'ses_b'}` con `plan-status` en false → error de plan.
Plugin: bundlear `opencode-config.ts` con `--external:electron`, escribir `planGatePluginSource()` en el scratchpad, importarlo con `ONYXCODE_PLAN_GATE_URL` al falso y comprobar que (a) `args.onyxcode_session` queda inyectado y (b) bloquea/permite según la sesión.

### PKG-C — UI de aprobación y estado en el renderer (bloqueos 1, 2, 3, 6 y 7a)
**Posee:** `src/renderer/overlay/pill.ts`, `src/renderer/overlay/pill.css`, `src/renderer/src/features/cowork/impl/ComputerAccess.tsx`,
`src/renderer/src/features/cowork/impl/actions.ts`, `src/renderer/src/features/cowork/impl/store.ts`.

`pill.ts` / `pill.css`:
1. `choices` = `defaultAccessDecision(a)` por app; eliminar `'click'` en ~119 y ~183.
2. Cada fila: línea extra `Pide: <TIER_LABEL_ES[requested]>` + `· Ahora: …` si hay `current` + `· Denegada antes` si `denied`; el botón del nivel pedido lleva la clase `requested`.
3. Tarjeta sin apps: título "Plan de la tarea"; nota "Este plan no controla ninguna app: usará la terminal, archivos o la web."; ocultar lista de apps y "Denegar todo".
4. Si hay `unresolved`: nota "No encontré: …".
5. `respond(decisions, extra = {})` envía `{id, decisions, ...extra}`. Aprobar: `approvePlan: !!req.plan`. ✕: `respond([], {cancel:true})`.
   "Denegar todo": en tarjetas sin plan es un deny explícito; en tarjetas con plan el botón se llama "Cancelar" y usa `{cancel:true}`.
6. Añadir la demo `#demo-plan-only`. 7. CSS para `.req-app-meta`, `.request-note`, `.req-tier.requested`.

`ComputerAccess.tsx`:
1. `PlanAccessCard`: preselección con `defaultAccessDecision` y la misma info por fila usando el `TierBadge` existente ("Solicita" y "Actual").
2. Nota de pie: "Aprobar nunca baja un nivel ya concedido; para bajarlo usa Ajustes."
3. Tarjeta sin apps y `unresolved`, igual que en la píldora.
4. Botones: con plan → Cancelar (`cancel`), Editar (`feedback`), Aprobar y empezar (`approvePlan`); sin plan → Denegar todo (deny explícito) y Confirmar; Esc → `cancel`.
5. `ControlBanner`: con `conn.fullAccess`, `activeTaskId` y `approvedPlans[activeTaskId]`, mostrar (también con nada ocupado) una fila compacta:
   "Plan aprobado para esta tarea: puede seguir sin volver a pedirlo" con botón **Revocar** → `revokePlanApproval(id)`.

`actions.ts`:
1. `respondAccessRequest(decisions, opts?: { feedback?; approvePlan?; cancel? })`. 2. `dismissAccessRequest` → `respondAccessRequest([], { cancel: true })`.
3. `export async function revokePlanApproval(sessionId: string)` → `cw('computer:revokePlan', …)`.
4. `archiveTask` y `deleteTask`: tras el éxito, `void cw('computer:revokePlan',{sessionId}).catch(()=>{})`.
5. `sendToTask`: `await loadProjectAndMemory(folder)` antes de `buildSystemPrompt()`.
6. **No** cambiar las firmas de `setAccessMode`, `sendToTask` ni `cancelFullAccess` (las usa PKG-E).

`store.ts`:
1. Estado `approvedPlans: Record<string,true>`.
2. En `syncAccessRequests()` suscribirse también a `computer:accessResolved` (limpiar `accessRequest` si coincide el id) y a `computer:planState`; cargar `cw('computer:approvedPlans')` una vez.
3. `syncComputerSession`: calcular el `sessionId` de la tarea raíz ocupada; etiqueta: si hay pregunta pendiente para esa raíz, `` `Tiene una pregunta para ti — responde en ${APP_NAME}` ``
   (importar `APP_NAME` de `@shared/brand`), si no el título; dedupe por clave `active|sessionId|label`; enviar `{active,label,sessionId}`; suscribirse también a cambios de `questions`.
4. Memoria: en el evento de reposo de una tarea raíz, `if (!projectPanelOpen) void loadProjectAndMemory(folder)`; `setProjectPanelOpen(true)` → `loadProjectAndMemory`.
**Aceptación:** no queda `'click' as AccessDecision`; Cancelar no cambia permisos en Ajustes; responder en la píldora cierra la tarjeta de la ventana; la etiqueta de pregunta aparece en la píldora.
**Verificación:** typecheck web; `pill.html#demo-request` y `#demo-plan-only` con el banco de pruebas Electron descrito abajo.

### PKG-D — red, agente `computer` y documentación (bloqueos 5, 6 y 7)
**Posee:** `src/main/cowork/manager.ts` (el resto; A ya terminó), `src/renderer/src/features/settings/impl/NetworkSection.tsx`,
`resources/opencode/agents/computer.md`, `AUDIT.md`.
1. `manager.ts`: `'.onyxcode'` en `SKIP_DIRS`; en `spawn`, en `extraEnv` y **solo cuando `!fullAccess`**: `OPENCODE_WEBSEARCH_PROVIDER: 'exa'` con comentario (lista blanca de un único host).
2. `NetworkSection.tsx`: interruptor "Búsqueda web del agente" (mismo patrón que npm/PyPI, `key: 'webSearchEnabled'`). Descripción:
   `Permite la herramienta de búsqueda web (${state.webSearchHosts.join(', ')}). Las consultas se envían a ese servicio.`
3. `computer.md`: `question: allow`; flujo actualizado: `request_access` siempre con `levels` (`full` para teclear, pulsar teclas o arrastrar —incluido escribir URLs o búsquedas en el navegador—;
   `click` solo clic/scroll; `view` solo mirar); plan sin apps (`apps: []`) para tareas de terminal, archivos o web; el plan aprobado dura toda la tarea (en seguimientos del mismo objetivo no se repite;
   si cambia el objetivo, plan nuevo; ante "no hay plan aprobado", pedirlo de nuevo); usar `question` para ambigüedades **antes** del plan; no delegar control de pantalla a subagentes (`task`);
   si una app queda en "nivel insuficiente", pedirla con `levels`; `websearch`/`webfetch` disponibles tras la aprobación.
4. `AUDIT.md:134`: sustituir "(lista ampliada; la red sigue abierta)" por "red restringida: proxy de egress con lista blanca deny-by-default (`proxy.ts`, `proxy-policy.ts`, Seatbelt `(deny network*)` salvo proxys locales)"; ajustar el resto del párrafo que diga que la red es abierta.
**Aceptación:** `grep -n "question: deny" resources` no devuelve nada.

### PKG-E — escalada sandbox → Control total (bloqueo 4)
**Posee:** `resources/opencode/agents/cowork.md`, `src/renderer/src/features/cowork/impl/CoworkWorkspace.tsx`, `src/renderer/src/features/cowork/impl/Home.tsx` (sin cambios previstos),
**nuevo** `src/renderer/src/features/cowork/impl/EscalateCard.tsx`.
1. `cowork.md`, nueva sección "Tareas que necesitan controlar apps del Mac": en el sandbox no puedes abrir apps, hacer clic, teclear en otras apps ni capturar pantalla (`open`, `osascript`, `screencapture` fallan: no lo intentes ni busques rodeos);
   haz lo que puedas dentro de la carpeta y termina el turno con la línea exacta `**Necesita Control total del Mac**: <motivo en una frase>`, indicando al usuario que pulse «Cambiar a Control total y continuar»;
   `websearch` disponible; `webfetch` a otros hosts puede quedar bloqueado (tarjeta para permitirlo y luego «Reintenta»).
2. `EscalateCard.tsx`: `lastAssistantText(entries)` (une partes `type==='text'` del último `info.role==='assistant'`); `needsFullAccess(text)` (busca "necesita control total del mac" normalizado NFD, sin tildes, minúsculas);
   `buildContinuationPrompt(entries)` (primer texto de usuario sin el marcador de adjuntos, como `scheduleActiveTask`): "Continúa en Control total del Mac esta tarea que empecé en modo sandbox.\n\nEncargo original:\n<…>\n\nLo que hiciste o concluiste en sandbox:\n<último texto del asistente, ≤1500 caracteres>".
   Continuación a nivel de módulo `{folder, prompt, at}` con `useCowork.subscribe` a nivel de módulo: (a) si `pendingFullAccess` pasa de algo a `null`: `setTimeout(3000)` y, si `!getState().fullAccess`, se descarta;
   (b) si `conn?.fullAccess && phase==='ready' && folder===cont.folder` y `conn !== prev.conn`: se consume con `sendToTask(prompt, useSettings.getState().settings.defaultModel).catch(e => useCowork.setState({error: errorMessage(e)}))`;
   (c) si cambia la carpeta o pasan más de 5 min: se descarta.
   Componente `EscalateCard({ taskId, entries })`: tarjeta ámbar "Esta tarea necesita controlar apps de tu Mac" con el motivo y la explicación; botón primario **"Cambiar a Control total y continuar"** (arma la continuación y llama a `setAccessMode(true)`, que abre el diálogo de confirmación);
   secundario "Seguir en sandbox" (la oculta; estado local por id de mensaje).
3. `CoworkWorkspace.tsx`: en el `footer`, `{!fullAccess && status === 'done' && activeId && <EscalateCard taskId={activeId} entries={entries} />}`.
**Aceptación:** sin clic explícito y sin confirmar el diálogo no se envía nada; si se cancela el diálogo no queda nada armado.

## D. Comprobaciones de integración (orquestador)
1. `npm run typecheck` (node y web) y `npx electron-vite build`.
2. Greps: `resetPlanApproval|'click' as AccessDecision` en `src` → vacío; `5 min` en `mcp-server.ts` → vacío; `question: deny` en `resources/opencode/agents` → vacío;
   `'.onyxcode'` en `manager.ts` → presente; `computer:revokePlan|computer:accessResolved|computer:planState` presentes en shared, schemas, handlers y renderer;
   `git diff --stat src/preload/pill.ts resources/computer-use` → vacío; `shasum resources/computer-use/helper.swift` → `d42da8a3…`.
3. Harnesses de A y B en el scratchpad (no en el repo).
4. **Prueba manual para el usuario** (`npm run dev -- --watch`, modelo con visión):
   1. Control total con Discord cerrada: «abre Discord y entra al canal pega y escribe hola» → tarjeta con Discord en «Control total» preseleccionado («Solicita: Control total»); aprobar → abre y teclea **sin volver a pedir permiso**.
   2. Seguimiento en la misma tarea («ahora escribe adiós»): no sale tarjeta de plan y se ve «Plan aprobado · Revocar». Revocar → el siguiente seguimiento vuelve a pedir el plan.
   3. Tarea nueva → pide un plan nuevo.
   4. En Ajustes poner Discord en Control total; pedir una tarea que solicite `click`: la tarjeta muestra «Actual: Control total» y tras aprobar sigue en Control total.
   5. Esc o ✕ en una tarjeta de plan: Ajustes queda igual (ninguna app pasa a «denegadas»).
   6. «Busca en la web el precio del dólar hoy y guárdalo en dolar.md»: sale «Plan de la tarea» sin apps → aprobar → búsqueda y escritura funcionan.
   7. Con la ventana minimizada, aprobar desde la píldora: la tarjeta de la ventana principal desaparece.
   8. Tarea ambigua en Control total: `QuestionCard` y la píldora dice «Tiene una pregunta para ti…».
   9. ⌘⇧Esc, Reanudar, seguimiento: vuelve a pedir el plan.
   10. En sandbox: «abre Discord y entra al canal pega» → el agente responde «Necesita Control total del Mac» → tarjeta → «Cambiar a Control total y continuar» → diálogo → Confirmar → tarea nueva en Control total con el encargo original → pide su plan.
   11. Sandbox con «Búsqueda web» activada: «busca noticias de hoy sobre X» devuelve resultados. Desactivada: tarjeta de red bloqueada para `mcp.exa.ai` (demuestra que websearch respeta `HTTPS_PROXY`; si en su lugar sale un error de conexión, el proxy no se respeta).
   12. «Recuerda que prefiero informes en PDF»: se crea `.onyxcode/memoria.md`, **no** aparece en Entregables, el panel «Proyecto y memoria» muestra el contenido nuevo y el siguiente turno lo usa.

## E. Riesgos y decisiones abiertas
1. **Búsqueda web activada por defecto en el sandbox** (también para usuarios existentes): da autonomía pero es un canal de fuga por prompt injection. Visible y desactivable en Ajustes.
2. **Duración de la aprobación del plan**: se pierde con Detener (todas), al archivar/borrar, con Revocar y al reiniciar la app. Un seguimiento hereda el permiso aunque cambie de objetivo (depende de las instrucciones al agente; el servidor no lo fuerza). Los niveles por app se siguen aplicando.
3. La inyección de `onyxcode_session` está verificada solo leyendo el bundle de opencode 1.18.32; si falla en ejecución cae al modo global anterior (con aviso en el log). **Reverificar al subir de versión de opencode.**
4. Con aprobación por sesión, los subagentes (`task`) ya no pueden usar `computer_*` (tienen otro sessionID). "Denegar" por app en una tarjeta sigue guardándose en la lista de denegadas.
5. "Continuar" desde el sandbox crea una tarea nueva en Control total con un resumen, no con el historial (los servidores no comparten el almacén de sesiones).
