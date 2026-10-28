# Plan: rebobinar por turno y compactación mejor

Fecha: 2026-10-25. Motor: fork 1.19.0 (`/Users/ben/Documents/lzx-wt/integracion`, rama base `feat/ola1`). Ramas nuevas: `feat/rebobinar` y `feat/compactacion-2` en el fork y en la app.
Plan general: `docs/PLAN-MOTOR-PROPIO.md` (paso 4, filas 8 y 9). Comparativa: `docs/COMPARATIVA-MOTOR.md` (filas 69-70 y prioridad 7). Formato copiado de `docs/PLAN-HERRAMIENTAS-DIFERIDAS-Y-FORMULARIOS-MCP.md`.
Rutas del motor relativas a `packages/opencode/src/` salvo que se diga otra cosa. Todo local y gratis; pruebas pesadas en el VPS (`/opt/lzx-test.sh`), nunca la suite completa en el Mac.

## 1. Estado actual (leído en el código)

### 1.1 Instantáneas del motor (`snapshot/index.ts`)

- Un repositorio git **propio** por proyecto en `<datos>/snapshot/<proyecto>/<hash(worktree)>` (`:66-73`), con `--work-tree` = carpeta de la persona. Nunca toca el `.git` de la persona (solo lo lee para ignorados y para sembrar objetos: `:102-130`, `:198-233`).
- **Solo funciona si la carpeta es un repo git** (`enabled`, `:167-170`: `vcs !== "git"` → nada). En una carpeta sin git no hay instantáneas.
- `track()` (`:318-347`): `add()` (`:235-298`) prepara lo cambiado y lo nuevo **no ignorado**; los nuevos de más de 2 MB se excluyen (`:24`, `:277-297`); devuelve un árbol (`write-tree`), **sin commit ni ref**.
- `patch(hash)` (`:349-380`): lista de archivos cambiados desde ese árbol, solo bajo la carpeta abierta (`-- .` con `cwd = directory`).
- `revert(patches)` (`:408-524`): `git checkout <árbol> -- <archivo>`; si falla y `ls-tree` no lo encuentra, **borra el archivo** (`:431-442`, `:473-482`, `:514-518`). `restore(árbol)` (`:382-406`): `read-tree` + `checkout-index -a -f`: **reescribe todo el árbol** de la carpeta.
- Poda: `git gc --prune=7.days` cada hora (`:23`, `:300-316`, `:761-766`). Como los árboles no tienen ref, a los 7 días se borran.
- **Fallo probable (confirmar en R0 con prueba):** tras la poda, `ls-tree` de un árbol perdido falla → el código lo trata como «no existía» y **borra** el archivo de la persona. Lo mismo en el camino por lotes (`:473-482` cae a `single`).
- `diffFull` (`:546-759`) genera el parche con **contexto infinito** (`:737`: archivo entero), que se guarda en cada mensaje (ver 1.3).

### 1.2 Por turno, en el procesador y en `revert`

- `session/processor.ts:99-109` y `:424-431`: instantánea al empezar cada paso (`step-start.snapshot`); `:435-483`: al terminar, `step-finish.snapshot` y una parte `patch {hash, files}` con lo cambiado en el paso (`:554-566` igual al abortar).
- Como la instantánea es de **toda la carpeta**, el `patch` incluye lo que cambió `bash`, un subagente en primer plano (corre dentro del paso de la madre), **y también lo que la persona u otro proceso editó a la vez**.
- `session/summary.ts:82-100` (`computeDiff`): diff del turno = primer `step-start` → último `step-finish`; `:102-127` (`summarize`, lanzado en `processor.ts:485-490` y `prompt.ts:1260`) lo guarda en `user.summary.diffs` (con parches enteros). Ruta `GET /session/{id}/diff?messageID` (`handlers/session.ts:99-103`). **La app no usa nada de esto.**
- `session/revert.ts:38-89`: junta los `patch` desde el mensaje elegido, `track()` del estado actual (para poder deshacer), `snap.revert`, marca `session.revert`. `:91-99` `unrevert` = `restore()` completo (pisa lo que la persona tocó después). `:101-124` `cleanup` borra los mensajes ocultos al siguiente prompt (`prompt.ts:464-465`, `:1062`) o al compactar (`handlers/session.ts:277`).
- Bloqueos: `state.assertNotBusy` solo de ESA sesión (`revert.ts:39`): no mira hijas ni trabajos de fondo.

### 1.3 Qué cubre hoy y qué no

| Cambio                                                                                                                                        | ¿Lo ve el diff del turno / lo deshace Revertir?                          |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `edit`/`write`/`apply_patch` dentro de la carpeta (repo git)                                                                                  | Sí                                                                       |
| `bash` dentro de la carpeta, archivos no ignorados                                                                                            | Sí (Claude Code no)                                                      |
| Archivos ignorados (`node_modules`, `.env`, `dist`), nuevos > 2 MB, fuera de la carpeta, efectos externos (paquetes, BD, `git commit`/`push`) | No                                                                       |
| Subagente en primer plano                                                                                                                     | Sí, mezclado en el paso de la madre                                      |
| Subagente/shell en segundo plano                                                                                                              | A medias: cae en el paso de la madre que coincida o en ninguno           |
| Ediciones de la persona durante el turno                                                                                                      | Sí, **mezcladas** (Revertir también las deshace)                         |
| Carpeta sin git                                                                                                                               | **Nada**, pero el diálogo dice que «se desharán los cambios en archivos» |
| Turnos de más de 7 días                                                                                                                       | Riesgo de borrado (1.1)                                                  |

