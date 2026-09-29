# Revisión de la rama y arreglos (Fase 7)

> Documento histórico. "Cowork" es el nombre interno del modo que la app muestra como "Tareas"; las menciones a productos de terceros eran referencias de diseño.

Resultado de 5 revisiones adversariales (Sonnet, solo lectura) + 1 plan de arreglo de bugs (Opus). Sin bloqueantes de
seguridad. Este documento reparte los arreglos por GRUPO de archivos (un agente por grupo, sin solaparse). Cada
arreglo con comportamiento nuevo → test (Vitest o E2E) y entrada `F7-B<n>` en `CHANGELOG-FASE7.md`. Los `it.fails` /
describe desactivado de `e2e/specs/*` que documentan bugs se convierten en `it` normales al arreglar.

Reglas: no tocar preloads con sandbox, `helper.swift`, plan-gate, Seatbelt, la regla `webRequest` de loopback ni
`security/web-security.ts`. UI en español. Commits con `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`,
`git add <rutas propias>` (nunca `-A`). Controles por commit: `npm run typecheck && npm test && npm run lint && npm run build && npm run test:transform`
+ el spec E2E afectado (con el cerrojo de build, ver abajo).

## G1 · browser (dueño: `src/main/embedded-browser/**`, `src/renderer/src/features/browser/**`, `src/shared/ipc-browser.ts`)
1. **[Alta] `mailto:`/`tel:` mata el proceso principal (SIGTRAP).** Causa más probable (sin confirmar): el respaldo
   `did-start-navigation` de `installBaselineNavigationGuard` (`surface.ts` ~l.170-175) llama síncrono a `wc.stop()` +
   `goBack()`/`loadURL('about:blank')` dentro del observador; Chromium emite `DidStartNavigation` antes de los throttles.
   Pasos: (a) CONFIRMAR antes: comentar ese respaldo, `npm run build`, `E2E_REPRO_CRASH=1 E2E_SKIP_BUILD=1 npx vitest run -c vitest.e2e.config.ts e2e/specs/lotes.e2e.ts -t mailto`;
   si main sigue vivo, confirmada; si no, instrumentar con `fs.writeSync(2, …)` síncrono en `will-navigate`/`will-frame-navigate`/`did-start-navigation`/`openExternal` y reportar.
   (b) `sites.ts`: helpers puros `schemeOf(url)` y `subframeUrlAllowed(url)` (http/https/about/data/blob); `checkUrl` (primer nivel) igual.
   (c) `surface.ts`: `guard(url, prevent, label, isMainFrame)` con política de subframe; log solo con el esquema si no es http(s)
   (`[embedded-browser] navegación bloqueada: <esquema> (<label>)`, sin dirección ni teléfono); `will-frame-navigate` y `will-redirect`
   ya no ignoran subframes; respaldo movido a `did-navigate` con `setImmediate` (nunca `stop()`/`loadURL` síncronos en eventos de navegación);
   `setWindowOpenHandler` con el mismo log; evento `blocked` (sin repetir el mismo esquema <200 ms).
   (d) `session.ts` `installPermissionHandlers`: si `openExternal`, log + `blocked` vía callback registrable (sin ciclo de imports); `callback(false)`.
   (e) `service.ts`: `surfaceEvents.on('blocked')` → `rt.notice = {id, text:'El navegador integrado no abre enlaces <esquema> (abrirían otra aplicación).'}` + broadcast;
   `verifyAfterAction` antepone el aviso si hubo bloqueo <5 s. (f) `ipc-browser.ts`: `BrowserOwnerState.notice?: {id:number; text:string}` (sin canal nuevo).
   (g) `BrowserPanel.tsx`: línea `role="status"` con «Cerrar», se oculta a los 8 s o al cambiar `notice.id`, en flujo normal (nunca sobre la vista nativa).
   (h) `normalizeInput`: `mailto:`/`tel:` escritos a mano muestran el mismo aviso (no buscar en Google; no confundir `localhost:5173`).
   (i) E2E `lotes.e2e.ts` ~l.474-523: quitar `E2E_REPRO_CRASH`, `it.fails`→`it`, espiar `console.warn` de main, aserciones (opened=[], URL de la pestaña intacta, warn con `navegación bloqueada: mailto:`), caso extra `tel:` por `location.href`; quitar `E2E_REPRO_CRASH` de `docs/VERIFICACION.md`.
   (j) Unit `src/main/embedded-browser/sites.test.ts`.
