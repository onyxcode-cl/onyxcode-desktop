# Avisos de terceros

Lazunox es un proyecto independiente y **no está afiliado a OpenCode**. Este fichero reúne los avisos de licencia de los componentes de
terceros que se distribuyen dentro del instalador. También se copia a `Lazunox.app/Contents/Resources/THIRD_PARTY_NOTICES.md`.

**Licencia de Lazunox: MIT.** El código propio de Lazunox se distribuye bajo la licencia del fichero `LICENSE`. Este documento solo cubre
componentes de terceros; si `LICENSE` cambia, esta línea debe cambiar a la vez (lo comprueba `npm run verify:release`).

<!-- TODO D10: la licencia MIT del fichero LICENSE y su titular («onyxcode-cl») están pendientes de la confirmación final del dueño
     (docs/RELEASE.md §14); LICENSE y el titular no se han tocado en el renombre. Este texto solo alinea el aviso con LICENSE; no es una decisión legal nueva. -->

## 1. OpenCode (motor incluido)

- Componente: ejecutable oficial de OpenCode, versión **1.18.33** (macOS, arm64), sin modificar.
- Origen: <https://github.com/anomalyco/opencode/releases/tag/v1.18.33>
- Ubicación en la app: `Contents/Resources/opencode/opencode`.
- Licencia: MIT.

```
MIT License

Copyright (c) 2025 opencode

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 2. Bun y JavaScriptCore/WebKit (dentro del ejecutable de OpenCode)

El ejecutable de OpenCode es un programa compilado con Bun. Bun enlaza estáticamente JavaScriptCore, el motor de JavaScript de WebKit, que
está licenciado bajo LGPL-2. Según la documentación de Bun, quien redistribuye el ejecutable debe ofrecer la posibilidad de volver a
enlazar esa parte.

- Documentación de licencias de Bun: <https://bun.com/docs/project/licensing>
- Código fuente de Bun: <https://github.com/oven-sh/bun>
- Código fuente de WebKit (incluye JavaScriptCore): <https://github.com/WebKit/WebKit> y <https://webkit.org/>

El binario incluido en Lazunox es el publicado oficialmente por OpenCode, **sin modificar** por Lazunox. Se incluye este aviso y el enlace
a las fuentes; este texto no pretende ser una valoración jurídica del cumplimiento de la LGPL.

## 3. Electron y Chromium

Lazunox está construido sobre Electron, que incluye Chromium y otras dependencias de código abierto. Cada instalación contiene sus avisos
completos dentro de la propia app:

- `Lazunox.app/Contents/Resources/licenses/electron/LICENSE` (licencia de Electron, MIT).
- `Lazunox.app/Contents/Resources/licenses/electron/LICENSES.chromium.html` (lista de licencias de Chromium y de las bibliotecas que incorpora).

Más información: <https://www.electronjs.org/> y <https://www.chromium.org/>.

## 4. Dependencias de JavaScript

Las bibliotecas de JavaScript empaquetadas con la app (React, Zustand, Lucide, entre otras) se distribuyen bajo sus propias licencias de
código abierto (en su mayoría MIT o ISC); sus avisos están en sus paquetes de `node_modules`.

### Control remoto desde el celular (prototipo)

- `node-datachannel` y `libdatachannel` (WebRTC DataChannel nativo): MPL-2.0, <https://github.com/murat-dogan/node-datachannel> y
  <https://github.com/paullouisageneau/libdatachannel>. Sin modificar; el texto de la licencia está en su paquete de `node_modules`.
  `libdatachannel` enlaza a su vez usrsctp, libjuice, libsrtp, OpenSSL y plog (cada una con su propia licencia, ver la documentación del proyecto).
- `ws` (WebSocket del servidor local): MIT.
- `qrcode` (matriz del código QR) y sus dependencias `pngjs`, `dijkstrajs`, `yargs`: MIT.
- `@noble/hashes` (sha256 del código de confirmación, también en la PWA): MIT.
- `detect-libc` (dependencia de `node-datachannel`): Apache-2.0.

### Modo viaje (opcional, se descarga bajo demanda)

- `cloudflared` (cliente del túnel rápido de Cloudflare), versión **2026.9.3**: Apache-2.0, <https://github.com/cloudflare/cloudflared>
  (texto de la licencia en el `LICENSE` de ese repositorio). **No se redistribuye con Lazunox**: solo si el usuario lo acepta en un diálogo
  se descarga desde la página oficial de lanzamientos de GitHub (`github.com/cloudflare/cloudflared/releases/download/2026.9.3/…`), se verifica
  su SHA-256 y su firma (Developer ID de Cloudflare Inc.) y se guarda en la carpeta de datos de la app; se puede borrar. Su uso del servicio de
  túneles rápidos se rige por las condiciones de Cloudflare (<https://www.cloudflare.com/website-terms/>), que el propio programa recuerda al
  arrancar. Lazunox no está afiliado a Cloudflare.

## 5. No afiliación

Lazunox es un proyecto independiente, no afiliado a OpenCode ni respaldado por sus autores. Los nombres de terceros se usan solo para
indicar compatibilidad.