### 1.4 App

- Code: botón «Revertir» en cada mensaje de la persona (`renderer/src/features/code/impl/MessageStream.tsx:296-311` celular, `:365-375` escritorio, `ConfirmButton`), texto `code.msg.revertBody` (`src/shared/i18n/es/code.ts:139-142`); `revertTo`/`revertLast`/`unrevert`/`editAndRetry` en `features/code/impl/store.ts:1165-1262`; aviso «Restaurar» con `onUnrevert` (`MessageStream.tsx:589-611`, `:687`). Partes `patch`, `snapshot`, `compaction` invisibles (`MessageStream.tsx:59`).
- Barra «N archivos con cambios» (`CodeWorkspace.tsx:541-570`) y panel Cambios: **estado git de todo el repo**, no por turno.
- Tareas: puntos de restauración propios de la app (`src/main/tasks/restore-points.ts:1-20`, límites `:61-71`: 20 por sesión, 30 días, 20 000 archivos, sin seguir enlaces, a la Papelera, `safeAbs` `:653`), creados antes de cada envío (`features/tasks/impl/actions.ts:647-669`) y «Deshacer desde aquí» = punto + `session.revert` (`:729-775`). No cambia en este plan.
- Celular: `POST /session/{id}/revert` M, `unrevert` M, `GET /session/{id}/diff` R, `summarize` M (`src/main/remote/policy.ts:934-950`, `:1178`, `:1210-1212`); `summary.diffs` y `session.diff` se filtran con `scrubDiffLists` (`src/main/remote/event-trim.ts:156-158`).

### 1.5 Compactación

- Disparo automático solo **entre pasos**: `processor.ts:490-496` marca `needsCompaction` en `step-finish` (las herramientas del paso ya terminaron); `prompt.ts:1166-1173` y `:1326-1335` crean el mensaje `compaction`; `prompt.ts:1155-1164` lo procesa; `:1345` poda salidas viejas.
- `session/compaction.ts:225-271` (`select`): conserva la cola reciente por presupuesto (`:116-121`, 2 000-15 000 tokens); `:321-569` (`process`): serializa la cabeza (`:55-86`, salidas a 2 000 caracteres), plantilla `packages/core/src/session/compaction.ts:16-55`, contexto de plugins `experimental.session.compacting` (`:375-379`) y **lista de tareas** (`:380-388`); `filterCompacted` (`session/message-v2.ts:534-585`) arma `[compaction, resumen, cola…]` con `tail_start_id` (`packages/schema/src/v1/session.ts:195-201`).
- Ya sobrevive siempre: AGENTS.md/CLAUDE.md raíz y global e instrucciones de la configuración (van en el sistema en cada petición: `prompt.ts:1267`, `instruction.ts:61-66`), lista de habilidades y de MCP (`system.ts:107-136`).
- Se pierde: **contenido** de habilidades cargadas (protegidas de la poda, `compaction.ts:32`, pero resumidas), AGENTS.md de subcarpetas adjuntados al leer (`instruction.ts:17-31`, `:179-220`; vuelven solo si se relee algo de esa carpeta), y qué ayudantes/trabajos de fondo siguen vivos.
- `PreCompact` de usuario: `plugin/lazunox-ganchos.ts:119-124` (stdout se suma al contexto del resumen). No hay `PostCompact`. Evento `session.compacted` solo con `sessionID` (`packages/schema/src/session-compaction-event.ts`).
- Ruta manual `POST /session/{id}/summarize` (`handlers/session.ts:273-292`): **no comprueba si la sesión está ocupada** ni si hay permiso/pregunta/formulario pendiente, y **consolida un revert pendiente** sin preguntar (`:277`).
- App: «Compactar historial» (`ToolbarMore.tsx:66`, `MessageStream.tsx:414-415`, `:482`, `:709`; `store.ts:1523-1532` llama sin `providerID/modelID`: comprobar en C1 que el motor no lo rechaza), Chat `features/chat/actions.ts:457-466`. Tras compactar la persona solo ve el texto del resumen como respuesta normal; no sabe qué se resumió ni cuánto se liberó. Ganchos en la app: `src/shared/user-hooks.ts:23` (`HOOK_EVENTS`).

## 2. Decisiones de diseño

### A. Rebobinar por turno