2. **[Media] Foco por defecto en «Cancelar»** (`Cards.tsx`): el efecto de montaje enfoca con el botón `disabled`. Cambiar a
   `useEffect(() => { if (armed) denyRef.current?.focus({preventScroll:true}) }, [armed])`; actualizar comentario; `lotes.e2e.ts` ~l.386 `it.fails`→`it`;
   test extra con la tarjeta de origen local (tras armarse, `activeElement` es «No»). Revisión adicional: cada `ApprovalCard` registra su propio Escape → con varias
   tarjetas un solo Esc deniega todas; que solo actúe la tarjeta con foco/la primera.
3. **[Baja] `siteOf` con IPs** (`sites.ts`): si el host es IPv4 literal o contiene `:`/`[`, devolver el host tal cual (hoy `93.184.216.34` y `1.2.216.34`
   comparten «216.34» y una aprobación «siempre» se extiende a otra IP). Test en `sites.test.ts`.
4. Documentar en `docs/SEGURIDAD.md` §3 quater que «Permitir siempre» de un origen local permite `fetch` a cualquier otro puerto de loopback (por origen de página; «en esta tarea» no cuenta).

## G2 · cowork y UI (dueño: `src/renderer/src/features/cowork/impl/{CoworkWorkspace,actions,util,TaskList,search,ComputerAccess}.ts(x)`, `features/routines/**`, `components/{Toggle,conversation/Reasoning,ErrorBoundary}.tsx`, `app/App.tsx`, `app/CommandPalette.tsx`, `features/settings/**`, lista de inputs con Enter)
Nota: NO tocar `features/cowork/impl/store.ts` (lo toca G3). En `App.tsx` y `RoutinesView.tsx` G4 hará una edición mínima de una línea (openProject con confianza): editá con Edit exactos, no reescribas el archivo.
1. **[Media] Motivo de carpeta prohibida no visible:** `phaseBanners` (`CoworkWorkspace.tsx`) solo pinta `error` con `phase==='error' && folder`.
   Añadir banner `role="alert"` con el texto exacto de main y botón «Cerrar» (`useCowork.setState({error:null})`) cuando `error && !(phase==='error' && folder)`;
   limpiar `error` al empezar `chooseFolder` y `approvePending`; `lotes.e2e.ts` ~l.75 `it.fails`→`it` (ampliar con `~/Library` y comprobar «Cerrar»).
2. **[Baja] Keys duplicadas** `CoworkWorkspace.tsx` ~l.656-657 → `key={`grant-${activeId}`}` / `key={`escalate-${activeId}`}`; `lru.e2e.ts` ~l.249 `it.fails`→`it`; borrar el `afterEach` que filtra `DUP_KEY` (~l.214-222).
3. **Rutinas: el interruptor no se acciona con teclado** (el keydown burbujea a la tarjeta `role=button`): en la tarjeta `if (e.target !== e.currentTarget) return` (o `stopPropagation` en `onKeyDown` del `Toggle`).
4. **ErrorBoundary solo envuelve `<View/>`:** añadir boundaries (con label) alrededor de `<Sidebar/>`, `<CommandPalette/>` y el banner/servidor en `App.tsx` (sin cambiar layout).
5. **Enter con IME:** `isSubmitKey(e, {allowShift:true})` en los `<input>` con `e.key === 'Enter'` a secas: `ChatSessionList.tsx:79`, `code/SessionList.tsx:71`, `ModelPicker.tsx:95`, `ProjectPanel.tsx:355`, `RoutineEditor.tsx:610`, `AutoModeSection.tsx:208`, `NetworkSection.tsx:170`, `CoworkSection.tsx:207` (y `ChangesPanel` lo hace G4).
6. **`Reasoning` variante `code`:** añadir `aria-expanded` (la de chat ya lo tiene) sin cambiar clases.
7. **`taskStatus` degrada a 'done' al desalojar** (`util.ts:113-117`, `TaskList.tsx`): no degradar cuando `loaded[id]` es false, o cachear el estado terminal en el `addEvictionListener` (como `search.ts`). Test.
8. **`deleteTask`** (`actions.ts:512-520`) y creación de tareas (`actions.ts:421`, `:824`): `deleteTask` debe borrar también `status`, `errors`, `sessionSource` y `lastAccess` (usar el helper que exponga G3 si existe, si no, `useSessions.setState`); las tareas nuevas con `messages[id]=[]` deben marcar `loaded[id]=true` (como Chat).
9. **`folderBusy`/`anyBusy`** (`CoworkWorkspace.tsx:~359`, `ComputerAccess.tsx:~426`): criterio «origen distinto de Code» en lugar de «solo la conexión actual» (no contar tareas del otro servidor de Cowork como libres).
10. Limpieza: dos líneas en blanco en `CoworkSection.tsx:139-140`; comentarios huérfanos.

