> Documento histórico. "Cowork" es el nombre interno del modo que la app muestra como "Tareas"; las menciones a productos de terceros eran referencias de diseño.

## F7-B30 — Limpieza de datos huérfanos de «Chrome aparte» (G5.1)

Al arrancar (en `start()`, tras el lock de instancia única y la migración de userData, antes de `whenReady`) se borran `userData/cowork-browser` (perfil, cookies, descargas) y `userData/cowork-browser.json` con `rmSync({recursive, force})` en try/catch. Solo dentro de `app.getPath('userData')` (se valida que la ruta resuelta quede estrictamente dentro). Log `[main] limpieza de datos de Chrome aparte` solo si borró algo. Irreversible: son datos de una función eliminada en el refactor (fase 3).

Test: `src/main/cowork/legacy-cleanup.test.ts` (directorio temporal real: borra perfil y json, conserva el resto, idempotente, no toca hermanos fuera de userData, no lanza si userData no existe). Verificado además `e2e/specs/instance.e2e.ts`.

## F7-B31 — `isInside` tolera barra final y raíz (G5.6)

`util/paths.ts#isInside` ahora acepta `dir` con barra final (`/a/b/` ≡ `/a/b`) y `dir === '/'` (contiene todo); antes ambos casos daban `false` (afecta a `cowork/projects.ts` y `cowork/manager.ts`, solo en esos bordes). La copia privada de `cowork/folder-policy.ts` se eliminó: para rutas normalizadas (como las que produce su `key()`) la nueva versión es equivalente.

Test: `src/main/util/paths.test.ts` (`/`, `/a/b`, `/a/bc`, barra final, `..` y equivalencia exhaustiva con la versión antigua de folder-policy).

## F7-B32 — Docs de «Chrome aparte» marcados como históricos (G5.2)

Solo documentación, sin cambio de comportamiento: `docs/SEGURIDAD.md` («Navegador propio»), `AUDIT.md` (C3, fila 13, §10 y el hallazgo de canales no registrados → ✅), `docs/LOTE-D.md`, `docs/COWORK-LOTE-B.md` marcados como históricos (eliminado en el refactor fase 3); `docs/DISTRIBUCION.md` sin la verificación de `browser-mcp.js`/`chrome-devtools-mcp`; `docs/VERIFICACION.md` sin la fila «11 Chrome aparte». No se borró contenido histórico.

Test: ninguno (docs).

## F7-B33 — Comentarios huérfanos y alias sin uso (G5.3, G5.4)

Sin cambio de comportamiento: comentarios de `shared/ipc-{cowork,code}.ts` y `features/code/impl/client.ts` actualizados (ya no hablan del «navegador propio»); eliminados los alias `IpcBrowserResult` (`ipc-browser.ts`) e `IpcExtrasResult` (`ipc-extras.ts`) (grep: sin usos fuera de su archivo). `BrowserSite` se conserva (lo usan el store y el contrato del navegador integrado).

Test: ninguno (typecheck).

## F7-B34 — El paquete deja de incluir lint/formato, changelogs y docs (G5.5)

`electron-builder.js` `files` excluye además `eslint.config.mjs`, `.prettierrc`, `.prettierignore`, `CHANGELOG-FASE*.md` y `docs/**`. El runtime no lee nada de esas rutas (grep). Solo cambia el contenido del `.asar` (no se ejecutó `electron-builder`).

Test: ninguno (verificado que `electron-builder.js` carga con `node -e require`).


## G3 · stores (reductor)

- **F7-B12** `message.updated` aplica `orphanDeltas` a las partes huérfanas que adopta (antes el texto de un delta llegado entre `part.updated` y `message.updated` se perdía). Test: `lib/session-reducer.fase7.test.ts`.
- **F7-B13** `message.removed`/`message.part.removed` durante una carga de mensajes se registran en el `LoadTracker` (`removedMessages`, `removedParts`) y `mergeSnapshot` los filtra: un snapshot anterior al borrado ya no lo resucita. Test: `lib/session-reducer.fase7.test.ts`.
- **F7-B15** `appendWithoutOverlap`: límite de la heurística documentado (trozos repetidos iguales al final de la base son ambiguos; sin señal fiable barata, no se cambia). Test que lo fija: `lib/session-reducer.fase7.test.ts`.
- **F7-B10** (parte pura) helper `runStatusScope` en `lib/session-reducer.ts` (ver entrada del store más abajo). Test: `lib/session-reducer.fase7.test.ts`.

