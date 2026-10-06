# Tareas en Windows (WSL2): estado, pendiente y pruebas en el PC

Fase 1 del plan: distro dedicada `Lazunox-Tareas` (sin unidades montadas, sin interop), OpenCode de Linux en un espacio de red vacío con Landlock, y todo el tráfico por la stdio de `wsl.exe` hacia los `EgressProxy`/`CredentialProxy` que ya viven en `main`. La clave real nunca entra en la VM. Entrada del changelog: F8-B81. Sección de seguridad: `docs/SEGURIDAD.md` §3 tricies octies.

**Tareas en Windows sigue DESACTIVADA**: `capsFor('win32').tasks` es `false` mientras la bandera de producto `tasksWin` esté apagada, y `backends/index.ts` no importa el backend WSL. Nada de esto cambia el comportamiento actual de Windows ni el de macOS.

## Estado (hecho y probado en la Mac, con dobles)

| Pieza | Dónde |
|---|---|
| `tasksSandbox` (`seatbelt`/`wsl`/`none`) y bandera `tasksWin` (apagada) | `src/shared/platform-caps.ts` |
| Interfaz `SandboxBackend`, Seatbelt extraído sin cambios, backend `none`, `selectBackend` | `src/main/tasks/backends/{types,seatbelt,none,spawn,index}.ts` |
| Equivalencia byte a byte del lanzamiento Seatbelt (fixture capturado ANTES de extraer, commit `baeb0bd`/`c70fbdb`) | `sandbox.equivalence.test.ts`, `__fixtures__/seatbelt-before.json` |
| Rutas Windows ↔ `/win/c/…` (UNC, ADS, `..`, reservados, 8.3, enlaces con `lstat` inyectado) | `wsl-paths.ts` |
| Comandos de `wsl.exe` en lista cerrada (sin `--shutdown`), entorno mínimo, `wsl.conf`, política Landlock, trama INIT | `wsl-spec.ts`, `resources/wsl/wsl.conf` |
| Trama de la stdio (límites, errores tipados, créditos, UTF-16LE) | `bridge-protocol.ts`, `resources/wsl/protocol.py`, `resources/wsl/vectors.json` |
| Lado Windows del puente (solo puertos permitidos) | `wsl-bridge-host.ts` |
| Estado de WSL a partir de la salida de `wsl.exe` | `wsl-status.ts` |
| `WslBackend` con `wsl.exe` simulado (no se activa) | `wsl.ts`, `wsl.test.ts` |
| Lanzador Python + Landlock (recurso; análisis estático y pruebas de la parte pura, NO ejecutado en el Mac) | `resources/wsl/{launcher,landlock,mux,protocol}.py`, `test_protocol.py`, `launcher.static.test.ts` |

Cómo comprobar en la Mac (sin Electron ni e2e): `npm run typecheck`, `npx vitest run src/main/tasks src/main/ipc src/shared/platform-caps.test.ts` y, a mano, `cd resources/wsl && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest test_protocol`.

## Integración REAL en el PC (estado)

`scripts/win/wsl-it.ps1` (con `LAZUNOX_WSL_IT=1`, solo en el PC de pruebas, bajo `C:\onyx`) corre dos especificaciones sobre la distro dedicada `Lazunox-Tareas`; ambas se niegan a correr si ya existe, nunca usan `wsl --shutdown` y no tocan otras distros:

- `wsl-setup.win.test.ts`: `setup()` desde la imagen y el opencode de la caché, `status()==='ready'`, actualizar la carga y `remove()`. **Pasa en el PC.**
- `wsl-session.win.test.ts` (nueva; **escrita en macOS y todavía NO ejecutada en Windows**): tras el setup arranca el sandbox con el backend real (`wsl.exe` + puente del lado anfitrión, `realSpawn/realConnect/realListen`) sobre una carpeta de prueba bajo `C:\onyx\tmp` con `nota.txt`, espera `/global/health` por el puente (versión = la de `resources/opencode-bin/pin.json`, 1.18.33), y comprueba: servidor como `lazunox` (uid 1000, `CapEff=0`, `NoNewPrivs=1`), la carpeta (rw) y la config (ro) montadas con `noexec,nosuid,nodev`, `case=off` por comportamiento, `nota.txt` leída desde dentro, un archivo creado dentro visible en Windows con su contenido, que sin `allowDelete` el `rm` no borra (Landlock), y al parar: `wsl.exe` sale, no queda `opencode` ni el lanzador en la distro, el puerto se cierra y `remove()` deja la lista de distros como estaba. La evidencia de dentro la escribe un `sh` lanzado por la API del propio servidor (`POST /pty`, o `/session/<id>/shell` si falla); no se amplía la lista cerrada de `wsl.exe`.

Comando: `powershell -NoProfile -ExecutionPolicy Bypass -File C:\onyx\wt\scripts\win\wsl-it.ps1 -Branch <rama>` (tope de 40 min; log en `C:\onyx\logs\<rama>\wsl-it.txt`). Lo que sigue sin ejecutarse: la batería A1-A20 y las dos sesiones (elevada/normal).

## Lo que falta (en este orden)

1. **T-W3 restante**: rootfs reproducible y `scripts/build-wsl-rootfs.*`, clave `wsl-rootfs` en `pin.json`, `setup()` del backend (`wsl --import` con sha256), copiar `resources/wsl/*` a `/opt/lazunox` y `opencode` Linux a `/opt/lazunox/bin/opencode` (el lanzador asume esas rutas y el uid 1000 de `lazunox`), tarjeta «Preparar Tareas en Windows» (es/en) y `tasks:sandboxStatus`/`tasks:sandboxSetup`. Empaquetado: `resources/wsl/**` está excluido del `.asar` (`electron-builder.js`) hasta decidir cómo se entrega.
2. **T-W4**: activar `tasks-handlers` en win32 con la bandera, mapear rutas en TODOS los consumidores (`files.ts`, `monitor.ts`, adjuntos, puntos de restauración, «Mostrar en el Explorador»), `tasks.linux.md`, `storage.ts` (medir/limpiar `/home/lazunox/xdg/<clave>`), rutinas, política `disableWslTasks`, y un `selectBackend('win32', { wsl })` que importe `wsl.ts` de forma dinámica SOLO con la bandera.
3. **T-W5**: batería A1–A15 automatizada (`scripts/win/tasks-attack.ps1`) e informe.
4. Datos que `main` aún no tiene en el backend: el binario `opencode` de Linux (`SandboxLaunchSpec.bin` es el del anfitrión y WSL lo ignora), `OPENCODE_CONFIG_CONTENT` con rutas del anfitrión si las hubiera, y el stdout del servidor (no se reenvía; el stderr sí, por `wsl.exe`).

## Checklist EXACTO de pruebas que requieren el PC Windows