## G3 · stores (dueño: `src/renderer/src/stores/**`, `lib/session-reducer.ts`, `lib/flags.ts`, `features/chat/{actions,store}.ts`, `features/code/impl/store.ts`, `features/cowork/impl/store.ts`)
1. **[Baja→Media] `busy` huérfano tras reiniciar el sidecar** (bug 5 del E2E): helper puro `runStatusScope({sessions, sessionSource, status}, directory, isSource)` en
   `session-reducer.ts` (ids de `sessions` del directorio y origen + claves de `status` sin `sessions[id]` con origen que cumpla `isSource`); `syncChatRunStatus` lo usa
   (`(src ?? MAIN_SOURCE) === MAIN_SOURCE`); encadenar `await loadChatSessions()` antes de `syncChatRunStatus()` en `ChatSidebar`/`onStreamReconnect`; no degradar a idle sesiones que pasaron a `busy` después del fetch (leer `status` justo antes del `set`);
   `removeSession` borra también `status[sid]`, `errors[sid]`, `loadingMessages[sid]` y `buffers.loading` (si `sessions.characterization.test.ts` fija lo anterior, ajustá SOLO esa aserción con el ID F7). Igual para Cowork (`syncRunStatus`) y Code (`loadPending`). `fase6.e2e.ts` ~l.316 `it.fails`→`it`.
2. **Cargas concurrentes de `loadMessages`** (`sessions.ts:160-179`): `Map<sessionID, Promise>` para reutilizar la carga en vuelo (o set de trackers activos) y que el `finally` de una no apague `loadingMessages` de otra. Igual en Code (`store.ts:329-360`). Test.
3. **`message.updated` no aplica `orphanDeltas` a las partes huérfanas que consume** (`session-reducer.ts:280-293`): pasar cada orphan por `applyOrphanDeltas`. Test (part.updated → delta → message.updated).
4. **`message.removed`/`part.removed` durante una carga**: `removed: Set` en `LoadTracker` y filtrar en `mergeSnapshot` (un snapshot viejo resucita lo borrado). Test.
5. **`appendWithoutOverlap`** (ambiguo con trozos de un carácter repetidos): documentar el límite con un comentario y un test que fije el comportamiento; solo cambiar si hay una señal fiable barata.
6. **`loaded` no se invalida al reconectar/reiniciar:** en `onStreamReconnect` (Chat) y en `connectFolder`/`purgeForeignCoworkStatus` (Cowork, para el origen reconectado) poner `loaded=false` salvo la activa. Test.
7. **Code `loadPending`** (`store.ts:353-395`): reconstruir `permissions`/`questions` desde el servidor (filtrando por proyecto), no solo acumular. **`deleteSession`/`session.deleted`** de Code: limpiar `messages`, `queue`, `permissions`, `questions`, `todos`, `runState`, `errors`, `unread`, `lastAccess`.
8. **Code `maybeAutoSend` + `session.idle`** (`store.ts:~1012-1036`, `:480`): si llegan `session.status→idle` y `session.idle` (ids distintos, el dedupe no los frena), el segundo ve `prev='busy'` (tras `doSend`), fuerza idle, notifica dos veces y lanza el siguiente encolado. En `session.idle`: no hacer nada si `prev==='idle'` ni sobrescribir un `busy` posterior al último idle. Además `maybeAutoSend` no debe perder el ítem si `doSend` falla (reencolar). Test con ambos eventos y cola de 3.
9. `EvictionListener` que lanza rompe `touchSession` (`sessions.ts:283-286`): envolver en try/catch. `!(sessionID in cur.messages)` en vez de `Object.keys(...)` por delta (`sessions.ts:238`). `buffersBySource` sin límite: acotar/limpiar. `taskStatus`/`TaskList` suscrito al record `messages` completo: selector derivado (`useShallow`) — solo si es seguro.
10. `sameDir` (`eventRouter.ts`): dejar como está pero anotar el límite (symlinks/mayúsculas) en un comentario.