## G4 · code UI y main de Code

- **F7-B20 — Workspace trust unico.** `openProjectTrusted(dir)` (`features/code/impl/trust.ts`, reexportada por `ProjectPicker.tsx`) hace `ensureTrusted` + `openProject` y se usa en WorktreeDialog, clic en notificacion (`App.tsx`), Rutinas (`RoutinesView.tsx`), reconexion de `CodeWorkspace` y el selector. Carpeta ya confiada: sin dialogo. Un `ensureTrusted` concurrente resuelve la anterior con `false` (antes quedaba colgada). Si el usuario rechaza, no se abre ni se selecciona la sesion. Test: `features/code/impl/trust.test.ts`.
- **F7-B21 — Estado obsoleto al cambiar de proyecto.** `<ChangesPanel key={directory}>`, contador de generacion en `refresh` (descarta respuestas viejas) y `setInfo(null)` al cambiar `directory` en `useBranch`. Test: ninguno unitario (cubierto por typecheck y `fase6.e2e.ts` caso 6).
- **F7-B22 — Enter con IME en el input de worktree.** `busy || isImeComposing(e)` antes de crear. Test: `lib/textarea.test.ts` cubre `isImeComposing`; sin test propio del componente.
- **F7-B23 — Diff del panel Cambios.** El efecto depende de path/kind/staged/fsVersion (no del objeto nuevo por refresh) y `git.diff` con git nativo ya no se traga el error (se muestra «No se pudo obtener el diff», no «Sin diferencias»). Test: ninguno unitario.
- **F7-B24 — `git diff --staged` de renombrados.** `stagedPathspec` anade el path antiguo al pathspec (via `diff --cached --name-status -z --find-renames`), asi sale `rename from/to` y no «new file». Test: `main/git/service.test.ts` (repo temporal real).
- **F7-B25 — TerminalPanel.** Tras crear el pty se llama `pty.resize(cols, rows)`; `requireCode()` dentro de try/catch con banner de error; si el proceso sale antes de que `create` resuelva se muestra el banner de salida. Test: ninguno (requiere xterm/DOM).
- **F7-B26 — PTYs huerfanos al recargar.** `killOwner` en `did-start-navigation` (solo frame principal y no mismo documento) y `render-process-gone`. Test: `main/pty/lifecycle.test.ts` (predicado puro `shouldKillOnNavigation`).
- **F7-B27 — Accesibilidad.** `TrustGate`: `aria-modal`, `aria-labelledby/describedby`, foco inicial en «Confiar y continuar» y Escape = cancelar; `WorktreeDialog`: trampa de foco con Tab/Shift+Tab; imports de `lib/paths` al inicio de `ProjectPicker.tsx`. Test: ninguno.
- **F7-B28 — Hardening `core.fsmonitor=false`** en `git status/diff/ls-files` (repos no confiables). Test: `main/git/service.test.ts` (hook de fsmonitor no se ejecuta).

## G3 · stores (useSessions, Chat, Cowork, Code)

