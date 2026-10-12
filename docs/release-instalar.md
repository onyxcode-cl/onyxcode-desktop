## Cómo instalar

### Mac (chip Apple, M1 o posterior)

1. Descarga **`lazunox-X.Y.Z-arm64.dmg`** de la lista de archivos de esta página.
2. Ábrelo y arrastra **Lazunox** a la carpeta **Aplicaciones**.
3. Ábrela. macOS dirá que no puede verificar que esté libre de software malicioso: pulsa **Hecho** (nunca «Mover a la papelera»).
4. Abre **Ajustes del Sistema › Privacidad y seguridad**, baja hasta el mensaje sobre «Lazunox» y pulsa **Abrir de todos modos**. Confirma con tu contraseña o Touch ID. Solo hace falta la primera vez.

¿Por qué sale ese aviso? Lazunox es gratis y no tiene el certificado de pago de Apple, así que Apple no la ha revisado. No significa que tenga virus; abajo se explica cómo comprobar que es la auténtica.

**Sin ningún aviso:** abre la app **Terminal** y pega esto (descarga, comprueba y la instala sola):

```sh
curl -fsSL https://raw.githubusercontent.com/onyxcode-cl/onyxcode-desktop/main/scripts/install/install.sh | sh
```

### Windows 10 u 11 (64 bits)

1. Descarga **`Lazunox-Setup-X.Y.Z-x64.exe`** de la lista de archivos de esta página.
2. Ábrelo. Si aparece el aviso azul «Windows protegió su PC», pulsa **Más información** y luego **Ejecutar de todas formas**. Solo la primera vez.
3. Sigue el instalador: se instala solo para tu usuario, sin pedir administrador.
4. La primera vez que abras Lazunox, prepara solo lo que falta (incluido el entorno de Tareas). Puede pedirte reiniciar el PC.

**Sin ningún aviso:** abre **PowerShell** (normal, no como administrador) y pega:

```powershell
irm https://raw.githubusercontent.com/onyxcode-cl/onyxcode-desktop/main/scripts/install/install.ps1 | iex
```

### Comprobar que es la auténtica (opcional, tarda segundos)

Descarga también `SHA256SUMS`. En Mac: `shasum -a 256 lazunox-X.Y.Z-arm64.dmg`. En Windows: `Get-FileHash .\Lazunox-Setup-X.Y.Z-x64.exe -Algorithm SHA256`. El resultado debe ser igual a la línea de ese archivo en `SHA256SUMS`. En Mac, además, `codesign -d -r- /Applications/Lazunox.app` debe mostrar `certificate leaf = H"8446c25f2c710d66701c262f048390d8f6edba31"`.

Guía completa, con todos los avisos y qué hacer: [`docs/INSTALAR.md`](https://github.com/onyxcode-cl/onyxcode-desktop/blob/main/docs/INSTALAR.md).
