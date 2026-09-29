# Bugs reales que destapó la red de verificación (ARREGLADOS en la Fase 7)

> Documento histórico. "Cowork" es el nombre interno del modo que la app muestra como "Tareas"; las menciones a productos de terceros eran referencias de diseño.

Los 5 están arreglados (commit entre paréntesis) y sus tests pasaron de `it.fails` / describe desactivado a `it` normales.
Detalle de cada arreglo en `CHANGELOG-FASE7.md` (F7-B*) y `docs/REVIEW-FASE7.md`.

| # | Gravedad | Bug | Dónde | Evidencia | Estado |
|---|---|---|---|---|---|
| 1 | Alta | Navegar el navegador integrado a `mailto:` o `tel:` **mata el proceso principal** (SIGTRAP en `CrBrowserMain`). Pasa por clic del agente y por `location.href`, con ventana visible u oculta; no aparece ninguna línea `[embedded-browser] navegación bloqueada` antes del crash. | `src/main/embedded-browser/` (política de navegación) | `e2e/specs/lotes.e2e.ts`, describe desactivado (`E2E_REPRO_CRASH=1`); informes en `~/Library/Logs/DiagnosticReports/Electron-2026-09-29-*.ips` | ✅ arreglado: dd21996 (F7-B1) |
| 2 | Media | El foco por defecto en «Cancelar» de la tarjeta de acción sensible no se cumple: `denyRef.current?.focus()` corre al montar con el botón `disabled` (aún sin armar, 700 ms), así que el foco queda en `body` y Enter no deniega. El comentario del archivo dice lo contrario. | `src/renderer/src/features/browser/Cards.tsx` | `lotes.e2e.ts` (`it.fails`) | ✅ arreglado: bdf504d (F7-B2) |
| 3 | Media | Carpeta prohibida en Cowork: el motivo se guarda en `useCowork.error` pero `phaseBanners` solo lo pinta con `phase==='error' && folder`; con una carpeta rechazada no hay ninguna de las dos, y el usuario no ve nada. | `src/renderer/src/features/cowork/impl/CoworkWorkspace.tsx` (`phaseBanners`) | `lotes.e2e.ts` (`it.fails`) | ✅ arreglado: 98d6189 + a526cb5 (F7-B4) |
| 4 | Baja | Keys duplicadas: `DeleteGrantHintCard` y `EscalateCard` son hermanos con `key={activeId}` (aviso de React en cada render de una tarea terminada de Cowork en Sandbox). | `CoworkWorkspace.tsx:656-657` | `lru.e2e.ts` (`it.fails`) | ✅ arreglado: 98d6189 (F7-B5) |
| 5 | Baja | Tras reiniciar el sidecar con una sesión de Chat en `busy`, `useSessions.status[sid]` queda `'busy'` para siempre: `syncChatRunStatus` calcula el ámbito desde `sessions`, que `loadChatSessions` ya vació. Sin efecto visible (entrada huérfana). | `stores/sessions.ts` / `features/chat/actions.ts` | `fase6.e2e.ts` caso 3b (`it.fails`) | ✅ arreglado: 3884e6c + fb8b411 (F7-B10) |

## Observaciones (sin test que falle)
- Un origen local aprobado con «Permitir siempre» puede hacer `fetch` a cualquier otro puerto de loopback (el test fija el
  comportamiento actual; «en esta tarea» no cuenta). Decidir si es intencional.
- Los mensajes de denegación llaman «0.1» al sitio de una IP (`siteOf('127.0.0.1')`).
- El test del panel Cambios cuenta llamadas envolviendo `ipcMain._invokeHandlers` (API interna de Electron).
- Una tarea de Cowork creada en sesión y nunca reabierta no siembra la caché de búsqueda al desalojarse (correcto, más lento).
