# Instalar Lazunox

**Mac con chip Apple** (M1 o posterior; no funciona en Mac con Intel) **o Windows 10/11 de 64 bits** (más abajo). La vía normal es **descargar el instalador** (macOS o Windows muestran un aviso de seguridad que se pasa con un par de clics). Quien sabe usar la terminal tiene además una vía de **un comando**, sin avisos.

Lazunox va firmada con un certificado propio (autofirmado), no con un Developer ID de Apple, y no está notarizada. Por eso
macOS puede mostrar un aviso la primera vez. No es un fallo: es lo esperado, y abajo se explica cómo comprobar que la app es la auténtica.

## Vía 1: descargar el DMG (la más común)

1. Descarga `lazunox-X.Y.Z-arm64.dmg` y `SHA256SUMS` de `https://github.com/onyxcode-cl/onyxcode-desktop/releases/latest/download/` (o de la lista de archivos de la página de la release).
2. Ábrelo y arrastra **Lazunox** a **Aplicaciones**.
3. Ábrela. macOS dirá que no puede verificar que esté libre de software malicioso: pulsa **Hecho** (nunca «Mover a la papelera»).
4. Abre **Ajustes del Sistema › Privacidad y seguridad**, baja hasta el mensaje sobre «Lazunox» y pulsa **Abrir de todos modos**; confirma con tu contraseña o Touch ID. Solo hace falta la primera vez.
5. La primera vez que se abre, Lazunox te da la bienvenida, revisa tu equipo y pide los permisos de macOS que usa (Accesibilidad y Grabación de pantalla). Actívalos en Ajustes del Sistema; si macOS pide reiniciar Lazunox, hazlo.
6. Opcional, comprueba que es la auténtica: `shasum -a 256 lazunox-X.Y.Z-arm64.dmg` debe coincidir con su línea en `SHA256SUMS`, y

   ```sh
   codesign -d -r- /Applications/Lazunox.app
   ```

   debe mostrar `identifier "cl.bentec.lazunox"` y `certificate leaf = H"8446c25f2c710d66701c262f048390d8f6edba31"`. Si el hash es otro, no abras la app.

## Vía 2: línea de comando (para quien usa la terminal, sin avisos)

```sh
curl -fsSL https://raw.githubusercontent.com/onyxcode-cl/onyxcode-desktop/main/scripts/install/install.sh | sh
```

El script comprueba que tu Mac es Apple Silicon, descarga el `.dmg` y `SHA256SUMS`, **verifica el hash**, comprueba la
**firma** de la app contra el certificado fijado, instala en `/Applications` (o `~/Applications`) y desmonta. No usa sudo, no toca
tus datos, no desactiva Gatekeeper y no instala nada más. Un archivo bajado con `curl` no lleva marca de cuarentena, así que no sale el aviso.

Los archivos se descargan de `https://github.com/onyxcode-cl/onyxcode-desktop/releases/latest/download/` (o de `…/releases/download/vX.Y.Z/`
con `--version`); no hace falta GitHub.

Opciones: `--version X.Y.Z`, `--dry-run` (muestra los pasos sin ejecutar nada), `--no-open`, `--uninstall`, `--help`.
Si lo prefieres, descárgalo y léelo antes: `sh install.sh --dry-run`.

## Vía 3: Homebrew (todavía no publicado)

```sh
brew install --cask <dueño>/lazunox/lazunox
```

El tap propio aún no está publicado; cuando lo esté, la receta quedará en él (Homebrew ya no admite apps sin firma de Apple en su catálogo oficial). La cask quita la cuarentena al instalar.

## Qué significa el aviso y por qué verificar el hash

El aviso aparece porque Apple no ha revisado la app (no hay Developer ID ni notarización). No significa que tenga virus,
pero tampoco que alguien lo haya comprobado por ti. Las dos comprobaciones cubren eso: el **SHA-256** demuestra que el archivo
descargado es exactamente el publicado (no se corrompió ni lo cambiaron por el camino) y la **firma** demuestra que lo creó quien tiene la clave del certificado.
Verificar es gratis y tarda segundos.

## Qué avisos verás y qué hacer (Mac)

| Aviso                                                                                                                  | Qué significa                                                                                              | Qué hacer                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bienvenida: «Esperando que los actives» (permisos de macOS: Accesibilidad y Grabación de pantalla)                     | macOS exige que actives esos dos permisos tú, y la Grabación de pantalla solo se aplica al reabrir la app. | Actívalos en Ajustes del Sistema › Privacidad y seguridad y pulsa **Reiniciar ahora** si Lazunox lo ofrece.                                                                           |
| «Lazunox no se puede abrir porque no se puede verificar que esté libre de software malicioso» (solo con el DMG a mano) | La app no está notarizada por Apple.                                                                       | **Aceptar**; luego Ajustes del Sistema › Privacidad y seguridad › **Abrir de todos modos**. Antes, comprueba el hash y la firma (Vía 3). No hace falta con el script ni con Homebrew. |
| «Acceso para ayudar / Grabación de pantalla»                                                                           | Permisos de macOS para que el agente use el ratón y vea la pantalla.                                       | Concédelos solo si vas a usar Control del Mac. El último paso de la guía de primeros pasos («Prepara tu equipo») los pide de una vez.                                                 |
| El script dice «la firma de la app NO corresponde al certificado esperado» (o falla la comprobación del hash)          | El archivo no es el publicado o está corrupto.                                                             | No se instala nada. Vuelve a ejecutar el script; si se repite, no instales.                                                                                                           |
| «Lazunox solo está disponible para Mac con chip Apple»                                                                 | Tu Mac es de Intel.                                                                                        | Esta versión no funciona en él.                                                                                                                                                       |

