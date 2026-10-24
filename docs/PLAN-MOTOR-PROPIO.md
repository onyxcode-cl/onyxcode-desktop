# Plan del motor propio de Lazunox

Fecha: 2026-10-23. Decisión de Ben (dicha varias veces): **OpenCode 1.19.0 es la base congelada; de ahí en adelante el motor es nuestro** y Lazunox deja de depender de OpenCode.
Este documento es el plan único. Si algo cambia, se cambia aquí y se avisa; no se improvisa en el chat.

## Reglas

1. El motor vive en `onyxcode-cl/lazunox-motor` (repo propio). Todo cambio al motor va ahí, en commits propios encima de la etiqueta `upstream-v1.19.0`.
2. La app descarga **nuestro** binario (`resources/opencode-bin/pin.json`), con tamaño y SHA-256 verificados antes de descomprimir.
3. No se sigue a OpenCode. Arreglos de seguridad o de proveedores suyos se portan a mano, por commit, con revisión.
4. Cada paso: probado ANTES de publicar (VPS para lo pesado, Windows real para el `.exe`). Nada de «publico y después pruebo».
5. Lo irreversible o público (releases, push, publicar versión) lo confirma Ben.

## Estado

| Paso | Qué | Estado |
|---|---|---|
| 1 | Fork con la base 1.19.0 + LICENSE + `LAZUNOX.md` | Hecho |
| 2 | Compilar desde el código fuente, repetible | Hecho (3 plataformas idénticas byte a byte) |
| 3.1 | Quitar conexiones a servicios de OpenCode | Hecho, con prueba que lo vigila (`test/lazunox/sin-red-de-opencode.test.ts`) |
| 3.2 | Release del motor en GitHub | Hecho: `v1.19.0-lazunox.1` a `v1.19.0-lazunox.7` (pausa y espera de Code Mode, identidad Lazunox en los textos del modelo; verificadas: las huellas coinciden con lo publicado) |
| 3.3 | `pin.json` apunta a nuestra release | **Pendiente** (el permiso del sistema lo bloqueó; ver «Bloqueado») |
| 3.4 | Probar el motor nuestro en la app real | Pendiente (Mac y Windows) |
| 3.5 | Renombrar para que no diga «OpenCode» | Pendiente, por etapas |
| 4 | Funciones propias en el motor | Pendiente |
| 5 | Mantenimiento mensual | Pendiente |

## Paso 3.3 — que la app use nuestro motor

1. Editar `pin.json` con las URLs y huellas de la release (darwin-arm64 `d8fdaea1…`, win32-x64 `f136e56a…`, linux-x64 `f00e8b9f…`).
2. `node scripts/fetch-opencode.mjs` en el Mac (verifica tamaño y SHA-256) y `npm run check:opencode` + `node scripts/engine-probe/run.mjs`.
3. El `.exe`: instalarlo en el PC Windows y pasar el contrato y las comprobaciones allí.
4. `verify:bundled`, smoke de arranque, `pack-check.ps1` en Windows.
5. El binario de macOS lleva firma ad-hoc de la compilación cruzada; la app lo vuelve a firmar con el certificado estable (ya hace eso con el motor oficial).
6. El WSL (`linux-x64`) usa el mismo pin: probar que el rootfs/bundle de WSL sigue funcionando con el binario nuevo.
7. Ajustar `docs/ACTUALIZAR-OPENCODE.md` y `THIRD_PARTY_NOTICES.md` (el motor ahora es un fork propio, MIT, con el copyright de OpenCode conservado).

## Paso 3.5 — renombrar (por etapas, cada una con pruebas)

Lo que la app usa hoy y no se debe romper a ciegas: nombre del binario `opencode`/`opencode.exe`, variables `OPENCODE_*`, carpeta de datos (`opencode.db`), API HTTP.
Etapas: (a) textos que ve el usuario (ayuda, `--version`, prompts del sistema que dicen «OpenCode»); (b) nombre del binario, con cambio en `fetch-opencode`, `motor-app`, `verify-*`; (c) variables `LAZUNOX_*` con alias a las `OPENCODE_*` un tiempo; (d) carpeta de datos, con migración. La API HTTP y el SDK no se renombran (rompería el contrato).

