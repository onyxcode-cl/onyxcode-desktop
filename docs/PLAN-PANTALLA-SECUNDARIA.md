# Plan: clic sobre una app concedida en cualquier monitor (modo unificado, origen aislado)

Estado: plan, sin código. Rama de trabajo: `feat/modo-unificado`. Fecha: 2026-10-28.

Alcance: el agente aislado del modo unificado (puente de apps, `docs/SEGURIDAD.md` §«Puente de apps del modo unificado») tiene que poder
hacer clic, doble clic, clic derecho, mover el puntero, arrastrar y desplazar sobre una app concedida esté en el monitor que esté, en macOS
y Windows, sin capturas de pantalla completa y sin actuar sobre nada que no sea la ventana de la app concedida. Teclado y atajos ya
funcionan y no se tocan.

---

## 1. Diagnóstico (leído en el código)

Todas las rutas son de `src/main/computer/` salvo que se diga otra cosa.

### 1.1 Por qué falla hoy

1. **En origen aislado nunca hay captura de pantalla.** `takeScreenshot` rechaza siempre con `isolatedCall`
   (`mcp-server.ts:772-775`); `zoom` también (`mcp-server.ts:1648`). La única captura posible es `app_screenshot`.
2. **`capturedScreen` solo lo fija la captura de pantalla completa.** Se asigna en `captureScreen` (`mcp-server.ts:1050`), que en
   origen aislado no se llega a ejecutar. `app_screenshot` (`mcp-server.ts:2382-2416`) no lo toca, ni guarda dónde está la ventana.
   Resultado: en origen aislado `capturedScreen` es siempre `null`.
3. **`toPoints` cae en la pantalla principal.** `toPoints` (`mcp-server.ts:1064-1091`) usa `capturedScreen ?? getMainScreen()`
   (`:1071`) y rechaza todo punto fuera de `0..width` × `0..height` de ESA pantalla (`:1074`) con «Coordenadas fuera de la pantalla».
   La relación punto/píxel sale de `ensureRatio` (`:736-744`), que también usa `capturedScreen ?? main`: en origen aislado es siempre la
   relación de la captura de pantalla principal que nunca se hizo.
4. **Los números que recibe el modelo están en otro espacio.** Hay tres espacios distintos y en origen aislado ninguno coincide con lo
   que espera `toPoints`:
   - `app_find`/`app_tree` (`:2166-2208`) devuelven el `frame` de accesibilidad tal cual, en **puntos de pantalla globales** (macOS:
     origen arriba-izquierda de la principal, pueden ser negativos; Windows: píxeles físicos del escritorio virtual).
   - `find_element`/`list_elements` (`:2418-2492`) pasan el punto global por `shotPx` (`:1402-1406`), que resta el origen de
     `capturedScreen` (aquí `null` → 0) y divide por la relación de la principal: un número que no corresponde a ninguna imagen que el
     modelo haya visto.
   - `app_screenshot` devuelve **píxeles de la imagen de la ventana**, con origen en la esquina de la ventana. Su propia descripción y su
     texto dicen que no sirve para clics (`:2384-2387`, `:2407-2409`) porque no se sabe dónde está la ventana.
5. **Ejemplo del fallo real** «Coordenadas fuera de la pantalla: (2135, 703)»: con Spotify en un monitor a la derecha, cualquier punto
   global de ese monitor (o ese mismo número tomado como px) tiene x mayor que el ancho de la principal. Por ejemplo, con una principal
   de 1512×982 pt a escala 2, `ensureRatio` da 1512/1366 ≈ 1,107; (2135, 703) px → (2363, 778) pt, fuera de 0..1512 → rechazo en
   `:1074`. (Las cifras de la principal son un ejemplo; el rechazo pasa con cualquier principal más estrecha que la x pedida.)
6. **`element: N` tampoco sirve en origen aislado.** La lista numerada la crea `elementsBlock` (`:1464-1498`) solo tras una captura de
   pantalla completa (`:2667`, `:2695`), que en origen aislado no existe; `pointFromArgs` (`:1553-1574`) responde «la lista caducó».

### 1.2 Otros hallazgos que afectan al diseño

