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
brew install --cask <dueño>/onyxcode/onyxcode
```

Está en un tap propio (Homebrew ya no admite apps sin firma de Apple en su catálogo oficial). La cask quita la cuarentena al instalar.

## Vía 3: DMG a mano

1. Descarga `onyxcode-X.Y.Z-arm64.dmg` y `SHA256SUMS` de la página de releases.
2. Comprueba el hash: `shasum -a 256 onyxcode-X.Y.Z-arm64.dmg` y compáralo con la línea del mismo archivo en `SHA256SUMS`.
3. Abre el `.dmg` y arrastra Lazunox a Aplicaciones.
4. Al abrirla, macOS dirá que no puede verificar que esté libre de software malicioso. Pulsa **Aceptar** (o «Hecho»), luego:
   **Ajustes del Sistema › Privacidad y seguridad**, baja hasta el mensaje sobre «OnyxCode» (así lo nombra aún el sistema) y pulsa **Abrir de todos modos**;
   confirma con tu contraseña o Touch ID. Solo hace falta la primera vez.
5. Comprueba la firma:

   ```sh
   codesign -d -r- /Applications/OnyxCode.app
   ```

   La línea `designated` debe contener `identifier "cl.bentec.onyxcode"` y
   `certificate leaf = H"c778a9630c6a627449b1a39e1e62b7a2a2565eb2"`. Si el hash es otro, no abras la app.

## Qué significa el aviso y por qué verificar el hash

El aviso aparece porque Apple no ha revisado la app (no hay Developer ID ni notarización). No significa que tenga virus,
pero tampoco que alguien lo haya comprobado por ti. Las dos comprobaciones cubren eso: el **SHA-256** demuestra que el archivo
descargado es exactamente el publicado (no se corrompió ni lo cambiaron por el camino) y la **firma** demuestra que lo creó quien tiene la clave del certificado.
Verificar es gratis y tarda segundos.

## Desinstalar sin perder datos

- Con el script: `sh install.sh --uninstall`. Con Homebrew: `brew uninstall --cask onyxcode`. A mano: arrastra Lazunox a la Papelera.
- Tus datos (sesiones, ajustes y claves cifradas) están en `~/Library/Application Support/OnyxCode` y **nada de lo anterior los borra**.
  Si quieres eliminarlos del todo, borra esa carpeta tú a mano.
