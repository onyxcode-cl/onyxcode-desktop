# Distribución de OnyxCode (firma + notarización)

`npm run package` funciona sin nada de esto: firma **ad-hoc** (`identity: '-'`) porque los fuses de
Electron (`electron-builder.js` → `electronFuses`) modifican el binario y, sin volver a firmarlo,
macOS lo mata al abrir. Un build ad-hoc sirve para probar en esta máquina, pero:

- Gatekeeper lo rechaza en cualquier otro Mac (`spctl -a -vvv` → `rejected`).
- Cada build cambia de "identidad" ante TCC: macOS olvida los permisos de Accesibilidad/Grabación de
  pantalla que el usuario concedió a una build anterior, y hay que volver a concederlos.

Para repartir OnyxCode a otra persona (o subirlo a algún sitio) hace falta firmarlo con un
**Developer ID Application** de Apple y notarizarlo. La config ya está lista
(`electron-builder.js`, `build/entitlements.mac.plist`, `build/notarize.js`): solo falta que
alguien con una cuenta de Apple Developer aporte el certificado y las credenciales.

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

## 2. Crear una contraseña específica de app (para notarizar)

La notarización usa `notarytool`, que necesita autenticarse contra Apple con el Apple ID **dueño**
del Developer ID (no la contraseña normal de la cuenta):

1. Entrar a <https://appleid.apple.com/account/manage> con ese Apple ID.
2. **Inicio de sesión y seguridad** → **Contraseñas específicas de apps** → **Generar contraseña…**
   → ponerle un nombre (p. ej. "OnyxCode notarize") → copiar la contraseña `xxxx-xxxx-xxxx-xxxx` que
   muestra (solo se ve una vez).
3. El **Team ID** se ve en <https://developer.apple.com/account> → **Membership** (o en el propio
   nombre del certificado, entre paréntesis: `(EQUIPOID)`).

## 3. Variables de entorno

```bash
export CSC_NAME="Developer ID Application: Nombre Apellido (EQUIPOID)"
# — o, si el certificado no está en el Llavero de esta máquina —
# export CSC_LINK=/ruta/al/certificado.p12
# export CSC_KEY_PASSWORD="contraseña del .p12"

export APPLE_ID="tu-apple-id@ejemplo.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="EQUIPOID"
```

Sin `CSC_NAME`/`CSC_LINK`, `electron-builder.js` sigue el camino ad-hoc de siempre (nada cambia). Si
solo se define `CSC_NAME`/`CSC_LINK` pero faltan las tres variables de `APPLE_*`, el build queda
**firmado pero sin notarizar** (`npm run package` avisa por consola) — Gatekeeper lo bloqueará igual
al abrirlo en otro Mac, así que conviene definir las cinco variables juntas.

## 4. Compilar

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
npm run package
```

Con las variables puestas, verás en la salida:

- `signing file=dist/mac-arm64/OnyxCode.app … identityName=Developer ID Application: …`
- `[notarize] enviando dist/mac-arm64/OnyxCode.app a Apple (equipo EQUIPOID)…` seguido de
  `[notarize] notarización completa.` (puede tardar varios minutos: Apple procesa el binario en su
  nube antes de responder).

El `.dmg` queda en `dist/onyxcode-<version>-arm64.dmg`.

## 5. Verificar la firma y la notarización

```bash
# Firma válida (Developer ID, no ad-hoc) y hardened runtime activo:
codesign -dv --verbose=4 dist/mac-arm64/OnyxCode.app

# Gatekeeper acepta el binario (debe decir "accepted", no "rejected"):
spctl -a -vvv dist/mac-arm64/OnyxCode.app

