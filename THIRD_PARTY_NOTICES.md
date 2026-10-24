# Avisos de terceros

Lazunox es un proyecto independiente y **no está afiliado a OpenCode**. Este fichero reúne los avisos de licencia de los componentes de
terceros que se distribuyen dentro del instalador. También se copia a `Lazunox.app/Contents/Resources/THIRD_PARTY_NOTICES.md`.

**Licencia de Lazunox: MIT.** El código propio de Lazunox se distribuye bajo la licencia del fichero `LICENSE`. Este documento solo cubre
componentes de terceros; si `LICENSE` cambia, esta línea debe cambiar a la vez (lo comprueba `npm run verify:release`).

<!-- TODO D10: la licencia MIT del fichero LICENSE y su titular («onyxcode-cl») están pendientes de la confirmación final del dueño
     (docs/RELEASE.md §14); LICENSE y el titular no se han tocado en el renombre. Este texto solo alinea el aviso con LICENSE; no es una decisión legal nueva. -->

## 1. OpenCode (motor incluido)

- Componente: «Lazunox Motor», copia **modificada** de OpenCode 1.19.0 (commit 733b2c62, etiqueta `upstream-v1.19.0` en nuestro repositorio), compilada por Lazunox. Cambios: sin conexiones a servicios de OpenCode, límites de Code Mode y otros descritos en `LAZUNOX.md` del repositorio.
- Origen del código modificado: <https://github.com/onyxcode-cl/lazunox-motor> (release `v1.19.0-lazunox.5`); código original: <https://github.com/anomalyco/opencode/releases/tag/v1.19.0>
- Ubicación en la app: `Contents/Resources/opencode/opencode` (en macOS, dentro de «Lazunox Motor.app»).
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

### Visor de documentos (PDF, Word, Excel, PowerPoint)

- `pdfjs-dist` (visor de PDF): Apache-2.0, <https://github.com/mozilla/pdf.js>.
- `docx-preview` (visor de Word) y su dependencia `jszip`: Apache-2.0 y (MIT O GPLv3, a elección) respectivamente.
- `xlsx` / SheetJS Community Edition (visor de Excel), v0.20.3: Apache-2.0, <https://git.sheetjs.com/sheetjs/sheetjs>. Vendorizado desde
  el CDN oficial del proyecto (no está en el registro de npm) en `vendor/sheetjs/`; ver `docs/VENDOR-SHEETJS.md` para el porqué y el sha256.
- Tipografías empaquetadas con el visor, compatibles en métricas con las de Word/PowerPoint para que un documento se vea igual sin tener
  Office instalado — ninguna es la tipografía original de Microsoft, son sustitutos de terceros con licencia libre:
  - Carlito (sustituye a Calibri) y Caladea (sustituye a Cambria): OFL-1.1, paquetes `@fontsource/carlito` y `@fontsource/caladea`.
  - Liberation Sans y Liberation Serif (sustituyen a Arial y Times New Roman): OFL-1.1, paquete `@typopro/web-liberation`.

### Modo viaje (opcional, se descarga bajo demanda)