1. **Base = instantáneas del motor**, no los puntos de la app. El motor sabe exactamente dónde empieza y acaba cada turno, ya calcula el diff y cubre `bash` dentro de la carpeta. Los puntos de la app siguen solo en Tareas.
2. **Puntos de control duraderos**: al terminar un turno, `git update-ref refs/lazunox/<sessionID>/<userMessageID> <árbol inicial>` (+ refs de los árboles de sus `patch`), así `gc` no los poda. Tope **100 por sesión** (`LAZUNOX_CHECKPOINTS_MAX`); al pasar, se borra la ref más vieja y ese turno queda «solo conversación». Al borrar la sesión se borran sus refs. **Nunca** se borra un archivo porque falte un objeto: objeto ausente = error «punto caducado», sin tocar nada.
3. **Resumen ligero por turno**: `GET /experimental/session/{id}/turnos` → `[{ messageID, time, files: [{ file, status, additions, deletions, origen: 'herramienta'|'comando'|'otro' }], truncated, restaurable, motivo? }]` con `git diff --numstat` entre árboles (sin escanear la carpeta ni parches enteros). `origen`: `herramienta` si una parte `edit/write/apply_patch` del turno nombra el archivo; `comando` si el turno corrió `bash`/`execute`; si no, `otro` (persona, ayudante de fondo, otro proceso). Tope 500 archivos por turno, 100 turnos por respuesta (`antesDe` para paginar), caché en memoria por `messageID`. Parche bajo demanda: `GET …/turnos/{messageID}/diff?file=` con contexto 3, tope 1 MB por archivo.
4. **Tres modos con revisión previa**:
   - `GET /experimental/session/{id}/rebobinar/{messageID}` (solo lectura) → `{ archivos, conflictos, protegidos, comandos, commitsDespues, ayudantesActivos, restaurable, motivo? }`. `conflictos` = archivos a restaurar que cambiaron **después** del último `step-finish` de la sesión (los tocó la persona u otro proceso); `protegidos` = `permission/rutas-protegidas.ts` (`.vscode`, `.claude`, `.mcp.json`…); `commitsDespues` = commits del repo de la persona con fecha posterior al inicio del turno (`git log` de solo lectura).
   - `POST /experimental/session/{id}/rebobinar { messageID, modo: 'todo'|'conversacion'|'codigo', sobrescribir?: string[] }`. Conflictos y protegidos **se saltan** salvo que vengan en `sobrescribir`. `todo` = Revertir de hoy endurecido; `conversacion` = `setRevert` sin tocar archivos (`RevertInput.files: false`); `codigo` = restaura archivos y deja los mensajes, y el siguiente prompt lleva una parte sintética «La persona restauró estos archivos a como estaban antes del turno N: …» para que el modelo no trabaje sobre un estado falso.
   - `POST …/rebobinar/deshacer`: vuelve al árbol tomado justo antes de rebobinar **solo en los archivos tocados**. `unrevert` pasa a hacer lo mismo (no más `checkout-index -a`).
   - Se niega (409) si la sesión, una hija o un trabajo de fondo de la sesión está en marcha, o si hay permiso/pregunta/formulario pendiente.
5. **Git de la persona**: no se hace `reset`, `stash`, `commit` ni `checkout` de ramas; `.git` nunca se toca. Si hay `commitsDespues`, se avisa: «Los commits no se deshacen; los archivos quedarán como cambios sin confirmar».
6. **Carpeta sin git**: v1 honesto: `restaurable: false, motivo: 'sin-git'`; el diálogo solo ofrece «Solo conversación» y lo dice. Se corrige `code.msg.revertBody`.
7. **Subagentes de fondo**: bloquean rebobinar mientras corren (punto 4); sus archivos salen como `otro`. Cada hija conserva su propio Revertir.
8. **UI**: tarjeta plegada «Cambios de este turno · 3 archivos · +40 −12» al final de cada turno con archivos; al abrir, lista con +/− en texto (no solo color), etiqueta de origen y diff bajo demanda (`DiffView`). Botón «Volver a antes de este turno…» (y el «Revertir» del mensaje abre el mismo diálogo). Diálogo: grupo de radio con los 3 modos, avisos (comandos: «lo que hicieron los comandos fuera de la carpeta, en archivos ignorados o fuera de Lazunox no se deshace»; conflictos con casillas desmarcadas; protegidos; commits; sin git), resumen «Se restaurarán N archivos y se ocultarán M mensajes», botón con el texto exacto de la acción. Después: aviso con «Deshacer». Accesible: `role="dialog"`, foco al primer radio, Esc cancela, resultado por `aria-live`. i18n `code.turn.*`, `code.rewind.*` (es/en).
9. **Celular (seguridad primero)**: ve la tarjeta en solo lectura (lista y cifras, filtrada por `scrubDiffLists`, sin parche). Las rutas nuevas de rebobinar y su diff son **X**; `turnos` y la revisión previa, R con ámbito. El `revert` M de hoy no cambia en este plan (ver 7).
10. **Interruptor**: `LAZUNOX_REBOBINAR=0` → rutas nuevas 404 y la app vuelve al Revertir de hoy (detecta 404).

Descartado:

- **Puntos de la app (copias) también en Code**: duplicaría almacenamiento y no conoce los límites de turno; además exigiría IPC nuevo. Se queda en Tareas.
- **Seguir solo las herramientas de edición (como Claude Code)**: no vería `bash`; preferimos ver más y avisar de la mezcla.
- **Deshacer commits (`reset`) o usar `stash`**: destructivo sobre el git de la persona.
- **Instantáneas en carpetas sin git ya**: sin reglas de ignorados copiaría `node_modules`; va a la fase opcional R5.

### B. Compactación

