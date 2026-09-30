# Avisos de terceros

OnyxCode es un proyecto independiente y **no está afiliado a OpenCode**. Este fichero reúne los avisos de licencia de los componentes de
terceros que se distribuyen dentro del instalador. También se copia a `OnyxCode.app/Contents/Resources/THIRD_PARTY_NOTICES.md`.

**LICENCIA PROPIA DE ONYXCODE: PENDIENTE.** La licencia del código de OnyxCode todavía no está decidida y se publicará en el fichero `LICENSE`.
Este documento solo cubre componentes de terceros.

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

El binario incluido en OnyxCode es el publicado oficialmente por OpenCode, **sin modificar** por OnyxCode. Se incluye este aviso y el enlace
a las fuentes; este texto no pretende ser una valoración jurídica del cumplimiento de la LGPL.

## 3. Electron y Chromium

OnyxCode está construido sobre Electron, que incluye Chromium y otras dependencias de código abierto. Cada instalación contiene sus avisos
completos dentro de la propia app:

- `OnyxCode.app/Contents/Resources/licenses/electron/LICENSE` (licencia de Electron, MIT).
- `OnyxCode.app/Contents/Resources/licenses/electron/LICENSES.chromium.html` (lista de licencias de Chromium y de las bibliotecas que incorpora).

Más información: <https://www.electronjs.org/> y <https://www.chromium.org/>.

## 4. Dependencias de JavaScript

Las bibliotecas de JavaScript empaquetadas con la app (React, Zustand, Lucide, entre otras) se distribuyen bajo sus propias licencias de
código abierto (en su mayoría MIT o ISC); sus avisos están en sus paquetes de `node_modules`.

## 5. No afiliación

OnyxCode es un proyecto independiente, no afiliado a OpenCode ni respaldado por sus autores. Los nombres de terceros se usan solo para
indicar compatibilidad.
