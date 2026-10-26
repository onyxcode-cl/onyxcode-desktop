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

## 3 bis. Banco de tareas del motor (`scripts/engine-bench/`, plan maestro 1A)

Mide «el motor mejoró» antes/después con el modelo gratuito: 23 tareas pequeñas y reproducibles (`--lista`; T01-T18 son las originales y T19-T23 las «duras» de la ola 6, paquete 6.1), cada una con su carpeta inicial generada por el script, un pedido natural en español y un verificador determinista (comando o comprobación de archivos, nunca un juez con modelo). Necesita un motor con las banderas de `run` del fork (`--permisos ninguno`, `--max-steps`, `--presupuesto-tokens`, `--informe`, `LAZUNOX.md` del fork).

- **Solo en contenedor del VPS** (nunca el motor real en el Mac; el ejecutor se niega fuera de un contenedor). Comando, con el binario linux-x64 compilado por `targets.sh`:
  `docker run --rm --cpus=4 --memory=8g -e BENCH_EN_CONTENEDOR=1 -v /opt/lzx-b1app:/app -v <binario>:/motor:ro -v <salida>:/out -v /opt/lzx-fork/src/node_modules/typescript:/ts:ro -w /app node:22-bookworm node scripts/engine-bench/run.mjs --motor /motor --repeticiones 3 --typescript /ts --salida /out`