1. **Parcial «compactar hasta aquí»**: `POST /session/{id}/summarize` acepta `upTo?: MessageID` (mensaje de la persona, posterior a la última compactación y no el primero). `create` guarda `tail_start_id = upTo` y `manual_tail: true` en la parte `compaction` (campo opcional nuevo en `schema/src/v1/session.ts:195-201`); `process` no llama a `select` y resume solo lo anterior. Si la cola elegida pasa del 60 % de lo usable → error claro «lo que quieres conservar ya no cabe; elige un mensaje más reciente». `filterCompacted` no cambia.
2. **Reinyección** tras un resumen correcto: una parte de texto sintética en el mensaje `compaction` con `<contexto-vigente>`: (a) lista de tareas con estado; (b) habilidades cargadas en la parte resumida: nombre + contenido releído por el servicio de habilidades; (c) AGENTS.md/CLAUDE.md de subcarpetas que se habían adjuntado (rutas de `metadata.loaded`, releídas con `instruction.resolve`, solo dentro del proyecto); (d) ayudantes y trabajos de fondo vivos (id, título, estado: `tool/trabajos.ts` + hijas ocupadas); (e) salida de `PostCompact`. Presupuesto total 16 KB o 10 % de lo usable (lo menor); si no cabe, solo nombres + «vuelve a cargarla si la necesitas». No se reinyecta lo que ya va en el sistema (1.5).
3. **`PostCompact`**: nuevo disparador de plugin `experimental.session.compacted` (entrada `{ sessionID, trigger: 'auto'|'manual', parcial, tokensAntes, tokensDespues }`, salida `{ context: [] }`) que usa `lazunox-ganchos.ts`; stdout con código 0 (≤ 4000 caracteres) va al bloque (e) marcado «[Gancho PostCompact]». Mismas reglas que `PreCompact` (solo el archivo de la app).
4. **Aviso a la persona**: `session.compacted` gana campos opcionales `{ auto, parcial, mensajes, tokensAntes, tokensDespues, reinyectado: string[] }` (solo etiquetas, nunca contenido) y se guardan también en la parte `compaction` (`lazunox`) para verlos al recargar. `tokensAntes` = tokens reales del último paso; `tokensDespues` = estimación (se muestra con «≈»).
5. **Momento seguro**: el automático ya ocurre solo entre pasos. La ruta manual responde 409 si la sesión está ocupada, tiene permiso/pregunta/formulario pendiente o **un revert pendiente** (hoy lo consolida en silencio). Celdas de Code Mode y shells de fondo vivos no bloquean: salen en (d).
6. **Calidad sin API de pago**: (i) determinista con el proveedor falso del arnés (el cuerpo de la petición de resumen y la petición siguiente se inspeccionan); (ii) evaluación con modelo gratuito: conversaciones sintéticas con 12 «hechos clave» cada una (ruta, decisión, restricción de la persona, cadena de error, tarea pendiente, siguiente paso), compactar con el motor real y preguntar cada hecho en un turno nuevo; puntuación por subcadena normalizada; mediana de 3 corridas; criterio ≥ 80 % y no peor que el motor actual.

Descartado:

- **«Resumir del mensaje elegido en adelante» (variante de Claude Code)**: exige un resumen en medio y reordenar `filterCompacted`; se pide lo contrario (conservar lo reciente).
- **Reinyectar en el sistema de cada petición**: rompe el caché del prompt cada vez que cambia el plan.
- **Compactar en segundo plano (OpenCode 2.1.4)**: carrera con el turno en curso; se pospone.

## 3. Modelo de amenazas

| Mejora | Amenaza                                                                                                                              | Defensa                                                                                                                                                                                                                                                | Prueba                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| A      | Rebobinar escribe o borra fuera del proyecto (ruta con `..`, enlace simbólico intermedio, carpeta cambiada por enlace tras el turno) | Rutas relativas de git normalizadas; cada componente con `lstat` (rechaza enlaces, como `restore-points.ts:653`); `realpath` del padre dentro de `directory`; borrar solo el archivo exacto, nunca recursivo; enlaces del árbol solo si apuntan dentro | `bun test` + probe R-6       |
| A      | Borrado por objeto podado (1.1)                                                                                                      | Objeto ausente = error, nunca borrar; refs duraderas                                                                                                                                                                                                   | R0 unitaria + R-3            |
| A      | Pisar trabajo de la persona (editado después, árbol sucio, `unrevert` total)                                                         | Conflictos fuera por defecto; deshacer solo archivos tocados; nada de `checkout-index -a`                                                                                                                                                              | R-4, R-5                     |
| A      | Reescribir configuración que da poder (`.mcp.json`, `.claude/`, ganchos)                                                             | Protegidos fuera salvo marcado explícito y listado en el diálogo                                                                                                                                                                                       | R-7                          |
| A      | Rebobinar desde el celular o sin persona delante                                                                                     | Rutas nuevas X; Tareas/Rutinas no las usan                                                                                                                                                                                                             | vitest `policy`              |
| A      | Carrera con un ayudante de fondo que sigue escribiendo                                                                               | 409 si hay hijas o trabajos vivos                                                                                                                                                                                                                      | R-8                          |
| A      | Fuga de contenido sensible por la lista de turnos                                                                                    | Solo rutas y cifras; `scrubDiffLists` en el celular; parche X                                                                                                                                                                                          | vitest `event-trim`/`policy` |
| B      | Contenido reinyectado con instrucciones (habilidad o AGENTS.md hostil)                                                               | Misma confianza que hoy (ya entraban); topes; solo dentro del proyecto                                                                                                                                                                                 | C-4                          |
| B      | `PostCompact` como vía de ejecución                                                                                                  | Solo el archivo de la app (`LAZUNOX_HOOKS_FILE`), apagado por defecto, tiempo y salida acotados                                                                                                                                                        | unitaria                     |
| B      | Compactar con un permiso/formulario pendiente o revert pendiente                                                                     | 409 en la ruta; la app deshabilita con motivo                                                                                                                                                                                                          | C-2                          |
| B      | `upTo` desde el celular                                                                                                              | `hasOnly(['providerID','modelID','auto'])` ya lo niega; prueba explícita                                                                                                                                                                               | vitest `policy`              |
| B      | Resumen que pierde una restricción de la persona                                                                                     | Reinyección + evaluación (2.B.6)                                                                                                                                                                                                                       | C-6/C-7, eval                |

