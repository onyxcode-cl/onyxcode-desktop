# Tap de Homebrew de OnyxCode

Carpeta lista para publicar como repositorio `homebrew-onyxcode` (aún NO creado).

Instalación para el usuario, cuando exista:

```sh
brew install --cask <dueño>/onyxcode/onyxcode
```

Solo Mac con chip Apple. La app va firmada con un certificado propio y sin notarizar; la cask quita la cuarentena
en `postflight`. Desinstalar no borra tus datos (`~/Library/Application Support/OnyxCode`).

## Para cada release

```sh
shasum -a 256 onyxcode-X.Y.Z-arm64.dmg   # o toma el valor de SHA256SUMS
node scripts/install/make-cask.mjs --version X.Y.Z --sha256 <hash> --repo <dueño>/<repo-de-releases>
```

Copia `Casks/onyxcode.rb` al repositorio `homebrew-onyxcode` y súbelo. El archivo de este directorio tiene
marcadores (`PENDIENTE`, hash de ceros) y una prueba comprueba que coincide con la plantilla.