- `cloudflared` (cliente del túnel rápido de Cloudflare), versión **2026.9.3**: Apache-2.0, <https://github.com/cloudflare/cloudflared>
  (texto de la licencia en el `LICENSE` de ese repositorio). **No se redistribuye con Lazunox**: solo si el usuario lo acepta en un diálogo
  se descarga desde la página oficial de lanzamientos de GitHub (`github.com/cloudflare/cloudflared/releases/download/2026.9.3/…`), se verifica
  su SHA-256 y su firma (Developer ID de Cloudflare Inc.) y se guarda en la carpeta de datos de la app; se puede borrar. Su uso del servicio de
  túneles rápidos se rige por las condiciones de Cloudflare (<https://www.cloudflare.com/website-terms/>), que el propio programa recuerda al
  arrancar. Lazunox no está afiliado a Cloudflare.

## 5. Python incluido y librerías de oficina

Lazunox incluye su propio Python para que las skills de oficina (Word, Excel, PowerPoint y PDF) no dependan del Python del Mac del usuario.
Se descarga con `scripts/fetch-python.mjs` (versión y SHA-256 fijados en `resources/python-bin/pin.json`; librerías con versión exacta en
`resources/python-bin/requirements.txt`), sin modificar salvo por la poda de archivos innecesarios (pruebas, IDLE, tkinter, cabeceras).
Ubicación en la app: `Contents/Resources/python/`. Las licencias de cada librería viajan en su carpeta `*.dist-info/` dentro de
`Contents/Resources/python/lib/python3.12/site-packages/`.

- CPython **3.12.15**: PSF License (Python Software Foundation License v2), <https://docs.python.org/3/license.html>. El intérprete enlaza
  además bibliotecas de terceros (OpenSSL, SQLite, zlib, xz, libffi, etc.) con sus propias licencias permisivas.
- python-build-standalone (compilación **20261009**, <https://github.com/astral-sh/python-build-standalone>): scripts de compilación bajo
  MPL-2.0; el resultado es CPython bajo su licencia (PSF).
- `python-docx` 1.2.0: MIT.
- `openpyxl` 3.1.5 y su dependencia `et_xmlfile` 2.0.0: MIT.
- `python-pptx` 1.0.2: MIT. Dependencia `XlsxWriter` 3.2.9: BSD-2-Clause.
- `pypdf` 6.20.0: BSD-3-Clause.
- `pdfplumber` 0.11.10: MIT (fichero `LICENSE.txt`). Dependencia `pdfminer.six` 20260107: MIT.
- `reportlab` 5.0.1: licencia BSD de ReportLab Inc. (fichero `LICENSE`; incluye la licencia de la fuente Bitstream Vera que trae el paquete).
- `pypdfium2` 5.14.0: BSD-3-Clause o Apache-2.0, con PDFium (BSD-3-Clause / Apache-2.0, Google y The PDFium Authors) y sus dependencias
  empaquetadas; sus textos están en `pypdfium2-5.14.0.dist-info/licenses/`.
- `pillow` 12.3.0: MIT-CMU (HPND), <https://github.com/python-pillow/Pillow>. Las bibliotecas nativas que trae la rueda (libjpeg, libpng,
  libtiff, freetype, etc.) conservan sus licencias.
- `pymupdf` 1.26.5 (PyMuPDF, de Artifex Software; incluye MuPDF): **GNU AGPL-3.0**, <https://github.com/pymupdf/PyMuPDF>. Solo la usa la skill
  `pdf` para traducir un PDF conservando su diseño (`translate_pdf.py`). Al repartir Lazunox con PyMuPDF dentro, el programa distribuido queda
  bajo la AGPL-3.0 y su código fuente completo es público (repositorio del proyecto en GitHub, enlazado desde la página de descargas). Una versión sin esa
  función no necesita PyMuPDF.
- `lxml` 6.1.3: BSD-3-Clause (incluye libxml2 y libxslt, licencia MIT), <https://lxml.de>.
- Dependencias transitivas: `cryptography` 50.0.2 (Apache-2.0 o BSD-3-Clause; la rueda incluye OpenSSL, Apache-2.0), `cffi` 2.1.1 (MIT-0),
  `pycparser` 3.11 (BSD-3-Clause), `charset-normalizer` 3.5.2 (MIT), `typing_extensions` 4.16.0 (PSF-2.0).

**ArtCraft (DeckCraft, WordCraft, GridCraft, PdfCraft) NO se incluye en el instalador** de Lazunox. Es un componente que la app DESCARGA
bajo demanda (desde la bienvenida o desde Ajustes › Componentes opcionales) de sus versiones publicadas, con tamaño exacto, SHA-256 y firma
(equipo de desarrollo fijado en `resources/craft/pin.json`) comprobados antes de usarlo, y lo guarda sin modificar en la carpeta de datos
de la app. Las skills de oficina lo emplean para crear y previsualizar documentos.

## 6. No afiliación

Lazunox es un proyecto independiente, no afiliado a OpenCode ni respaldado por sus autores. Los nombres de terceros se usan solo para
indicar compatibilidad.

### Conectores locales: Node.js y uv (se descargan bajo demanda)

- **Node.js** 24.22.0 (licencia MIT, <https://github.com/nodejs/node/blob/main/LICENSE>) y **uv** 0.13.1 (MIT o Apache-2.0,
  <https://github.com/astral-sh/uv>). **No se redistribuyen con Lazunox**: la preparación inicial o el botón «Instalar lo necesario» los descarga de
  `nodejs.org` y de las releases de GitHub de astral-sh/uv, se verifican por tamaño y SHA-256 fijados (`resources/runtimes/pin.json`) y se guardan en la
  carpeta de datos de la app; se pueden quitar desde Ajustes. Solo los usan los conectores locales aprobados por la persona. Lazunox no está afiliado a
  la OpenJS Foundation ni a Astral.