## 4. Fases (cada una: un commit por repo, revertible con `git revert`; interruptor por variable)

**R0. Motor: arreglos de seguridad de instantáneas (sin cambio visible).**

- Fork: `snapshot/index.ts` (comprobar el objeto con `cat-file -e` antes de decidir «no existía»; `remove` con la guardia de rutas de 2.A/3; `restoreFiles(árbol, archivos)` nuevo), `session/revert.ts` (`unrevert` solo con los archivos del revert).
- `bun test test/lazunox/snapshot-seguro.test.ts`: árbol podado (`gc --prune=now`) → no borra nada y da error; enlace simbólico intermedio → no borra fuera; `unrevert` no pisa un archivo que la persona cambió y que el revert no tocó. Pasan `test/snapshot/snapshot.test.ts` y `test/session/revert-compact.test.ts`.
- Hecho: las tres pruebas fallan antes y pasan después (VPS). Revertir: commit.

**R1. Motor: puntos de control duraderos y turnos.**

- Fork: `snapshot/index.ts` (`keep(ref, árbol)`, `forget(prefijo)`, `numstat(from, to)`), `session/turnos.ts` (nuevo: lista ligera, origen, caché, topes), `session/summary.ts:102-127` (crear la ref al terminar el turno), borrado de refs al borrar la sesión (`session/session.ts`), rutas en `server/routes/instance/httpapi/groups/experimental.ts` (+ handler), `LAZUNOX.md`.
- `bun test test/lazunox/turnos.test.ts`: tope 100 (la 101 borra la más vieja), refs sobreviven a `gc --prune=now`, origen `herramienta`/`comando`/`otro`, carpeta sin git → `restaurable:false`, 500 archivos → `truncated`.
- Probe: R-1 (`edit` + `bash` en un turno → 2 archivos, orígenes correctos), R-2 (diff de un archivo ≤ 1 MB, contexto 3).
- Hecho: dirigidas + R-1/R-2 verdes; `run.mjs` completo igual que antes. Revertir: commit; en caliente `LAZUNOX_REBOBINAR=0`.

**R2. Motor: rebobinar con modos, revisión previa y deshacer.**

- Fork: `session/rebobinar.ts` (nuevo, usa `SessionRevert` y `Snapshot`), `session/revert.ts` (`files?: boolean`), nota sintética para el modo `codigo` (guardada con `Storage` y consumida en `session/prompt.ts` al crear el siguiente mensaje), rutas `GET …/rebobinar/{messageID}`, `POST …/rebobinar`, `POST …/rebobinar/deshacer`.
- `bun test test/lazunox/rebobinar.test.ts`: tres modos, conflictos saltados salvo `sobrescribir`, protegidos, 409 con hija ocupada/trabajo vivo/permiso pendiente, `commitsDespues`, deshacer.
- Probe (arnés con `sc.git: true`): R-3 turno de hace «8 días» (fecha simulada + `gc`) se restaura; R-4 la persona edita tras el turno → conflicto, no se pisa; R-5 `deshacer` deja el árbol igual al de antes; R-6 enlace simbólico a `/tmp` → nada fuera cambia; R-7 `.mcp.json` saltado por defecto; R-8 ayudante de fondo vivo → 409; R-9 modo `codigo` → la siguiente petición al modelo lleva la nota.
- Hecho: todo verde en el VPS. Revertir: commit; `LAZUNOX_REBOBINAR=0`.

**R3. App: «Cambios de este turno» y diálogo de rebobinar.**

