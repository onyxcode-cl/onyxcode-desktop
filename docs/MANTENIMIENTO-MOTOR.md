# Mantenimiento mensual del motor propio

El motor de Lazunox es una copia de OpenCode 1.19.0 (`onyxcode-cl/lazunox-motor`) que **no sigue** a OpenCode: lo que ellos corrijan se porta a mano.
Este documento es la rutina. Marco general: `docs/PLAN-MOTOR-PROPIO.md` (paso 5). Presupuesto: ~2-4 días al mes; si pasa de ~1 semana, reevaluar (volver a seguir a 2.x: `docs/SPIKE-OPENCODE-2.md`).

## 1. Revisión mensual (primer lunes de cada mes; 1-2 horas)

1. **Avisos de seguridad de lo que lleva dentro el binario** (se compila con Bun y arrastra dependencias): Bun (<https://github.com/oven-sh/bun/security/advisories> y notas de versión), `hono`, `effect`, `@modelcontextprotocol/sdk`, `@ai-sdk/*`, `web-tree-sitter`, `drizzle`. Comando de apoyo en el fork: `bun audit` dentro de `packages/opencode` (en el servidor, imagen `oven/bun`).
2. **OpenCode (upstream)**: avisos de seguridad de `anomalyco/opencode` (pestaña Security) y publicaciones 1.19.x / 2.x. Solo interesa lo que arregle una vulnerabilidad o un proveedor/modelo que Lazunox use. Las funciones nuevas NO se siguen.
3. **Proveedores**: ¿algún proveedor que usa la gente cambió su API (Anthropic, OpenAI, Google, OpenRouter, DeepSeek, OpenCode Go)? Se nota por errores en la app; probar un mensaje corto con cada uno.
4. **Resultado**: anotar en `LAZUNOX.md` del fork una línea con la fecha, qué se revisó y qué se portó (o «sin novedades»).

## 2. Cómo portar un arreglo de upstream

1. En el fork: `git fetch https://github.com/anomalyco/opencode.git <rama-o-etiqueta>` y localizar el commit del arreglo.
2. `git cherry-pick -x <commit>` sobre `main` del fork (el `-x` deja escrito de dónde viene). Si hay conflicto, resolverlo a mano; lo que no se entienda no se porta.
3. Probar en el servidor (no en el Mac): sincronizar a `/opt/lzx-fork/src` y correr `/opt/lzx-test.sh /opt/lzx-fork/src "<pruebas>"` (tipos + `bun test`).
4. Añadir una prueba que falle sin el arreglo, cuando se pueda.
5. Seguir el ciclo de la sección 3.

## 3. Ciclo de una versión nueva del motor (probado el 2026-10-23)

1. Compilar en el servidor, tres plataformas, dos veces cada una: `build-targets-vps.sh` (`/opt/lzx-fork/targets.sh darwin-arm64 win32-x64 linux-x64`, dentro de un contenedor `oven/bun:1.3.14`).
2. `scripts/fork-motor/armar-release.sh vX.Y.Z-lazunox.N <carpeta>`: exige que las dos compilaciones sean idénticas, firma ad-hoc el de macOS y calcula huellas.
3. `node scripts/engine-probe/run.mjs <carpeta>/d/opencode` (todas las comprobaciones deben pasar) y `node scripts/check-opencode.mjs --bin <carpeta>/d/opencode`.
4. `scripts/fork-motor/publicar-motor.sh vX.Y.Z-lazunox.N <carpeta>`: crea la release pública, verifica las huellas bajándola de nuevo y apunta `resources/opencode-bin/pin.json`. **Lo corre una persona** (crea algo público).
5. Actualizar `src/main/tasks/backends/wsl-real-pin.test.ts` (huella y tamaño de Linux), el staging de WSL (`npm run stage:wsl-bundle`; en el PC Windows copiar el `.tar.gz` a `C:\onyx\staging` y `C:\onyx\wt\resources\wsl-images` y borrar `C:\onyx\wt\resources\opencode-bin\bin`), subir la versión de la app y su `CHANGELOG.md`.
6. Flujo normal de publicación de la app: `scripts/release.sh prepare|mac|win|draft|publish X.Y.Z` (`docs/RELEASE.md`), probando ANTES de publicar.

## 4. Cosas que ya nos mordieron (no repetir)

- Una herramienta nueva del motor hay que **registrarla también en la lista `builtin`** de `tool/registry.ts`, si no el modelo nunca la recibe (las pruebas unitarias no lo ven; `engine-probe` sí).
- `fetch-opencode --if-missing` compara la huella del pin, no solo la versión.
- Cambiar un valor por defecto de los ajustes de la app exige una migración (el almacén guarda los valores por defecto en disco).
- El smoke de macOS ensucia `dist/mac-arm64/Lazunox.app` con archivos `.pyc`: instalar desde el ZIP firmado.
- Probar una actualización con una carpeta de datos propia confunde al actualizador (la app nueva abre con la carpeta normal).
- El catálogo `models.json` se descarga sin huella al compilar: dos compilaciones el mismo día coinciden; si cambia el catálogo entre una y otra, no. Anotarlo si una compilación no sale idéntica.

- Al sincronizar el código al servidor con `rsync --delete`, se borra `/opt/lzx-fork/src/.github/TEAM_MEMBERS` (archivo vacío que la compilación lee y el fork no versiona): la compilación falla con `ENOENT ... TEAM_MEMBERS`. Excluir `.github` del rsync o recrearlo con `: > .github/TEAM_MEMBERS`.
- El `targets.sh` del servidor corre DENTRO de un contenedor: `docker run --rm -v /opt/lzx-fork:/w oven/bun:1.3.14 bash /w/targets.sh win32-x64` (lanzarlo directo en el servidor no hace nada).
- En Windows, PowerShell 5 escribía la salida en cp850 y los acentos llegaban rotos; se corrige fijando UTF-8 antes del comando (`tool/shell/utf8-windows.ts`). `cmd` sigue sin arreglo (solo se usa si no hay PowerShell ni Git Bash). Comprobación: `PROBE_ONLY=acentos node scripts/engine-probe/run.mjs <motor>` en el PC Windows, con `PROBE_SHELL=<ruta del shell>`.

## 5. Criterio de salida

Si en dos meses seguidos la revisión supera ~1 semana de trabajo, o 2.x se estabiliza y trae lo que necesitamos, retomar la migración (`docs/SPIKE-OPENCODE-2.md`).