- **F7-B10** `busy` huérfano: `removeSession`/`session.deleted` borran también `status`, `errors`, `loadingMessages`, cargas en vuelo y partes huérfanas; `syncChatRunStatus` (Chat), `syncRunStatus` (Cowork) y `loadPending` (Code) usan un ámbito que incluye las entradas de estado sin sesión (`runStatusScope`) y no degradan a idle lo que pasó a busy durante la petición (`unchangedSince`); `ChatSidebar` encadena `loadChatSessions()` → `syncChatRunStatus()`. Cierra el bug 5 del E2E (`fase6.e2e.ts` caso 3b pasa de `it.fails` a `it`). Tests: `stores/sessions.fase7.test.ts`, `features/chat/actions.fase7.test.ts`, `features/cowork/impl/store.fase7.test.ts`, `features/code/impl/store.fase7.test.ts`, `lib/session-reducer.fase7.test.ts`; E2E `fase6.e2e.ts` 3b.
- **F7-B11** cargas concurrentes de `loadMessages` (useSessions y Code): mapa de cargas en vuelo por sesión; la segunda llamada reutiliza la promesa (antes el segundo tracker pisaba al primero y el `finally` apagaba `loadingMessages` de la otra). Una carga cuya sesión se borró a mitad no la resucita. Tests: `stores/sessions.fase7.test.ts`, `features/code/impl/store.fase7.test.ts`.
- **F7-B14** `loaded` se invalida al reconectar: Chat (`onStreamReconnect` en `chat/actions.ts`, salvo la conversación activa) y Cowork (`purgeForeignCoworkStatus` → orígenes no principales) vía `useSessions.invalidateLoaded`. Tests: `stores/sessions.fase7.test.ts`, `features/chat/actions.fase7.test.ts`, `features/cowork/impl/store.fase7.test.ts`.
- **F7-B16** Code `loadPending` reconstruye `permissions`/`questions` desde el servidor (solo el proyecto actual; conserva los llegados por evento durante la petición y no borra nada si la petición falla). Helper puro `reconcilePending`. Test: `features/code/impl/store.fase7.test.ts`.
- **F7-B17** Code `deleteSession`/`session.deleted` limpian `messages`, `queue`, `permissions`, `questions`, `todos`, `runState`, `errors`, `unread`, `loadingMessages`, acceso LRU, cargas y partes huérfanas. Test: `features/code/impl/store.fase7.test.ts`.
- **F7-B18** Code: `session.status→idle` + `session.idle` de una misma terminación ya no notifican dos veces ni lanzan dos ítems de la cola (el duplicado del otro tipo, sin `busy` confirmado por el servidor y en <2 s, se descarta); `session.idle` con la sesión ya idle solo refresca `fsVersion`; `maybeAutoSend` reencola el ítem si `doSend` falla. Test: `features/code/impl/store.fase7.test.ts` (cola de 3, ambos órdenes).
- **F7-B19** robustez de `useSessions`: un `EvictionListener` que lanza ya no rompe `touchSession`; `in` en vez de contar claves de `messages` por evento; `buffersBySource` acotado a 8 orígenes (LRU, nunca el principal ni uno con carga). Helper `purgeSessionState(sessionID)` exportado para `deleteTask` de Cowork (G2). Tests: `stores/sessions.fase7.test.ts`.
- **F7-B20** `sameDir` (`stores/eventRouter.ts`): límite (symlinks/mayúsculas) anotado en un comentario, sin cambio de comportamiento.
- No hecho: selector derivado/`useShallow` para `taskStatus`/`TaskList` (F7-B19, «solo si es seguro»): `TaskList.tsx` es de G2 y el cambio de suscripción no es local a los stores.

## F7-B1 — `mailto:`/`tel:` ya no matan el proceso principal (G1.1)

Causa raíz CONFIRMADA por experimento: con el respaldo `did-start-navigation` de `surface.ts` comentado (única diferencia), el spec `mailto` sobrevivió (app viva, `shell.openExternal` sin llamadas, sin `.ips` nuevo); con él, SIGTRAP en `CrBrowserMain`. Ese respaldo llamaba síncrono a `stop()` + `goBack()`/`loadURL('about:blank')` dentro del observador (Chromium emite `DidStartNavigation` antes de los throttles). Ahora: `guard(url, prevent, label, isMainFrame)` con política de subframe (`subframeUrlAllowed`: http/https/about/data/blob), `will-frame-navigate`/`will-redirect` ya no ignoran subframes, el respaldo pasó a `did-navigate` con `setImmediate` (nunca `stop()`/`loadURL` síncronos en eventos de navegación), permiso `openExternal` denegado con log (`session.ts`, listener registrable sin ciclo de imports), log solo con el esquema (`navegación bloqueada: mailto: (<origen>)`, sin dirección ni teléfono), evento `blocked` (sin repetir el mismo esquema <200 ms) → `BrowserOwnerState.notice` + línea `role="status"` con «Cerrar» en `BrowserPanel` (8 s o cambio de `notice.id`), `verifyAfterAction` antepone el aviso si hubo bloqueo <5 s (el agente lo ve), y `mailto:`/`tel:` escritos en la barra muestran el mismo aviso en vez de buscarse en Google.