- `src/shared/engine/types.ts` + `adapters/engine1.ts` (`turnos`, `rebobinar*` por `fetch` crudo), `resources/opencode-bin/api-routes.json` (regenerar), `src/main/remote/policy.ts` (`turnos` y revisión previa R con ámbito; resto en `HTTP_X_ROUTES`), `features/code/impl/TurnChangesCard.tsx` y `RewindDialog.tsx` (nuevos), `MessageStream.tsx` (tarjeta al final del turno; «Revertir» abre el diálogo), `store.ts` (acciones `loadTurns`, `rewind`, `undoRewind`; recarga por `session.diff`), i18n `code.turn.*`/`code.rewind.*` y nuevo `code.msg.revertBody`, `CHANGELOG-FASE8.md` (`F8-B<n>`), `docs/SEGURIDAD.md`.
- vitest: tarjeta (lista, +/−, origen, truncado, celular solo lectura), diálogo (modos, avisos, casillas desmarcadas, sin git → solo conversación, 404 → Revertir de hoy), `policy.test.ts`, `event-trim`, contrato del adaptador, guardias i18n/`visible-terms`; E2E de Code con el OpenCode falso (añadir rutas a `e2e/fake-opencode`).
- Hecho: dirigidas + `typecheck`/`lint`/`build`/`test:transform` + spec E2E. Revertir: commit.

**R5 (opcional, después). Instantáneas en carpetas sin git** detrás de `LAZUNOX_SNAPSHOT_SIN_GIT=1`, con exclusiones de `restore-points.ts:141` y topes de 20 000 archivos. Solo si Ben lo pide tras medir.

**C1. Motor: momento seguro, aviso y parcial.**

- Fork: `handlers/session.ts:273-292` (409 por ocupada/pendientes/revert pendiente; `upTo`), `groups/session.ts:65-69` (`upTo` opcional), `session/compaction.ts` (`create` con `manual_tail`, `process` sin `select` en parcial, tope de cola, métricas), `schema/src/v1/session.ts` (`manual_tail`, `lazunox`), `schema/src/session-compaction-event.ts` (campos opcionales), `LAZUNOX.md`.
- `bun test test/lazunox/compactacion-parcial.test.ts` (+ `test/session/compaction.test.ts` pasa): cabeza exacta hasta `upTo`, cola intacta, `upTo` inválido → error, cola demasiado grande → error, métricas en evento y parte, 409.
- Probe: C-1 `upTo` = 3er mensaje → la petición de resumen solo contiene los 2 primeros turnos y la siguiente petición lleva los últimos íntegros; C-2 permiso pendiente → 409; C-3 evento con `tokensAntes > tokensDespues`.
- Hecho: verde en el VPS. Revertir: commit.

**C2. Motor: reinyección y `PostCompact`.**

- Fork: `session/compaction.ts` (bloque `<contexto-vigente>` tras resumir, presupuesto), `packages/plugin` (tipo del disparador `experimental.session.compacted`), `plugin/lazunox-ganchos.ts` (`PostCompact` en `Config`, `leerConfig`, disparador), `LAZUNOX.md`.
- `bun test test/lazunox/compactacion-reinyeccion.test.ts`: tareas, habilidad cargada, AGENTS.md de subcarpeta, trabajo de fondo vivo, tope de 16 KB, salida de `PostCompact`, nada de esto si la lista está vacía.
- Probe: C-4 tras compactar, la petición siguiente lleva la habilidad y el AGENTS.md de `sub/`; C-5 `PostCompact` escribe un marcador que llega al modelo; C-6 tareas presentes tras dos compactaciones seguidas.
- Hecho: verde en el VPS. Revertir: commit; el bloque se apaga con `LAZUNOX_COMPACT_REINYECTAR=0`.

**C3. App: aviso de compactación, «Compactar hasta aquí» y ajustes.**

- `features/code/impl/CompactionCard.tsx` (nuevo; Chat lo reutiliza), `MessageStream.tsx` (renderizar la parte `compaction` en vez de ocultarla; acción «Compactar hasta aquí» en el menú del mensaje, con confirmación), `store.ts` (`compactSession(sessionID, upTo?)` con modelo explícito; deshabilitar con revert pendiente/permiso), `features/chat/ChatMessageList.tsx` + `chat/actions.ts`, `src/shared/user-hooks.ts` (`PostCompact`) y textos de ganchos en `settings.ts`, i18n `code.compaction.*`, `CHANGELOG-FASE8.md`.
- Tarjeta: «Se resumieron 48 mensajes · contexto ≈152 000 → ≈21 000 tokens (≈131 000 liberados) · Se mantuvieron: plan (5), 2 habilidades, 1 instrucción de carpeta, 1 ayudante activo» + «Ver resumen».
- vitest: tarjeta (con y sin métricas: motor viejo), menú deshabilitado con motivo, `user-hooks` acepta `PostCompact`, guardias i18n. E2E de Code con el falso emitiendo `session.compacted` ampliado.
- Hecho: dirigidas + `typecheck`/`lint`/`build`/`test:transform` + spec. Revertir: commit.

**C4. Calidad.** `scripts/engine-probe/run.mjs` C-7 (falso determinista: 12 hechos sembrados aparecen en el cuerpo de la petición de resumen y el bloque reinyectado está en la siguiente); `scripts/compaction-eval/run.mjs` + `fixtures/*.json` (manual, VPS, modelo gratuito; informe en `docs/` con la cifra base del motor actual y la nueva). Hecho: informe con mediana ≥ 80 % y ≥ base.

**V. Verificación final con modelo real** (sección 6).

## 5. Tareas para agentes en paralelo

