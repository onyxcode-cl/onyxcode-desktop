# Control remoto desde el celular en Windows: estado y pruebas en el PC

Objetivo del dueño: «todo igual a Mac, adaptado para Windows». El control remoto (PWA por red local, modo «También fuera de casa» y Modo viaje) existía solo en macOS. Esta rama lo deja listo detrás de la bandera `remoteWin`, **APAGADA por defecto**. Con ella apagada, Windows queda exactamente como antes (`capsFor('win32').remote === false`, sin canales activos, sin sección en Ajustes) y macOS no cambia. **Nada de esto se ha probado en un Windows real**: todo lo hecho se verificó en la Mac con la plataforma inyectada.

Garantías de seguridad (AGENTS.md §8, `docs/SEGURIDAD.md`): no se relaja ninguna. Cifrado WebRTC/DTLS, emparejamiento por QR y código, límites de aprobación, política de la organización, auditoría y listas de denegación son los mismos; los cambios de seguridad solo AÑADEN negativas para Windows.

## La bandera

`remoteWin = win32 && !política.bloquea && (REMOTE_WIN_BUILD || LAZUNOX_REMOTE_WIN=1 sin empaquetar)` (`src/main/remote/remote-win-flag.ts`). `REMOTE_WIN_BUILD` es un literal `false` que solo cambia el dueño, en un commit aparte (una guardia lee el literal). Vive ahí y no en `src/shared/feature-flags.ts` porque esa es zona intocable (AGENTS.md §7). Para probar en el PC: `LAZUNOX_REMOTE_WIN=1 npm run dev`. Viaja al preload como `--lazunox-caps=remoteWin` (`caps-argv.ts`), `main` la fija en `loader.setRemoteWin` y hace falta reiniciar para que cambie.

## Inventario

| # | Punto | Qué fallaba en Windows | Sev. | Cambio / estado |
|---|---|---|---|---|
| 1 | `platform-caps` | `remote: mac` | Alta | `remote: mac \|\| (win && remoteWin)`; matriz de pruebas. Hecho |
| 2 | IP de LAN (`lan-ip.ts`) | Elegía `vEthernet (WSL)`, Hyper-V, VMware, VPN o el punto de acceso móvil (192.168.137.x): el celular no llega | Alta | Lista de adaptadores virtuales de Windows y preferencia Wi-Fi/Ethernet, solo en win32. Hecho |
| 3 | Binario `cloudflared` | Solo `.tgz` + `tar` + `codesign` de macOS; sin `.exe` ni asset en el pin | Alta | Rama win32: `.exe` suelto con tamaño/SHA-256 fijados, sin `tar`, Authenticode (estado `Valid` + sujeto exacto del pin), ruta `cloudflared.exe`, mismos hosts y consentimiento. **Sin asset en `pin.json` sigue `unsupported` (falla cerrado)**. Código hecho; pin pendiente (pregunta 1) |
| 4 | Proceso `cloudflared` | Sin vigía `/bin/sh`; `HOME`/`PATH` de macOS; señales a `-pid`; `isOurCloudflared` no reconocía rutas `C:\…\cloudflared.exe` | Media | Entorno mínimo de Windows (`USERPROFILE`, `SystemRoot`, `PATH` de System32, TEMP, proxies); sin PIDs negativos; `isOurCloudflared` acepta `\`, `.exe` y comillas. Hecho. Residual: si la app muere sin cerrar, `cloudflared` queda vivo hasta el siguiente arranque (`killStaleServers`); su servidor local ya no existe, así que no expone nada |
| 5 | Aprobar comandos desde el celular (`command-denylist.ts`) | Lista solo de shells POSIX; `flatten` borraba las `\` de `C:\…`; sin `del`, `reg`, `powershell`, `iwr`, UNC, flujos NTFS | **Alta** | Con `platform: 'win32'`: barras normalizadas, unidades `C:` y UNC como «fuera», `%VAR%`/`^`/`!x!`/flujos `a:b`/nombres 8.3 denegados, más de cien comandos de cmd/PowerShell siempre a confirmar, extensión y mayúsculas no esquivan. macOS idéntico. Hecho |
| 6 | Archivos sensibles (`path-guard.ts`) | Faltaban ubicaciones de Windows | Media | `AppData\…\Microsoft\{Credentials,Protect,Vault,Crypto}`, `User Data` de navegadores, Firefox, `NTUSER.DAT*`, gcloud/GitHub CLI en `AppData`. Hecho. La comparación de rutas sigue distinguiendo mayúsculas (más estricta: pregunta de más, nunca de menos) |
| 7 | Cerrar la ventana | `window-all-closed` cierra la app en Windows: el remoto muere con la ventana | Alta | Con `remoteWin`, remoto activo y bandeja visible, la app sigue en la bandeja (`lifecycle.ts`); sin bandeja o remoto apagado, cierra como siempre. Hecho |
| 8 | Aviso de confirmación | `app.dock?.bounce` no existe | Media | `flashFrame` de la barra de tareas (`attention.ts`); notificación si no hay ventana. Hecho |
| 9 | Escritura de `remote.bin`/auditoría | `rename` sobre un archivo abierto por antivirus/indexador falla con `EPERM`/`EBUSY` | Media | `renameReplaceSync` reintenta (5, solo en win32) y relanza el error. Hecho |
| 10 | `safeStorage` | En Windows usa DPAPI (ligada al usuario, no a la app: otro proceso del mismo usuario podría descifrar) | Baja | Sin cambio: `remote.bin` solo guarda el SHA-256 del secreto de cada celular y el hash scrypt del PIN, no secretos en claro. `isEncryptionAvailable()` se comprueba como hoy |
| 11 | Permisos 0600/0700 | No existen en NTFS | Baja | Sin cambio: `mode` se ignora, `chmod` falla en silencio (ya con `try`), la comprobación de grupo/otros ya se salta en win32 (ahora con la plataforma inyectada). `userData` hereda la ACL del perfil del usuario |
| 12 | Protocolo `lazunox://` | Ninguno: es un esquema interno de la app (`lazunox://app`, `lazunox://engine/`), no se registra en el sistema | n/a | Sin cambio |
| 13 | Firewall de Windows | La primera escucha en el puerto local (HTTP y UDP de WebRTC) muestra el aviso del Firewall; si se rechaza o la red es «Pública», el celular no conecta y no hay error visible | Alta | **No se toca** (crear reglas exige administrador). Pregunta 2 |
| 14 | Mantener el equipo despierto | El remoto en macOS tampoco usa `caffeinate` (solo el consejo de la interfaz); en Windows dormir/hibernar corta el remoto | Media | **No se toca**. Alternativa propuesta: `powerSaveBlocker('prevent-app-suspension')` (Electron usa `SetThreadExecutionState`) mientras el remoto esté activo. Pregunta 3 |
| 15 | Textos «Mac» (~25 claves de `remote.*`, PWA y diálogos) | Dicen «este Mac» | Baja | **No se toca**. Pregunta 4 |
| 16 | `node-datachannel` | Prebuilt `win32-x64-msvc` está en el lock y `asarUnpack` lo cubre | Media | Sin cambio; sin probar la carga ni ICE en Windows |
| 17 | Rutas de la política (`isAbsolute`, `realpath.native`) | Ya usan `node:path` nativo y `file:///C:/` (`fileUrlPath`) | Baja | Sin cambio; sin probar con junctions, nombres 8.3 ni unidades de red |