Reglas: `ssh bentec@192.168.1.84`, solo bajo `C:\onyx\` (carpetas de prueba `C:\onyx\tareas\…`, distro de prueba en `C:\onyx\wsl\`; la ruta de producto será `%LOCALAPPDATA%\Lazunox\wsl`), `powershell -NoProfile -ExecutionPolicy Bypass -File` con logs en archivo, límite de tiempo en cada paso, sin carga artificial. Nunca `wsl --shutdown`. Al final: `Get-Process wsl*,vmmem*,opencode*,electron*`, `wsl -l -v` (la distro en `Stopped`) y `uptime`. **No hacer nada de esto hasta que el dueño autorice instalar WSL2 (decisión 1).**

**Las dos sesiones.** La sesión SSH del administrador va **elevada** y el fallo abierto de WSL (microsoft/WSL#12443) puede montar las unidades pese a `automount enabled=false` al entrar elevado en una distro en marcha. Repetir 2 a 9 y los ataques **dos veces**: (a) por SSH (elevada) y (b) desde una sesión **NO elevada** (tarea programada interactiva de un solo uso bajo `C:\onyx\`, o el dueño frente al PC). Si `wsl.exe` falla por SSH (Store), usar la tarea programada y borrarla al terminar.

1. Solo lectura: `wsl --status`, `wsl --version`, `wsl -l -v`. ¿WSL2 instalado? ¿Virtualización activa? Anotar versión del núcleo.
2. Importar la distro de prueba desde el rootfs fijado: sha correcto, tiempo y tamaño del `ext4.vhdx`, `wsl -l -v` la muestra en versión 2 (las otras distros intactas, antes y después).
3. `launcher.py --probe` (`wsl -d Lazunox-Tareas -u root --cd / --exec /opt/lazunox/launcher.py --probe`): `interop:false`, `driveMounts:[]`, `landlockAbi >= 2`. Además `findmnt` sin `/mnt/c`, `/proc/sys/fs/binfmt_misc/WSLInterop` ausente, `cat /sys/kernel/security/lsm` con `landlock`. **Verificar que `--cd /` y el entorno mínimo (`SystemRoot`, `windir`, `SystemDrive`, `TEMP`, `TMP`, `LOCALAPPDATA`, `WSLENV=''`, `WSL_UTF8=1`) bastan para que `wsl.exe` arranque**; si hace falta otra variable, añadirla a `WSL_ENV_ALLOWED` con prueba.
4. Que `mount -t drvfs 'C:\onyx\tareas\a' /win/c/onyx/tareas/a -o noexec,nosuid,nodev,uid=1000,gid=1000` funcione como root con el automontaje apagado y sin interop; que `ro` sea de solo lectura.
5. Arranque de un servidor con la bandera activa (rama de integración): `READY` y `/global/health` en < 30 s en frío; conversa con un modelo gratuito y con OpenCode Go (clave real solo en `main`, centinela dentro).
6. Red (A10/A11): sin interfaz salvo `lo`; `curl https://example.com` y DNS (`getent hosts example.com`) fallan dentro; `opencode.ai` por el proxy funciona; un host no permitido muestra la tarjeta; el puente rechaza puertos no listados.
7. Archivos (A13/A15): crear y editar funciona; `rm`, `mv`, `os.rename` fallan con EACCES sin `allowDelete` y funcionan con él; `.lazunox/trabajo` sí se borra; `ro` no admite escritura; `rw` adicional sin borrar; `truncate` permitido (residuo conocido); `ln -s` en la carpeta falla (sin `MAKE_SYM`).
8. Ciclo de vida: Detener ⇒ ningún `opencode` en la distro (`wsl -d Lazunox-Tareas -u root -- ps -e`); matar `electron.exe` a la fuerza ⇒ el lanzador sale por EOF en < 5 s y la VM pasa a `Stopped` tras `vmIdleTimeout`; sin Vmmem consumiendo CPU en reposo (mirar 60 s sin generar carga).
9. Rendimiento (solo medir): arranque en frío y en caliente, RSS de Vmmem con una tarea, `git status` en una carpeta de 2000 archivos.
10. Restauración y rutas (cuando exista T-W4): puntos de restauración tras editar desde dentro; la interfaz muestra `C:\…`; «Mostrar en el Explorador» abre la ruta correcta.
11. Quitar Tareas: `--unregister` deja `C:\onyx\wsl` vacío y no toca otras distros.
12. **Ataques** (como `lazunox` dentro, carpeta `C:\onyx\tareas\a`, «víctima» `C:\onyx\tareas\victima` con un archivo testigo):