- **macOS, tamaño mal informado en `app_screenshot`.** El helper captura la ventana a `frame × 2` fijo (`resources/computer-use/helper.swift`,
  `windowShot`, `config.width = frame.width * 2`) y devuelve ese tamaño; luego `sips -Z 1366` reduce el JPEG
  (`mcp-platform-darwin.ts:462-473`), pero el MCP informa el tamaño del PNG intermedio, no el del JPEG que ve el modelo
  (`mcp-server.ts:2406`). Para convertir píxeles de esa imagen hay que usar el tamaño REAL del JPEG.
- **macOS, el helper no devuelve la posición de la ventana** (`helper.swift`, `case "window-shot"`: solo `ok,width,height,title`). Sí la
  da `windows-of` (`helper.swift`, `windowsOf`: `kCGWindowBounds`, mismos puntos globales que los clics y la accesibilidad).
- **Windows, el helper rechaza todo clic fuera del monitor principal.** `require_on_primary`
  (`resources/computer-use/win/src/win/screen.rs:57-65`) se aplica en `move`, `click`, `drag` y `scroll`
  (`resources/computer-use/win/src/win/run.rs:171,178,185-186,194`). Aunque el MCP calculara bien el punto, el helper devolvería el
  código 11. La inyección en sí ya usa el escritorio virtual completo (`input.rs:55-59`, `MOUSEEVENTF_VIRTUALDESK`), y `app-at` no
  tiene esa restricción.
- **Windows, `window-shot` no devuelve la posición** (`run.rs:384-397`) y captura `w.rect` (rectángulo con los bordes invisibles), mientras
  que `windows-of` devuelve `w.frame` (el marco visible; `apps.rs:251-261`). Son rectángulos distintos: el plan necesita los dos.
- **Windows, `normalizeScreen` descarta `x`/`y`** (`mcp-platform-win32.ts:763`), aunque el helper los da (`run.rs:227-245`). Todo el
  proceso es PerMonitorV2 (`cu-helper.manifest`): ventanas, UI Automation, `app-at` y entrada están en píxeles físicos del escritorio
  virtual, así que la conversión imagen → pantalla es lineal y no necesita la escala de cada monitor.
- **Las pruebas actuales de origen aislado hacen clic en (10, 10) sin ninguna captura** (`service-bridge-round2.test.ts:273,287,483,…`):
  hoy un clic «a ciegas» en coordenadas de la principal pasa si la app bajo el punto está concedida.
- **El prompt del agente aislado dice que varias pantallas no se pueden** (`src/main/tasks/unified-apps-prompt.ts`, línea de
  `NEEDS_FULL_CONTROL`: «la pantalla entera, varias pantallas…»).
- `reportBridgeDenied` acepta cualquier motivo `^[a-z-]{1,40}$` (`service.ts:1485-1493`): los motivos nuevos no tocan `service.ts`.

---

## 2. Opciones de diseño

| Opción | Qué es | A favor | En contra |
| --- | --- | --- | --- |
| **A. La captura de ventana fija el espacio del clic** | En origen aislado, `app_screenshot` guarda (por sesión) la app, la ventana, su rectángulo global y el tamaño real del JPEG. `left_click`/`mouse_move`/`drag`/`scroll`/`teach_step` interpretan `x`/`y` como píxeles de ESA captura y los convierten a puntos globales. | Vale para cualquier app, también las de poca accesibilidad (Spotify, Electron, juegos), porque el modelo apunta sobre una imagen que ve. No depende de la disposición de monitores ni de la escala. Permite **acotar el clic a la ventana concedida**, más estricto que hoy (hoy basta con que caiga en la pantalla principal). No amplía lo que ve la IA. | Estado nuevo en el MCP (caduca, por sesión). El helper de Windows necesita cambios (posición y permitir otros monitores). Los clics en menús emergentes que salen de la ventana quedan fuera. |
| **B. Parámetro `space: 'screen'\|'capture'` o herramienta `app_click` por `ref`** | El modelo elige el espacio, o pulsa con el ratón real el centro del `frame` de un elemento AX. | `app_click` por `ref` es exacto cuando la accesibilidad es buena. | `space: 'screen'` deja al modelo pasar puntos globales arbitrarios, que nunca ha visto: es justo la mezcla de espacios que ya causó F8-B149. `app_click` no ayuda con apps de accesibilidad pobre (el caso real de Spotify). Más herramientas que aprender. Para clics por `ref` ya existe `app_press` sin ratón. |
| **C. Aceptar puntos globales de `app_find` con comprobación de pantalla** | En origen aislado, `toPoints` acepta puntos globales si caen en alguna pantalla. | Cambio pequeño. | El modelo no tiene ninguna imagen con esa referencia; el único freno sería `appAtPoint`. No arregla el flujo por visión sobre `app_screenshot`. Más superficie: cualquier punto de cualquier monitor. |
| D. Mover la ventana a la pantalla principal | Traer la ventana por AX al monitor principal. | Reutiliza todo lo de hoy. | Cambia el escritorio de la persona sin pedirlo; con Control total ya no hace falta. Descartada. |
| E. Capturar el monitor secundario completo | Captura de pantalla de ese monitor. | — | Rompe la regla «sin pantalla completa en origen aislado» (el escritorio de Finder y otras apps saldrían). Descartada. |