**Decisión 2026-10-24 (medida, no supuesta):** la etapa (a) ya está hecha. Lo que queda (b, c, d) casi no se ve: la carpeta de datos ya vive dentro de `Application Support/Lazunox/opencode-data`, y el binario solo aparece como `opencode` dentro de la mini-app «Lazunox Motor». A cambio tocaría ~100 referencias al binario y ~50 a las rutas de datos, y (d) pone en riesgo las sesiones guardadas (`opencode.db`). Se deja para una versión aparte y, si se hace, en este orden: (c) alias `LAZUNOX_*` → `OPENCODE_*` (barato, sin migrar nada), (b) nombre del binario, y (d) solo con copia de seguridad y prueba de migración con datos reales. Mientras tanto no se renombra nada.

## Paso 4 — traer TODAS las funciones útiles de OpenCode 2.x al motor nuestro, y mejorarlas

Objetivo de Ben (2026-10-23): partir de la base 1.19 y habilitar dentro del motor las funciones nuevas de OpenCode 2.0, mejorándolas, para Lazunox. No se migra a 2.x ni se usa su código tal cual:
se reimplementan sobre la base 1.19 (modelos de datos distintos), conservando la licencia MIT y el aviso de copyright de OpenCode en lo que se copie (`THIRD_PARTY_NOTICES.md`).
Fuente de referencia: `docs/ANALISIS-OPENCODE-2-FUNCIONES.md` (con rutas y líneas de 2.x).

| # | Función de 2.x | En 1.19 hoy | Qué hacemos en el motor | Mejora nuestra sobre 2.x |
|---|---|---|---|---|
| 1 | Subagentes en segundo plano | Está, tras bandera experimental | Activa por defecto en el motor; endpoint «mandar al fondo» ya existe | Tope de simultáneos; cancelar al cerrar sesión/app; permisos de las hijas visibles; el plan-gate resuelve la hija; (opcional) sobrevivir a reinicios con marcador en disco |
| 2 | Shell en segundo plano ✅ (1.6.3) | No existía (mata a los 2 min) | `background` en `tool/shell.ts` + `BackgroundJob` + archivo de salida + leer/matar + aviso de fin que despierta la sesión | Tiempo máximo también en segundo plano (2.x no pone ninguno), matar el grupo de procesos, tope de salida y retención, dentro del sandbox de la sesión, mismo filtro de entorno que `lazunox-env`. Revisar el `bgshell` que ya tiene la app para no duplicar |
| 3 | Aviso sintético que despierta la sesión (`<subagent>`, `<shell>`) | Parcial (subagentes) | Unificar el mecanismo para subagentes y shell | Marcar el texto como no confiable y pasarlo por la puerta del plan (es un canal de inyección) |
| 4 | Code Mode | Está (solo MCP, sin `fetch`), tras bandera | Activo detrás de un ajuste de Lazunox | Límites por defecto (`timeoutMs`, `maxToolCalls`, `maxOutputBytes`, que 2.x no fija); NO traer el `fetch` sin permiso; el «siempre» no aprueba la herramienta entera |
| 5 | Gancho `permission.ask` / `permission.evaluate` | Tipado pero no se dispara | Cablearlo en `Permission.ask` | Lo usa el plan-gate; sustituye parches actuales |
| 6 | Gancho `shell.create.before` (entorno mutable) | `shell.env` ya existe | Mantener `shell.env`; añadir cwd/timeout mutables si hace falta | — |
| 7 | Permisos «siempre» guardados por proyecto (persisten) | En memoria de la instancia | Guardar en disco por carpeta | Revocables desde ajustes; nunca para acciones de `NEVER_ALONE_PERMISSIONS` |
| 8 | Diff por turno | No | Evaluar sobre el sistema de puntos de restauración que ya tiene Lazunox | Reusar nuestros restore points |
| 9 | Compactación de sesión mejorada | Básica | Evaluar tras medir | — |
| 10 | Reanudar trabajos tras reinicio | No | Solo marcadores (cancelar con aviso claro, como 2.x para shell) | Aviso visible en la UI |
| 11 | Proveedores/modelos nuevos | Se portan a mano cuando haga falta | Por commit | — |

**No se traen:** servicio compartido por usuario (rompe el sidecar por carpeta con Seatbelt/WSL), demonio PTY persistente (Lazunox tiene su PTY), SDK en proceso, credenciales en SQLite sin cifrar, `fetch` de Code Mode sin permiso.

### Hecho el 2026-10-23 (probado)

