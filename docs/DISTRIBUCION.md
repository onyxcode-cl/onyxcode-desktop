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

Ojo: no ejecutes el binario contra tu `HOME` real (crea datos en `~/.local/share/opencode`); usa `HOME` y
`XDG_*` temporales para cualquier prueba distinta de `--version`.