### Opción recomendada: A

Por qué, desde la seguridad (qué impide que el clic caiga en otra app u otra pantalla):

1. **Solo se puede apuntar dentro de la ventana capturada.** El punto se calcula como
   `origen_ventana + px × (ancho_ventana / ancho_JPEG)`, y se rechaza si los píxeles quedan fuera de la imagen o el punto fuera del marco
   visible de la ventana. No hay forma de expresar un punto de otra ventana u otro monitor.
2. **La ventana se vuelve a comprobar justo antes de actuar.** Se lee otra vez el rectángulo de las ventanas de esa app (`windows-of`);
   si ya no está igual (se movió, cambió de tamaño, se cerró o cambió de Space), no se actúa y se pide una captura nueva.
3. **La app bajo el punto tiene que ser ESA app** (comparación exacta de clave), además de lo de hoy: `requireTier` sigue comprobando la
   app al frente y la app bajo el punto con su nivel (`mcp-server.ts:303-340`), `ensureTier` sigue rechazando las exentas y el
   Finder/Explorador con control acotado. Si otra ventana (una notificación, otra app concedida) tapa ese punto, se rechaza.
4. **El punto tiene que caer en un monitor real** (unión de las pantallas, releídas en cada `app_screenshot`). En Windows el helper lo
   vuelve a comprobar por su cuenta.
5. **Arrastrar**: los dos extremos en la misma ventana capturada. No se puede arrastrar algo de la app concedida a otra app ni al escritorio.
6. **Captura de la misma sesión y reciente** (mismo criterio que `lastShotSession`, `mcp-server.ts:1649`; caducidad de 90 s como la lista
   de elementos). La sesión hermana del mismo servidor no usa la captura de otra.
7. **Sin captura de ventana no hay clic con x/y en origen aislado** (falla cerrado). Hoy un clic a ciegas en (10, 10) de la principal
   pasa; con A deja de pasar. Las pruebas que hacen eso se actualizan para capturar primero.
8. **No cambia lo que ve la IA**: la imagen es la misma `app_screenshot` de hoy; el rectángulo global de la ventana se queda dentro del
   MCP y no se escribe en el texto para el modelo.
9. **Fuera del origen aislado (Control total y Control del PC) no cambia nada**: lo vigila `mcp-server.equivalence.test.ts`.

Complemento pequeño dentro de A: en origen aislado, `find_element`/`list_elements` expresan sus puntos en píxeles de la última
`app_screenshot` de esa app (o dicen que hay que capturar primero), para que haya un solo espacio de coordenadas. `app_find`/`app_tree`
no cambian (alimentan `ref` para `app_press`, que no usa el ratón).

No se toca `resources/computer-use/helper.swift` (zona intocable y, sobre todo, recompilarlo cambia la firma del helper y macOS olvida los
permisos de Accesibilidad y Grabación de pantalla, `AGENTS.md` §7 y §10). La posición de la ventana en macOS se obtiene con el
`windows-of` que ya existe, más una comprobación cruzada con el tamaño que devuelve `window-shot` (ver T1).

---