## Desinstalar sin perder datos

- Con el script: `sh install.sh --uninstall`. Con Homebrew: `brew uninstall --cask lazunox`. A mano: arrastra Lazunox a la Papelera.
- Tus datos (sesiones, ajustes y tus claves de IA, que se guardan en un archivo que solo tu usuario puede leer) están en `~/Library/Application Support/Lazunox` y **nada de lo anterior los borra**.
  Si quieres eliminarlos del todo, borra esa carpeta tú a mano.

---

# Instalar en Windows (gratis, sin certificado de firma)

Windows 10/11 de 64 bits. El instalador **no está firmado** (no hay certificado de pago): si lo bajas desde el navegador, SmartScreen
puede mostrar «Windows protegió su PC». No es un fallo. Se puede pasar con dos clics (vía 1) o evitar con un comando (vía 2):

## Vía 1: descargar el instalador (.exe)

1. Descarga `Lazunox-Setup-X.Y.Z-x64.exe` y `SHA256SUMS` de `https://github.com/onyxcode-cl/onyxcode-desktop/releases/latest/download/` (o de la lista de archivos de la página de la release).
2. Ábrelo. Si sale el aviso azul **«Windows protegió su PC»**, pulsa **Más información** y luego **Ejecutar de todas formas**. Solo la primera vez.
3. Sigue el instalador: se instala solo para tu usuario, sin pedir administrador.
4. La primera vez que abras Lazunox, te da la bienvenida, revisa tu equipo y prepara lo que falta (el entorno aislado de Tareas incluido). Puede pedirte reiniciar el PC.
5. Opcional, comprueba el archivo: `Get-FileHash .\Lazunox-Setup-X.Y.Z-x64.exe -Algorithm SHA256` debe coincidir con su línea en `SHA256SUMS`.

**Al publicar:** `SHA256SUMS` de la release debe incluir también la línea del instalador de Windows (lo hace `scripts/publish-github.mjs`), si no el script de PowerShell se niega a instalar.

## Vía 2: PowerShell (para quien usa la terminal, sin avisos)

Abre PowerShell normal (NO «Ejecutar como administrador») y pega:

```powershell
irm https://raw.githubusercontent.com/onyxcode-cl/onyxcode-desktop/main/scripts/install/install.ps1 | iex
```

El script (`scripts/install/install.ps1`) descarga de GitHub (`https://github.com/onyxcode-cl/onyxcode-desktop`) el `SHA256SUMS` y `Lazunox-Setup-X.Y.Z-x64.exe`,
**comprueba el hash SHA-256** (si no coincide no instala nada), instala solo para tu usuario y borra los temporales. Lo que baja
PowerShell no lleva la marca «descargado de Internet», así que SmartScreen no salta. No usa administrador ni toca tus datos
(`%APPDATA%\Lazunox`).

Opciones: `-Version X.Y.Z`, `-DryRun` (muestra los pasos sin ejecutar nada), `-NoOpen`, `-Uninstall`.
Si lo prefieres, descárgalo y léelo antes: `.\install.ps1 -DryRun`.

## Qué avisos verás y qué hacer (Windows)

| Aviso                                                                            | Qué significa                                                                | Qué hacer                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| «Windows protegió su PC» (SmartScreen), solo si bajas el `.exe` con el navegador | El instalador no está firmado con certificado de pago.                       | **Más información › Ejecutar de todas formas**, tras comprobar el hash. Con `install.ps1` no sale.                                                                                                                                                                                 |
| «El SHA-256 no coincide con el publicado»                                        | El archivo no es el publicado.                                               | No se instala nada. Repite; si se repite, no instales.                                                                                                                                                                                                                             |
| «Abre PowerShell normal, SIN «Ejecutar como administrador»»                      | `install.ps1` se niega a correr elevado.                                     | Ábrelo en una PowerShell normal.                                                                                                                                                                                                                                                   |
| Bienvenida de la primera vez («Prepara tu equipo»: entorno aislado de Tareas)    | Lazunox instala WSL y su distro aislada, la imagen viene en el instalador.   | Sigue los pasos de la tarjeta; si falta WSL o la virtualización, te explica cómo activarlos (puede pedir reiniciar). **Si actualizas a 0.5.9, el entorno aislado se reinstala y lo guardado dentro de esa distro fuera de `/opt/lazunox` se pierde** (tus carpetas de Windows no). |
| Control del PC / Control total                                                   | Permiso explícito por acción, y Control total además pide tu consentimiento. | Léelo antes de aceptar. Lazunox no debe correr como administrador: si lo abres así, Tareas y Control del PC se niegan a arrancar.                                                                                                                                                  |

## Qué publicar en GitHub (Mac y Windows, para quien publica)

Las personas usan los dos comandos de arriba, que bajan `install.sh` e `install.ps1` directamente del repositorio (rama `main`, carpeta
`scripts/install/`): no hay que copiar nada a ningún servidor. Cada release de GitHub debe llevar el `.dmg`, el instalador `.exe` y el
`SHA256SUMS` con una línea por cada uno (lo escribe `node scripts/publish-github.mjs`, ver `docs/RELEASE.md`). Si algún día se usa el
servidor propio, los dos scripts se copian a su raíz (`docs/VPS.md`).