Tests: `src/main/embedded-browser/sites.test.ts` (`schemeOf`, `subframeUrlAllowed`, `checkUrl`); E2E `e2e/specs/lotes.e2e.ts` describe «mailto: y tel:» (sin `E2E_REPRO_CRASH`, `it.fails`→`it`): clic en `mailto:` (opened=[], URL de la pestaña intacta, warn con `navegación bloqueada: mailto:` sin la dirección, aviso visible y cerrable) y `tel:` por `location.href`.

## F7-B4 — Motivo de carpeta prohibida visible en Cowork (G2.1)

`CoworkWorkspace` pinta un banner `role="alert"` con el texto exacto de main y un botón «Cerrar» cuando hay `error` y no aplica el banner de fase `error` con carpeta; `chooseFolder` y `approvePending` limpian `error` al empezar. Antes el motivo solo vivía en el store.

Test: E2E `lotes.e2e.ts` «paso 2 (UI): el mensaje de carpeta prohibida es visible… y se puede cerrar» (`~` y `~/Library`, «Cerrar»); antes `it.fails`.

## F7-B5 — Keys duplicadas en la vista de tarea terminada (G2.2)

`DeleteGrantHintCard` y `EscalateCard` usan `key` distintas (`grant-<id>` / `escalate-<id>`).

Test: E2E `lru.e2e.ts` (antes `it.fails`, ya `it`; se eliminó el `afterEach` que filtraba `DUP_KEY`).

## F7-B6 — El interruptor de una rutina se acciona con teclado (G2.3)

La tarjeta `role="button"` de `RoutinesView` ignora los `keydown` que no se originan en ella (`e.target !== e.currentTarget`), así que Enter/Espacio en el `Toggle` ya no se secuestran para seleccionar la tarjeta. Sin test automatizado (componente local no exportado); verificación manual.

## F7-B7 — ErrorBoundary por zonas de App (G2.4)

`Sidebar`, `CommandPalette` y `ServerBanner` van cada uno dentro de su `ErrorBoundary` con label; un error de render en ellos ya no deja la ventana en blanco. Sin cambio de layout. Sin test automatizado (el fallback no es testeable con `renderToStaticMarkup`).

## F7-B8 — Enter con IME en inputs de texto (G2.5)

`ChatSessionList`, `code/SessionList`, `ModelPicker`, `cowork/ProjectPanel`, `RoutineEditor`, `AutoModeSection`, `NetworkSection` y `CoworkSection` usan `isSubmitKey(e, { allowShift: true })`: confirmar una composición IME ya no envía el formulario. Cubierto por los tests existentes de `isSubmitKey`; sin test propio por input. (Limpieza G2.10: líneas en blanco de `CoworkSection`.)

## F7-B9 — `Reasoning` variante `code` con `aria-expanded` (G2.6)

Test: `components/conversation/Reasoning.test.tsx` (ambas variantes) y snapshot de `MessageStream.render.test.tsx` actualizado (solo el atributo).

## F7-B35 — `taskStatus` no degrada a «done» una tarea con error desalojada (G2.7)

Al desalojarse el historial (LRU) `TaskList` guarda el estado terminal `error` (`rememberEvictedStatus`) y `taskStatus` lo usa cuando no hay `entries` (`evicted`). Test: `cowork/impl/f7-g2.test.ts`.