## 3. Tareas

Orden y paralelismo (como mucho 2 a la vez):

```
Ronda 1:  T1 (backends TS)  ∥  T2 (helper de Windows)
Ronda 2:  T3 (MCP: clic en px de app_screenshot)            ← necesita T1 y T2
Ronda 3:  T4 (prompt y documentación)  ∥  T5 (revisión de seguridad independiente)
Ronda 4:  T6 (prueba real en el Mac y en el PC Windows)
```

Propiedad de archivos: ningún archivo lo editan dos tareas. Ninguna tarea toca una zona intocable (`docs/zonas-intocables.json` no
cambia; si alguien decide tocar `helper.swift` en vez de lo que dice T1, pasa a ser zona intocable con
`npm run zonas:actualizar -- "motivo"`, revisión independiente y pérdida de permisos TCC: no recomendado).

### T1. Backends: ubicar la ventana capturada (macOS y Windows) — modelo `sonnet`

- **Archivos (exclusivos):** `src/main/computer/mcp-platform.ts`, `mcp-platform-darwin.ts`, `mcp-platform-win32.ts`,
  `mcp-platform-darwin.test.ts`, `mcp-platform-win32.test.ts`.
- **Qué se hace:**
  1. En `mcp-platform.ts`: `WindowShotResult` gana campos opcionales `rect?` (rectángulo global que corresponde a la IMAGEN) y `frame?`
     (marco visible, el que devuelve `windows-of`), ambos `{x,y,width,height}` en el espacio de entrada del backend (puntos en macOS,
     píxeles físicos del escritorio virtual en Windows). Nuevo método `locateWindowShot(appKey, windowIndex, shot, outPath)` que devuelve
     `{ rect, frame, imageWidth, imageHeight } | null` y nuevo `windowFrames(appKey)` (lista de marcos actuales, para volver a comprobar).
  2. macOS (`locateWindowShot`): `windows-of <bundleId>` → filtrar ventanas > 40×40 → ordenar por área de mayor a menor (el mismo
     criterio que `windowShot` en `helper.swift`) → tomar `windowIndex` → **comprobación cruzada**: el PNG intermedio mide `frame × 2`
     (`helper.swift`), así que `|ancho_png − 2·frame.width| ≤ 2` y lo mismo con el alto; si no cuadra, `null` (falla cerrado: la captura
     se puede mirar pero no sirve para clics). `rect = frame`. Tamaño real del JPEG con `sips -g pixelWidth -g pixelHeight` (como en
     `captureScreen`, `mcp-platform-darwin.ts:456-458`). `windowShot` existente NO cambia (la prueba de equivalencia sigue igual).
  3. Windows: `windowShot` lee del JSON del helper los campos nuevos de T2 (`x`, `y`, `srcWidth`, `srcHeight`, `frame`), los valida
     (enteros, tamaños > 0) y los pasa; `locateWindowShot` no llama al helper: usa esos campos y `width`/`height` (que en Windows ya son
     del JPEG final). Si faltan (helper viejo) → `null`. `normalizeScreen` conserva `x`/`y` (la principal sigue en 0,0; escala 1).
  4. `windowFrames`: `windows-of` en las dos plataformas (macOS: marcos = rectángulos; Windows: `w.frame`).
- **Terminado cuando:** los métodos existen, nadie los llama todavía, y `mcp-server.equivalence.test.ts` pasa sin regenerar el fixture.
- **Pruebas:** en `mcp-platform-darwin.test.ts`, elección de la ventana por área e índice, comprobación cruzada que falla (tamaño que no
  cuadra → `null`), ventana con origen negativo (monitor a la izquierda), `windows-of` vacío → `null`. En `mcp-platform-win32.test.ts`,
  campos presentes → `rect`/`frame` correctos; ausentes o no numéricos → `null`; `normalizeScreen` con `x:-1920`.

### T2. Helper de Windows: posición de la ventana y entrada en cualquier monitor — modelo `sonnet` — **revisión de seguridad independiente**