## G4 · code UI y main de Code (dueño: `src/renderer/src/features/code/impl/{panels/*,CodeWorkspace,ProjectPicker,Composer}.tsx`, `src/main/ipc/code-handlers.ts`, `src/main/git/**`, `src/main/pty/**`)
NO tocar `features/code/impl/store.ts` (G3). Para el workspace trust usá `ensureTrusted` de `ProjectPicker.tsx`.
1. **[Corregir] Workspace trust se salta:** `WorktreeDialog` (`ChangesPanel.tsx:242,361,388`) llama a `openProject` sin `ensureTrusted`; también `app/App.tsx:93` (clic en notificación), `routines/impl/RoutinesView.tsx:186`, `CodeWorkspace.tsx:635`. Crear una función única `openProjectTrusted(dir)` (en `ProjectPicker.tsx`, exportada) que haga `ensureTrusted` y luego `openProject`, y usarla en todas las entradas (en `App.tsx` y `RoutinesView.tsx` con UNA edición mínima de la línea, hay otro agente en esos archivos). `ensureTrusted` concurrente pisa `pendingTrustResolve` (la primera promesa nunca resuelve): encolar o resolver la anterior con `false`. Carpeta ya en `trustedFolders` no molesta. Test.
2. **[Corregir] Estado obsoleto al cambiar de proyecto** (`ChangesPanel.tsx:439-477`, `CodeWorkspace.tsx:199`): `key={directory}` en `<ChangesPanel/>`; contador de generación (o flag `cancelled`) en `refresh` para descartar respuestas viejas; `setInfo(null)` al cambiar `directory` en `useBranch` (`CodeWorkspace.tsx:225-247`).
3. **[Corregir] Enter en el input de worktree** (`ChangesPanel.tsx:325`): `if (busy || isImeComposing(e)) return`.
4. `selectedFile` de `ChangesPanel` (~l.473-486) depende de `path`, `kind`, `staged` (no del objeto nuevo en cada refresh); `loadDiff` no debe tragar el error de `git.diff` (mostrar el error, no «Sin diferencias»); `git diff --staged` de un archivo renombrado debe incluir el path antiguo (`main/git/service.ts`).
5. **TerminalPanel** (`TerminalPanel.tsx:38,75-83`): tras asignar `ptyId` llamar `api.pty.resize(info.id, term.cols, term.rows)`; `requireCode()` dentro de try/catch con `setError`; si el proceso sale antes de que `create` resuelva, mostrar el banner de salida.
6. **PTYs huérfanos al recargar la ventana** (`code-handlers.ts:41-56`): además de `destroyed`, `killOwner` en `did-start-navigation` (main frame) / `render-process-gone`.
7. Accesibilidad: `TrustGate` (`ProjectPicker.tsx`) con `aria-modal`, `aria-labelledby`, foco inicial y Escape; `WorktreeDialog` trap de foco básico; imports de `lib/paths` en `ProjectPicker.tsx` al principio (no a mitad del archivo).
8. Hardening opcional: `-c core.fsmonitor=false` en `git status/diff` (`main/git/service.ts`) para repos no confiables.