## F7-B36 — `deleteTask` limpia todo y las tareas nuevas nacen `loaded` (G2.8)

`deleteTask` usa `removeSession` y borra además `status` y `errors`; las tareas creadas en sesión (`sendToTask`, `sendSideChat`) marcan `loaded[id]=true` al sembrar `messages[id]=[]`. Test: `f7-g2.test.ts` (deleteTask).

## F7-B37 — «Ocupado» por origen de Cowork, no solo por la conexión actual (G2.9)

`folderBusy` (`CoworkWorkspace`) y `anyBusy` (`ComputerAccess`) cuentan sesiones de cualquier servidor de Cowork en la carpeta (`isCoworkSource`), no las de Chat/Code. Test: `f7-g2.test.ts` (`isCoworkSource`).

## F7-B2 — Foco en «Cancelar» de las tarjetas de aprobación y un Esc por tarjeta (G1.2)

`ApprovalCard` enfocaba el botón de denegar al montar, cuando aún estaba `disabled` (700 ms hasta armarse) y no recibe foco: el foco quedaba en `body` y Enter no denegaba. Ahora `useEffect(() => { if (armed && first) denyRef.current?.focus({ preventScroll: true }) }, [armed, first])`. Además cada tarjeta registraba su propio Escape (con varias apiladas, un Esc denegaba todas): solo la primera tarjeta (`first`) toma el foco y responde a Esc; al resolverse, la siguiente pasa a ser la primera.

Tests: `e2e/specs/lotes.e2e.ts` (`it.fails`→`it` para la tarjeta sensible + aserción extra en la tarjeta de origen local: tras armarse, `activeElement` es «No»). El comportamiento de Esc con varias tarjetas no tiene test automático (sin entorno de componentes en Vitest; cubierto por la lógica `first`). Los E2E que abren el proyecto por el store ahora llaman antes a `trustFolder` (el diálogo de confianza de G4 aparecía al reconectar el cliente y tapaba las tarjetas).

## F7-B3 — `siteOf` con IPs literales (G1.3)

`siteOf('93.184.216.34')` y `siteOf('1.2.216.34')` daban ambos «216.34», así que una aprobación «Permitir siempre» de un sitio se extendía a otra IP; y los mensajes de denegación llamaban «0.1» al sitio de `127.0.0.1`. Ahora un host IPv4 literal o con `:`/`[` (IPv6) se devuelve tal cual.

Test: `src/main/embedded-browser/sites.test.ts` (describe `siteOf`: IPs distintas no comparten sitio, `127.0.0.1`, IPv6, y los casos de dominio existentes).

## F7-B38 — Retirada de los feature flags de la Fase 6 (`sessionsChatOnly`, `codeAlwaysSubscribed`, `messagesLru`)

Los tres estaban encendidos por defecto; se eliminan `flag`, `flagOn`, `FLAG_DEFAULTS` y `FlagName` (`lib/flags.ts`) y quedan solo las ramas activas: enrutado de eventos de Chat por directorio (`eventRouter.ts`), suscripción de Code a nivel de App (`App.tsx`) y LRU de `messages` siempre activo (`sessions.ts`, `code/impl/store.ts`, loader de transcript). Ya no hay forma de apagarlos con `localStorage['onyx.flag.*']`. `lruMax()` y el override `onyx.lru.max` (lo usan los E2E) se movieron a `lib/lru.ts`.

Tests: se borran los casos «flag apagada»/«con flag en 0» (`eventRouter.test.ts`, `sessions.lru.test.ts`, `store.lru.test.ts`, `flags.test.ts`) y los E2E `fase6` 1b y 5b y `lru` «flag apagada». Nuevo `lib/lru.test.ts` (`lruMax`). El caso 3 de `fase6.e2e.ts` ahora vuelve a Chat y suelta la sesión activa de Code antes de reiniciar el sidecar (antes lo hacía sin querer el caso 1b; sin eso el 404 de recarga de la sesión de Code inexistente contaba como error de consola).