- **Archivos (exclusivos):** `resources/computer-use/win/src/win/run.rs`, `resources/computer-use/win/src/win/screen.rs`,
  `resources/computer-use/protocol.json` (salida de `window-shot`), `resources/computer-use/win/src/protocol_tests.rs` si comprueba esa
  salida, `e2e/fake-cu-helper/fake.mjs` (respuesta por defecto de `window-shot` con los campos nuevos).
- **Qué se hace:**
  1. `window_shot` añade a su salida `x`, `y`, `srcWidth`, `srcHeight` (= `w.rect`, el rectángulo que `grab_window` pinta en la imagen)
     y `frame: {x,y,width,height}` (= `w.frame`, el mismo que devuelve `windows-of`).
  2. `require_on_primary` se sustituye por `require_on_monitor`: el punto tiene que estar dentro de ALGÚN monitor (`screen::monitors()`).
     Se mantienen `require_point_controllable` y `require_foreground_controllable` en `move`/`click`/`drag`/`scroll`, en el mismo orden.
  3. `protocol.json`: documentar los campos nuevos como opcionales en la salida de `window-shot` (aditivo: el helper de macOS no los da).
- **Terminado cuando:** `cargo test` del helper pasa (en el PC Windows por `scripts/win/`, o con el destino cruzado que ya usa
  `scripts/build-native.mjs --win-helper`), `npx vitest run src/test/cu-protocol.test.ts` pasa y `node scripts/build-native.mjs --win-helper`
  genera el `.exe`.
- **Pruebas:** Rust: punto en un monitor secundario con origen negativo → aceptado; punto entre monitores (hueco) o fuera de todos →
  código 11; los dos extremos de `drag` se comprueban. TS: `cu-protocol.test.ts` sigue validando el contrato.
- **Por qué revisión:** quita una restricción del helper que también afecta a Control del PC fuera del modo unificado (allí el MCP sigue
  limitando los clics a la captura de la principal, `toPoints`, pero el helper deja de ser la segunda barrera para otros monitores).

### T3. MCP: en origen aislado, clic en píxeles de `app_screenshot` — modelo `sonnet` — **revisión de seguridad independiente**

- **Depende de:** T1 y T2.
- **Archivos (exclusivos):** `src/main/computer/mcp-server.ts`, `mcp-bridge-origin.test.ts`, `service-bridge-round2.test.ts` (y
  `service-bridge.test.ts`, `service-bridge-hardening.test.ts`, `service-bridge-live.test.ts` solo si alguna hace clic con x/y en origen
  aislado: comprobar con `grep`), `mcp-server.equivalence.fixture.json` (regenerado a propósito solo si cambia la descripción de
  `app_screenshot`), `src/test/cu-mcp-kit.ts` (si hace falta que el `sips` falso de Linux devuelva un tamaño configurable).
- **Qué se hace (todo solo con `isolatedCall`; fuera de él, ni una línea de comportamiento cambia):**
  1. `windowCtx: Map<sesión, { app, windowIndex, rect, frame, imageWidth, imageHeight, at }>`. `app_screenshot` lo fija con
     `backend.locateWindowShot(...)`; si devuelve `null`, borra el de esa sesión y el texto dice «no se pudo ubicar la ventana: esta
     captura sirve para mirar, no para clics». En cada `app_screenshot` se vuelven a leer las pantallas (`allScreens = null`).
  2. Texto de `app_screenshot` en origen aislado: tamaño REAL del JPEG y «x/y de left_click, double_click, right_click, mouse_move, drag,
     scroll y teach_step van en píxeles de ESTA imagen; valen 90 s o hasta la siguiente app_screenshot». Sin el rectángulo global.
  3. `toPoints` en origen aislado → `toWindowPoints(session, x, y)`: exige `windowCtx` de esa sesión y no caducado; `0 ≤ x ≤ imageWidth`,
     `0 ≤ y ≤ imageHeight`; `pt = rect.origen + px × rect.tamaño / imagen.tamaño`; el punto tiene que caer dentro de `frame` y dentro de
     algún monitor. Si no, error claro (sin captura → «pide app_screenshot de la app primero»). Devuelve el punto y el `ctx`.
  4. `recheckWindow(ctx)` justo antes de `act(...)`: `backend.windowFrames(app)` tiene que contener un marco igual a `ctx.frame` (±1);
     si no, `reportBridgeDenied('window-moved')` y no se actúa.
  5. Tras `requireTier('click'|'full', p, session)`: en origen aislado, `appAtPoint(p).bundleId === ctx.app.bundleId` o
     `reportBridgeDenied('outside-window')` y rechazo. `drag`: los dos extremos con el mismo `ctx`.
  6. `pointFromArgs` con `element: N` en origen aislado: rechazo con un mensaje que lleva a x/y sobre `app_screenshot` (no hay lista).
     `teach_step` con x/y usa la misma conversión.
  7. `find_element`/`list_elements` en origen aislado: puntos en píxeles de la `app_screenshot` de esa app (`(global − rect.origen) ×
     imagen / rect`), marcando «fuera de la ventana capturada» lo que no cae dentro; sin captura, una línea que pide `app_screenshot`.
  8. Descripciones de herramientas: `app_screenshot` y `XY` dicen las dos cosas (fuera del modo de apps: solo para mirar; en el modo de
     apps: sus píxeles valen para los clics). Si cambia la descripción, regenerar el fixture con
     `UPDATE_CU_FIXTURE=1 npx vitest run src/main/computer/mcp-server.equivalence.test.ts` y `npx prettier --write` sobre el fixture, y
     revisar en el diff que SOLO cambian esas descripciones.
