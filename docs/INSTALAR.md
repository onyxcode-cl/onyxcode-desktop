# Instalar Lazunox

**Solo Mac con chip Apple** (M1 o posterior). No funciona en Mac con Intel ni en otros sistemas por esta vía.

Lazunox va firmada con un certificado propio (autofirmado), no con un Developer ID de Apple, y no está notarizada. Por eso
macOS puede mostrar un aviso la primera vez. No es un fallo: es lo esperado, y abajo se explica cómo comprobar que la app es la auténtica.

## Vía 1: línea de comando

```sh
curl -fsSL <dirección-del-script>/install.sh | sh
```

El script comprueba que tu Mac es Apple Silicon, descarga el `.dmg` y `SHA256SUMS`, **verifica el hash**, comprueba la
**firma** de la app contra el certificado fijado, instala en `/Applications` (o `~/Applications`) y desmonta. No usa sudo, no toca
tus datos, no desactiva Gatekeeper y no instala nada más. Un archivo bajado con `curl` no lleva marca de cuarentena, así que no sale el aviso.

Opciones: `--version X.Y.Z`, `--dry-run` (muestra los pasos sin ejecutar nada), `--no-open`, `--uninstall`, `--help`.
Si lo prefieres, descárgalo y léelo antes: `sh install.sh --dry-run`.

## Vía 2: Homebrew

```sh
brew install --cask <dueño>/lazunox/lazunox
```

Está en un tap propio (Homebrew ya no admite apps sin firma de Apple en su catálogo oficial). La cask quita la cuarentena al instalar.

## Vía 3: DMG a mano

1. Descarga `lazunox-X.Y.Z-arm64.dmg` y `SHA256SUMS` de la página de releases.
2. Comprueba el hash: `shasum -a 256 lazunox-X.Y.Z-arm64.dmg` y compáralo con la línea del mismo archivo en `SHA256SUMS`.
3. Abre el `.dmg` y arrastra Lazunox a Aplicaciones.
4. Al abrirla, macOS dirá que no puede verificar que esté libre de software malicioso. Pulsa **Aceptar** (o «Hecho»), luego:
   **Ajustes del Sistema › Privacidad y seguridad**, baja hasta el mensaje sobre «Lazunox» y pulsa **Abrir de todos modos**;
   confirma con tu contraseña o Touch ID. Solo hace falta la primera vez.
5. Comprueba la firma:

   ```sh
   codesign -d -r- /Applications/Lazunox.app
   ```

   La línea `designated` debe contener `identifier "cl.bentec.lazunox"` y
   `certificate leaf = H"8446c25f2c710d66701c262f048390d8f6edba31"`. Si el hash es otro, no abras la app.

## Qué significa el aviso y por qué verificar el hash

El aviso aparece porque Apple no ha revisado la app (no hay Developer ID ni notarización). No significa que tenga virus,
pero tampoco que alguien lo haya comprobado por ti. Las dos comprobaciones cubren eso: el **SHA-256** demuestra que el archivo
descargado es exactamente el publicado (no se corrompió ni lo cambiaron por el camino) y la **firma** demuestra que lo creó quien tiene la clave del certificado.
Verificar es gratis y tarda segundos.

## Desinstalar sin perder datos

- Con el script: `sh install.sh --uninstall`. Con Homebrew: `brew uninstall --cask lazunox`. A mano: arrastra Lazunox a la Papelera.
- Tus datos (sesiones, ajustes y claves cifradas) están en `~/Library/Application Support/Lazunox` y **nada de lo anterior los borra**.
  Si quieres eliminarlos del todo, borra esa carpeta tú a mano.


---

# Instalar en Windows (gratis, sin certificado de firma)

Windows 10/11 de 64 bits. El instalador **no está firmado** (no hay certificado de pago): si lo bajas desde el navegador, SmartScreen
puede mostrar «Windows protegió su PC». No es un fallo. Hay dos formas de evitarlo:

## Vía 1: PowerShell (recomendada)

Abre PowerShell normal (NO «Ejecutar como administrador») y pega:

```powershell
irm <dirección-del-script>/install.ps1 | iex
```

El script (`scripts/install/install.ps1`) descarga de la release de GitHub el `SHA256SUMS` y `Lazunox-Setup-X.Y.Z-x64.exe`,
**comprueba el hash SHA-256** (si no coincide no instala nada), instala solo para tu usuario y borra los temporales. Lo que baja
PowerShell no lleva la marca «descargado de Internet», así que SmartScreen no salta. No usa administrador ni toca tus datos
(`%APPDATA%\Lazunox`).

Opciones: `-Version X.Y.Z`, `-DryRun` (muestra los pasos sin ejecutar nada), `-NoOpen`, `-Uninstall`.
Si lo prefieres, descárgalo y léelo antes: `.\install.ps1 -DryRun`.

## Vía 2: instalador a mano

1. Descarga `Lazunox-Setup-X.Y.Z-x64.exe` y `SHA256SUMS` de la página de releases.
2. Comprueba el hash: `Get-FileHash .\Lazunox-Setup-X.Y.Z-x64.exe -Algorithm SHA256` y compáralo con `SHA256SUMS`.
3. Ábrelo. Si sale el aviso azul: **Más información › Ejecutar de todos modos**. Solo la primera vez.

**Al publicar:** `SHA256SUMS` de la release debe incluir también la línea del instalador de Windows
(`sha256sum Lazunox-Setup-X.Y.Z-x64.exe`), si no el script se niega a instalar.