## F7-B39 — Directivas `eslint-disable` sin uso eliminadas y `reportUnusedDisableDirectives: 'error'`

Se quitan las 6 directivas heredadas que ya no suprimían nada (`cowork-files-handlers.ts`, `ConfirmDialog.tsx`, `CoworkWorkspace.tsx`, `FolderRequestCard.tsx`, `PermissionPrompt.tsx`, `transcript.ts`) y la config pasa de `off` a `error`, de modo que una directiva obsoleta rompe `npm run lint`. Sin cambio de comportamiento; el propio lint es el test.

## F7-B40 — El canal IPC prohibido del preload devuelve `code: 'FORBIDDEN'`

`makeBridge().invokeRaw` (`src/preload/bridge.ts`) respondía `code: 'ERROR'` para un canal fuera de la lista blanca; ahora `'FORBIDDEN'`, igual que `ipc/guard.ts` y el resto de preloads. Nadie decide según `code` (verificado con grep: `lib/api.ts` solo lo transporta en `IpcCallError`). Los preloads con sandbox (`quick`, `overlay`, `pill`, `assist`, `browser-host`) no importan `bridge.ts` y conservan el mismo hash.

Test: `src/preload/bridge.test.ts` (aserción cambiada de `ERROR` a `FORBIDDEN`).

## F7-B41 — Code: loader «Cargando conversación…» al reabrir una sesión desalojada

Al seleccionar en Code una sesión conocida cuyo `messages[sid]` fue desalojado por el LRU, `ChatColumn` mostraba el spinner pelado o `EmptySession` mientras recargaba. Nuevo selector puro `isCodeTranscriptLoading(state, sid)` (`code/impl/store.ts`: sesión conocida + `messages[sid] === undefined` + `loadingMessages[sid]`; `selectSession` marca la carga en el mismo tick que la activa, así que cubre el «recién seleccionada») y `CodeWorkspace.tsx` renderiza `TranscriptLoading` (presentación extraída de `components/TranscriptLoader.tsx`, sin cambio para Chat/Cowork). Una sesión nueva vacía, con historial ya presente o con error no cambia. Sin snapshots modificados.

Test: `code/impl/store.lru.test.ts` («sesión desalojada seleccionada no muestra vacío» y tabla de casos falsos).

## F7-B42 — Code no refresca lo oculto: `useVisibleFsVersion` (Pf1 parte 3)

`useBranch` (`CodeWorkspace.tsx`), `ChangesPanel.tsx` y `FilesPanel.tsx` leían `fsVersion` directamente y lanzaban `git status`/listados también con la ventana oculta. Nuevo hook `useVisibleFsVersion()` (`code/impl/useVisibleFsVersion.ts`) con el puro `nextVisibleVersion(prev, current, hidden)`: congela `fsVersion` mientras `document.visibilityState === 'hidden'` y se pone al día (una sola vez, a la última versión) con el evento `visibilitychange`. El store sigue contando `fsVersion` sin cambios.

Tests: `useVisibleFsVersion.test.ts` (puro) y E2E `fase6` 6b (visibilidad simulada con el evento real: 0 `git:status` oculta y ≥1 al volver; el caso 6 de las 300 llamadas sigue verde). El caso 6c (ocultar la ventana real) queda `it.skip`: `BrowserWindow.hide()/minimize()` no cambia `document.visibilityState` en headless; pasa a la checklist humana de `docs/VERIFICACION.md` (punto 13).

## F7-B43 — Agrupar `message.part.delta` por frame (rendimiento del streaming)

Cada delta hacía un `set` de Zustand (clon de `messages[sid]` + render de la lista) en `useSessions` y `useCode`. Nuevo `lib/frame-queue.ts` (`createFrameQueue`, programador inyectable `setFrameScheduler`; por defecto `requestAnimationFrame` con respaldo `setTimeout(100 ms)` para ventanas ocultas; sin rAF —tests en node— el vaciado es síncrono). `applyEvent` encola los deltas (dedupe por `event.id` y guarda `known` al encolar, como antes) y se aplican en lote con `reduceEvent` y UN solo `set` por frame. Orden: cualquier evento que no es delta, `loadMessages` (al empezar y justo antes de `mergeSnapshot`, así el `LoadTracker` registra los deltas igual que antes), `removeSession`/`deleteSession` y el desalojo LRU vacían la cola antes de actuar. Resultado final idéntico; lo único observable es que el texto llega como mucho un frame (o 100 ms con la ventana oculta) más tarde. `flushPendingDeltas()` exportado en ambos stores (tests).

