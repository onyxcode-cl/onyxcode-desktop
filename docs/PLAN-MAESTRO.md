# Plan maestro: red de verificación, cierre del refactor, funciones y distribución

> Documento histórico. "Cowork" es el nombre interno del modo que la app muestra como "Tareas"; las menciones a productos de terceros eran referencias de diseño.

Hecho por Opus 5.5, ejecutado por Sonnet 5.5. Versión condensada; el plan completo vive en el historial de la sesión.

## Decisiones tomadas
- Alcance actual: **Olas 1 a 5** (verificación con la app real + cierre del refactor + merge a `main`).
- E2E con **`playwright-core`** (devDependency exacta, sin navegadores). Voz y Dispatch quedan **fuera**.
- Merge a main con **squash** (se conserva la rama `refactor/cleanup` y sus tags como respaldo del detalle).
- Rama `claude/pensive-brahmagupta-2c3b60` + worktree: comparar su commit `53b8bb2` con el árbol; si está reemplazado
  por `app:notify`/`app:setAttention`, archivar con tag `archive/pensive-notify` y borrar rama y worktree.

## Olas
| Ola | Contenido |
|---|---|
| 0 | tag `pre-verify`, rama `verify/e2e` |
| 1 | A1 herramienta · A2 servidor OpenCode falso (`e2e/fake-opencode`) · A3 ganchos DEV (`__onyxE2E`) · A4 harness (`e2e/lib`, Vitest e2e) · A5 `test:transform` · A6 `test:smoke` |
| 2 | A7 specs E2E (`fase6`, `lru`, `instance`, `lotes`) · A8 `docs/VERIFICACION.md` (checklist humana mínima) |
| 3 | B1 revisión de código de la rama + auditoría independiente |
| 4 | B2 retirar 3 flags · B3 eslint-disable · B4 `ERROR`→`FORBIDDEN` · B5 loader Code · B6 paneles ocultos · B7 rendimiento del render |
| 5 | B9 Prettier (commit aislado) · merge a `main` · tags `fase7-done`, `v0.2.0` |
| 6-10 | Funciones (adjuntos Chat, logs/diagnóstico, onboarding, PR en Code, web+memoria Chat, Artifacts, conectores) y distribución: FUERA de este alcance por ahora |

## Reglas de ejecución (todo agente)
Controles por commit: `npm run typecheck` → `npm test` → `npm run lint` → `npm run build` → diff de `require` y de
`ls -R out/main out/preload`; hashes `shasum out/preload/{quick,overlay,pill,assist,browser-host}.js` idénticos. Un commit
por paso, con `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Cambio de comportamiento → ID `F7-B<n>` en
`CHANGELOG-FASE7.md` con su test. Si falla un control: `git revert`, no arreglar encima. IPC nuevo: contrato + esquema en
`main/ipc/schemas.ts` + builder de preload + `CHANNEL_ROLES` solo main. No tocar preloads con sandbox, `helper.swift`,
plan-gate, Seatbelt ni la regla `webRequest`. Texto de UI en español.

## Hallazgos que condicionan
- `migrateLegacyUserData` (`src/main/index.ts`) mueve datos de `Lapis`/`OpenDesk` a un userData sin `settings.json`: el
  harness debe crear `settings.json` en el userData aislado ANTES de arrancar.
- `OPENCODE_BIN` se respeta en sidecar y Cowork: un OpenCode falso es viable (~45 rutas del SDK).
- Solo 6 directivas `eslint-disable` sin uso; solo `bridge.ts:30` devuelve `'ERROR'` para canal prohibido.