- Motor nuestro en la app: pin apuntando a `v1.19.0-lazunox.1`, contrato y 27 comprobaciones OK en Mac; el `.exe` arranca en Windows sin conexiones externas.
- Subagentes en segundo plano: encendidos por defecto en la app. Probado en la app real empaquetada (Mac, modelo gratuito): el ayudante corrió en segundo plano, apareció en «Trabajos en segundo plano» con botón Cancelar y al terminar despertó la conversación con el resultado.
- Code Mode con límites por defecto (300 s, 200 llamadas, 1 MB; variables `LAZUNOX_CODE_MODE_*`). Al llegar a un límite el script se corta pero **lo hecho no se deshace** y el error le dice al modelo qué ya se obtuvo (pruebas en `packages/codemode/test/lazunox-limites.test.ts`).
- Investigado (2026-10-23): Claude (API) limita 90 s por celda, ~4 min por llamada pendiente y conserva el estado entre celdas; Codex no mata el script, lo **pausa** («Script running» + `wait`/terminar, salida final con tope de 10 000 tokens).

### Hecho (1.6.1): pausa y espera para Code Mode (lo mejor de Codex y Claude)

En vez de cortar al pasarse el tiempo, el script sigue vivo: `execute` devuelve «script en curso» con un `cell_id` y el modelo usa `execute_wait` (esperar más / leer lo avanzado / terminar). Implementado en el motor (`execute` con `yield_ms` + `execute_wait`): la celda corre como trabajo en segundo plano con señal de cancelación propia (la del turno se dispara al terminar la respuesta), tope de 3 celdas vivas, y el guardián de subagentes de la app mantiene el seguimiento de permisos mientras la celda vive. Probado: `bun test` del fork, 29 comprobaciones de `engine-probe` contra el motor real. Pendiente: probar a mano `execute_wait`/`terminate` con un conector real en la app, y que la app muestre la celda en «Trabajos en segundo plano».

Orden de trabajo: 1 → 2 (+3) → 5 → 4 → 7 → 8 → 10 → 9/11 según haga falta.
Cada función: pruebas `bun test` en el fork, ampliar `scripts/engine-probe` (que sigan pasando las 27 y se sumen las nuevas), prueba con la app real por CDP (modelo gratuito) en Mac y Windows, y su nota en `CHANGELOG.md` y `docs/SEGURIDAD.md`. La parte visual (lista de trabajos de fondo, botones, tarjetas) va en la app y se prueba aparte.

### Hecho el 2026-10-24 (1.7.1 y 1.7.2, probado con la app real)

- Acentos correctos en PowerShell de Windows (lazunox.6/7). `cmd` sigue sin arreglo (límite conocido).
- Rutas protegidas (`.git`, `.opencode`, `.claude`, `.vscode`, `.mcp.json`…): editar SIEMPRE pregunta, sin «siempre» ni plugin que lo levante (tabla fila 7 y comparativa #1).
- Permisos «siempre» persistentes por carpeta (fila 7), apagados salvo que la app los encienda; nunca el comodín en herramientas propias.
- Tope de ayudantes en segundo plano (`LAZUNOX_MAX_SUBAGENTS`, defecto 8).
- Ganchos de usuario por comando (`PreToolUse`, `PostToolUse`, `PreCompact`, `Stop`) desde el archivo que fija la app (`LAZUNOX_HOOKS_FILE`), con pantalla en Ajustes.
- En el fork, rama `feat/compactacion` (sin publicar): la lista de tareas de la sesión viaja en el contexto del resumen (fila 9, parcial).
- Comparativa con Claude Code, Codex y OpenCode 2.x: `docs/COMPARATIVA-MOTOR.md`. Pendiente de ella: lista de dominios para el shell, subagentes con worktree, tareas programadas, búsqueda diferida de herramientas.
- Zonas intocables: se hacen cumplir por prueba (`docs/zonas-intocables.json`), ya no por lectura del dueño.

## Paso 5 — mantenimiento

Revisión mensual de avisos de seguridad (Bun, `@ai-sdk/*`, `hono`, `effect`, MCP SDK) y de proveedores; portar lo necesario por commit; registrar en `LAZUNOX.md`. Criterio de salida: si cuesta más de ~1 semana al mes, reevaluar.

## Bloqueado / necesita a Ben

- **`pin.json`**: el clasificador de permisos de Claude Code rechaza la edición. Ben debe permitirla (regla de permiso para Bash o Edit sobre `resources/opencode-bin/pin.json`) o editarla él.
- **Publicar una versión de la app** con el motor nuevo: decisión de Ben después de las pruebas del paso 3.4.

## Riesgos conocidos

- Parches de seguridad de proveedores/Bun: son nuestros desde ahora.
- El binario de macOS se firma ad-hoc en el VPS y se re-firma en la app; el hash de la release no es el del binario ya re-firmado.
- Windows: el `.exe` aún no se ha ejecutado.
- El Mac de Ben se satura con compilaciones: todo lo pesado va al VPS.