Orden: (T1, T2) en paralelo → (T3, T5) → T4 (parte de integración) → T6. Cada agente en su worktree y rama, `git add` por rutas, commit en español con su prueba. Pruebas del fork en el VPS (`rsync` excluyendo `.github`, luego `/opt/lzx-test.sh /opt/lzx-fork/src "<pruebas>"`). Nada de `bun test` completo ni compilaciones en el Mac. **Ninguna tarea toca zonas intocables**; si alguna lo necesitara, se para y lo avisa (revisión independiente + `npm run zonas:actualizar`). `policy.ts` no es zona pero es de seguridad: toda clase nueva con prueba.

**T1 — Motor: rebobinar (R0, R1, R2).** Sin dependencias.

- Objetivo: secciones 2.A.1-7 y 2.A.10. Tres commits (arreglos, turnos, rebobinar).
- Archivos: `snapshot/index.ts`, `session/revert.ts`, `session/summary.ts`, `session/turnos.ts` y `session/rebobinar.ts` (nuevos), `session/session.ts` (borrar refs), `session/prompt.ts` (solo consumir la nota del modo `codigo`), `groups/experimental.ts` + handler, `test/lazunox/*`, sección propia en `LAZUNOX.md`.
- Contrato fijo: rutas `GET /experimental/session/{sessionID}/turnos`, `GET …/turnos/{messageID}/diff?file=`, `GET …/rebobinar/{messageID}`, `POST …/rebobinar`, `POST …/rebobinar/deshacer`; formas exactas de 2.A.3-4; variables `LAZUNOX_REBOBINAR`, `LAZUNOX_CHECKPOINTS_MAX` (100).
- Restricciones: R0 primero y con prueba que falle antes; nunca borrar si falta un objeto; nada de `checkout-index -a`; nada sobre `.git` de la persona salvo lecturas; guardia de rutas en TODA escritura/borrado.
- NO tocar: `session/compaction.ts`, `handlers/session.ts` (`summarize`), `schema/src/v1/session.ts`, la app.
- Hecho: dirigidas verdes en el VPS; binario `linux-x64` compilado en el contenedor para T5.

**T2 — Motor: compactación (C1, C2).** Sin dependencias.

- Objetivo: secciones 2.B.1-5. Dos commits.
- Archivos: `session/compaction.ts`, `handlers/session.ts:273-292`, `groups/session.ts:65-69`, `schema/src/v1/session.ts`, `schema/src/session-compaction-event.ts` (+ inventario de eventos), `packages/plugin` (tipo), `plugin/lazunox-ganchos.ts`, `test/lazunox/*`, sección propia en `LAZUNOX.md`.
- Contrato fijo: `summarize { providerID, modelID, auto?, upTo? }`; 409 con `{ motivo: 'ocupada'|'pendiente'|'revert' }`; `session.compacted { sessionID, auto?, parcial?, mensajes?, tokensAntes?, tokensDespues?, reinyectado? }`; parte `compaction.lazunox` con lo mismo; disparador `experimental.session.compacted`; evento de ganchos `PostCompact`; variable `LAZUNOX_COMPACT_REINYECTAR`.
- Restricciones: no reinyectar lo que ya va en el sistema; presupuesto 16 KB; el evento lleva etiquetas, nunca contenido; sin `upTo` el comportamiento es el de hoy (pasa `test/session/compaction.test.ts` sin cambios).
- NO tocar: `snapshot/`, `session/revert.ts`, `session/prompt.ts`, la app.
- Hecho: dirigidas verdes en el VPS.

**T3 — App: tarjeta de turno y diálogo (R3).** Depende del contrato de T1 (empieza con datos falsos; `api-routes.json` al final con el motor de T1).

- Archivos: los de R3. Es DUEÑA de `MessageStream.tsx`, `store.ts` y `src/shared/i18n/{es,en}/code.ts` hasta fusionar.
- Restricciones: textos honestos (comandos, sin git, commits); conflictos y protegidos desmarcados; celular solo lectura y rutas nuevas X (`HTTP_X_ROUTES`), prueba explícita; si el motor responde 404, el Revertir de hoy sigue igual; accesible (axe en la prueba del diálogo).
- NO tocar: zonas intocables, preloads, CSP, Tareas (`restore-points.ts`, `features/tasks`), el fork.
- Hecho: dirigidas + `typecheck`/`lint`/`build`/`test:transform` + spec E2E.

**T4 — App: compactación visible y ganchos (C3).** Depende del contrato de T2. En paralelo con T3 SOLO en archivos propios: `CompactionCard.tsx`, `features/chat/*`, `src/shared/user-hooks.ts`, `settings.ts` (es/en). La integración en `MessageStream.tsx`, `store.ts` y `code.ts` se hace **después** de fusionar T3 (rebase), en un commit aparte.

- Restricciones: con un motor sin métricas la tarjeta dice solo «Se resumió la conversación»; «Compactar hasta aquí» deshabilitado con motivo si hay revert pendiente o la sesión está ocupada; siempre manda `providerID/modelID`.
- Pruebas: vitest de C3, `user-hooks.test.ts`, E2E de Code con el falso.
- NO tocar: zonas intocables, `policy.ts` (no hace falta: `upTo` ya queda negado; solo añadir la prueba en `policy.test.ts`), el fork.
- Hecho: dirigidas + `typecheck`/`lint`/`build`/`test:transform`.