- Cada corrida: carpeta temporal con `git init` y un commit; el motor con `HOME` y `XDG_*` temporales, permisos acotados (`external_directory`, `webfetch`, `websearch` y `question` denegados) y `run --format json --permisos ninguno --max-steps 60 --presupuesto-tokens 400000`, con el pedido por stdin y tope de 15 min. T09 encadena 8 pedidos en la misma sesión (`--session`); T12 levanta un conector MCP propio de 40 herramientas (`mcp-bench.mjs`); T07 necesita `--typescript <carpeta>` (sin ella se omite y no cuenta como fallo).
- Salida: `bench-<fecha>.json` y una tabla (éxito k/n, mediana de tokens enviados `input + cache.read`, tokens de salida, % de caché, pasos, llamadas, minutos, tokens por éxito; agregados: tasa de éxito, mediana de tokens por éxito, p90 de minutos). Cuota gratuita agotada («Free usage limit reached»): reintenta una vez tras esperar y la marca `cuota` (no cuenta como fallo).
- `--comparar antes.json despues.json` imprime el antes/después y aplica el criterio de ola (el éxito total no baja más de 1 tarea; ninguna pasa de estable a 0).
- Sin red ni modelo: `--proveedor-falso` (servidor local compatible con OpenAI, determinista, con guiones que resuelven las tareas con las herramientas reales del motor; `--sin-guion T05` deja una sin guion para ver que el banco distingue el fallo). `--autoprueba` comprueba, sin motor, que cada verificador falla en la carpeta inicial y pasa con el guion.
- **Tareas duras T19-T23** (el banco original quedó saturado: 54/54 con `opencode-go/deepseek-v4.1-flash` en lazunox.9 y .11): T19 sesión de 20 pedidos que se refieren a decisiones de los pedidos 2 y 5 (nombre de clase `Bodeguero`, separador `;`; presupuesto propio de 1,5 M de tokens); T20 edición de frases con «», “” y — (el verificador exige el texto final exacto, byte a byte); T21 migración de 5 pasos donde `comprobar.js N` se niega si no quedó comprobado el N-1 (y exige `migracion.log` en orden); T22 pruebas con ~20 000 líneas de salida y un solo fallo (caso 5000 g); T23 un proceso de fondo (lanzado por el propio pedido, `sleep` de 6 s en `sync.js`) cambia `precios.csv` a mitad de la sesión y el modelo debe releer antes de escribir (si el ejecutor cortó el proceso antes de que acabara, el verificador termina la sincronización él mismo, siempre dentro de la carpeta temporal). Cada una trae `preparar`, `verificar` determinista y `guion` para el proveedor falso; `--autoprueba` las cubre.
- **Métricas nuevas**: `tokens_por_paso` (mediana y p90 de lo enviado en cada paso del modelo, `input + cache.read`) por corrida y en el resumen (mediana de las medianas / de los p90).
- **Repeticiones y guardado incremental**: `--repeticiones N` admite cualquier N. `--salida x.json` se reescribe tras cada corrida (parcial). `--guardar-corridas <carpeta>` deja además un JSON por tarea y repetición (`T19-r03.json`, con motor, modelo y fecha) apenas termina cada una; si el archivo ya existe (mismo motor y modelo, y no salió por cuota) esa repetición se salta, así que una tanda larga se reparte en varios días repitiendo el mismo comando. `--comparar` acepta esas carpetas en lugar de un `.json`.
- **Ruido en `--comparar`**: por tarea muestra mediana y rango `[mín–máx]` de tokens enviados y de pasos. Con menos de 5 repeticiones válidas por lado dice «sin veredicto» (no declarar mejoras); con ≥5, «dentro del ruido» si los rangos de tokens se solapan y «fuera del ruido» si no. Una diferencia dentro del ruido no es mejora ni empeoramiento. Avisa también si los dos lados son de días distintos.
- **Procedimiento recomendado para medir un cambio**: (1) el MISMO modelo (ID fijo, anotado) y el MISMO día para los dos motores; (2) ≥5 repeticiones por tarea difícil (T06, T09, T10, T13, T19-T23) y por motor, intercalando motor A y B si se puede; las tareas fáciles con 3; (3) `--guardar-corridas` distinto por motor; (4) `--comparar A B`: solo cuentan las diferencias «fuera del ruido»; el criterio de ola (éxito) sigue igual; (5) anotar fecha, modelo y versión del motor en la línea base (`linea-base/real-<motor>-<fecha>.json`).
- **Correr con OpenCode Go en el Mac (Docker arm64)**: el ejecutor se niega fuera de contenedor, así que se usa Docker/Colima con `--platform linux/arm64` y el motor linux-arm64 (compilado aparte, p. ej. `~/.lzx-bench-tmp/m-arm64/<nombre>/opencode`). Una sola corrida a la vez y con `nice` para no saturar el Mac; no tocar contenedores ajenos ni reiniciar Colima. Plantilla (el `auth.json` de OpenCode Go se monta de solo lectura y el ejecutor lo copia al HOME temporal de cada corrida con modo 0600; nunca se imprime ni se guarda en el resultado):
  `nice docker run --rm --platform linux/arm64 --cpus=2 --memory=3g -e BENCH_EN_CONTENEDOR=1 -v <repo>:/app:ro -v <motor>:/motor:ro -v <salida>:/out -v <typescript>:/ts:ro -v <auth.json>:/auth.json:ro -w /app node:22-bookworm node scripts/engine-bench/run.mjs --motor /motor --repeticiones 5 --typescript /ts --modelo opencode-go/deepseek-v4.1-flash --auth-archivo /auth.json --salida /out/<nombre>.json --guardar-corridas /out/<nombre>-corridas`
  Para el motor con otras variables, `--env K=V` (p. ej. `LAZUNOX_AYUDANTES_MINIMOS=1`). Los scripts usados hasta ahora (`run.sh`, `driver.sh` y `vol.sh` en `~/.lzx-bench-tmp/`) son esa misma orden envuelta; viven fuera del repositorio por llevar rutas y la ubicación del `auth.json`. `--cpus=2 --memory=3g` basta; T19 (20 pedidos) tarda varios minutos por repetición con el modelo real y consume bastante cuota: usar `--reanudar` o `--guardar-corridas` para repartirlo.
- Líneas base guardadas en `scripts/engine-bench/linea-base/` (`--comparar` contra ellas tras cada ola). Los modelos gratuitos cambian: anotar siempre fecha y modelo (el JSON los trae).

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
