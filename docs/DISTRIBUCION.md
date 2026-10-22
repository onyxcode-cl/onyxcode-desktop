# Distribución de Lazunox (firma + notarización)

> **Nota sobre nombres (identidad única Lazunox).** Los nombres de este documento (`Lazunox.app`, `Lazunox-<v>-arm64.dmg`/`.zip`,
> `lazunox-<v>-arm64.dmg`, el certificado «Lazunox Local Signing», el appId `cl.bentec.lazunox`, «Lazunox Safe Storage»,
> `~/Library/Application Support/Lazunox`, `~/.lazunox-keys/`) son los vigentes desde la 0.5.0 (instalación nueva).

`npm run package` funciona sin nada de esto: firma **ad-hoc** (`identity: '-'`) porque los fuses de
Electron (`electron-builder.js` → `electronFuses`) modifican el binario y, sin volver a firmarlo,
macOS lo mata al abrir. Un build ad-hoc sirve para probar en esta máquina, pero:

- Gatekeeper lo rechaza en cualquier otro Mac (`spctl -a -vvv` → `rejected`).
- Cada build cambia de "identidad" ante TCC: macOS olvida los permisos de Accesibilidad/Grabación de
  pantalla que el usuario concedió a una build anterior, y hay que volver a concederlos.

Para repartir Lazunox a otra persona (o subirlo a algún sitio) hace falta firmarlo con un
**Developer ID Application** de Apple y notarizarlo. La config ya está lista
(`electron-builder.js`, `build/entitlements.mac.plist`, `build/notarize.js`, `build/notarize-dmg.js`): solo falta que
alguien con una cuenta de Apple Developer aporte el certificado y las credenciales. El guion completo de una publicación
(CI, firma del manifiesto, rollback, claves) está en `docs/RELEASE.md`.

## 1. Conseguir un certificado Developer ID Application

1. Tener (o crear) una cuenta en <https://developer.apple.com/programs/> (Apple Developer Program,
   de pago, ~99 USD/año). Puede ser individual o de una organización.
2. En un Mac con Xcode instalado: Xcode → Settings → Accounts → añadir el Apple ID → seleccionar el
   equipo → **Manage Certificates…** → botón `+` → **Developer ID Application**. Xcode genera la
   clave privada en el Llavero (Keychain) y el certificado firmado por Apple.
   - Alternativa sin Xcode: generar un CSR en Llavero (`Acceso a Llaveros` → `Solicitar certificado
de una autoridad certificadora`) y subirlo en
     <https://developer.apple.com/account/resources/certificates/add> eligiendo **Developer ID
     Application**; descargar el `.cer` resultante y hacer doble clic para importarlo al Llavero
     (debe unirse con la clave privada del CSR).
3. Verificar que quedó en el Llavero de inicio de sesión, categoría "Mis certificados", con una
   flechita desplegable que muestra la clave privada asociada (si no tiene clave privada, no sirve
   para firmar).
4. Anotar el nombre exacto tal como aparece en Llavero, algo como:
   `Developer ID Application: Nombre Apellido (EQUIPOID)` — ese es el valor de `CSC_NAME`.

### Exportar el certificado (para firmar en otra máquina o en CI)

En Llavero: clic derecho sobre el certificado **Developer ID Application** → **Exportar…** → formato
`.p12` → poner una contraseña. Eso da los dos valores que electron-builder necesita en vez de
`CSC_NAME` si no se firma en esta misma máquina:

- `CSC_LINK`: ruta al `.p12` (o su contenido en base64, ver docs de electron-builder) — se usa en
  vez de `CSC_NAME` cuando el certificado no está en el Llavero local (p. ej. en CI).
- `CSC_KEY_PASSWORD`: la contraseña puesta al exportar.

## 2. Credenciales de notarización: clave API (recomendada) o contraseña de app

La notarización usa `notarytool`. Hay dos formas de autenticarse; `build/notarize.js` y `build/notarize-dmg.js` usan la
**clave API** si están sus tres variables y, si no, el Apple ID. Con variables a medias el empaquetado **falla** diciendo cuáles faltan.

### 2.1 Clave API de App Store Connect (recomendada)

Se revoca sola desde App Store Connect y no toca tu Apple ID ni su contraseña:

1. Entrar en <https://appstoreconnect.apple.com/access/integrations/api> → pestaña **Team Keys** → **+**.
2. Nombre (p. ej. `lazunox-notary`) y rol **App Manager** → **Generar**.
3. Descargar el `.p8` (**solo se puede descargar una vez**) y anotar el **Key ID** y el **Issuer ID**.
4. Guardar el `.p8` en el gestor de contraseñas. **Nunca** en el repositorio.

### 2.2 Contraseña específica de app (alternativa)

Autentica con el Apple ID **dueño** del Developer ID (no la contraseña normal de la cuenta):

1. Entrar a <https://appleid.apple.com/account/manage> con ese Apple ID.
2. **Inicio de sesión y seguridad** → **Contraseñas específicas de apps** → **Generar contraseña…**
   → ponerle un nombre (p. ej. "Lazunox notarize") → copiar la contraseña `xxxx-xxxx-xxxx-xxxx` que
   muestra (solo se ve una vez).
3. El **Team ID** se ve en <https://developer.apple.com/account> → **Membership** (o en el propio
   nombre del certificado, entre paréntesis: `(EQUIPOID)`).

## 3. Variables de entorno

```bash
export CSC_NAME="Developer ID Application: Nombre Apellido (EQUIPOID)"
# — o, si el certificado no está en el Llavero de esta máquina —
# export CSC_LINK=/ruta/al/certificado.p12
# export CSC_KEY_PASSWORD="contraseña del .p12"

# Notarización, forma A (recomendada): clave API de App Store Connect. APPLE_API_KEY es la RUTA del .p8.
export APPLE_API_KEY="$HOME/.lazunox-keys/AuthKey_XXXXXXXXXX.p8"   # fuera del repositorio
export APPLE_API_KEY_ID="XXXXXXXXXX"
export APPLE_API_ISSUER="00000000-0000-0000-0000-000000000000"
# Notarización, forma B: Apple ID (solo si no usas la clave API)
# export APPLE_ID="tu-apple-id@ejemplo.com"
# export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
# export APPLE_TEAM_ID="EQUIPOID"
```

Los secretos van **solo** en variables de entorno (o en los secretos del entorno protegido de GitHub): nunca en archivos del repositorio.

Sin `CSC_NAME`/`CSC_LINK`, `electron-builder.js` sigue el camino ad-hoc de siempre (nada cambia). Si
se define `CSC_NAME`/`CSC_LINK` pero no hay credenciales de notarización, el build queda
**firmado pero sin notarizar** (`npm run package` avisa por consola) — Gatekeeper lo bloqueará igual
al abrirlo en otro Mac. **Con `CSC_LINK` hace falta además `CSC_NAME`** (y, en CI con llavero temporal, `CSC_KEYCHAIN`): hace falta para volver a
firmar los helpers con su identificador (§6).