## G5 · docs y higiene (dueño: `docs/**` salvo `FASE6-PLAN.md`/`LRU-PLAN.md`/`REVIEW-FASE7.md`, `AUDIT.md`, `README.md`, `electron-builder.js`, `src/main/index.ts`, `src/shared/ipc-{cowork,code,browser,extras}.ts` (solo comentarios/alias), `src/main/cowork/folder-policy.ts`, `src/main/util/paths.ts`)
1. **Datos huérfanos de «Chrome aparte»:** al arrancar (dentro de `start()` de `main/index.ts`, tras el lock), borrar una sola vez y con try/catch `userData/cowork-browser` (perfil, cookies, descargas) y `userData/cowork-browser.json`; log `[main] limpieza de datos de Chrome aparte`. Test unitario del helper puro si se extrae (`main/cowork/legacy-cleanup.ts`) con directorio temporal.
2. **Docs falsos:** `docs/SEGURIDAD.md:218-236` sección «Navegador propio» → marcar TODA la sección como histórica o reemplazar por nota que apunte al navegador integrado; `docs/DISTRIBUCION.md:148-154` borrar la verificación de `browser-mcp.js`/`chrome-devtools-mcp`; `AUDIT.md:97` → ✅ (resuelto en el refactor), `AUDIT.md:38,:258` chrome-devtools-mcp como histórico; `docs/LOTE-D.md:68-108,209` y `docs/COWORK-LOTE-B.md:213` («Chrome aparte se conserva») → notas históricas; `docs/VERIFICACION.md:189` («11 Chrome aparte | manual») quitar.
3. **Comentarios huérfanos:** `shared/ipc-cowork.ts:938` y banner de la l.699 («Lote C: navegador propio»), `shared/ipc-browser.ts` («Lote C: apaga el navegador propio…»), bloque vacío tras el comentario de cabecera de `shared/ipc-code.ts`, comentario de `features/code/impl/client.ts` («git/diálogos» → incluye pty).
4. `IpcBrowserResult`/`IpcExtrasResult` (alias sin uso fuera de su archivo): eliminarlos si no los usa nadie (grep), o dejarlos como API pública documentada.
5. `electron-builder.js` `files`: excluir también `eslint.config.mjs`, `.prettierrc`, `.prettierignore`, `CHANGELOG-FASE*.md`, `docs/**`, `e2e/**` (ya), `vitest*.config.ts` (ya).
6. Unificar la copia privada de `isInside` de `cowork/folder-policy.ts:76` con `main/util/paths.ts` SOLO si la semántica (caso `'/'`) se preserva con un parámetro o un test que demuestre equivalencia; si no, dejarla y documentar por qué en un comentario. Normalizar `dir` con barra final en `util/paths.ts` (`'/a/b/c'` vs `'/a/b/'`) con test.
7. `CHANGELOG-FASE7.md`: crearlo con los IDs F7-B1.. de todos los grupos (los otros agentes hacen append atómico); `docs/HALLAZGOS-E2E.md` y `docs/VERIFICACION.md`: pasar la tabla de bugs reales a «arreglado» con el hash del commit cuando los demás grupos terminen (esto lo hago yo al final).

## Cerrojo de build/E2E (todos los grupos)
Varios agentes comparten `out/` y el puerto del servidor de renderer. Para construir o correr E2E, adquirí el cerrojo:
`LOCK=/private/tmp/claude-501/-Users-ben/0f2b5c02-144e-41f9-8c7c-156d39453861/scratchpad/e2e.lock; until mkdir $LOCK 2>/dev/null; do sleep 3; done; trap 'rmdir $LOCK' EXIT; <build y/o E2E>; rmdir $LOCK`
(mantenelo mientras dure el build + el spec, y liberalo SIEMPRE, incluso si falla). Los unit tests (`npm test`) y typecheck no lo necesitan.