- **Terminado cuando:** un clic en origen aislado sobre una ventana en un monitor con origen negativo o a la derecha llega al helper con
  el punto global correcto, todos los rechazos de arriba se cumplen con helper falso, y la equivalencia fuera del origen aislado sigue
  igual (salvo las descripciones, si se cambian).
- **Pruebas (helper falso, `src/test/cu-mcp-kit.ts` + `e2e/fake-cu-helper`; solo POSIX):** nuevo bloque en `mcp-bridge-origin.test.ts`
  para macOS y para Windows (`COMPUTER_BACKEND: 'win32'`, como en `:317`):
  - pantallas `[{principal 0,0}, {x:-1920,y:0}]` y `[{principal}, {x:1512,y:-200}]`; `windows-of` con la ventana en el secundario;
    `window-shot` con un tamaño que cuadra; `left_click` en px de la imagen → la llamada `click` del helper lleva el punto global esperado;
  - Windows con `rect` ≠ `frame` (bordes invisibles): la conversión usa `rect` y el límite usa `frame`;
  - escala: imagen reducida por `sips` (ventana 1400 pt de ancho → JPEG 1366) y monitor a escala 1 junto a principal a escala 2;
  - rechazos sin llamada `click`: sin `app_screenshot`; captura de otra sesión; captura caducada (reloj falso con `vi.setSystemTime`);
    px fuera de la imagen; punto en la ventana pero fuera de todo monitor; `windows-of` con otro marco (ventana movida); `app-at` con otra
    app (concedida o no); `drag` con un extremo fuera; comprobación cruzada de tamaño fallida en macOS (`locateWindowShot` → `null`).
  - En `service-bridge-round2.test.ts` (G1, G2, F2…), los `left_click {x:10,y:10}` de origen aislado pasan a llamar antes a
    `app_screenshot` con `windows-of`/`window-shot` guionados; se añade una prueba de que el clic a ciegas sin captura ya no pasa.
  - Ojo: en Linux el `sips -g` falso devuelve siempre 10×10 (`cu-mcp-kit.ts:241`); en el Mac, el real. Las pruebas calculan el punto
    esperado a partir del tamaño que el MCP informa, o el kit gana una variable para fijar ese tamaño.

### T4. Prompt del agente aislado, seguridad y registro — modelo `haiku`

- **Depende de:** T3 (para describir lo que de verdad quedó).
- **Archivos (exclusivos):** `src/main/tasks/unified-apps-prompt.ts`, `src/main/tasks/agent-prompts.test.ts` (si fija el texto),
  `docs/SEGURIDAD.md` (§«Puente de apps del modo unificado»), `CHANGELOG-FASE8.md` (siguiente ID libre, hoy `F8-B231`).
