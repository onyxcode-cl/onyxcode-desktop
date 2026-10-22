# Diseño: «Lazunox Motor.app» (motor OpenCode con identidad TCC propia, macOS)

Estado: **diseño + prototipo** (2026-10-22, rama `feat/engine-client`). Nada de esto está en el código todavía.

## 0. Problema y decisión

Hoy el motor (`Contents/Resources/opencode/opencode`) se lanza con `lazunox-disclaim` (docs/SEGURIDAD.md §3): pasa a ser
responsable de sí mismo y no hereda Accesibilidad/Grabación de Lazunox. Pero es un Mach-O **suelto**: su firma no tiene
bundle id (ad-hoc/autofirmado con identificador `opencode`), el aviso de macOS dice «“opencode” quiere acceder a Documentos»
y, si la persona lo deniega, `tccutil reset SystemPolicyDocumentsFolder <bundleid>` no tiene a quién apuntar.
**Opción B (dueño):** meter el binario como ejecutable principal de una mini-app `Lazunox Motor.app`, id
`cl.bentec.lazunox.motor`, para que el aviso nombre «Lazunox Motor» y se pueda restablecer por id. El disclaim se conserva:
la mini-app es responsable de sí misma y **no** hereda los permisos de Lazunox.

## 1. Estructura del bundle y lanzamiento

```
Lazunox.app/Contents/Resources/opencode/Lazunox Motor.app/
  Contents/Info.plist
  Contents/MacOS/opencode        ← el binario fijado en pin.json, SIN cambios (mismo sha256 antes de firmar)
  Contents/_CodeSignature/CodeResources
```
- Se queda bajo `Resources/opencode/` para no mover `agents-win`, `skills` ni el prefijo que ya conoce el actualizador.
- `lazunox-disclaim` **no** entra en la mini-app: sigue en `Resources/launcher/`. Hace `POSIX_SPAWN_SETEXEC`, así que la
  imagen final del PID es `…/Lazunox Motor.app/Contents/MacOS/opencode` y la identidad que ve TCC es la del bundle.
- Info.plist mínimo (probado en el prototipo): `CFBundleIdentifier`=`cl.bentec.lazunox.motor`, `CFBundleExecutable`=`opencode`,
  `CFBundleName`/`CFBundleDisplayName`=`Lazunox Motor`, `CFBundlePackageType`=`APPL`, `CFBundleShortVersionString`=versión de
  pin.json, `CFBundleVersion`, `LSMinimumSystemVersion`=12.0, `LSUIElement`=true y `LSBackgroundOnly`=true (sin Dock ni menú;
  de todas formas se lanza por `posix_spawn`, no por LaunchServices), y textos `NSDocumentsFolderUsageDescription`,
  `NSDesktopFolderUsageDescription`, `NSDownloadsFolderUsageDescription`, `NSRemovableVolumesUsageDescription`,
  `NSNetworkVolumesUsageDescription` (i18n: es/en vía `InfoPlist.strings` en `Resources/<lang>.lproj` de la mini-app; opcional en v1).
- Generación: nuevo `scripts/stage-motor-app.mjs` (lo llama `npm run package` tras `fetch-opencode.mjs`): arma
  `resources/opencode-bin/Lazunox Motor.app` copiando `bin/opencode` y escribiendo el Info.plist con el id derivado de
  `src/shared/brand.ts` (`motorId = ${appId}.motor`, como `disclaimId`; añadir a `brand-consistency.test.ts`).
- **Código** (el único cambio de lanzamiento): `bundledOpencodePath()` en `src/main/opencode/server.ts` devuelve en darwin
  `join(res, 'opencode', 'Lazunox Motor.app', 'Contents', 'MacOS', 'opencode')`, con respaldo a `res/opencode/opencode` para
  que una prueba vieja o un paquete a medias no deje sin motor. `server.ts`, `tasks/backends/spawn.ts` y `onboarding.ts`
  ya consumen esa función: no cambian. **`withDisclaim` no cambia.** `pty/service.ts` lanza la shell del usuario, no el
  motor: no aplica (los avisos que dispare la terminal seguirán nombrando la shell).