Tests: `src/test/deltas.batch.test.ts` (trazas `chat-simple`, `code-subagent`, `reconnect` evento por evento vs lotes fijos y aleatorios con semilla, en `useSessions` y `useCode`; deltas huérfanos; desalojo a mitad del lote; un solo `set` por frame; orden con `part.updated`; dedupe; `loadMessages`; `removeSession`). Los snapshots de trazas no cambian.

## F7-B44 — Filas memoizadas en Chat, Code y Cowork (rendimiento del streaming)

Sin cambio de markup ni de resultado. `React.memo` en `PartView` y `ChatToolCall` (props primitivas o `part` con referencia estable del store), filas de turno de `ChatMessageList` (`ChatUserRow`/`ChatAssistantRow`, extraídas del `map`; `onRetry`/`lastUserText` solo se entregan a la última fila para no romper la memoización), `ToolRow` y `UserMessage` de `MessageStream`, un nuevo `TurnView` por turno de Code (comparador por mensajes; los permisos ligados a llamadas se reparten por turno con `NO_PERMS` estable y `turnBlocks` deja de recalcularse entero) y `StepsBlock`/`UserMessage`/`ReasoningRow` de `TaskConversation` (comparador por contenido: sus `Block` se reconstruyen en cada render). El reductor ya conserva la referencia de las partes y mensajes sin cambios, así que durante el streaming solo se pinta lo que cambió.

Tests: sin runtime de DOM en Vitest, la garantía es que los snapshots de render existentes (`ChatMessageList.render.test.tsx`, etc.) pasan SIN tocarse, más los E2E; el efecto se mide en `e2e/specs/perf.e2e.ts` (F7-B47).

## F7-B45 — Markdown: `detect:false` y sin resaltar lo que se está escribiendo

`rehype-highlight` pasa de `detect:true` a `detect:false` y `Markdown` resalta solo cuando el bloque está completo: nuevo prop `highlight` (por defecto `!streaming`). Chat ya pasaba `streaming` a su último texto en curso; Code y Cowork (que no muestran cursor) pasan `highlight={false}` solo para su último bloque de texto mientras la sesión está ocupada. **Cambio de comportamiento declarado:** un bloque de código SIN lenguaje declarado (```` ``` ```` a secas) ya no se autodetecta ni se colorea (antes se probaban todos los lenguajes registrados); los bloques con lenguaje (```ts) siguen con `.hljs` y `hljs-keyword`. Mientras se escribe un mensaje, sus bloques salen sin colorear y se colorean al terminar (un único paso).

Tests: `components/Markdown.highlight.test.tsx` (con lenguaje: `.hljs`+token; `streaming` y `highlight={false}`: sin `hljs`, conserva `language-ts`; sin lenguaje: sin token). E2E `fase6` caso 9 sigue verde sin cambios.

## F7-B46 — `content-visibility: auto` en las filas antiguas de Chat, Code y Cowork