- **Qué se hace:** en el prompt, quitar «varias pantallas» de lo que no se puede y añadir: «para hacer clic con el ratón real en una app
  concedida, primero `computer_app_screenshot` de esa app; x/y van en píxeles de esa imagen; no uses los números de `app_find`/`app_tree`
  como x/y». En `SEGURIDAD.md`: el clic queda acotado a la ventana capturada (comprobaciones 1–7 de §2), el cambio del helper de Windows
  y los límites residuales de §5. Entrada en el changelog con sus pruebas.
- **Terminado cuando:** `npx vitest run src/main/tasks/agent-prompts.test.ts src/test/visible-terms.test.ts src/test/i18n-coverage.test.ts`
  pasa (el texto del prompt no nombra productos de terceros).

### T5. Revisión de seguridad independiente de T2 y T3 — modelo `sonnet` (un agente que no escribió T2 ni T3)

- **Archivos:** ninguno (solo lee el diff; el resultado se anota en el mensaje del commit de T3, `AGENTS.md` §7).
- **Qué mira:** que ningún camino de origen aislado acepte x/y sin `windowCtx`; que la conversión no permita salir de `frame`; que
  `recheckWindow` y la comprobación de la app bajo el punto vayan después de la última espera y antes de `act`; que la sesión hermana no
  use la captura de otra; que fuera del origen aislado no cambie nada (diff del fixture); que el helper de Windows siga comprobando app
  bajo el punto y app al frente en todos los comandos de entrada; que el texto al modelo no lleve el rectángulo global.
- **Terminado cuando:** hay un informe con hallazgos resueltos o aceptados por Ben.

### T6. Prueba real en el Mac y en el PC Windows — modelo `sonnet`

- **Depende de:** T3 (y T2 compilado para Windows). Ver §4.2. Sin archivos de código.

---

## 4. Verificación

### 4.1 Automática

En el Mac (como mucho 1–3 archivos por vez, `AGENTS.md` y la regla de no saturar):

- T1: `npx vitest run src/main/computer/mcp-platform-darwin.test.ts src/main/computer/mcp-platform-win32.test.ts src/main/computer/mcp-server.equivalence.test.ts`
- T2: `npx vitest run src/test/cu-protocol.test.ts`; `cargo test` del helper en el PC Windows o en el VPS con el destino cruzado.
- T3: `npx vitest run src/main/computer/mcp-bridge-origin.test.ts src/main/computer/service-bridge-round2.test.ts src/main/computer/mcp-server.equivalence.test.ts`
- T4: los tres de su criterio.
- Cada commit: `npm run typecheck`, `npm run lint`, `npm run format:check` en el Mac; **`npm test` completo y `npm run build` en el
  contenedor del VPS**. Las pruebas del MCP con helper falso son `posixOnly`: corren en el Mac y en el VPS (Linux), no en Windows.

### 4.2 Prueba real (sin inventar: qué se puede comprobar y qué no)

Con el Mac de Ben (normalmente un solo monitor), con la app de desarrollo, userData temporal y modelo gratuito por CDP:

- **Sí se puede:** que en origen aislado `app_screenshot` + `left_click` en px de esa imagen pulsa el botón correcto de una app real en la
  principal (regresión del caso de un monitor), con una app de buena accesibilidad (Notas) y con una de accesibilidad pobre (Spotify);
  que el clic a ciegas sin captura se rechaza; que mover la ventana entre la captura y el clic se rechaza; que una ventana medio fuera de
  la pantalla (arrastrada hacia un borde) rechaza los puntos de la parte que no se ve; que una notificación encima del punto se rechaza.
  Para comprobar la conversión sin depender de la vista: tomar el `frame` AX de un botón con `app_find`, calcular su píxel en la imagen y
  confirmar que `left_click` en ese píxel llega a `click` con el centro del botón (registro del MCP).
- **No se puede con un solo monitor:** el caso real de una ventana en otro monitor, con origen negativo o con escala distinta. macOS no
  tiene una pantalla virtual pública y no vamos a instalar software de terceros ni usar API privadas para simularla. Se necesita un
  segundo monitor de verdad, un iPad con Sidecar, o un adaptador HDMI «fantasma». Hasta tener uno de esos, el caso de varios monitores
  en macOS queda comprobado solo con el helper falso (la aritmética y las barreras), no con el sistema real.