**T5 — Comprobaciones del motor real y evaluación (R-1..R-9, C-1..C-7, C4).** Depende de T1 y T2 para que pasen; se escribe en paralelo.

- Archivos: `scripts/engine-probe/harness.mjs` (`sc.git: true` = `git init` + commit inicial en `proj`; recoger el cuerpo de la petición de resumen; reloj simulado para R-3 con `GIT_COMMITTER_DATE`), `run.mjs` (`PROBE_ONLY=rebobinar|compactar`), `scripts/compaction-eval/` (nuevo).
- Restricciones: sin red ni modelo en `run.mjs`; la evaluación usa solo un modelo gratuito y corre en el VPS; las comprobaciones existentes no cambian de resultado.
- NO tocar: `src/`, el fork.
- Hecho: `node scripts/engine-probe/run.mjs <motor de T1+T2>` todo verde; informe de la evaluación (base y nueva).

**T6 — Revisión independiente y verificación final (V).** Depende de todo.

- Un agente que no escribió T1 revisa R0/R2 (rutas, enlaces, borrado, `.git`) y T2 (409, reinyección, `PostCompact`); anota el resultado en el commit de cierre. Luego la receta de la sección 6; solo la nota de resultados en este documento.
- Restricciones: perfil temporal siempre; no publicar; matar sus procesos al terminar.

## 6. Verificación final con modelo real

Receta (Mac; Windows igual con `scripts/win/` si Ben lo pide):

1. Motor compilado en el VPS (`docker run --rm -v /opt/lzx-fork:/w oven/bun:1.3.14 bash /w/targets.sh darwin-arm64`), `node scripts/engine-probe/run.mjs <motor>` verde.
2. App de desarrollo con perfil temporal (`--user-data-dir=$(mktemp -d)`, borrarlo al terminar; nunca el perfil real), `LAZUNOX_TEST_BUNDLED_DIR` apuntando al motor nuevo y `--remote-debugging-port=9333`.
3. Proveedor gratuito (OpenCode Zen, modelo gratuito) desde Ajustes. Proyecto de prueba en `mktemp -d` con `git init`, 3 archivos y un commit.
4. Por CDP, rebobinar: «crea a.txt con hola y ejecuta `echo x > b.txt`» → tarjeta con 2 archivos (`herramienta` y `comando`). Segundo turno: «cambia a.txt a adiós». Editar a mano `a.txt` desde la terminal → diálogo del primer turno: muestra el conflicto desmarcado y el aviso de comandos; «Solo código» → `b.txt` desaparece, `a.txt` con tu edición intacta, los mensajes siguen; «Deshacer» → todo como antes. «Código y conversación» → mensajes ocultos y archivos restaurados. Carpeta sin git → solo «Solo conversación».
5. Compactación: conversación larga con el modelo gratuito (pegar 3 archivos grandes, cargar una habilidad, crear 4 tareas, lanzar un ayudante de fondo) → «Compactar hasta aquí» sobre el penúltimo mensaje → tarjeta con mensajes resumidos, tokens liberados y lo reinyectado; preguntar «¿cuáles son las tareas pendientes y qué dice la habilidad X?» → respuesta correcta. Con un permiso pendiente, el menú está deshabilitado con motivo. Gancho `PostCompact` de prueba deja su marcador.
6. Celular solo si Ben lo pide: la tarjeta se ve, rebobinar no aparece.

Medición: anotar aquí tiempo de `turnos` y de la revisión previa en un repo grande (p. ej. un clon de este repositorio, ~10 000 archivos): criterio < 1 s y < 3 s; y la evaluación de C4 (base vs nueva).

## 7. Riesgos y lo que se pospone

Riesgos:

- Las refs duraderas hacen crecer el repo de instantáneas (100 turnos × sesiones). Mitigación: tope por sesión, borrado con la sesión, y anotar el tamaño en la verificación; si pasa de ~1 GB por proyecto, bajar el tope.
- El diff del turno mezcla cambios de la persona y de otras conversaciones en la misma carpeta: se etiqueta `otro` y los conflictos se detectan solo si ocurren **después** del turno. Límite aceptado y dicho en el diálogo.
- `commitsDespues` usa fechas: un commit con fecha falsa puede escapar. Solo es un aviso; nunca se toca git.
- Modelos gratuitos pequeños pueden resumir peor con el bloque reinyectado (más contexto). Mitigación: presupuesto e interruptor `LAZUNOX_COMPACT_REINYECTAR=0`; medir en C4.
- La nota sintética del modo `codigo` puede confundir al modelo si la persona cambia de tema; se manda una sola vez.
- `store.ts:1528` llama a `summarize` sin modelo: si el motor lo rechaza hoy, «Compactar historial» ya está roto; comprobar en T4 primero.

Se pospone: instantáneas sin git (R5); rebobinar desde el celular (y revisar si el `revert` M de hoy debe pasar a D); rebobinar en Tareas con estas rutas (sigue con sus puntos propios); compactación en segundo plano; «resumir del mensaje elegido en adelante»; deshacer efectos externos de comandos (imposible en general); `/diff` de toda la sesión agrupado por turnos en el panel Cambios.
