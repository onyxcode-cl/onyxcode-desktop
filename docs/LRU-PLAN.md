# Plan: LRU de `messages` (diferido de la Fase 6)

Hecho por Opus 5.5, ejecutado por Sonnet 5.5. Versión condensada. Topes elegidos: **40** sesiones en
`useSessions` (Chat + Cowork) y **20** en `useCode`.

## Diseño
- **Se desaloja solo el contenido:** `messages[id]`, `loaded[id]`, `loadingMessages[id]` y las `orphanParts` de esa sesión
  (filtradas por `part.sessionID`). Nunca `sessions`, `status`, `errors`, `todos`, `sessionSource`.
- **Fijadas (no desalojables):** `status` busy/retry; carga en vuelo (`loadingMessages`/`buffers.loading`); raíz e hijas de
  cualquier fijada (recorrer `parentID`, como `isChildOfAny`); Chat: `activeSessionId`; Cowork: `activeTaskId`,
  `sideChat.sessionId`, permisos/preguntas pendientes (+raíz); Code: `activeSessionID`, `queue[id]` no vacía,
  permisos/preguntas pendientes.
- **Guardas:** `useSessions.addEvictionGuard(fn: () => Iterable<string>)`; Chat y Cowork se registran desde su módulo;
  Code usa guardas internas (evita imports circulares).
- **Política:** tope por número de sesiones no fijadas con contenido; LRU por `lastAccess` (Map a nivel de módulo, sin
  `set`, uno por store). Las nunca abiertas (`lastAccess=0`) salen primero. Recibir un evento NO cuenta como acceso.
  Tope sobrescribible con `localStorage['onyx.lru.max']`.
- **Dónde vive:** funciones puras en `lib/session-reducer.ts` (`pickEvictions`, `evictMessages` —misma referencia si no hay
  cambio—, `forgetOrphansOf`); envoltorio fino `touchSession`/`evictIdle` en cada store.
- **Cuándo se desaloja:** tras cada `touch`, y cuando `applyEvent` añade una clave nueva a `messages` y se pasa del tope
  (agrupado con `queueMicrotask`, un único `set({messages, loaded, loadingMessages})`).
- **Recarga:** reabrir fija la sesión (activa + touch) ANTES de `loadMessages`; `loaded=false` fuerza recarga;
  `LoadTracker`+`mergeSnapshot` cubren eventos en vuelo. Loader en ChatView/CoworkWorkspace mientras `!loaded && loading`.
- **Flag:** `messagesLru` (default false hasta el paso 7; se retira en la Fase 7). Con `'0'` el comportamiento es el de hoy.

## Pasos (un commit por paso; typecheck → test → lint → build → diff de `require`)
1. F6-B14 (sin LRU): `deleteTask` limpia `loaded`; `ensureEntries` (cowork/actions.ts ~l.764) y `search.ts` (~l.155) usan
   `loaded[id]` y no la longitud de la lista; helper puro `loadedTranscript` con `search.test.ts`.
2. Primitivas puras en `session-reducer.ts` + tests (`no desaloja si hay ≤ max`, `primero las nunca accedidas`,
   `orden por lastAccess`, `nunca devuelve fijadas`, `evictMessages misma referencia sin ids`, `forgetOrphansOf`).
3. Flag `messagesLru` en `lib/flags.ts` + caso en `flags.test.ts`. *(Retirada en la Fase 7, F7-B38: el LRU está siempre activo; `lruMax()` pasó a `lib/lru.ts`.)*
4. `useSessions`: `touchSession`, `addEvictionGuard`, `evictIdle`, guardas base, disparo por microtask (F6-B15) + tests.
5. Chat y Cowork: `touch`, guardas, loader al reabrir, sembrar `textCache` de `search.ts` al desalojar + tests
   (`reabrir una sesión desalojada vuelve a llamar a session.messages`, `delta en vuelo durante la recarga no se pierde ni duplica`).
6. Code (F6-B16): `lastAccess` + `evictIdle` + guardas + tests.
7. Activar la flag por defecto; CHANGELOG-FASE6 (F6-B14..B16), quitar "LRU" de "Se difiere" en FASE6-PLAN.md, AUDIT.md
   §1.1 "Crecimiento sin límite" → ✅.

## Decisiones tomadas
D1 topes 40/20 (solo por nº de sesiones) · D2 flag `messagesLru` (retirada en la Fase 7) · D3 aceptar que una tarea desalojada con error del último
asistente sin `errors[id]` se vea `'done'` · D4 sembrar `textCache` al desalojar · D5 numerar F6-B14..B16.

## Verificación manual (con `onyx.lru.max = 2`)
Abrir 4 chats y volver al primero (recarga sin pantalla vacía) · chat largo en streaming, pasar a otros 3 y volver (sin
huecos) · Cowork: tarea con permiso pendiente no se desaloja, buscar texto de una desalojada la encuentra, subtarea con
`FolderRequestCard` se ve entera · Code: encolar en A, cambiar a B/C/D, A autoenvía; revert y fork tras reabrir · rutina en
segundo plano: nº de claves de `messages` estable ≤ N + fijadas (DevTools: `useSessions.getState()`).
