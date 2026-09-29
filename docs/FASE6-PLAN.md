# Fase 6 — plan (hecho por Opus 5.5, ejecutado por Sonnet 5.5)

Rama `refactor/cleanup`. Tag base `fase6-base`; tag `fase6-<subfase>` tras cada subfase verde.
Versión condensada del plan original; el detalle vive en el historial de la sesión.

## Reglas
1. Un commit por subfase (dentro de 6a/6b, uno por paso). Nunca mezclar "mover código" con "cambiar comportamiento".
2. Cada cambio de comportamiento se declara en el commit y en `CHANGELOG-FASE6.md` con ID `F6-B<n>` y su test.
3. Controles en cada commit: `npm run typecheck` → `npm test` → `npm run build` → diff de estructura contra la
   línea base (`ls -R out/main out/preload` + `grep -o 'require("[^"]*")' out/main/*.js out/preload/*.js | sort -u`).
   Un chunk nuevo en `out/preload` o `out/main/chunks` bloquea. Los preloads con sandbox
   (`quick`, `overlay`, `pill`, `assist`, `browser-host`) no se tocan y deben quedar byte a byte iguales.
4. Si falla un control: `git revert` del commit, no arreglar encima.
5. Feature flags solo donde cambia qué datos llegan al estado (`lib/flags.ts`, `localStorage['onyx.flag.<n>']`):
   `sessionsChatOnly`, `codeAlwaysSubscribed` y `messagesLru` (LRU de `messages`, ver `docs/LRU-PLAN.md`).
   **RETIRADAS en la Fase 7 (F7-B38):** `lib/flags.ts` ya no existe; rige siempre la rama por defecto. Se conserva solo el
   override de tope `localStorage['onyx.lru.max']` (`lib/lru.ts`, `lruMax()`), que usan los E2E.
6. Nada de reformateo masivo mezclado con lógica. `computer/mcp-server.ts` es un bundle aparte: no importa `util/`.

## Orden
| # | Subfase | Depende de |
|---|---|---|
| 6.0 | Vitest, stub de `window`, fixtures, trazas, tests de caracterización, snapshots HTML | — |
| 6.1 | Extras: `IpcPlainResult`, quitar `NOT_IMPLEMENTED`, Git*/Pty* a `ipc-code.ts`, asar en `opencode-config.ts`, `sleep`/`hostOf`, highlight.js dedup, docs a `docs/archive/` | 6.0 |
| 6.2 | `makeBridge` en preload (solo builders de `index.js`) | 6.1 |
| 6.3 | Primitivas de conversación (`AssistantError`, `Reasoning`, `parseTodos`, `useAutosizeTextarea`, `isSubmitKey`, `Toggle`) | 6.0 |
| 6.4 | Extraer `lib/session-reducer.ts` sin cambios de comportamiento | 6.0 |
| 6.5 | Enrutar eventos por directorio del sobre (`stores/eventRouter.ts`), flag, Code suscrito a nivel de App | 6.4 |
| 6.6 | Correcciones declaradas: dedupe (B3), deltas huérfanos (B2), B4 en Code (B6), hijas (B4), busy pegado (B5) | 6.5 |
| 6.7 | Pf1: debounce y filtro de `fsVersion` en Code | 6.6 |
| 6.8 | ESLint + Prettier (sin bloquear) y `ErrorBoundary` | todo |

## Decisiones tomadas
- D1 filtrar por directorio del sobre con fail-open para sesiones conocidas · D2 extraer reductor antes de 6a ·
  D3 Code suscrito a nivel de App con flag (**sí**) · D4 corregir hijas/busy/B4 en Code (**sí**) ·
  D5 `keyCode 229` en `isSubmitKey` · D6 Toggle unificado (2 px) · D7 ESLint sin bloquear ·
  D8 diferir refresco de paneles ocultos · D9 archivar planes viejos · D10 instalar devDeps.

## Se difiere a propósito
Store por origen, rendimiento del render, fusionar composers / `ChatToolCall`-`ToolCard` /
`UserMessage` / `PermissionCard`-`PermissionPrompt`, reformateo Prettier, unificar `code:'ERROR'` vs `'FORBIDDEN'`.

## Definition of Done
typecheck + tests (más de 60 casos) + build verdes en cada tag; diff de `require` vacío o justificado; un solo
`upsertSorted`/`appendWithoutOverlap`/`mergeSnapshot`; una sola implementación de las primitivas; `makeBridge` en los
4 builders; un solo highlight.js; `CHANGELOG-FASE6.md` con F6-B1..B13; docs obsoletos archivados; checklist manual
ejecutada; flags listados para retirar en la Fase 7.