## 4. Compilar

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
npm run package
```

Con las variables puestas, verás en la salida:

- `signing file=dist/mac-arm64/Lazunox.app … identityName=Developer ID Application: …`
- `[notarize] volviendo a firmar cu-helper y lazunox-disclaim …` (con su identificador, hardened runtime, timestamp y entitlements).
- `[notarize] enviando dist/mac-arm64/Lazunox.app a Apple (clave API)…` seguido de
  `[notarize] notarización completa.` (puede tardar varios minutos: Apple procesa el binario en su
  nube antes de responder).
- `[notarize-dmg] enviando …dmg a Apple…` y `…notarizado y grapado.` (`build/notarize-dmg.js`, hook `afterAllArtifactBuild`:
  `notarytool submit --wait`, `stapler staple` y `stapler validate` del `.dmg`).

El `.dmg` queda en `dist/lazunox-<version>-arm64.dmg`.

## 5. Verificar la firma y la notarización

Un solo comando comprueba todo lo de abajo (y los identificadores de los helpers) sobre lo ya empaquetado, sin red ni empaquetar nada:

```bash
npm run verify:signed -- --expect devid --team EQUIPOID        # --expect adhoc | self | devid; --dry-run lista los comandos sin ejecutarlos
```

A mano, equivale a:

```bash
# Firma válida (Developer ID, no ad-hoc) y hardened runtime activo:
codesign -dv --verbose=4 dist/mac-arm64/Lazunox.app

# Gatekeeper acepta el binario (debe decir "accepted", no "rejected"):
spctl -a -vvv dist/mac-arm64/Lazunox.app

