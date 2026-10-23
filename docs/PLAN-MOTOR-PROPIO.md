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
| 3.2 | Release del motor en GitHub | Hecho: `v1.19.0-lazunox.1` (verificada: las 3 huellas coinciden) |
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

## Paso 4 — funciones propias (lo de OpenCode 2.0), dentro del motor

Orden:

1. **Subagentes en segundo plano.** La función ya está en 1.19 tras `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS`. En el motor nuestro: activa por defecto (sin variable). En la app: lista de trabajos de fondo, botón «mandar al fondo» (`POST /experimental/session/{id}/background`), cancelar, tope de simultáneos, permisos de las sesiones hijas, plan-gate verificado con la hija.
   *Hecho ya en la app (sin publicar):* por defecto encendidos (`src/shared/engine-experiments.ts`) y pruebas ajustadas.
2. **Shell en segundo plano nativo.** En 1.19 el comando se mata a los 2 min. En el motor: parámetro `background` en `tool/shell.ts`, `BackgroundJob`, archivo de salida con tope, herramienta leer/matar, aviso al terminar, matar el grupo de procesos al cerrar. Ya existe `bgshell` en la app (`src/main/background-shell`, «listo para conectar»): revisar qué cubre y decidir si el motor lo reemplaza o solo se integra; no duplicar.
3. **`permission.ask` cableado** en `Permission.ask` (hoy el gancho está tipado y no se dispara); lo usa `lazunox-plan-gate`.
4. **Code Mode** (`OPENCODE_EXPERIMENTAL_CODE_MODE`): detrás de un ajuste y tras probar; **no** se porta el `fetch` sin permiso de 2.x.
5. Otras ideas de 2.x, solo si hacen falta: diff por turno, «siempre permitir» por proyecto, compactación.

Cada función: pruebas `bun test` en el fork, 27 comprobaciones del `engine-probe` ampliadas, prueba con la app real por CDP (modelo gratuito), Mac y Windows.

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