- Limitaciones: con `OPENCODE_BIN`, `settings.opencodeBin` o CLI del usuario (orden de `pickOpencode`) el motor sigue siendo
  un binario suelto y el aviso seguirá diciendo «opencode». Tareas con Seatbelt: el disclaim ejecuta `sandbox-exec`, que
  luego hace `exec` del motor en el mismo PID; la identidad final debería ser la del bundle, **sin verificar** (ver §3).

## 2. Empaquetado, firma, verificación, actualizador

- **electron-builder.js**: `extraResources` mac: `{ from: 'resources/opencode-bin', to: 'opencode', filter: ['Lazunox Motor.app/**'] }`
  en lugar de `filter: ['opencode']` (Windows sigue con `opencode.exe`). En `binaries` (Developer ID) cambiar
  `Contents/Resources/opencode/opencode` por `Contents/Resources/opencode/Lazunox Motor.app` (firmar el bundle, no el Mach-O
  suelto, para que el Info.plist quede sellado).
- **Firma (`build/sign-common.js` `resignBundle`)**: añadir antes de `sign(appPath, …)`:
  `sign(join(res, 'opencode', 'Lazunox Motor.app'), ids.motorId)`. Firmar el **directorio .app** (no el binario) sella el
  Info.plist; `codesign -dv` del ejecutable ya informa `Identifier=<bundle id>` y `Format=app bundle` (comprobado).
  Con el certificado «Lazunox Local Signing», el requisito designado por defecto queda
  `identifier "cl.bentec.lazunox.motor" and certificate leaf = H"<PIN>"`: TCC guarda ese csreq y la concesión sobrevive a
  actualizaciones. **Ad-hoc no sirve**: el requisito es `cdhash` (visto en el prototipo) y cada versión del motor vuelve a
  preguntar. Modo devid: mismas entitlements que hoy lleva el binario (Bun necesita JIT bajo hardened runtime).
  `scripts/sign-release-mac.sh` no cambia (llama a `resignBundle`), pero conviene añadir la comprobación del pin también
  sobre `codesign -dr - "…/Lazunox Motor.app"`. El `--deep` inicial de ese script ya lo firma y luego `resignBundle` lo rehace
  con su id. Prueba unitaria de `resignBundle` (doble de `run`): esperar la llamada con `ids.motorId` y el orden (motor antes que app).
- **`scripts/verify-bundled.mjs`** (línea 26): `bin` = ruta nueva; añadir: Info.plist con id/ejecutable/LSUIElement,
  `codesign -dv` → `Identifier=cl.bentec.lazunox.motor`, `codesign --verify --strict` del bundle, sha256 del ejecutable == el
  descargado antes de firmar (o `--version == pin.version`, que ya existe), y que **no** quede `Resources/opencode/opencode` suelto.
- **`scripts/smoke-boot-mac.sh`**: tras arrancar, `ps -o comm=` del PID del motor debe contener `Lazunox Motor.app/Contents/MacOS/opencode`
  y `codesign -dv +<pid>` dar el id del motor (el `+pid` funciona; comprobado).
- **Actualizador**: el ZIP de la app completa ya incluye el bundle anidado; revisar en `scripts/update-lib.mjs`/`verify-update*.mjs`
  si hay lista de requeridos para mac (solo vi `WIN_REQUIRED`) y añadir `…/Lazunox Motor.app/Contents/MacOS/opencode`.
  La validación de firma tras descargar (`verify-signed.mjs`, `--deep --strict`) cubre el bundle anidado. `pin.json` y
  `fetch-opencode.mjs` no cambian (descargan el mismo binario; el empaquetado en .app es un paso aparte).
- **`killStaleServers`/pids**: buscar comparaciones por ruta del motor; si comparan `…/opencode/opencode`, aceptar ambas rutas.
- **Windows/WSL**: no aplica; ningún cambio.
- **Rollback**: revertir el commit; `bundledOpencodePath` ya tiene respaldo a la ruta antigua, y la concesión TCC de
  `cl.bentec.lazunox.motor` queda huérfana pero inofensiva. Las concesiones viejas dadas a «opencode» (suelto) se pierden al
  migrar: la persona verá **una vez** el aviso nuevo de «Lazunox Motor» (anotarlo en las notas de la versión).