Sin dependencias nuevas. `lib/conversation/cv.ts` (`isOldRow`, `withCv`, `CV_RECENT = 8`; Code usa 4 turnos) y CSS en `globals.css`: todas las filas de mensaje llevan `.turn-row` (`contain-intrinsic-block-size: auto 160px`, para que el navegador recuerde su alto real) y solo las ANTIGUAS `.turn-cv` (`content-visibility: auto`); `.turn-cv-pad` (padding 4/8 px con margen negativo, neutro para la maquetación) evita que `contain: paint` recorte los márgenes negativos y el hover de las filas. Las últimas filas nunca se saltan, así el pegado al final y el streaming ven alturas reales. Hallazgo al probarlo: con la clase solo en las antiguas, una fila que pasaba a antigua caía a la estimación de 160 px, el salto de altura disparaba `onScroll` y se perdía el pegado al final (≈1 de cada 3 ejecuciones); `.turn-row` en todas lo elimina. Cowork: el bloque destino de un salto de búsqueda/contexto nunca lleva `turn-cv` (su `outline` se recortaría) y durante el salto (2,5 s) se desactiva en todos los bloques, para que `scrollIntoView` centre con alturas reales. Code: un turno con permisos pendientes no se salta.

**Snapshots de render actualizados (solo clases):** `ChatMessageList`, `MessageStream` y `TaskConversation` `.render.test.tsx.snap` (11 líneas: cada fila gana ` turn-row` y, en Chat/Code, ` turn-cv-pad`); verificado por diff que es lo único que cambia. Las trazas (`traces.replay`) no cambian.

Tests: `lib/conversation/cv.test.ts`; E2E `perf.e2e.ts` (F7-B47): historial de 13 turnos con filas `.turn-cv`, pegado al final exacto, subir/volver, reabrir la conversación y mensaje nuevo; Cowork: la búsqueda abre un mensaje antiguo y lo centra (<80 px) y `turn-cv` se reactiva.

## F7-B47 — Test E2E de rendimiento del streaming (`e2e/specs/perf.e2e.ts`) y cifras

Con el OpenCode falso: un guion de 2000 deltas (`text` en 2000 trozos con párrafos y un bloque ```ts, `chunkDelayMs: 1`) en un chat, con `PerformanceObserver` (`longtask`, >50 ms) en la página y la CPU del renderer ralentizada x4 por CDP (`Emulation.setCPUThrottlingRate`, se restablece al medir; `E2E_PERF_THROTTLE=1` la quita). Comprueba: la sesión termina, texto final EXACTO y completo en el store (`===` con la unión de los 2000 deltas), el final visible en el DOM, el bloque ```ts resaltado (`pre code.hljs .hljs-keyword`) y umbrales: ≤ 40 tareas largas, suma ≤ 3000 ms, máx ≤ 800 ms (medido con los cambios: 13-20 / 0,9-1,7 s / ≤ 220 ms, es decir ≥ 2x de margen). Además: historial largo con `content-visibility` (pegado al final exacto, subir/volver, reabrir, mensaje nuevo) y Cowork (búsqueda que centra un mensaje antiguo, ver F7-B46).

Medido (3 ejecuciones por fila, mismo guion, headless):

| Commit | CPU x4: tareas largas / suma / máx / duración | CPU x1: tareas largas / suma |
|---|---|---|
| `afeff4f` (antes, sin cambios) | 3-4 / 95-97 s / 75-91 s / 95-98 s | 6-7 / 18,2-18,6 s (máx 11-16 s) / 18,6-19 s |
| + B43 deltas por frame | 19-20 / 1,6-1,7 s / ≈ 200 ms / 3,0 s | — |
| + B44 memo | 18-20 / 1,7-1,8 s / ≈ 200 ms / 2,9-3,2 s | — |
| + B45 Markdown | 13-19 / 0,9-1,3 s / ≈ 205 ms / 3,0 s | — |
| + B46 content-visibility (final) | 13-17 / 0,9-1,2 s / ≈ 205 ms / 2,9-3,0 s | 0 / 0 (2,7 s) |

Nota: el «número» de tareas largas engaña en el estado anterior (pocas pero de decenas de segundos: la página se congela); por eso el test acota también la suma y el máximo. En headless (ventana con opacidad 0, `showInactive`) `requestAnimationFrame` SÍ se dispara con normalidad (los deltas se agrupan; 2000 deltas en ≈ 3 s), así que no hizo falta ajustar nada; el respaldo de 100 ms del programador (`frame-queue.ts`) cubre ventanas ocultas/minimizadas, donde rAF se pausa.