# El ticket de notarización quedó grapado al .app y al .dmg:
xcrun stapler validate dist/mac-arm64/OnyxCode.app
xcrun stapler validate dist/onyxcode-<version>-arm64.dmg
```

Si `spctl` dice `rejected` o `stapler validate` falla, revisar que las cinco variables estén bien
puestas y volver a correr `npm run package` (el afterSign solo notariza si las tres `APPLE_*` están
presentes; si faltan, el log lo dice explícitamente en vez de fallar en silencio).

## 6. Qué cambia respecto al build ad-hoc

| | Sin `CSC_NAME`/`CSC_LINK` (default) | Con Developer ID + `APPLE_*` |
|---|---|---|
| Firma | Ad-hoc (`identity: '-'`) | Developer ID Application (via `CSC_NAME`/`CSC_LINK`, electron-builder los detecta solo) |
| Hardened runtime | Off | On, con `build/entitlements.mac.plist` |
| `cu-helper` / `onyxcode-disclaim` | Firmados igual (deep-sign automático) | Firmados explícitamente (`mac.binaries`) |
| Notarización | Omitida (log lo indica) | `build/notarize.js` vía `@electron/notarize` |
| Gatekeeper en otro Mac | Rechaza | Acepta |
| Permisos TCC entre builds | Se pierden en cada build | Se conservan (identidad estable) |

## 7. Novedades del Lote B que afectan a la distribución

- **Skills empaquetadas:** `resources/opencode/skills/**` va en `asarUnpack` (junto a `agents/**`), y al arrancar
  la app las copia a `userData/opencode-config/skills`. Comprueba en el `.app` que existe
  `Contents/Resources/app.asar.unpacked/resources/opencode/skills/{docx,xlsx,pdf,pptx}/SKILL.md`.
- **Política gestionada (opcional, para despliegues en organizaciones):** un administrador puede crear
  `/Library/Application Support/OnyxCode/managed.json` (solo un administrador puede escribir ahí; se relee al cambiar).
  Claves admitidas: `disableFullAccess`, `allowedFolderRoots`, `disableCustomHosts`, `extraAllowedHosts`,
  `disableAlwaysAllow`, `disableRoutines` y `maxAutoArchiveDays`. Un archivo ilegible activa todas las restricciones
  (falla hacia el lado seguro). Detalle en `docs/SEGURIDAD.md` («3 bis»). La variable `ONYXCODE_MANAGED_POLICY` solo
  funciona con la app sin empaquetar.
- Lote C añade dos claves más a `managed.json`: `disableAutoMode` (Modo auto) y `disableBrowser`
  (navegador propio), con el mismo criterio fail-closed que las demás.

## 8. Novedades del Lote C que afectan a la distribución

- **Permisos de Micrófono y Reconocimiento de voz (grabar una skill con micro):** `build/entitlements.mac.plist`
  añade `com.apple.security.device.audio-input` (necesario bajo hardened runtime; sin Developer ID, ad-hoc no lo
  usa) e `Info.plist` (vía `electron-builder.js` → `mac.extendInfo`) declara, en español:
  - `NSMicrophoneUsageDescription`: «OnyxCode necesita el micrófono para grabar tu voz al grabar una skill (opcional).»
  - `NSSpeechRecognitionUsageDescription`: «OnyxCode necesita reconocimiento de voz para transcribir en el dispositivo
    lo grabado al crear una skill.»

  La primera vez que se grabe una skill con micro, macOS pedirá estos dos permisos por separado (Micrófono y
  luego Reconocimiento de voz), atribuidos al mismo proceso responsable que Accesibilidad/Grabación de pantalla
  (la terminal en desarrollo, o OnyxCode empaquetada): no hace falta nada nuevo en Ajustes del Sistema más allá de
  aceptar esos dos prompts la primera vez. **Terminal.app no declara uso de micrófono**: si la grabación con voz
  falla o el proceso aborta al pedir el permiso desde ahí, prueba desde iTerm o VS Code (la grabación sigue
  funcionando sin audio si el permiso falla o se deniega).
- **Navegador propio (`chrome-devtools-mcp`, `browser-mcp.js`): ELIMINADO** en el refactor fase 3 (nota del 2026-09-29). Ya no hay nada que
  desempaquetar ni verificar en el `.app`; el navegador integrado vive dentro del proceso principal.

## 9. Motor embebido (OpenCode dentro del instalador)

El instalador lleva el **OpenCode oficial** como motor, para que nadie tenga que instalar nada. Se copia a
`OnyxCode.app/Contents/Resources/opencode/opencode` (dentro del `.app` y no en `userData`, para que el perfil
Seatbelt de Tareas pueda ejecutarlo). En desarrollo (`npm run dev`) no se usa: allí manda el CLI del usuario u
`OPENCODE_BIN`.

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

  | | Antes (descargado) | Después (dentro del .app) |
  | --- | --- | --- |
  | SHA-256 | `139ddeb6a46ba276827bb8f79c7b28208621746e4fd6914d9ae71cc1a0a57524` | `774e92503dbb21d9708651f9a8becd8209d9abe8746a6eb7599b14481be24018` |
  | Tamaño | 144 800 738 bytes | 143 959 952 bytes |
  | Firma | ad-hoc, `Identifier=a.out` | ad-hoc, `Identifier=opencode-<hash>` |

  Solo cambia la firma (identificador y bloque de firma); el `--version` y el servidor siguen igual. El SHA-256
  que se verifica contra el release es el del ZIP (`pin.json`), no el del ejecutable ya firmado.
- Con Developer ID: hardened runtime y `build/entitlements.mac.plist` (que ya trae JIT y memoria ejecutable, lo
  que necesita el motor de JavaScript del binario). El binario también figura en `mac.binaries`, y se notariza
  con el resto de la app.

**Avisos de terceros.** `THIRD_PARTY_NOTICES.md` (raíz) recoge el aviso MIT de OpenCode, el de Bun/JavaScriptCore
(enlazado estáticamente en el binario, LGPL-2, con enlace a las fuentes) y los de Electron/Chromium. Se copia a
`Contents/Resources/THIRD_PARTY_NOTICES.md`, y el `LICENSE` y `LICENSES.chromium.html` de Electron a
`Contents/Resources/licenses/electron/` (ambos vía `extraResources` en `electron-builder.js`). Al subir el pin hay que
actualizar la versión y la URL de la release en ese fichero. El fichero `LICENSE` de OnyxCode sigue pendiente
(`verify:release` lo exige aparte).

**Política de actualización.** Fijamos una versión probada y la subimos más o menos una vez al mes, con una versión
nueva de OnyxCode. Procedimiento, contrato de la API y qué hacer si algo cambia:
[`ACTUALIZAR-OPENCODE.md`](./ACTUALIZAR-OPENCODE.md).

**Tamaño esperado.** El `.dmg` pasa de unos 130 MB a **unos 170 MB** (el binario ocupa ~100 MB sin comprimir). Por
encima de 200 MB algo va mal (p. ej. se empaquetó dos veces).

**Cómo comprobarlo** tras `npm run package`: `npm run verify:bundled` (`scripts/verify-bundled.mjs`) hace todo lo
siguiente de una vez, sin tocar tu `HOME`: `codesign --verify --deep --strict` del `.app`, `--version` == `pin.version`,
el binario sirviendo `/global/health` dentro del perfil Seatbelt real de Tareas (`buildSandboxProfile`, con
`HOME`/`XDG_*` temporales) más un control negativo (el perfil sigue negando leer `userData`), `.dmg` < 200 MB y los
avisos de licencias en `Contents/Resources`. A mano:

```bash
ls -lh dist/onyxcode-*-arm64.dmg                                  # ~170 MB
APP=dist/mac-arm64/OnyxCode.app
codesign --verify --deep --strict "$APP" && echo firma OK
"$APP/Contents/Resources/opencode/opencode" --version             # = "version" de pin.json
ls "$APP/Contents/Resources/THIRD_PARTY_NOTICES.md" "$APP/Contents/Resources/licenses/electron/"
```

Ojo: no ejecutes el binario contra tu `HOME` real (crea datos en `~/.local/share/opencode`, el almacén del CLI; la app usa el suyo en `userData/opencode-data`); usa `HOME` y
`XDG_*` temporales para cualquier prueba distinta de `--version`.

## 10. Publicar una versión y actualizar desde la app

OnyxCode avisa de las versiones nuevas (ver `docs/SEGURIDAD.md`, secciones 3 quinquies y 3 septies) y, si esta
copia puede instalar sola, el botón **«Actualizar»** descarga la versión, la verifica y la sustituye. Sin la
clave de firma (`UPDATE_PUBLIC_KEY` vacía) o en una carpeta sin permiso, todo sigue como antes: «Descargar» abre la
página de la release y el usuario arrastra el `.dmg` a Aplicaciones.

### 10.1 Una sola vez: el par de claves de actualización (Ed25519)

La **autenticidad** de una actualización la da **solo** la firma Ed25519 del manifiesto `update.json`. `codesign
--verify` no prueba nada de eso (cualquiera puede generar una firma ad-hoc coherente). La clave **privada** la genera
y guarda quien publica, **fuera del repositorio**, y **nunca** se sube a GitHub ni a un CI.

```bash
mkdir -p ~/.onyxcode-keys && chmod 700 ~/.onyxcode-keys
# Con OpenSSL 3 (p. ej. Homebrew: /opt/homebrew/bin/openssl; el LibreSSL de /usr/bin/openssl NO sabe Ed25519):
/opt/homebrew/bin/openssl genpkey -algorithm ed25519 -out ~/.onyxcode-keys/update.pem
chmod 600 ~/.onyxcode-keys/update.pem
/opt/homebrew/bin/openssl pkey -in ~/.onyxcode-keys/update.pem -pubout -outform DER | base64     # clave pública

# …o, sin OpenSSL 3, con Node (escribe la privada con permisos 0600 e imprime la pública):
node -e "const c=require('node:crypto');const fs=require('node:fs');const k=c.generateKeyPairSync('ed25519');fs.writeFileSync(process.argv[1],k.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});console.log(k.publicKey.export({type:'spki',format:'der'}).toString('base64'))" ~/.onyxcode-keys/update.pem
```

Pega la clave pública (base64, 44 bytes en SPKI DER; también valen los 32 bytes crudos) en `UPDATE_PUBLIC_KEY` de
`src/shared/brand.ts` (y deja `UPDATE_KEY_ID` como identificador de esa clave, p. ej. `onyxcode-1`). **Haz copia de
la clave privada** (gestor de contraseñas o disco cifrado aparte).

- **Si se pierde la clave privada:** no se pueden firmar más actualizaciones, y las copias instaladas solo aceptan esa
  clave. No habrá más actualizaciones automáticas: hay que publicar un `.dmg` nuevo (con la clave nueva en
  `brand.ts`) y cada usuario lo baja y lo instala a mano. El aviso de versión nueva sigue funcionando.
- **Si se filtra:** no hay defensa para lo ya instalado (quien la tenga puede firmar una «actualización» que esas copias
  aceptarán). Hay que publicar cuanto antes una versión con clave nueva (rotación, abajo) y avisar a los usuarios.
- **Rotación.** La versión N lleva las dos claves, `[nueva, vieja]`, cada una con su `keyId`, y se firma con la
  **vieja** (así la aceptan las copias anteriores); desde la N+1 se firma con la **nueva**. (El cliente ya admite una
  lista de claves; `brand.ts` tiene hoy una sola constante `UPDATE_PUBLIC_KEY` + `UPDATE_KEY_ID`: para rotar hay que
  ampliarla a una lista.)

### 10.2 Cada versión

1. Subir la versión en `package.json` (semver `X.Y.Z`).
2. `npm run verify:release && npm run package`. La app empaquetada contacta el servidor de cuentas `ACCOUNT_API` (`https://api.onyxcode.cl`, `src/shared/brand.ts`) y exige iniciar sesión; `verify:release` no exige `ACCOUNT_API` (ya está definido), pero antes de publicar hay que probar a mano el login con el servidor real (`docs/CUENTAS-ACTIVACION.md`). `ONYXCODE_ACCOUNT_DISABLED` solo apaga la cuenta sin empaquetar (E2E): en el paquete se ignora. `verify:release` falla mientras `RELEASES_REPO`, el alias, la
   licencia o `UPDATE_PUBLIC_KEY` (vacía o que no decodifique a una clave Ed25519) sigan sin definir, o si
   `resources/updater/swap.sh` no va en `extraResources`. `npm run verify:bundled` comprueba además que el `.app`
   lleva `Contents/Resources/updater/swap.sh` y que el sello de la firma lo cubre.
3. Generar y firmar la actualización (el ZIP lo hace `ditto`, **no** electron-builder: rompería los symlinks de
   `Electron Framework.framework`):
   ```bash
   ONYXCODE_UPDATE_KEY_FILE=~/.onyxcode-keys/update.pem node scripts/publish-update.mjs
   node scripts/verify-update.mjs --dir dist/update        # reproduce la verificación del cliente
   ```
   `publish-update.mjs` rechaza una clave dentro del repo o con permisos más abiertos que `0600`, comprueba que
   corresponde a `UPDATE_PUBLIC_KEY`, no la imprime nunca, crea `dist/update/OnyxCode-X.Y.Z-arm64.zip`
   (`ditto -c -k --sequesterRsrc --keepParent dist/mac-arm64/OnyxCode.app`), calcula el SHA-256 y escribe
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
5. `gh release create vX.Y.Z dist/onyxcode-X.Y.Z-arm64.dmg dist/update/OnyxCode-X.Y.Z-arm64.zip dist/update/update.json dist/update/update.json.sig --title "OnyxCode X.Y.Z"`
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

1. Acceso a Llaveros → menú *Acceso a Llaveros › Asistente de Certificados › Crear un certificado…* → nombre
   (p. ej. `OnyxCode Local`), *Tipo de identidad:* **Raíz autofirmada**, *Tipo de certificado:* **Firma de código**.
   Comprueba que aparece como válido: `security find-identity -v -p codesign`.
2. Empaqueta con `ONYXCODE_SELF_SIGNED=1 CSC_NAME="OnyxCode Local" npm run package`. `electron-builder.js` firma con
   ese certificado, **sin hardened runtime** y **sin notarizar** (ignora las variables `APPLE_*`); sin esa variable el
   comportamiento es exactamente el de siempre. `build/after-sign-self-signed.js` vuelve a firmar
   `cu-helper` y `onyxcode-disclaim` con el **mismo certificado** manteniendo `HELPER_ID` y `DISCLAIM_ID` (electron-builder
   los re-firma con un identificador derivado del nombre del archivo, p. ej. `cu-helper-5555…`; con ad-hoc da igual,
   con certificado los permisos se pierden) y resella el `.app`.
3. **La primera migración ad-hoc → autofirmado pedirá los permisos una vez más** (la identidad cambia). Desde ahí,
   las actualizaciones firmadas con el mismo certificado los conservan. Si se pierde el certificado hay que crear otro y
   se vuelven a pedir.
4. Sigue sin haber notarización: Gatekeeper en otro Mac rechazará el primer `.dmg` («no se puede abrir porque no se
   puede verificar al desarrollador»: clic derecho › Abrir). Las actualizaciones hechas por la propia app no pasan por
   Gatekeeper (se les quita la cuarentena tras verificarlas).

(Esto lo hace el usuario; las pruebas del repositorio no crean certificados ni firman con uno.)

## 11. Prueba manual del actualizador (dos builds de prueba, todo en directorios temporales)

Comprueba de punta a punta, con dos apps empaquetadas reales, la descarga, verificación, reemplazo, arranque confirmado
y el rollback. No toca `/Applications`, ni `~/Library/Application Support/OnyxCode`, ni `~/.local/share/opencode`, y no
hace peticiones a GitHub (un servidor local imita la release). Usa un **build de prueba** (`ONYXCODE_TEST_BUILD=1`, se
sustituye en compilación: un build normal no contiene estos ganchos): honra las variables `ONYXCODE_TEST_*` aunque esté
empaquetado, acepta cualquier carpeta de instalación y `swap.sh` en modo de prueba arranca la app por ejecución directa
(sin `open`) con `--user-data-dir` propio. `ONYXCODE_TEST_FAIL_BOOT=1` (la app nueva no confirma el arranque) **solo** se
honra en este build.

```bash
export T=~/tmp/onyx-update-test; mkdir -p $T/keys
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
  && ONYXCODE_TEST_BUILD=1 npm run build && npx electron-builder --mac --arm64 --dir -c electron-builder.js --config.directories.output=$2); }
build 0.3.0 $T/out-old
build 0.3.1 $T/out-new
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/verify-bundled.mjs --app $T/out-new/mac-arm64/OnyxCode.app --dmg /no.dmg  # swap.sh presente y sellado (el .dmg fallará: es normal)

# 3. Publicar la «nueva» con la clave de prueba y servirla en local
(cd $T/wt && ONYXCODE_UPDATE_KEY_FILE=$T/keys/update.pem node scripts/publish-update.mjs --app $T/out-new/mac-arm64/OnyxCode.app --out $T/release \
  && node scripts/verify-update.mjs --dir $T/release --current 0.3.0)
node scripts/serve-test-release.mjs --dir $T/release --port 8799 &        # 127.0.0.1 solamente

# 4. Caso A — actualización correcta. «Instalada» = copia de la vieja en $T/a/app
mkdir -p $T/a/app $T/a/userdata && ditto $T/out-old/mac-arm64/OnyxCode.app $T/a/app/OnyxCode.app
env ONYXCODE_TEST_RELEASES_API=http://127.0.0.1:8799 ONYXCODE_TEST_RELEASES_REPO=test-owner/test-repo \
    ONYXCODE_TEST_UPDATE_DELAY_MS=500 ONYXCODE_TEST_UPDATE_PUBKEY="$PUB" \
    ONYXCODE_SWAP_TEST_NO_OPEN=1 ONYXCODE_SWAP_TEST_EXEC=OnyxCode ONYXCODE_SWAP_TEST_USERDATA=$T/a/userdata \
    $T/a/app/OnyxCode.app/Contents/MacOS/OnyxCode --user-data-dir=$T/a/userdata &
#    En la ventana: aviso «Hay una versión nueva de OnyxCode (0.3.1)» → «Actualizar» → Descargando (%) → Verificando →
#    «Lista: reinicia» → «Reiniciar ahora».
```

Esperado (caso A): la app vieja se cierra; `swap.sh` espera su PID, mueve `OnyxCode.app` a `.OnyxCode.app.bak-0.3.0`
(misma carpeta), pone la nueva y la arranca; la nueva escribe `booting-0.3.1` (su PID) y, tras cargar la ventana y
confirmar el renderer, `boot-ok-0.3.1`. `$T/a/userdata/update/result.json` = `{"version":"0.3.1","ok":true,"rolledBack":false,"error":""}`,
`Info.plist` de `$T/a/app/OnyxCode.app` dice 0.3.1 y `codesign --verify --deep --strict` pasa. Al **volver a abrir** la
app nueva (siguiente sesión), borra la copia `.bak-0.3.0`, los marcadores viejos y el staging.

Caso B — rollback forzado: igual que A (carpetas `$T/b/...`, copia nueva de la vieja) añadiendo
`ONYXCODE_SWAP_TEST_FAIL_NEW=1 ONYXCODE_SWAP_WAIT_BOOT=25` al `env` de la app vieja (acorta la espera de 90 s). La app
nueva se lanza con `ONYXCODE_TEST_FAIL_BOOT=1`: escribe `booting-0.3.1` pero nunca `boot-ok-0.3.1`. Esperado: a los 25 s
`swap.sh` mata el PID de la nueva (solo si su línea de comandos está dentro del `.app` nuevo), la aparta a
`.OnyxCode.app.failed-0.3.1`, restaura la vieja, la abre y escribe `{"version":"0.3.1","ok":false,"rolledBack":true,"error":"boot-timeout"}`.
La app vieja lo lee al iniciar y muestra «La versión nueva no arrancó bien y se volvió a la anterior.»; después borra
los restos (`.failed`).

Limpieza: `pkill -f onyx-update-test; rm -rf $T` (incluye la clave de prueba; no es la de producción).

Caso C — `swap.sh` sin reemplazar nada si la app vieja no termina: lo cubre
`src/main/update/swap.integration.test.ts` (PID que no muere → `pid-timeout`, sin tocar nada).

**Qué NO cubre esta prueba:** `open -n` real (LaunchServices) en vez de la ejecución directa, permisos TCC reales,
Gatekeeper en otro Mac, la protección «Gestión de apps» de macOS 13+ al modificar `/Applications`, proxy corporativo y
disco lleno.