## 3. Prototipo (hecho en el temporal, ya borrado)

Mini-app `Lazunox Motor.app` con Info.plist de §1 (id `…motor.proto`), firmada ad-hoc, lanzada con el
`resources/launcher/bin/lazunox-disclaim` del repo (id `cl.bentec.lazunox.disclaim`):
1. Ejecutable C trivial que hace `opendir`: `~/Library/Safari` → `EPERM` (protegido, sin aviso), `/tmp` → ok.
   `codesign --verify --deep --strict` OK; `codesign -dv` del `.app` y del `Contents/MacOS/opencode` → `Identifier=…motor.proto`,
   `Format=app bundle`.
2. Proceso vivo: `ps -o pid,ppid,pgid,comm` → `comm = …/Lazunox Motor.app/Contents/MacOS/opencode`, PPID = la shell que lanzó
   (no queda el disclaim intermedio: `SETEXEC`), PGID propio. `codesign -dv +<pid>` → `Identifier=…motor.proto`.
3. **Binario real** `resources/opencode-bin/bin/opencode` (1.19.0) copiado al bundle, firmado ad-hoc como `…motor.real`:
   `disclaim … serve --port 47917` responde HTTP 200 y `codesign -dv +<pid>` da el id del bundle. Bun no se queja de vivir en
   `Contents/MacOS` ni de la firma de bundle.

**No verificado (requiere que la persona pulse o root):** el texto exacto del aviso de TCC («“Lazunox Motor” quiere…»);
que TCC atribuya a la mini-app y no a Lazunox (`launchctl procinfo` pide root; `log` de tccd no mostró eventos para el
acceso a Safari, que es FDA sin aviso); que `tccutil reset SystemPolicyDocumentsFolder cl.bentec.lazunox.motor` funcione;
la ruta Tareas+Seatbelt (`sandbox-exec` → motor); que la concesión sobreviva a una actualización con el certificado fijado.
Prueba manual propuesta (Ben, 10 min, con build autofirmado): Chat → «lista ~/Documents» → ver el nombre en el aviso →
Denegar → `tccutil reset SystemPolicyDocumentsFolder cl.bentec.lazunox.motor` → repetir → vuelve a preguntar → Permitir →
Ajustes › Privacidad › Archivos y carpetas muestra «Lazunox Motor» y **no** aparece en Accesibilidad/Grabación.

## 4. Riesgos, orden y plazos

Riesgos: (a) TCC podría seguir atribuyendo por ruta si el proceso no es lanzado por LaunchServices — el prototipo muestra que la
identidad de código es la del bundle, pero el comportamiento de tccd solo se confirma con la prueba manual; (b) migración: un
aviso más para quien ya concedió a «opencode»; (c) firma: si `resignBundle` firma solo el Mach-O y no el bundle, el Info.plist
queda sin sellar y `--strict` falla; (d) notarización futura con Developer ID: bundle anidado en `Resources` es válido pero
Apple prefiere `Contents/Helpers`; moverlo luego cambia rutas otra vez; (e) tamaño del ZIP sin cambio (mismo binario).

Orden de trabajo (tiempos honestos, una persona):
1. `brand.ts` `motorId` + `stage-motor-app.mjs` + electron-builder — 1,5 h.
2. `bundledOpencodePath` con respaldo + pruebas unitarias — 1 h.
3. `resignBundle` + prueba + check del pin en `sign-release-mac.sh` — 1 h.
4. `verify-bundled`, `smoke-boot-mac.sh`, requeridos del actualizador, pids — 1,5 h.
5. Empaquetar, firmar con el certificado local, prueba manual de §3 y una actualización real N→N+1 — 2–3 h (necesita a Ben).
Total: **7–8 h efectivas, ~1,5 días** con revisión y la prueba en frío del release.

**Qué se puede entregar ya (1.5.1):** nada de la mini-app sin la prueba manual del punto 5; sí se puede publicar en 1.5.1 la
mitigación textual (en el aviso de error de permisos, explicar que «opencode» es el motor de Lazunox y cómo concederlo en
Ajustes › Privacidad › Archivos y carpetas). **Para 1.5.2/1.6:** la mini-app completa (pasos 1–5).