# El ticket de notarización quedó grapado al .app y al .dmg:
xcrun stapler validate dist/mac-arm64/Lazunox.app
xcrun stapler validate dist/lazunox-<version>-arm64.dmg
```

Si `spctl` dice `rejected` o `stapler validate` falla, revisar que las variables de notarización estén completas
y volver a correr `npm run package` (sin credenciales, el log dice explícitamente que se omite la notarización; con credenciales
a medias, el empaquetado falla nombrando las que faltan).

## 6. Qué cambia respecto al build ad-hoc

|                                  | Sin `CSC_NAME`/`CSC_LINK` (default)   | Con Developer ID + credenciales de notarización                                                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firma                            | Ad-hoc (`identity: '-'`)              | Developer ID Application (via `CSC_NAME`; `CSC_LINK` solo junto con `CSC_NAME`)                                                                                                                                                                                                          |
| Hardened runtime                 | Off                                   | On, con `build/entitlements.mac.plist`                                                                                                                                                                                                                                                   |
| `cu-helper` / `lazunox-disclaim` | Firmados igual (deep-sign automático) | Firmados explícitamente (`mac.binaries`) y **vueltos a firmar con su identificador** (`HELPER_ID`/`DISCLAIM_ID`) y hardened runtime en `build/notarize.js`, antes de notarizar (electron-builder los deja con `cu-helper-<hash>` y macOS recordaría mal los permisos de Control del Mac) |
| Notarización                     | Omitida (log lo indica)               | `.app`: `build/notarize.js` vía `@electron/notarize` (clave API o Apple ID). `.dmg`: `build/notarize-dmg.js` (`notarytool` + `stapler`)                                                                                                                                                  |
| Gatekeeper en otro Mac           | Rechaza                               | Acepta                                                                                                                                                                                                                                                                                   |
| Permisos TCC entre builds        | Se pierden en cada build              | Se conservan (identidad estable)                                                                                                                                                                                                                                                         |

## 7. Novedades del Lote B que afectan a la distribución

- **Skills empaquetadas:** `resources/opencode/skills/**` va en `asarUnpack` (junto a `agents/**`), y al arrancar
  la app las copia a `userData/opencode-config/skills`. Comprueba en el `.app` que existe
  `Contents/Resources/app.asar.unpacked/resources/opencode/skills/{docx,xlsx,pdf,pptx}/SKILL.md`.
- **Política gestionada (opcional, para despliegues en organizaciones):** un administrador puede crear
  `/Library/Application Support/Lazunox/managed.json` (solo un administrador puede escribir ahí; se relee al cambiar).
  Claves admitidas: `disableFullAccess`, `allowedFolderRoots`, `disableCustomHosts`, `extraAllowedHosts`,
  `disableAlwaysAllow`, `disableRoutines` y `maxAutoArchiveDays`. Un archivo ilegible activa todas las restricciones
  (falla hacia el lado seguro). Detalle en `docs/SEGURIDAD.md` («3 bis»). La variable `LAZUNOX_MANAGED_POLICY` solo
  funciona con la app sin empaquetar.
- Lote C añade dos claves más a `managed.json`: `disableAutoMode` (Modo auto) y `disableBrowser`
  (navegador propio), con el mismo criterio fail-closed que las demás.

## 8. Novedades del Lote C que afectan a la distribución

- **Permisos de Micrófono y Reconocimiento de voz (grabar una skill con micro):** `build/entitlements.mac.plist`
  añade `com.apple.security.device.audio-input` (necesario bajo hardened runtime; sin Developer ID, ad-hoc no lo
  usa) e `Info.plist` (vía `electron-builder.js` → `mac.extendInfo`) declara, en español:
  - `NSMicrophoneUsageDescription`: «Lazunox necesita el micrófono para grabar tu voz al grabar una skill (opcional).»
  - `NSSpeechRecognitionUsageDescription`: «Lazunox necesita reconocimiento de voz para transcribir en el dispositivo
    lo grabado al crear una skill.»

  La primera vez que se grabe una skill con micro, macOS pedirá estos dos permisos por separado (Micrófono y
  luego Reconocimiento de voz), atribuidos al mismo proceso responsable que Accesibilidad/Grabación de pantalla
  (la terminal en desarrollo, o Lazunox empaquetada): no hace falta nada nuevo en Ajustes del Sistema más allá de
  aceptar esos dos prompts la primera vez. **Terminal.app no declara uso de micrófono**: si la grabación con voz
  falla o el proceso aborta al pedir el permiso desde ahí, prueba desde iTerm o VS Code (la grabación sigue
  funcionando sin audio si el permiso falla o se deniega).

- **Navegador propio (`chrome-devtools-mcp`, `browser-mcp.js`): ELIMINADO** en el refactor fase 3 (nota del 2026-09-29). Ya no hay nada que
  desempaquetar ni verificar en el `.app`; el navegador integrado vive dentro del proceso principal.

## 9. Motor embebido (OpenCode dentro del instalador)

El instalador lleva el **OpenCode oficial** como motor, para que nadie tenga que instalar nada. En Windows se copia a
`resources\opencode\opencode.exe`. En macOS viaja como ejecutable de una mini-app firmada, `Lazunox.app/Contents/Resources/opencode/
Lazunox Motor.app` (id `<appId>.motor`, armada por `scripts/stage-motor-app.mjs`, que corre dentro de `npm run package`), y al arrancar
Lazunox la **copia** a `~/Library/Application Support/Lazunox Motor/` (`src/main/opencode/motor-app.ts`). La copia es necesaria: medido en
el registro de TCC, una mini-app anidada en el `.app` se evalúa a nombre de Lazunox y hereda su decisión de privacidad; suelta, macOS la
evalúa como «Lazunox Motor» (el aviso la nombra y `tccutil reset … <appId>.motor` la restablece). La carpeta es hermana de `userData` (el
sandbox de Tareas deniega leer `userData`). La copia se rehace cuando cambia la huella de la maestra y se comprueba su firma en cada
arranque. Si la copia falta o no valida, se usa la maestra anidada y, como último recurso, un `opencode` suelto de un paquete viejo.
Diseño y pruebas: `docs/DISENO-LAZUNOX-MOTOR.md`. En desarrollo (`npm run dev`) no se usa: allí manda el CLI del usuario u `OPENCODE_BIN`.

**Origen y versión.** Es el binario del release oficial de GitHub (`opencode-darwin-arm64.zip`, sin modificar).
Versión, URL, tamaño y **SHA-256** del ZIP están fijados en `resources/opencode-bin/pin.json` (hoy 1.18.33). Cambiar
de versión es cambiar ese fichero, nada más.

**Descarga.** `scripts/fetch-opencode.mjs` baja el ZIP, verifica tamaño y SHA-256 **antes** de descomprimir (si no
coinciden, borra lo descargado y no extrae nada) y deja el binario en `resources/opencode-bin/bin/opencode`
(ignorado por git). Solo se ejecuta dentro de `npm run package` (`--if-missing`); `dev`, `build`, los tests y
`verify` no descargan nada. Sin red, `package` falla con un error explícito.

**Firma.** electron-builder recorre todo el bundle y vuelve a firmar cada Mach-O, también este binario; al
hacerlo cambia el hash del ejecutable respecto al original (es esperable):

- Sin Developer ID: firma **ad-hoc**, igual que el resto de la app. Medido con `npm run verify:bundled` (1.18.33):

  |         | Antes (descargado)                                                 | Después (dentro del .app)                                          |
  | ------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
  | SHA-256 | `139ddeb6a46ba276827bb8f79c7b28208621746e4fd6914d9ae71cc1a0a57524` | `774e92503dbb21d9708651f9a8becd8209d9abe8746a6eb7599b14481be24018` |
  | Tamaño  | 144 800 738 bytes                                                  | 143 959 952 bytes                                                  |
  | Firma   | ad-hoc, `Identifier=a.out`                                         | ad-hoc, `Identifier=opencode-<hash>`                               |

  Solo cambia la firma (identificador y bloque de firma); el `--version` y el servidor siguen igual. El SHA-256
  que se verifica contra el release es el del ZIP (`pin.json`), no el del ejecutable ya firmado.

- Con Developer ID: hardened runtime y `build/entitlements.mac.plist` (que ya trae JIT y memoria ejecutable, lo
  que necesita el motor de JavaScript del binario). El binario también figura en `mac.binaries`, y se notariza
  con el resto de la app.

**Avisos de terceros.** `THIRD_PARTY_NOTICES.md` (raíz) recoge el aviso MIT de OpenCode, el de Bun/JavaScriptCore
(enlazado estáticamente en el binario, LGPL-2, con enlace a las fuentes) y los de Electron/Chromium. Se copia a
`Contents/Resources/THIRD_PARTY_NOTICES.md`, y el `LICENSE` y `LICENSES.chromium.html` de Electron a
`Contents/Resources/licenses/electron/` (ambos vía `extraResources` en `electron-builder.js`). Al subir el pin hay que
actualizar la versión y la URL de la release en ese fichero. El fichero `LICENSE` de Lazunox sigue pendiente
(`verify:release` lo exige aparte).

**Política de actualización.** Fijamos una versión probada y la subimos más o menos una vez al mes, con una versión
nueva de Lazunox. Procedimiento, contrato de la API y qué hacer si algo cambia:
[`ACTUALIZAR-OPENCODE.md`](./ACTUALIZAR-OPENCODE.md).

**Tamaño esperado.** Con OpenCode embebido y el Python de las skills de oficina (`resources/python-bin`, ~134 MB sin comprimir) el `.dmg` mide
**unos 300 MB** (medido con `hdiutil`, UDZO: 302 MiB; el `.app` ocupa ~753 MB). Por encima de 400 MB algo va mal (p. ej. se
empaquetó dos veces).

**Cómo comprobarlo** tras `npm run package`: `npm run verify:bundled` (`scripts/verify-bundled.mjs`) hace todo lo
siguiente de una vez, sin tocar tu `HOME`: `codesign --verify --deep --strict` del `.app`, `--version` == `pin.version`,
el binario sirviendo `/global/health` dentro del perfil Seatbelt real de Tareas (`buildSandboxProfile`, con
`HOME`/`XDG_*` temporales) más un control negativo (el perfil sigue negando leer `userData`), `.dmg` < 400 MB, las herramientas internas
(`cu-helper`, `cu-keys`, Python con sus librerías y las skills de oficina/soporte remoto) y los
avisos de licencias en `Contents/Resources`. A mano:

```bash
ls -lh dist/lazunox-*-arm64.dmg                                  # ~170 MB
APP=dist/mac-arm64/Lazunox.app
codesign --verify --deep --strict "$APP" && echo firma OK
"$APP/Contents/Resources/opencode/opencode" --version             # = "version" de pin.json
ls "$APP/Contents/Resources/THIRD_PARTY_NOTICES.md" "$APP/Contents/Resources/licenses/electron/"
```

Ojo: no ejecutes el binario contra tu `HOME` real (crea datos en `~/.local/share/opencode`, el almacén del CLI; la app usa el suyo en `userData/opencode-data`); usa `HOME` y
`XDG_*` temporales para cualquier prueba distinta de `--version`.

## 10. Publicar una versión y actualizar desde la app

Lazunox avisa de las versiones nuevas (ver `docs/SEGURIDAD.md`, secciones 3 quinquies y 3 septies) y, si esta
copia puede instalar sola, el botón **«Actualizar»** descarga la versión, la verifica y la sustituye. Sin la
clave de firma (`UPDATE_PUBLIC_KEY` vacía) o en una carpeta sin permiso, todo sigue como antes: «Descargar» abre la
página de la release y el usuario arrastra el `.dmg` a Aplicaciones.

### 10.1 Una sola vez: el par de claves de actualización (Ed25519)

La **autenticidad** de una actualización la da **solo** la firma Ed25519 del manifiesto `update.json`. `codesign
--verify` no prueba nada de eso (cualquiera puede generar una firma ad-hoc coherente). La clave **privada** la genera
y guarda quien publica, **fuera del repositorio**, y **nunca** se sube a GitHub ni a un CI.

```bash
mkdir -p ~/.lazunox-keys && chmod 700 ~/.lazunox-keys
# Con OpenSSL 3 (p. ej. Homebrew: /opt/homebrew/bin/openssl; el LibreSSL de /usr/bin/openssl NO sabe Ed25519):
/opt/homebrew/bin/openssl genpkey -algorithm ed25519 -out ~/.lazunox-keys/update.pem
chmod 600 ~/.lazunox-keys/update.pem
/opt/homebrew/bin/openssl pkey -in ~/.lazunox-keys/update.pem -pubout -outform DER | base64     # clave pública

# …o, sin OpenSSL 3, con Node (escribe la privada con permisos 0600 e imprime la pública):
node -e "const c=require('node:crypto');const fs=require('node:fs');const k=c.generateKeyPairSync('ed25519');fs.writeFileSync(process.argv[1],k.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});console.log(k.publicKey.export({type:'spki',format:'der'}).toString('base64'))" ~/.lazunox-keys/update.pem
```

Pega la clave pública (base64, 44 bytes en SPKI DER; también valen los 32 bytes crudos) en `UPDATE_PUBLIC_KEY` de
`src/shared/brand.ts` (y deja `UPDATE_KEY_ID` como identificador de esa clave, p. ej. `lazunox-1`). **Haz copia de
la clave privada** (gestor de contraseñas o disco cifrado aparte).

- **Si se pierde la clave privada:** no se pueden firmar más actualizaciones, y las copias instaladas solo aceptan esa
  clave. No habrá más actualizaciones automáticas: hay que publicar un `.dmg` nuevo (con la clave nueva en
  `brand.ts`) y cada usuario lo baja y lo instala a mano. El aviso de versión nueva sigue funcionando.
- **Si se filtra:** no hay defensa para lo ya instalado (quien la tenga puede firmar una «actualización» que esas copias
  aceptarán). Hay que publicar cuanto antes una versión con clave nueva (rotación, abajo) y avisar a los usuarios.
- **Rotación.** La versión N lleva las dos claves, `[nueva, vieja]`, cada una con su `keyId`, y se firma con la
  **vieja** (así la aceptan las copias anteriores); desde la N+1 se firma con la **nueva**. (El cliente ya admite una
  lista de claves: `verifyWithKeys`, y `resolveInstallConfig` acepta `updateKeys` extra además de la principal; lo que **falta** es
  que `brand.ts` exponga esa lista (hoy una sola constante `UPDATE_PUBLIC_KEY` + `UPDATE_KEY_ID`) y cablearla en `src/main/ipc/update.ts`:
  hazlo **antes de la primera release**, no cuando haga falta rotar.) Procedimiento completo y lista de pasos: `docs/RELEASE.md` § Claves.

### 10.2 Cada versión

1. Subir la versión en `package.json` (semver `X.Y.Z`).
2. `npm run verify:release && npm run package`. La app ya no tiene cuentas ni inicio de sesión (retiradas en 0.4.x; `docs/SEGURIDAD.md` §3 quadragies bis): no hay servidor de cuentas que probar. `verify:release` falla mientras `RELEASES_REPO`, el alias, la
   licencia o `UPDATE_PUBLIC_KEY` (vacía o que no decodifique a una clave Ed25519) sigan sin definir, o si
   `resources/updater/swap.sh` no va en `extraResources`. `npm run verify:bundled` comprueba además que el `.app`
   lleva `Contents/Resources/updater/swap.sh` y que el sello de la firma lo cubre.
3. Generar y firmar la actualización. **Con el CI** (lo habitual, `docs/RELEASE.md`) se hace en dos pasos para que la clave privada no
   salga de tu Mac: el CI corre `node scripts/publish-update.mjs --manifest-only` (ZIP + `update.json` SIN firmar, sin ninguna clave) y tú
   firmas en local con `LAZUNOX_UPDATE_KEY_FILE=~/.lazunox-keys/update.pem node scripts/sign-update.mjs --dir <carpeta con update.json y el ZIP>`
   (comprueba tamaño y SHA-256 del ZIP contra el manifiesto, appId/keyId contra `brand.ts` y que la clave corresponda a `UPDATE_PUBLIC_KEY`;
   escribe `update.json.sig`). **Sin CI**, todo en uno (el ZIP lo hace `ditto`, **no** electron-builder: rompería los symlinks de
   `Electron Framework.framework`):
   ```bash
   LAZUNOX_UPDATE_KEY_FILE=~/.lazunox-keys/update.pem node scripts/publish-update.mjs
   node scripts/verify-update.mjs --dir dist/update        # reproduce la verificación del cliente
   ```
   `publish-update.mjs` rechaza una clave dentro del repo o con permisos más abiertos que `0600`, comprueba que
   corresponde a `UPDATE_PUBLIC_KEY`, no la imprime nunca, crea `dist/update/Lazunox-X.Y.Z-arm64.zip`
   (`ditto -c -k --sequesterRsrc --keepParent dist/mac-arm64/Lazunox.app`), calcula el SHA-256 y escribe
   `update.json` + `update.json.sig` (Ed25519 sobre los bytes exactos del manifiesto).
   **Qué se verifica y dónde** (para no duplicar trabajo): el cliente (`src/main/update/installer.ts`, `signature.ts`,
   `src/shared/update-install.ts`) comprueba la firma Ed25519 sobre los bytes exactos del manifiesto ANTES de leer el JSON,
   su forma, appId/keyId/tag, que la versión sea mayor (anti-downgrade), tamaño y SHA-256 del ZIP, las entradas del ZIP,
   symlinks, `codesign` y `Info.plist`; `swap.sh` hace el reemplazo con **rollback** si la nueva no confirma el arranque
   (`swap.integration.test.ts`). `npm run verify:update-manifest` repite sin red y sin `.app` (con una clave efímera y un ZIP
   falso, en cualquier sistema) las comprobaciones del manifiesto (19 casos: legítimo + cada manipulación rechazada) y mira que
   `UPDATE_PUBLIC_KEY`/`UPDATE_KEY_ID` de `brand.ts` sean válidos; `src/main/update/manifest-script.test.ts` además exige que
   lo firmado por `update-lib.mjs` lo acepte el cliente real. Corre en `npm test`; úsalo antes de publicar junto con
   `verify:release` y, tras `package`, `verify:bundled` y `verify-update.mjs --dir dist/update` (este último sí usa `ditto`/`codesign`).
4. `git tag vX.Y.Z && git push --tags`. El tag debe coincidir con la versión de `package.json` (el manifiesto lo exige).
5. `gh release create vX.Y.Z dist/lazunox-X.Y.Z-arm64.dmg dist/update/Lazunox-X.Y.Z-arm64.zip dist/update/update.json dist/update/update.json.sig --title "Lazunox X.Y.Z"`
   — **sin** `--prerelease` (con una prerelease, `/releases/latest` no la devuelve y nadie recibe el aviso). Los cuatro
   archivos son assets de la misma release.

GitHub sirve `releases/download/...` con una redirección a `release-assets.githubusercontent.com` /
`objects.githubusercontent.com`: el instalador las sigue a mano (máx. 3 saltos, solo https, hosts `github.com` y
`*.githubusercontent.com`, sin credenciales).

### 10.3 Permisos de macOS (TCC) y el certificado autofirmado

Con firma **ad-hoc**, macOS identifica la app por el hash de su código: tras **cada** actualización considera que es
otra app y **vuelve a pedir** Accesibilidad, Grabación de pantalla, etc. Mitigación sin pagar Developer ID: un
**certificado de firma de código autofirmado** que crea el usuario; macOS recuerda los permisos por «identificador +
certificado» y se conservan entre versiones.

1. Acceso a Llaveros → menú _Acceso a Llaveros › Asistente de Certificados › Crear un certificado…_ → nombre
   `Lazunox Local Signing`, _Tipo de identidad:_ **Raíz autofirmada**, _Tipo de certificado:_ **Firma de código**.
   Comprueba que aparece como válido: `security find-identity -v -p codesign`.
2. **Forma recomendada:** `npm run package` (ad-hoc) y después `scripts/sign-release-mac.sh`, que firma `dist/mac-arm64/Lazunox.app` con `codesign`
   (helpers con su identificador), comprueba que la firma contenga el hash que fija `install.sh` y vuelve a armar el `.dmg`. Hace falta porque
   electron-builder se salta la firma cuando el certificado autofirmado no es «de confianza» en el llavero. Para instalar en tu propio Mac
   usa `scripts/sign-installed-mac.sh`. Alternativa de una sola orden, solo si el certificado es de confianza:
   `LAZUNOX_SELF_SIGNED=1 CSC_NAME="Lazunox Local Signing" npm run package`. `electron-builder.js` firma con
   ese certificado, **sin hardened runtime** y **sin notarizar** (ignora las variables `APPLE_*`); sin esa variable el
   comportamiento es exactamente el de siempre. `build/after-sign-self-signed.js` vuelve a firmar
   `cu-helper` y `lazunox-disclaim` con el **mismo certificado** manteniendo `HELPER_ID` y `DISCLAIM_ID` (electron-builder
   los re-firma con un identificador derivado del nombre del archivo, p. ej. `cu-helper-5555…`; con ad-hoc da igual,
   con certificado los permisos se pierden) y resella el `.app`.
3. **La primera migración ad-hoc → autofirmado pedirá los permisos una vez más** (la identidad cambia). Desde ahí,
   las actualizaciones firmadas con el mismo certificado los conservan. Si se pierde el certificado hay que crear otro y
   se vuelven a pedir.
4. Sigue sin haber notarización: Gatekeeper en otro Mac rechazará el primer `.dmg` («no se puede abrir porque no se
   puede verificar al desarrollador»: clic derecho › Abrir). Las actualizaciones hechas por la propia app no pasan por
   Gatekeeper (se les quita la cuarentena tras verificarlas).

(Esto lo hace el usuario; las pruebas del repositorio no crean certificados ni firman con uno.)

### 10.4 Release de un solo comando: `scripts/release.sh`

Los ~15 pasos de sacar una versión (Mac + Windows + GitHub + página) están encadenados por fases en `scripts/release.sh`. No
reemplaza a los scripts de arriba: los llama en el orden que se aprendió a golpes (`docs/VPS.md` para la página; incidente 0.5.24 para
las puertas `npm ls`, `verify:bundled` y `smoke-boot`). Cada fase se detiene al primer fallo, habla en español, y es idempotente: cada
paso exitoso deja `dist/release-state/X.Y.Z/<paso>.ok` con el commit en que se hizo y se salta mientras el commit no cambie
(`--force` lo repite). `--dry-run` solo imprime lo que haría.

| Fase                           | Qué hace                                                                                                                                                                                                                                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prepare X.Y.Z`                | Solo lectura: rama `main` y al día con `origin/main`, árbol limpio, versión en `package.json`, `package-lock.json` y sección en `CHANGELOG.md` (con `release-notes.mjs`), tag libre, `gh` instalado y `npm ls --omit=dev --all` sin `extraneous`/`missing`. Corre también con `--dry-run` (son lecturas).                    |
| `mac X.Y.Z`                    | `npm run package` → `sign-release-mac.sh` → `publish-update.mjs` → `verify-update.mjs` → `npm run verify:bundled` (después de publicar, nunca antes) → `smoke-boot-mac.sh` sobre la `.app` y sobre el ZIP de la release.                                                                                                     |
| `win X.Y.Z`                    | Comprueba el acceso al PC por ssh → `STEPS=ci,package win/sync.sh` → trae `win-unpacked` (por tar + scp) y el instalador → `publish-update.mjs --platform win32-x64` → `verify-update.mjs --platform win32-x64` → `win/pack-check.ps1` en el PC.                                                                              |
| `draft X.Y.Z`                  | `publish-github.mjs` (carpeta `dist/github` con `SHA256SUMS`), notas con `release-notes.mjs` (cambiando `X.Y.Z` por la versión), `gh release create --draft --target main` y comparación del digest SHA-256 de CADA asset contra el archivo local. Si el borrador ya existe, solo compara; si ya está publicada, se niega. |
| `publish X.Y.Z`                | Exige un **terminal interactivo** y que la persona escriba exactamente `publicar vX.Y.Z` (no hay `--yes`; por tubería o en automático se niega). Vuelve a comparar los digests, hace `gh release edit --draft=false --latest`, `site/publicar-descargas.sh`, cambia la versión en `site/lazunox/index.html` y lo sube por scp. |

Al terminar `publish` imprime lo que **falta a mano**: purgar Cloudflare (el token vive en un MCP, no en el script) para el índice, el
`.dmg`, el `.exe`, `latest.json` y `SHA256SUMS`; el comando que baja los instaladores desde el dominio sin caché y compara el SHA-256
con `SHA256SUMS`; confirmar que la release figura como «Latest» y confirmar en git el cambio de `site/lazunox/index.html`.

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
scripts/release.sh prepare 0.5.36          # y arregla lo que falle
scripts/release.sh --dry-run mac 0.5.36    # ver qué haría
scripts/release.sh mac 0.5.36
scripts/release.sh win 0.5.36
scripts/release.sh draft 0.5.36            # revisar el borrador en GitHub
scripts/release.sh publish 0.5.36          # pide la confirmación escrita
```

Variables de entorno (valores por defecto entre paréntesis): `ONYX_WIN_HOST` (`Bentec@100.64.0.6`, el PC de pruebas por Tailscale; es la
misma que usa `win/sync.sh`), `ONYX_WIN_ROOT` (`C:/onyx`), `LAZUNOX_UPDATE_KEY_FILE` (`~/.lazunox-keys/update.pem`; el script solo
comprueba que existe y se la pasa por entorno a `publish-update.mjs`, nunca la lee ni la imprime) y `RELEASE_ALLOW_BRANCH=1` (solo para
probar `prepare` fuera de `main`). La llave `~/.ssh/lazunox_deploy_ed25519` solo la usan `ssh` y `scp` de la fase `publish`.

Pruebas: `src/test/release-script.test.ts` (solo macOS) ejecuta `--dry-run` de todas las fases con un `gh` falso y comprueba el orden de
las fases, el host de Windows por entorno y que `publish` sin terminal no llega a `gh release edit`. **No verificado:** de punta a punta
con una versión real (solo `prepare` y `--dry-run`); `shellcheck` no estaba instalado. Si algo sale mal después de publicar:
`scripts/retirar-release.sh MALA BUENA`.

## 11. Prueba manual del actualizador (dos builds de prueba, todo en directorios temporales)

Comprueba de punta a punta, con dos apps empaquetadas reales, la descarga, verificación, reemplazo, arranque confirmado
y el rollback. No toca `/Applications`, ni `~/Library/Application Support/Lazunox`, ni `~/.local/share/opencode`, y no
hace peticiones a GitHub (un servidor local imita la release). Usa un **build de prueba** (`LAZUNOX_TEST_BUILD=1`, se
sustituye en compilación: un build normal no contiene estos ganchos): honra las variables `LAZUNOX_TEST_*` aunque esté
empaquetado, acepta cualquier carpeta de instalación y `swap.sh` en modo de prueba arranca la app por ejecución directa
(sin `open`) con `--user-data-dir` propio. `LAZUNOX_TEST_FAIL_BOOT=1` (la app nueva no confirma el arranque) **solo** se
honra en este build.

```bash
export T=~/tmp/lazunox-update-test; mkdir -p $T/keys
export TMPDIR=$(cd ~/tmp && pwd -P)/      # swap.sh en modo de prueba exige que el destino esté bajo $TMPDIR (ruta real)
REPO=$PWD

# 1. Copia del repo (sin node_modules) para no ensuciar out/ ni dist/; clave de PRUEBA desechable
tar cf - --exclude=./node_modules --exclude=./.git --exclude=./dist --exclude=./out . | (mkdir -p $T/wt && tar xf - -C $T/wt)
ln -s $REPO/node_modules $T/wt/node_modules
openssl genpkey -algorithm ed25519 -out $T/keys/update.pem && chmod 600 $T/keys/update.pem   # OpenSSL 3 (ver §10.1)
PUB=$(openssl pkey -in $T/keys/update.pem -pubout -outform DER | base64)
python3 - "$T/wt/src/shared/brand.ts" "$PUB" <<'PY'
import sys; p,k=sys.argv[1:]; s=open(p).read()
open(p,'w').write(s.replace("UPDATE_PUBLIC_KEY = '' as string","UPDATE_PUBLIC_KEY = '%s' as string"%k))
PY

# 2. Dos builds de prueba: la «vieja» (0.3.0) y la «nueva» (0.3.1)
build() { (cd $T/wt && node -e "const f=require('fs'),p=JSON.parse(f.readFileSync('package.json'));p.version='$1';f.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')" \
  && LAZUNOX_TEST_BUILD=1 npm run build && npx electron-builder --mac --arm64 --dir -c electron-builder.js --config.directories.output=$2); }
build 0.3.0 $T/out-old
build 0.3.1 $T/out-new
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/verify-bundled.mjs --app $T/out-new/mac-arm64/Lazunox.app --dmg /no.dmg  # swap.sh presente y sellado (el .dmg fallará: es normal)

# 3. Publicar la «nueva» con la clave de prueba y servirla en local
(cd $T/wt && LAZUNOX_UPDATE_KEY_FILE=$T/keys/update.pem node scripts/publish-update.mjs --app $T/out-new/mac-arm64/Lazunox.app --out $T/release \
  && node scripts/verify-update.mjs --dir $T/release --current 0.3.0)
node scripts/serve-test-release.mjs --dir $T/release --port 8799 &        # 127.0.0.1 solamente

# 4. Caso A — actualización correcta. «Instalada» = copia de la vieja en $T/a/app
mkdir -p $T/a/app $T/a/userdata && ditto $T/out-old/mac-arm64/Lazunox.app $T/a/app/Lazunox.app
env LAZUNOX_TEST_RELEASES_API=http://127.0.0.1:8799 LAZUNOX_TEST_RELEASES_REPO=test-owner/test-repo \
    LAZUNOX_TEST_UPDATE_DELAY_MS=500 LAZUNOX_TEST_UPDATE_PUBKEY="$PUB" \
    LAZUNOX_SWAP_TEST_NO_OPEN=1 LAZUNOX_SWAP_TEST_EXEC=Lazunox LAZUNOX_SWAP_TEST_USERDATA=$T/a/userdata \
    $T/a/app/Lazunox.app/Contents/MacOS/Lazunox --user-data-dir=$T/a/userdata &
#    En la ventana: aviso «Hay una versión nueva de Lazunox (0.3.1)» → «Actualizar» → Descargando (%) → Verificando →
#    «Lista: reinicia» → «Reiniciar ahora».
```

Esperado (caso A): la app vieja se cierra; `swap.sh` espera su PID, mueve `Lazunox.app` a `.Lazunox.app.bak-0.3.0`
(misma carpeta), pone la nueva y la arranca; la nueva escribe `booting-0.3.1` (su PID) y, tras cargar la ventana y
confirmar el renderer, `boot-ok-0.3.1`. `$T/a/userdata/update/result.json` = `{"version":"0.3.1","ok":true,"rolledBack":false,"error":""}`,
`Info.plist` de `$T/a/app/Lazunox.app` dice 0.3.1 y `codesign --verify --deep --strict` pasa. Al **volver a abrir** la
app nueva (siguiente sesión), borra la copia `.bak-0.3.0`, los marcadores viejos y el staging.

Caso B — rollback forzado: igual que A (carpetas `$T/b/...`, copia nueva de la vieja) añadiendo
`LAZUNOX_SWAP_TEST_FAIL_NEW=1 LAZUNOX_SWAP_WAIT_BOOT=25` al `env` de la app vieja (acorta la espera de 90 s). La app
nueva se lanza con `LAZUNOX_TEST_FAIL_BOOT=1`: escribe `booting-0.3.1` pero nunca `boot-ok-0.3.1`. Esperado: a los 25 s
`swap.sh` mata el PID de la nueva (solo si su línea de comandos está dentro del `.app` nuevo), la aparta a
`.Lazunox.app.failed-0.3.1`, restaura la vieja, la abre y escribe `{"version":"0.3.1","ok":false,"rolledBack":true,"error":"boot-timeout"}`.
La app vieja lo lee al iniciar y muestra «La versión nueva no arrancó bien y se volvió a la anterior.»; después borra
los restos (`.failed`).

Limpieza: `pkill -f lazunox-update-test; rm -rf $T` (incluye la clave de prueba; no es la de producción).

Caso C — `swap.sh` sin reemplazar nada si la app vieja no termina: lo cubre
`src/main/update/swap.integration.test.ts` (PID que no muere → `pid-timeout`, sin tocar nada).

**Qué NO cubre esta prueba:** `open -n` real (LaunchServices) en vez de la ejecución directa, permisos TCC reales,
Gatekeeper en otro Mac, la protección «Gestión de apps» de macOS 13+ al modificar `/Applications`, proxy corporativo y
disco lleno.

## 12. Windows: instalador NSIS (v1, sin firma)

- **Construir:** en un PC Windows con Node 22, `npm ci` y `npm run package:win` (descarga el OpenCode fijado para `win32-x64` con `scripts/fetch-opencode.mjs --if-missing`, compila y llama a `node node_modules/electron-builder/cli.js --win nsis --x64`; no se usa el binario `electron-builder` a secas porque en `cmd` se ejecutaría `electron-builder.js` con Windows Script Host). Salida: `dist\Lazunox-Setup-<versión>-x64.exe` (≈ 152 MB) y `dist\win-unpacked`. No se puede construir el instalador de Windows desde la Mac sin Wine; el de macOS (`npm run package`) no cambia (cada plataforma lleva sus `extraResources`).
- **Qué lleva:** instalador asistido, **por usuario** (sin administrador; `perMachine: false`), con carpeta elegible; `resources\opencode\opencode.exe` (1.18.33), node-pty desempaquetado (`conpty.node`, `conpty.dll`, `OpenConsole.exe`), icono `build/icon.ico` (16–256 px, generado con `node build/make-ico.mjs` desde `build/icon.png`) y los mismos fuses que en macOS. No lleva el actualizador, el helper de Control del PC ni el lanzador de macOS.
- **Sin firma:** no hay certificado de firma de código de Windows. Consecuencias que no se pueden comprobar sin él: **SmartScreen** mostrará «Windows protegió su PC» al ejecutar el instalador descargado (el usuario pulsa «Más información › Ejecutar de todas formas») y Defender puede tardar en confiar en el ejecutable. Para firmarlo hace falta un certificado y `win.certificateSubjectName`/`CSC_LINK`; electron-builder firma entonces el `.exe` y el desinstalador.
- **Qué esperar de SmartScreen (2026):** desde marzo de 2024 un certificado **EV ya no da reputación inmediata**: EV y OV la ganan igual, con descargas limpias a lo largo del tiempo, así que **el primer instalador firmado seguirá mostrando el aviso**. Desde junio de 2023 la clave de cualquier certificado de firma de código debe vivir en un HSM o un token (USB o nube): ya no sirve un `.p12` suelto en CI.
- **Opciones de firma desde Chile** (precios de referencia, comprobar antes de contratar): **Azure Artifact Signing** (antes Trusted Signing, ~10 USD/mes) **no está disponible** para personas en Chile (solo individuos de EE. UU. y Canadá y organizaciones de EE. UU., Canadá, UE y Reino Unido). **SignPath Foundation**: gratis para código abierto (exige licencia OSI sin doble licencia comercial, repositorio público ya con cierta reputación y política de firma publicada; el editor visible es «SignPath Foundation»; preguntarles por la cuenta obligatoria contra `api.onyxcode.cl`). **Certum Open Source** (nube, ~49 EUR, solo individuos, firma con código del móvil: difícil de automatizar, se firma en local). **OV comercial** (Sectigo, SSL.com…, unos 200–400 USD/año más token o nube). Ninguna quita el aviso el primer día.
- **Verificar:** `scripts/win/pack-check.ps1 -Install` (ver `docs/VERIFICACION.md` › «Paquete de Windows»). **Actualizar:** la app de Windows ya tiene actualizador propio (sección 12.1), pero queda apagado mientras `UPDATE_PUBLIC_KEY` esté vacía; sin él se instala la versión nueva encima.

### 12.1 Windows: publicar y firmar una actualización

El actualizador de Windows usa el mismo esquema que el del Mac: un manifiesto firmado con Ed25519 y un ZIP. Cambian los nombres y el
contenido del ZIP. La clave privada es **la misma** y se queda en tu Mac; el campo `platform` va dentro de lo firmado, así que un
manifiesto de Windows no sirve en el Mac ni al revés.

|                                             | macOS                                           | Windows                                                                              |
| ------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| Manifiesto y firma                          | `update.json`, `update.json.sig`                | `update-win32-x64.json`, `update-win32-x64.json.sig`                                 |
| ZIP                                         | `Lazunox-X.Y.Z-arm64.zip` (raíz `Lazunox.app/`) | `Lazunox-X.Y.Z-win32-x64.zip` (raíz `Lazunox/`, el contenido de `dist\win-unpacked`) |
| Instalador para quien llega por primera vez | `.dmg`                                          | `Lazunox-Setup-X.Y.Z-x64.exe`                                                        |

Pasos (el ZIP se arma en el Mac, en JavaScript, sin `tar.exe`; así se puede revisar y repetir con los mismos bytes):

```bash
# 1. En el PC Windows: npm run package:win  (deja dist\win-unpacked y el Setup.exe). Copia dist\win-unpacked al Mac.
# 2. En el Mac, con la versión de package.json igual a la del app.asar copiado:
LAZUNOX_UPDATE_KEY_FILE=~/.lazunox-keys/update.pem \
  node scripts/publish-update.mjs --platform win32-x64 --app <ruta>/win-unpacked --out dist/update-win
#    (o en dos pasos, como en el Mac: añade --manifest-only, sin clave, y luego)
LAZUNOX_UPDATE_KEY_FILE=~/.lazunox-keys/update.pem \
  node scripts/sign-update.mjs --platform win32-x64 --dir dist/update-win
# 3. Revisar lo publicado (firma, hash, estructura del ZIP y versión del asar):
node scripts/verify-update.mjs --platform win32-x64 --dir dist/update-win
```

Qué revisan los scripts de Windows antes de firmar o dar por bueno: que estén `Lazunox.exe`, `resources\app.asar` y
`resources\opencode\opencode.exe`; que todos los nombres sean seguros en Windows (sin `..`, `\`, `:`, nombres reservados como `aux`
o `con`, ni mayúsculas/minúsculas repetidas) y cuelguen de `Lazunox/`; que no haya enlaces simbólicos; y que el `package.json` del
`app.asar` diga `lazunox` y la versión del manifiesto. Sube los **cuatro** archivos a la release (manifiesto, firma, ZIP e
instalador). Con `--platform` sin indicar, los tres scripts siguen trabajando para el Mac como antes.

**Verificado (pruebas en macOS, `src/test/update-scripts-win.test.ts`, con un `win-unpacked` falso y claves de prueba):** publicar y
firmar, que el ZIP sea idéntico en dos ejecuciones, que `WinUpdateInstaller` (el de la app) acepte lo generado, que rechace hash,
`platform` y versión manipulados y un asar de otra versión, y que el lector de ZIP/asar de los scripts coincida con `zip-index.ts` y
`asar-version.ts`. La extracción de esa prueba usa el `tar` de macOS (bsdtar), no el de Windows. **Verificado en un PC Windows real:**
`swap.ps1` con `scripts/win/swap-check.ps1` (camino feliz, vuelta atrás y argumentos hostiles: 0 fallos).

**Tamaño con la imagen de Tareas incluida (beta opcional, decisión del dueño 2026-10-07; nada de esto se publica).** Cuando `resources\wsl\images` entra al paquete (imagen `lazunox-rootfs-2026.10.1-x64.tar.gz`, 77 545 052 bytes, y el OpenCode de Linux, ~55-60 MB sin medir) `win-unpacked` crece **~135 MB** y, como ya son `.tar.gz`, no comprimen: el instalador `Setup.exe` y el ZIP de la actualización crecen casi lo mismo (~135 MB). Revisión de los topes (con prueba en `src/test/update-scripts-win.test.ts`): el tope del ZIP (`ZIP_MAX_BYTES`, 600 MB) deja sitio hasta un ZIP base de ~465 MB, muy por encima de lo esperado (~200 MB base, ~335 MB con imágenes); el tope descomprimido (`winUncompressedCap` = 3x ZIP + 1 GiB, igual que `installer-win.ts`) no se acerca porque lo incompresible baja la razón total/ZIP; `MAX_ENTRIES` y el espacio libre exigido (`total x 1,5 + 256 MB` en el volumen de la instalación, y 3x el ZIP en la descarga) no cambian de fórmula, pero la actualización pide ~135 MB más de disco. **No hizo falta cambiar ningún tope.** `pack-check.ps1` sí: el tamaño razonable del instalador pasó de 400 a 520 MB. El tamaño real del ZIP **no está medido** (hace falta un `win-unpacked` real con las imágenes en el PC): si supera ~450 MB hay que revisar `ZIP_MAX_BYTES`. `swap.ps1` renombra la carpeta de la app: **no debe haber nada abierto bajo `resources\wsl\images`** en ese momento; por eso el setup copia la imagen a la caché (`%LOCALAPPDATA%\Lazunox\wsl`) y trabaja desde ahí, nunca «en el sitio» ni con `wsl --import` leyendo del paquete. Cambiar la imagen exige subir la `version` del pin (solo se avanza, no se reinstala una anterior). El desinstalador pregunta si quitar la distro `Lazunox-Tareas` (NO en silencioso y en actualizaciones).

**No verificado:** `tar.exe` de Windows extrayendo un ZIP de estos scripts; el reemplazo completo con la app real (no solo `swap.ps1`
con un ejecutable de prueba); el instalador NSIS por usuario con una actualización real encima; Defender sobre el ZIP; y la clave
pública: `UPDATE_PUBLIC_KEY` sigue vacía, así que hoy el actualizador está apagado en Mac y Windows y los scripts se niegan a publicar.

### 12.2 Windows: Control del PC en el paquete (apagado)

- **Hoy no entra nada.** Mientras `TASKS_WIN_BUILD` sea `false`, ni `cu-helper.exe` ni el agente `computer.win.md` van en el instalador (ni en el `.asar`, ni en el paquete de macOS): `files` excluye `resources/opencode/agents-win/computer.win.md` y todo `resources/computer-use/win/**`. Esa exclusión del `.asar` ya existía para los fuentes de Rust y `target/`; no se duplicó.
- **Cuándo entran:** solo con la función activa (`TASKS_WIN_BUILD = true` en `src/shared/feature-flags.ts`; ya no hace falta `LAZUNOX_COMPUTER_WIN_PACK=1`). Con ella activa y sin `cu-helper.exe` compilado, `check-win-bundle` hace fallar el empaquetado. Entonces `win.extraResources` copia **solo** `resources/computer-use/win/bin/cu-helper.exe` → `resources\computer-use\bin\` (compílalo antes con `node scripts/build-native.mjs --win-helper`; `npm run package:win` no lo compila) y `computer.win.md` → `resources\opencode\agents\`, fuera del asar, donde `computer-agent.ts` lo busca. Nunca los fuentes de Rust ni `target/`.
- **Comprobar:** `node scripts/check-win-bundle.mjs --config-only` valida `electron-builder.js` (helper y agente solo en `win.extraResources`, solo con la función activa, con el filtro exacto, y la exclusión del `.asar` intacta); sin `--config-only` además revisa `out/main/index.js` (requiere `npm run build`). Pruebas: `node --test scripts/check-win-bundle.test.mjs`.
- **Sin firma Authenticode (pendiente):** el helper iría sin firmar. Un exe sin firmar que combina gancho de teclado, SendInput y captura de pantalla puede ser puesto en cuarentena por la heurística de Defender; **no se ha probado** un escaneo a demanda (`scripts\win\run-cu.ps1 -Step defender`, a pedido del dueño). Que el helper aparezca o no tras instalar es lo primero que habría que mirar. Decisión del dueño: firma antes de publicar (véase `docs/SEGURIDAD.md`, «3 quadragies quinquies»).
- **No hay actualización del helper por separado:** viaja dentro del ZIP de la actualización (raíz `Lazunox/`), sin tocar `scripts/update-lib.mjs`; si el ZIP no lo lleva, la función queda no disponible.

## 11. Publicar el sitio del control remoto (fuera de casa): primero el sitio, después la app

La página del celular en `remoto.onyxcode.cl` y la app del Mac son versiones distintas que deben seguir entendiéndose (la interfaz React llama a canales IPC de la versión del Mac). **Orden obligatorio al publicar: 1) el sitio, 2) la app.**
El sitio conserva la unión de los `app/assets` de las últimas 10 versiones, así que un Mac con una versión anterior sigue encontrando los archivos de su interfaz; el Mac manda por el canal los hashes de la suya (`entry`) y la página la carga con `integrity`.
Todo se hace desde el Mac del dueño, sin CI y sin secretos en el repositorio: `npm run build:pwa` → `node scripts/build-site.mjs` → `LAZUNOX_SITE_KEY_FILE=~/.lazunox-keys/site.pem node scripts/site-release.mjs` (firma `site-manifest.json`; con `--build` compila antes)
→ `cd cloud/remoto-worker && npx wrangler@4 deploy` (lo imprime `site-release`; pasos completos y la clave de firma en `cloud/remoto-worker/README.md`). La clave **pública** de firma va en `SITE_PUBLIC_KEY` de `src/shared/brand.ts` y viaja en la app: hay que
empaquetar la app con ella antes de que la vigilancia verifique algo. `site-archive/` (carpeta local, en `.gitignore`) guarda esas 10 versiones: no se borra entre publicaciones.