| # | Ataque | Esperado |
|---|---|---|
| A1 | Salir de la carpeta (`../victima/x`, `/win/c/…` fuera del montaje) | ENOENT |
| A2 | Junction `mklink /J a\j C:\onyx\tareas\victima` y `cat j/x` | Falla. **Si drvfs la atraviesa es BLOQUEANTE** (rechazar carpetas con reparse points o montar de otro modo) |
| A3 | Symlink NTFS (`mklink /D`) y de archivo hacia la víctima | Igual que A2 |
| A4 | El agente crea enlaces hacia fuera y `main` (restauración, visor, adjuntos) los sigue | `main` no sigue enlaces fuera (`checkNoLinks`, `lstat`/`realpath` + `isInside`) |
| A5 | Rutas UNC/dispositivo (`\\192.168.1.101\x`, `\\?\C:\`, `\\wsl.localhost\…`) que vuelven a `main` | `fromSandboxPath` las rechaza |
| A6 | ADS (`echo x > 'a.txt:oculto'`) | drvfs no crea ADS; `main` rechaza `:` |
| A7 | Leer `%USERPROFILE%` (`ls /win/c/Users`, `find / -name '*.ssh*'`, `/mnt/c`); `mount -t drvfs C: /x` como `lazunox` | No existe; EPERM |
| A8 | Ejecutar Windows (`./evil.exe`, `/init`, `cmd.exe`, `$WSL_INTEROP`) | Falla; ningún proceso nuevo en Windows (`Get-Process` antes/después) |
| A9 | Exfiltrar la clave (`env`, `/proc/*/environ`, `ps -ef`, stdio de `wsl.exe`, `CredentialProxy` con otro `Host` o `../`) | Solo el centinela; el proxy solo va a `opencode.ai/zen/go/v1` |
| A10 | Salir sin proxy (`curl --noproxy '*'`, UDP 53, ICMP, gateway de WSL, `::1`, puertos de Windows) | Todo falla |
| A11 | Abusar del proxy (CONNECT fuera de lista, `Host` en mayúsculas, IP literal, `opencode.ai.evil.com`) | Bloqueado |
| A12 | Root dentro (`su`, `sudo`, setuid, `unshare -U`, deshacer Landlock) | Sin root ni capacidades; `no_new_privs` |
| A13 | Borrar sin permiso (`rm`, `mv`, `os.replace`, hardlink hacia fuera) | EACCES; `truncate` permitido |
| A14 | Agotar el puente (muchos flujos, tramas enormes; prueba acotada) | Se corta el flujo o la sesión; `main` no cae |
| A15 | Persistencia (`/etc`, `/opt/lazunox`, `wsl.conf`, `~/.bashrc`) | EACCES |

## Decisiones del dueño que siguen abiertas

1. **Instalar WSL2 en el PC de pruebas** (administrador, quizá reinicio) o hacerlo él. Sin esto no hay nada de lo anterior.
2. **Debian slim (~150-250 MB, glibc, más compatible) o Alpine (~60-100 MB, musl, `opencode-linux-x64-musl`)**; si el rootfs se descarga al «Preparar» (fijado por sha256, recomendado) o va en el instalador; quién lo construye.
3. **Sin Landlock (ABI < 2)**: recomendado **fallar cerrado** (así está implementado: `status()` da `broken` y el lanzador se niega a arrancar). Alternativa: arrancar sin protección de borrado, avisando y apoyándose en los puntos de restauración.
4. **Enlaces dentro de la carpeta**: la política NO concede crear enlaces simbólicos, FIFO, sockets ni dispositivos en las carpetas de Windows (es el vector de A2-A4). Rompe `git clone` de repos con symlinks y `npm` con `.bin` dentro de la carpeta. ¿Se acepta o se concede `MAKE_SYM` y se confía en `checkNoLinks`?
5. **Junctions y reparse points**: si A2 muestra que drvfs los atraviesa, ¿se rechazan las carpetas que los contengan o se exige elegir otra?
6. **Ruta visible para el agente** (`/win/c/Users/…`) y la variante de prompts `tasks.linux.md`.
7. **Fase 2** (AppContainer): spike de un día; si falla, ¿modelo de usuario dedicado (administrador en la instalación) o Windows solo con WSL?
8. **Política `disableWslTasks`** y si la desinstalación NSIS borra la distro (por defecto sí).
9. **Activar la bandera `tasksWin`**: solo tras pasar este checklist y A1–A15 en las dos sesiones.