## Lo verificado (en la Mac, plataforma inyectada)

Pruebas nuevas: `remote-win-flag`, `lan-ip`, `cloudflared.win`, `binary.win`, `command-denylist.win`, `fs-retry`, `attention`, `lifecycle`; actualizadas `tasks-win-wiring` y el texto de `TravelPanel`. Lo ya existente de `src/main/remote`, `src/shared`, `src/test`, `renderer/remote` y los ajustes sigue en verde. Comprobado: matriz plataforma × bandera, macOS sin cambios, la bandera apagada no activa nada, y que cada negativa de macOS de la lista de denegación también lo es en Windows.

## Lo NO verificado (solo en el PC)

Que `npm run dev` con la bandera arranque el remoto y el servidor escuche en la IP elegida; el aviso del Firewall y conectar desde el celular (HTTP + UDP); DPAPI real; carga de `node-datachannel`; Authenticode real, Defender y SmartScreen sobre `cloudflared.exe`; el modo viaje completo (necesita el pin); `taskkill /T` y los huérfanos tras matar la app; `flashFrame`, notificaciones y la app viva en la bandeja; suspensión; las listas de denegación contra comandos reales de PowerShell/cmd que emite OpenCode en Windows.

## Preguntas para el dueño

1. **Pin de `cloudflared` para Windows**: hay que descargar `cloudflared-windows-amd64.exe` (~20 MB, release oficial), calcular SHA-256 y leer el sujeto Authenticode en el PC (`Get-AuthenticodeSignature`), y extender `scripts/cloudflared/pin.mjs` (hoy solo macOS). ¿Lo autorizas?
2. **Firewall**: ¿regla de entrada creada por el instalador NSIS (pide administrador y hoy la instalación es por usuario), guía manual en Ajustes, o solo documentarlo?
3. **Mantener despierto en Windows**: ¿bloqueo de suspensión mientras el remoto esté activo (propuesto) o solo consejo?
4. **Textos**: ¿«este Mac» → «este equipo/PC» según plataforma? Cambia claves del PWA: habría que regenerar `i18n-core-keys.json` (no lo he tocado).
5. **Cómo se abre `remoteWin`**: hoy variable de desarrollo + literal de compilación (siguiendo `tasksWin`); ¿quieres además un interruptor de usuario (beta) en Ajustes?
6. **Bandeja**: ¿te parece bien que con el remoto activo la app siga viva en la bandeja al cerrar la ventana?
7. **Aprobar comandos desde el celular en Windows**: sigue apagado por defecto y pide el diálogo propio del equipo; ¿se permite ya, o se bloquea en Windows hasta probar la lista de denegación con comandos reales?