- **Windows (PC de pruebas por SSH/Tailscale, tarea programada para corridas largas):** con un solo monitor se puede comprobar lo mismo
  que en el Mac más que `window-shot` devuelve `rect` y `frame` coherentes (los bordes invisibles de Windows 10/11) y que un clic en px de
  la imagen cae en el sitio con escala 125 % o 150 % en el monitor principal. Para varios monitores hace falta un monitor real o un
  controlador de pantalla virtual (Indirect Display Driver), que es instalar un controlador en el PC: **decisión de Ben**. Una sesión de
  escritorio remoto con varios monitores solo sirve si el equipo cliente tiene varios.
- Lo que no se ha probado se escribe así en `SEGURIDAD.md` y en el changelog («probado con helper falso; sin probar con un segundo
  monitor real»).

---

## 5. Riesgos y lo que NO se resuelve

- **Carrera de milisegundos:** entre `recheckWindow`/`appAtPoint` y el clic real la ventana puede moverse o aparecer otra encima; no hay
  forma atómica de «clic solo si sigue ahí» (mismo límite residual que ya documenta `recheckFront`).
- **Menús emergentes, ventanas emergentes y hojas fuera de la ventana** (menú contextual que sobresale, selector de archivos del sistema,
  barra de menús de macOS): quedan fuera del marco capturado y se rechazan. Alternativas: `app_menu`, `key`, o una `app_screenshot` de
  esa otra ventana si es de la misma app y `window-shot` la lista (las de capa > 0 en macOS no las lista).
- **macOS: la comprobación cruzada se apoya en que `window-shot` captura a `frame × 2`.** Si algún día cambia `helper.swift`, T1 tiene que
  cambiar a la vez (una prueba en `mcp-platform-darwin.test.ts` deja escrito ese supuesto). Si `windows-of` y `window-shot` eligen
  ventanas distintas (transparencias raras), la captura queda solo para mirar: falla cerrado, no clica mal.
- **El modelo puede seguir pasando números de `app_find` como x/y.** Ahora se interpretan como píxeles de la ventana: el clic cae en otro
  sitio DENTRO de la app concedida, nunca fuera. Mitigan el texto de las herramientas y el prompt (T4).
- **Monitores conectados o desconectados a mitad de sesión:** se releen en cada `app_screenshot`; entre medias, `recheckWindow` y el
  helper de Windows detienen un clic que ya no cae en un monitor.
- **Indicador visual del clic:** el overlay de Lazunox vive en la pantalla principal (`overlay.ts:100`, `:285`); en otro monitor puede no
  verse la marca del clic. Es cosmético; no se resuelve aquí.
- **Esquinas activas de macOS** al mover el puntero cerca de una esquina: límite residual ya documentado.
- **No se resuelve:** capturas de pantalla completa de ningún monitor en origen aislado (sigue prohibido); clics con `app_screenshot`
  fuera del origen aislado (Control total sigue con `screenshot`); el tamaño mal informado de `app_screenshot` en macOS fuera del origen
  aislado (`mcp-server.ts:2406`, se arregla solo en origen aislado para no tocar la equivalencia; **decisión de Ben** si se arregla también
  fuera); la lista numerada `element: N` sobre `app_screenshot` (posible paso siguiente); arrastrar entre dos apps.
- **Windows sin probar en real con varios monitores** hasta tener el hardware o el controlador virtual (ver §4.2).

### Decisiones que necesita Ben

1. ¿Se acepta que en origen aislado un clic con x/y **sin** `app_screenshot` previa deje de funcionar (hoy pasa a ciegas en la principal)?
   El plan lo recomienda: es falla cerrado y lo exige la acotación a la ventana.
2. ¿Se quita la restricción «solo monitor principal» del helper de Windows para todos los modos (T2), sabiendo que fuera del modo
   unificado el MCP sigue limitando los clics a la principal?
3. Para la prueba real con varios monitores: ¿segundo monitor/iPad/adaptador en el Mac, y se instala o no un controlador de pantalla
   virtual en el PC Windows?
4. ¿Se corrige también fuera del origen aislado el tamaño mal informado de `app_screenshot` en macOS (cambia el fixture de equivalencia)?
