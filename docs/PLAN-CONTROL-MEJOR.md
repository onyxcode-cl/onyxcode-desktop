# Plan: cómo controla la IA el ratón y el teclado en el modo de apps (origen aislado)

Estado: plan, sin código. Rama: `feat/modo-unificado`. Fecha: 2026-10-28.

Alcance: el agente aislado del modo unificado (puente de apps, `docs/SEGURIDAD.md` §«Puente de apps del modo unificado»), en macOS y
Windows. Parte de lo que ya dejó `docs/PLAN-PANTALLA-SECUNDARIA.md` (clic en píxeles de `app_screenshot`, `windowCtx`,
`locateWindowShot`, `windowFrames`, `recheckWindow`, `assertCapturedAppAt`).

Qué pasó en las pruebas reales (Windows App, escritorio remoto): más de 50 pasos para leer el espacio libre de un disco; cifras de letra
chica leídas mal en las capturas; confusión porque otra ventana (Brave, Finder) tapaba la app; acciones repetidas sin saber si habían
hecho algo. Ideas tomadas de proyectos abiertos (windows-desktop-skill, agent-computer-use-oss, lindoelio/computer-use y el skill
«computer-use» de NousResearch/hermes-agent sobre el driver cua-driver): **se reimplementan, no se copia código**.

Reglas que no cambian (todas se mantienen tal cual): en origen aislado nunca hay captura de pantalla completa; solo se actúa sobre apps
con el nivel concedido; siguen `requireTier`, `assertCapturedAppAt`, `recheckWindow`, `recheckFront`, la lista de teclas bloqueadas y
el bloqueo de Finder/Explorador; al modelo no le llega contenido de otras ventanas (como mucho el NOMBRE de la app que tapa); fuera del
origen aislado no cambia el comportamiento (`mcp-server.equivalence.test.ts`; solo pueden cambiar textos de descripción de
herramientas, regenerando el fixture a propósito). No se toca `resources/computer-use/helper.swift` (zona intocable; recompilarlo hace
que macOS olvide Accesibilidad y Grabación de pantalla). Solo soluciones locales y gratuitas.

Todas las rutas son de `src/main/computer/` salvo que se diga otra cosa.

---

## 1. Diagnóstico (leído en el código)

### 1.1 Zoom limitado a la ventana

- **Existe** la herramienta `zoom` (`mcp-server.ts:1819-1862`), pero solo sobre la última captura de pantalla completa (`lastShot`,
  `:662`). En origen aislado se rechaza siempre (`:1838`, mensaje `ISOLATED_SCREEN_REJECT_MSG`, `:116-117`).
- **Contradicción visible para el modelo**: la descripción de `type_text` pide «Comprueba SIEMPRE con zoom lo escrito» (`:2028`) y su
  respuesta en escritorio remoto lo repite (`:2070-2072`), pero en origen aislado `zoom` falla. Es una causa directa de pasos perdidos.
- macOS: el helper ya trae `zoom-image <in> <out> x y w h scale` (`resources/computer-use/helper.swift:1611-1625`: recorta en px de la
  imagen, escala 1–4, JPEG de lado máx. 2000). `windowShot` del helper captura la ventana a `frame × 2` (`helper.swift:1086-1087`), pero
  el MCP solo le da al modelo el JPEG reducido a 1366 con calidad 70 (`mcp-platform-darwin.ts:480`) y **borra el PNG grande** al
  terminar (`mcp-server.ts:2656-2658`). Ese PNG tiene el doble de detalle: es el que sirve para leer letra chica.
- Windows: `zoomImage` lanza «no disponible» (`mcp-platform-win32.ts:779-781`); en `protocol.json` `zoom-image` es `win32: none`.
  `window-shot` sí acepta `--max-long` 100–4096 (`win/src/limits.rs:26-27`) y escribe PNG o JPEG según la extensión
  (`win/src/win/capture.rs:130-168`, `paths.rs:126-131`), siempre de la ventana completa (`run.rs:384-408`).
- **Falta**: zoom sobre la ventana concedida, en coordenadas de la última `app_screenshot`, con tope de tamaño configurable.

### 1.2 Aviso de ventana tapada

- Las capturas de ventana **muestran la ventana entera aunque otra la tape**: macOS usa ScreenCaptureKit con
  `desktopIndependentWindow` (`helper.swift:1084`), Windows `PrintWindow(PW_RENDERFULLCONTENT)` (`capture.rs:115-123`). El modelo ve la
  app «limpia», hace clic y recién ahí `assertCapturedAppAt` (`mcp-server.ts:1224-1234`) rechaza porque bajo el punto hay otra app. Eso
  explica la confusión con Brave/Finder: nada le avisó al capturar.
- macOS, lo que ya existe en el helper (sin tocarlo):
  - `app-at x y` (`helper.swift:387-408`): app del elemento de accesibilidad bajo el punto y, si falla, de la ventana más al frente
    que lo contiene. Ve también ventanas de capa > 0 (avisos, paneles flotantes). Un proceso por punto.
  - `running-apps` (`helper.swift:413-428`): apps con ventanas en pantalla, una por proceso, en el orden de su ventana más al frente.
  - `windows-of id1,id2,…` (`helper.swift:446-464`): rectángulos de las ventanas de capa 0 y no transparentes de esas apps, **en orden de
    delante hacia atrás**, pero sin decir de qué app es cada uno.
- Windows: `wnd::enum_top` da todas las ventanas visibles en orden Z (`win/src/win/wnd.rs:120-139`) y `top_window_at` la de arriba en
  un punto (`wnd.rs:293-297`); `window_shot` (`run.rs:384-408`) no calcula nada de esto.
- **Falta**: decir al capturar qué app tapa la ventana y cuánto, sin dar su contenido.

### 1.3 «¿Hizo algo la acción?»

- En origen aislado no hay captura automática tras una acción (`mcp-server.ts:2940`, `!isolatedCall`) y ninguna comparación antes/después.
  `act` (`:612-644`) solo emite inicio/fin; el texto de vuelta es «left_click en (x, y) px → (…) pt» (`:1354`) pase lo que pase.
- La espera larga de los escritorios remotos (`REMOTE_SETTLE_MS = 2200`, `:1706`) solo se usa para la captura automática, que en
  origen aislado no existe.
- El indicador de captura posterior (`screenshot`, `SHOT_FLAG`, `:1308-1313`, «por defecto true») **se ignora en silencio** en origen
  aislado (`:2940`): el modelo cree que pidió una captura y no la recibe.
- `computer_batch` (`:1900-1956`) devuelve solo una línea por paso.
- Los rechazos de origen aislado ya se notifican a main con un motivo corto (`reportBridgeDenied`, `:145-153`; acepta
  `^[a-z-]{1,40}$`, `service.ts`), pero al modelo le llegan como frases sueltas, sin un código que pueda reconocer.
- **Falta**: un veredicto por acción, barato y sin imágenes, y códigos de rechazo estables.

### 1.4 Elementos numerados en origen aislado

- La lista numerada nace solo de una captura de pantalla completa (`elementsBlock`, `:1654-1688`, y solo en macOS, `:1656`), y la
  instantánea es **global, no por sesión** (`elementsSnapshot`, `:1645`). En origen aislado `element: N` se rechaza a propósito
  (`pointFromArgs`, `:1736-1740`; prueba `mcp-bridge-origin.test.ts:982`).
- Lo que sí hay: `find_element`/`list_elements` ya expresan sus puntos en px de la `app_screenshot` vigente en origen aislado
  (`describeElement`, `:1580-1590`; `isolatedCtxFor`, `:1597-1601`). El helper de Windows también tiene `find-elements` (`run.rs:352-362`).
- **Falta**: lista numerada atada a UNA `app_screenshot`, con ficha por elemento y rechazo `stale` cuando ya no vale.

### 1.5 Foco tras teclear, esperas y guía de trabajo

- El foco se comprueba ANTES: `requireTier('full')` + `recheckFront` justo antes de escribir o pulsar (`:983-992`, `:2060`, `:2097`);
  al pegar, también justo antes de `cmd+v` (`beforePress`, `:2062`). **Nada se comprueba después**. `type_text` acepta hasta 5000
  caracteres en UNA llamada al helper (`:2046`, `:2065`): a 14 ms por carácter, más de un minuto en el que el foco puede cambiar sin
  que nadie lo note. `expect_app` (`:295-306`) también es solo previo.
- `wait` es una pausa fija de 0–10 s (`:2187-2197`); no existe «esperar a que aparezca algo».
- El prompt del agente aislado (`src/main/tasks/unified-apps-prompt.ts`) habla de permisos, de `app_screenshot` antes del clic y de
  no pedir otras apps para sortear un rechazo, pero nada de: cuándo verificar, lotes (`computer_batch`), atajos, pegar texto largo,
  preguntar en qué equipo trabajar (local o sesión remota), ni de cómo escalar cuando algo no funciona.
- `resources/opencode/agents/computer.md` es el agente de Control total: **no se toca en este plan** (no es origen aislado).

---

## 2. Diseño elegido por mejora

Una pieza común sostiene 1.3, 1.4 y parte de 1.1: **la «sonda» de ventana**. Es una captura de la ventana concedida que NO va al
modelo: se decodifica en el MCP (PNG con `node:zlib`, sin dependencias), se reduce a una rejilla de luminancia (p. ej. 32×24 celdas) y
se borra al instante. Sirve para comparar «antes/después» y «captura/ahora». Vive en un módulo puro nuevo, `window-probe.ts`
(solo módulos de Node; lo importa únicamente el MCP, como los `mcp-platform*.ts`).

- macOS: la sonda es `window-shot <id> <tmp>.png <índice>` (el PNG a `frame × 2` que ya escribe el helper, sin `sips`).
- Windows: `window-shot` gana `--probe <tmp>.png` (miniatura PNG de lado ≤ 256 en la MISMA captura) y la sonda suelta es
  `window-shot <clave> <tmp>.png <índice> --max-long 256`.
- Atajo: si los bytes del PNG son idénticos, «sin cambios» sin decodificar.

### 2.1 Zoom de la ventana concedida

**Elegido:** la herramienta `zoom` existente gana una rama SOLO para origen aislado: `x, y, width, height` en px de la última
`app_screenshot` de esa sesión (el mismo espacio que los clics), `scale` 1–4, lado largo del resultado ≤ `COMPUTER_ZOOM_MAX_LONG`
(por defecto 1366, acotado a 400–2000). El texto dice que es solo para mirar. La región debe caer dentro de la imagen; si no hay
`app_screenshot` vigente (90 s), se rechaza con `[rechazo: no-capture]`.

- macOS: `app_screenshot` en origen aislado **conserva** el PNG grande (renombrado `shot-app-raw-<sello>.png`, así lo recoge
  `cleanupShots`) en un registro por sesión `windowShots` (independiente de `windowCtx`, para que el zoom funcione aunque la ventana no
  se haya podido ubicar para clics). El zoom convierte la región a px del PNG (factor `ancho_png / ancho_jpeg`) y llama a `zoom-image`
  del helper (ya existe). Si el resultado pasa del tope, `sips -Z`. Muestra lo que el modelo ya vio, con el doble de detalle.
- Windows: `window-shot` gana `--crop x,y,w,h` (en px del rectángulo de origen de la ventana): captura la ventana de nuevo a resolución
  completa y codifica solo ese trozo. El MCP exige que el `x, y, srcWidth, srcHeight` devuelto sea igual al `rect` guardado (si la
  ventana se movió o cambió de tamaño: `[rechazo: window-moved]`). Es una imagen fresca de la misma ventana.
- Helper falso: `--crop` en `protocol.json` (`win32Flags`) para que `fake.mjs` lo acepte; las pruebas de macOS guionan `zoom-image`.

**Descartado:** (a) herramienta nueva `app_zoom`: otro nombre que aprender y el prompt y `type_text` ya dicen «zoom»; (b) recortar el
JPEG que vio el modelo: el texto chico ya llega emborronado a 1366/calidad 70, ampliarlo no lo hace legible; (c) zoom de pantalla en
origen aislado: rompe la regla de no mostrar el escritorio; (d) en Windows, `zoom-image` con WIC sobre el JPEG: misma pérdida que (b).

### 2.2 Aviso de ventana tapada

**Elegido:** al hacer `app_screenshot` en origen aislado, una línea más en el texto, p. ej.:
«Ojo: "Brave Browser" tapa ~40 % de esta ventana (zona derecha) y ~5 % queda fuera de pantalla. La imagen muestra la ventana entera,
pero los clics en la zona tapada se rechazarán: pide a la persona que la deje a la vista.» Solo nombres de app (máx. 3) y porcentajes;
los rectángulos de otras ventanas se quedan dentro del MCP. El cálculo es informativo: la barrera sigue siendo `assertCapturedAppAt`.

- **macOS, sin tocar el helper — viable.** Con los comandos que ya existen:
  1. `running-apps` (1 llamada): las claves de todas las apps con ventanas en pantalla.
  2. `windows-of <todas, incluida la capturada>` (1 llamada): rectángulos de capa 0 en orden Z de delante hacia atrás.
  3. Se ubica la ventana capturada en esa lista (marco igual a `windowCtx.frame` ±1; los marcos propios de la app ya los trajo
     `locateWindowShot`). Lo que está antes y la corta, y no es de la propia app, la tapa. El % se calcula con una rejilla en el MCP
     (sin llamadas). Lo fuera de pantalla sale de la lista de monitores.
  4. `app-at` en un punto de cada zona tapada (máx. 3 llamadas) para poner NOMBRE a quien tapa (lo que está arriba de verdad).
  - Coste: **2 llamadas si nada la tapa, hasta 5 si sí** (cada una es un proceso del helper, decenas de ms; cada `app-at` con tope de
    1,5 s porque la accesibilidad de una app colgada puede tardar). Si la ventana no aparece una sola vez en la lista (ambigüedad),
    se dice «no se pudo comprobar si está tapada» y nada más.
  - Límites: no cuenta ventanas de capa > 0 (avisos, menús, paneles siempre encima) salvo que caigan en un punto de `app-at`; puede
    sobrestimar con ventanas de forma irregular. Se escribe así en `SEGURIDAD.md`.
  - Alternativa medida y descartada: solo `app-at` en una rejilla 4×4 (16 procesos por captura, cada punto vale 6 %, y riesgo de
    esperar a una app colgada en cada punto).
- **Windows, en el helper (1 llamada, la misma captura).** `window_shot` añade `covered: [{name, pct}]` y `coveredPct`: muestrea una
  rejilla 32×32 sobre `w.frame` con la lista de `enum_top` (en memoria, sin llamadas por punto), cuenta los puntos donde la ventana de
  arriba no es la capturada ni del mismo proceso (`top_window_at`, que ya salta las que dejan pasar el ratón), y agrupa por nombre de
  app (`cache.info_for_window`; sin identificar → «una ventana sin identificar»). La lógica de la rejilla va en un módulo puro
  (`win/src/occlusion.rs`, junto a `mask.rs`) para que `cargo test` corra fuera de Windows.
- Helper falso: `window-shot` por defecto devuelve `covered: []`; las pruebas guionan `covered` (Windows) o `running-apps`/`windows-of`/
  `app-at` (macOS).

**Descartado:** cambiar `helper.swift` para devolver el dueño de cada ventana (zona intocable y pérdida de permisos); tapar con negro en
la imagen la zona cubierta (el modelo dejaría de ver lo que la persona tampoco ve, pero haría falta la posición exacta de otras ventanas
dentro de la imagen y no aporta más seguridad que el rechazo al clicar).

### 2.3 «¿Hizo algo la acción?»: veredicto estructurado

**Elegido:** en origen aislado, tras `left_click`, `double_click`, `right_click`, `scroll`, `drag`, `type_text`, `key` y `batch` (un
solo veredicto para el lote entero), la PRIMERA línea del texto es:

```
efecto: confirmed | unverifiable | suspected_noop — <motivo corto>[; siguiente: <escalada sugerida>]
```

Cómo se calcula, sin mandar imágenes:

1. **Antes** de actuar: sonda de la ventana (la de `windowCtx` si su app es la que está al frente; si no, la ventana 0 de la app al
   frente, que ya pasó `requireTier`), número de ventanas de la app (`windowFrames`) y app al frente.
2. **Después**: sondas cada ~400 ms hasta que cambie algo o se agote el tiempo (1,5 s en apps locales; 4 s si al frente hay un cliente
   de escritorio remoto, `isRemoteClientApp`), más `windowFrames` y `frontmost` una vez.
3. **Lectura de vuelta por accesibilidad, cuando aplica** (solo apps locales; los clientes remotos no la tienen): tras `type_text`,
   `find-elements --app <app al frente> --query <últimos ≤40 caracteres sin saltos>`; si un campo contiene ese texto → `confirmed`.
4. Reglas (función pura en `window-probe.ts`):
   - `confirmed`: hubo lectura de vuelta que coincide (paso 3) o, en `wait` con condición, apareció lo esperado (§2.5).
   - `suspected_noop`: la ventana no cambió (por debajo del umbral, p. ej. < 0,3 % de celdas con Δ luminancia > 6), mismo número de
     ventanas y misma app al frente, tras el tiempo completo, y la acción es de las que se ven (clic, doble clic, scroll, arrastre,
     escribir, teclas de edición/navegación).
   - `unverifiable`: cambió algo pero no hay lectura de vuelta («se entregó; la ventana cambió ~12 % (zona centro); confírmalo con
     app_screenshot si importa»), la sonda falló, o la acción puede no verse en la ventana (clic derecho: los menús emergentes son otra
     ventana; combinaciones con cmd/ctrl como copiar; `mouse_move` no lleva veredicto).
   - Si cambió la app al frente o apareció/desapareció una ventana de la app, se dice (solo nombre).
5. **Escalada sugerida** (solo como reacción al veredicto, nunca por el tipo de app):
   - clic por x/y con `suspected_noop` → «prueba element: N (de la lista de la captura) o app_press por accesibilidad»;
   - clic por `element` con `suspected_noop` → «prueba app_press o x/y en el centro del elemento»;
   - escribir en escritorio remoto con `suspected_noop` → «prueba input: "paste" y comprueba con zoom»;
   - **segunda** `suspected_noop` sobre el mismo objetivo (misma app y punto a ±8 px, o mismo texto) → «no repitas: esa superficie no
     acepta la entrada simulada; usa la vía propia de la app (atajo, menú con app_menu, archivo o línea de comandos)».
   - Acción igual a una con `confirmed` en los últimos 60 s → aviso «ya se confirmó; no la repitas» (aviso, no bloqueo).
   Registro por sesión de las últimas ~20 acciones (herramienta, app, punto redondeado o hash del texto, veredicto), en memoria.
6. **Códigos de rechazo estables**: en origen aislado los errores empiezan por `[rechazo: <código>]`, con los mismos códigos que ya van a
   `reportBridgeDenied` (`no-capture`, `capture-expired`, `outside-window`, `window-moved`, `off-screen`, `front-changed`,
   `key-blocked`, `key-sequence`, `key-unknown`, `exempt-app`, `no-grant`, `low-tier`, `file-manager`, `unknown-app`) y nuevos:
   `covered` (bajo el punto hay otra app; hoy sale como `outside-window`), `stale` (§2.4), `focus-stolen` (§2.5). En los mensajes que
   comparten Control total (`ensureTier`), el prefijo se añade solo si `isolatedCall`.
7. **Captura en la misma llamada**: en origen aislado `screenshot: true` explícito (hoy se ignora) devuelve, tras el veredicto, una
   `app_screenshot` de la ventana de `windowCtx` (misma app e índice; la regla de solo-ventana se mantiene) y renueva `windowCtx` y la
   lista de elementos. `screenshot: false` explícito apaga las sondas (sin veredicto). Sin el argumento: veredicto sin imagen.
   La descripción de `SHOT_FLAG` lo dice (cambia el fixture).

Coste honesto: por acción, 1 sonda antes + 1 a 4 después + 2 llamadas cortas; ~0,5–1,5 s en apps locales y hasta ~4 s con escritorio
remoto (que hoy ya espera 2,2 s en Control total). Las sondas se borran al momento; al modelo solo llegan porcentajes y nombres.

**Descartado:** (a) comparar solo un hash: el cursor de texto que parpadea cambia el hash siempre y todo saldría «cambió»; (b) mandar
la captura de después al modelo en cada acción: es lo que el modelo ya puede pedir con `screenshot: true`, y no da un veredicto;
(c) diferencia en el helper de macOS (zona intocable); (d) lectura de vuelta por accesibilidad tras cada clic (cara y poco fiable en
apps Electron; se deja para `type_text` y `wait`).

### 2.4 Elementos numerados atados a una captura

**Elegido:** en origen aislado, `app_screenshot` (cuando la ventana se pudo ubicar) añade una lista numerada de elementos pulsables
de ESA app que caen dentro del marco de la ventana (mismo filtro de roles que `elementsBlock`, máx. 30, tope de 3 s; macOS y Windows,
ambos helpers tienen `find-elements`), con un **número de captura** y una ficha por elemento:

```
Captura #7 — elementos de Notas (para pulsar: element: N y capture: 7):
[1] botón «Nueva nota» (412, 88) 80×24
[2] campo de texto «Buscar» (980, 40) 200×28 [deshabilitado]
```

- Se guarda en `windowCtx` de la sesión (`captureId`, `elements`, `signature` = rejilla de la propia captura). Nada global.
- `element: N` en origen aislado exige `capture: <id>` (argumento nuevo, opcional fuera del modo de apps e ignorado allí). Se rechaza
  con `[rechazo: stale]` y «re-captura y vuelve a elegir» si: el id no es el de la captura vigente; la captura caducó o la reemplazó otra;
  una acción posterior cambió la ventana (veredicto distinto de `suspected_noop` ⇒ la lista se invalida); o la sonda previa a ESTE clic
  difiere de `signature` por encima del umbral (la ventana cambió por su cuenta). Nunca se cae en otro control.
- El punto del elemento sigue el mismo camino seguro que x/y: dentro de `frame`, dentro de un monitor, `assertCapturedAppAt`,
  `requireTier('click')`, `recheckWindow`.
- En `batch`, cada paso con `element` hace su propia sonda si antes hubo otro paso que actuó (la comparación es contra la captura).
- Para x/y no se rechaza (la geometría ya es segura), pero si la sonda previa difiere > 5 % de la captura se añade «ojo: la ventana
  cambió ~X % desde tu captura».

**Descartado:** reutilizar `elementsSnapshot` global (la sesión hermana vería la lista de otra); números sin id de captura (el modelo
usaría números viejos tras una captura nueva sin que nadie lo detecte); volver a consultar la accesibilidad en cada clic (más lento y
el AX puede no reflejar lo que se ve).

### 2.5 Foco después de teclear, esperar a algo y guía del agente

**Foco (elegido):** en origen aislado:
- `type_text` en modo Unicode o teclas físicas se escribe **por trozos de 200 caracteres**, con `recheckFront` entre trozos; tras el
  último, otra comprobación. Si el foco cambió a mitad: se detiene, `reportBridgeDenied('focus-stolen')`, se invalida `windowCtx` y el
  texto dice `[rechazo: focus-stolen]` «se escribieron N de M caracteres; luego pasó al frente "X"; revisa ambas apps antes de seguir».
- Pegar y `key`: una comprobación DESPUÉS de pulsar; si cambió, el veredicto lo dice (no se puede deshacer).
- Descartado: comprobar entre cada carácter (un proceso del helper por tecla); en Windows, comprobar dentro del helper (el helper ya
  comprueba la ventana al empezar, `run.rs:200-208`, y no conoce la app esperada).

**Esperar a algo (elegido):** `wait` gana, solo en origen aislado, `until_text` (+ `app` opcional; por defecto la de `windowCtx`) y
`until_change` (booleano), con `seconds` hasta 20 en este modo:
- `until_text`: `find-elements --query` sobre la app concedida (nivel `view`) cada 500 ms; al encontrarlo, `efecto: confirmed` y la
  ficha del elemento en px de la captura vigente.
- `until_change`: sondas de la ventana de `windowCtx` hasta superar el umbral (útil en escritorio remoto, donde no hay accesibilidad).
- Fuera del origen aislado, `wait` sigue igual (los argumentos nuevos se ignoran; la descripción lo dice).
- Descartado ahora: leer texto de la imagen (OCR). Para escritorio remoto sería lo que de verdad lee «espacio libre: 23 GB», y hay vías
  locales y gratuitas (Vision en un binario Swift APARTE, como ya es `cu-keys`, que solo lee un archivo y no necesita permisos; en
  Windows `Windows.Media.Ocr`). Queda como siguiente paso, **decisión de Ben** (§5).

**Guía del agente (elegido; `unified-apps-prompt.ts`):** reglas cortas, en dos tandas (T4 con lo que ya existe, T7 con lo nuevo):
- **Escalera**: primero accesibilidad en segundo plano (`app_find`/`app_press`/`app_set_value`) → verificar con una captura fresca de la
  app → solo entonces coordenadas sobre `app_screenshot` → solo entonces métodos más intrusivos (teclas físicas, pegar, Control total con
  el marcador). Se sube un peldaño **como reacción a una señal devuelta** (`suspected_noop`, un rechazo), nunca por adivinar según el
  tipo de app.
- Un efecto `confirmed` no se repite. Tras UNA pérdida verificada en una superficie que se traga la entrada simulada, no repetir la
  escalera: usar la vía propia de la app (atajo, menú, archivo, línea de comandos del sandbox).
- Verificar solo después de acciones que cambian algo; usar `screenshot: true` en la misma llamada en vez de una llamada aparte.
- `computer_batch` cuando ya se sabe la secuencia; atajos de teclado antes que varios clics.
- Texto largo: en apps locales, `type_text` normal; en escritorio remoto, `input: "paste"` y comprobar con zoom (si sale el texto
  anterior, `input: "keys"`).
- Si el pedido no deja claro **en qué equipo** (este ordenador o la sesión remota abierta), preguntar antes de actuar.
- Leer cifras y letra chica con `zoom` sobre la captura de la app, no adivinando.
- Capturas solo de la app concedida; no pedir acceso a otra app para sortear un rechazo (`covered`: pedir a la persona que deje la
  ventana a la vista).

---

## 3. Tareas

Orden y paralelismo (como mucho 2 a la vez; el Mac de Ben se satura):

```
Ronda 1:  T1 (módulo puro de sondas)        ∥  T2 (helper de Windows + contrato + helper falso)
Ronda 2:  T3 (backends macOS/Windows)       ∥  T4 (guía del agente, tanda 1)
Ronda 3:  T5 (MCP: zoom, aviso de tapado, elementos numerados)
Ronda 4:  T6 (MCP: veredicto, foco tras teclear, wait con condición)
Ronda 5:  T7 (guía tanda 2 y documentación)  ∥  verificación real (§4.2)
```

Propiedad de archivos: ningún archivo lo editan dos tareas a la vez. `mcp-server.ts` lo tocan solo T5 y luego T6, en serie. Ninguna
tarea toca `helper.swift`, `keys.swift` ni otra zona intocable (`docs/zonas-intocables.json` no cambia).

### T1. Módulo puro de sondas y veredictos — `sonnet`

- **Archivos:** `src/main/computer/window-probe.ts` (nuevo), `src/main/computer/window-probe.test.ts` (nuevo).
- **Qué:** decodificador PNG mínimo (8 bits, tipos de color 0/2/4/6, sin entrelazado, filtros 0–4; otra cosa → `null`); firma en
  rejilla de luminancia; diferencia (`changedPct`, zona en palabras: «arriba a la izquierda», «centro»…); función de veredicto
  (entradas: tipo de acción, diferencia o fallo de sonda, ventanas antes/después, app al frente antes/después, lectura de vuelta,
  remoto, repeticiones → `{effect, reason, escalation?}`); geometría de tapado (lista Z de rectángulos, índice de la ventana, marcos
  propios, monitores → `coveredPct` por tapador, `offscreenPct`); registro de repeticiones por sesión (clase pura con tope).
  Solo módulos de Node (`node:zlib`, `node:crypto`).
- **Terminado:** se importa sin efectos secundarios; no lo usa nadie todavía.
- **Pruebas:** PNG generados en la prueba (colores lisos, un cuadrado que cambia, un «cursor» de 2×20 px que no debe contar), cada filtro,
  PNG inválido → `null`; tabla de veredictos (cada regla de §2.3); tapado con ventana encima parcial, debajo, de la propia app, fuera de
  pantalla, ambigüedad → «no se sabe». En el Mac: `npx vitest run src/main/computer/window-probe.test.ts`.

### T2. Helper de Windows: tapado, recorte y miniatura — `sonnet` — **revisión de seguridad independiente**

- **Archivos:** `resources/computer-use/win/src/win/run.rs`, `win/src/commands.rs`, `win/src/occlusion.rs` (nuevo, puro) y
  `win/src/lib.rs` (registrar el módulo), `resources/computer-use/protocol.json`, `win/src/protocol_tests.rs`,
  `e2e/fake-cu-helper/fake.mjs`, `src/test/cu-protocol.test.ts` (si fija la salida).
- **Qué:** (1) `window-shot` devuelve `covered` y `coveredPct` (§2.2); (2) bandera `--crop x,y,w,h` (px del rectángulo de origen,
  validada dentro de la imagen; fuera → código 1); (3) bandera `--probe <ruta.png>` (miniatura PNG ≤ 256 px en la misma captura; ruta
  validada con `image_out`, dentro del temporal). `protocol.json`: todo opcional y aditivo, solo `win32`. `fake.mjs`: `covered: []` por
  defecto, respuesta con `imageB64` (imagen propia por llamada, para sondas antes/después distintas), escribe también el archivo de
  `--probe`.
- **Terminado:** `node scripts/build-native.mjs --win-helper-test` (pruebas puras, en cualquier sistema; en el Mac pesado → contenedor
  del VPS), `npx vitest run src/test/cu-protocol.test.ts`, y el `.exe` compila (`node scripts/build-native.mjs --win-helper` o Docker
  desde el Mac, como en el plan anterior).
- **Pruebas:** Rust puro: rejilla con ventana encima al 50 %, ventana del mismo proceso (no cuenta), ventana que deja pasar el ratón (no
  cuenta), sin tapar → `[]`; `--crop` en el borde y fuera; parseo de banderas. TS: contrato.
- **Revisión:** que `covered` no lleve más que nombres y porcentajes; límites del recorte; rutas de `--probe` dentro del temporal.

### T3. Backends: sonda, zoom y tapado — `sonnet`

- **Depende de:** T1 y T2.
- **Archivos:** `mcp-platform.ts`, `mcp-platform-darwin.ts`, `mcp-platform-win32.ts`, `mcp-platform-darwin.test.ts`,
  `mcp-platform-win32.test.ts`.
- **Qué:** `WindowShotResult` gana `covered?`; métodos nuevos `probeWindow(appKey, índice, ruta)` (macOS: `window-shot` a PNG; Windows:
  `--max-long 256` a PNG), `zoomWindow(...)` (macOS: `zoom-image` sobre el PNG conservado + `sips -Z` si pasa del tope; Windows:
  `window-shot --crop`, devolviendo el `rect` para que el MCP lo compare), `occlusion(appKey, frame, marcosPropios, pantallas)` (macOS:
  §2.2 con `running-apps`, `windows-of`, `app-at` con tope de 1,5 s, usando la geometría de T1; Windows: lee `covered` de la captura).
  Windows: `windowShot` pide `--probe` solo si el MCP lo pide (parámetro opcional), así las llamadas de siempre no cambian.
  **`windowShot` de macOS no cambia ni un byte.**
- **Terminado:** nadie llama aún a lo nuevo; `mcp-server.equivalence.test.ts` pasa sin regenerar el fixture.
- **Pruebas:** dobles del helper: orden de llamadas y su número (2 sin tapar, ≤ 5 tapada), `app-at` que tarda → sin nombre, ventana
  ambigua → `null`; Windows con y sin `covered`/`rect` (helper viejo → zoom no disponible), recorte con `rect` distinto.

### T4. Guía del agente, tanda 1 (solo lo que ya existe) — `haiku`

- **Archivos:** `src/main/tasks/unified-apps-prompt.ts`, `src/main/tasks/agent-prompts.test.ts`.
- **Qué:** escalera y «escalar como reacción»; no repetir lo confirmado ni insistir en una superficie que se traga la entrada; lotes y
  atajos; texto largo y escritorio remoto; preguntar en qué equipo; capturas solo de la app; no sortear rechazos (§2.5). Frases cortas.
  No nombrar herramientas que aún no existen.
- **Terminado:** `npx vitest run src/main/tasks/agent-prompts.test.ts` y luego `src/test/visible-terms.test.ts` (uno por uno).

### T5. MCP, parte A: zoom, aviso de tapado y elementos numerados — `sonnet` — **revisión de seguridad independiente**

- **Depende de:** T1 y T3.
- **Archivos:** `mcp-server.ts`, `mcp-bridge-origin.test.ts` (actualizar `:276` zoom y `:982` element), `mcp-bridge-window.test.ts`
  (nuevo), `mcp-server.equivalence.fixture.json` (regenerado a propósito: descripciones de `zoom`, `left_click`/`right_click`/
  `double_click`/`mouse_move` y el argumento `capture`).
- **Qué:** §2.1 (rama aislada de `zoom`, `windowShots` por sesión, PNG conservado en macOS); §2.2 (línea de tapado en `app_screenshot`);
  §2.4 (lista con `captureId` en `windowCtx`, `capture` obligatorio con `element` en origen aislado, `stale` por id o por firma);
  prefijo `[rechazo: …]` en los errores de origen aislado y `covered` en `assertCapturedAppAt`. Fuera de `isolatedCall`, cero cambios.
- **Terminado:** todo lo de §2.1, §2.2 y §2.4 cumplido con helper falso en macOS y Windows; el diff del fixture solo muestra
  descripciones y el argumento nuevo.
- **Pruebas (solo POSIX):** zoom: región dentro/fuera, sin captura, sesión hermana sin captura propia, tope de tamaño, Windows con
  `rect` distinto → `window-moved`; tapado: Windows `covered` guionado → nombre y %, macOS guion de `running-apps`/`windows-of`/`app-at`,
  sin tapar → sin línea; elementos: lista y fichas, `element` sin `capture`, con `capture` viejo, tras captura nueva, sonda distinta →
  `stale` y **ninguna llamada `click`**; elemento fuera del marco → sin clic; sesión hermana no ve la lista de otra.
- **Revisión:** que ningún camino nuevo devuelva imagen o rectángulos de otra app; que `element` no esquive ninguna comprobación de x/y;
  que el PNG conservado no sobreviva a la caducidad ni sea legible por otra sesión; equivalencia.

### T6. MCP, parte B: veredicto, foco tras teclear y `wait` con condición — `sonnet` — **revisión de seguridad independiente**

- **Depende de:** T5.
- **Archivos:** `mcp-server.ts`, `mcp-bridge-effect.test.ts` (nuevo), `service-bridge-round2.test.ts` (solo si el troceo cambia sus
  llamadas guionadas), `mcp-server.equivalence.fixture.json` (descripciones de `wait` y `SHOT_FLAG`).
- **Qué:** envoltorio en `callToolInner` para las herramientas de §2.3 en origen aislado (sondas antes/después con sondeo, lectura de
  vuelta de `type_text`, veredicto, escalada, registro de repeticiones, `screenshot: true/false`), invalidación de la lista de elementos
  por veredicto, troceo de `type_text` con `recheckFront` y `focus-stolen`, comprobación tras pegar y tras `key`, `wait` con
  `until_text`/`until_change`.
- **Terminado:** cada regla de §2.3 y §2.5 con helper falso; `batch` da un solo veredicto; fuera del origen aislado, equivalencia igual
  salvo descripciones.
- **Pruebas:** sondas iguales → `suspected_noop` (y la escalada correcta; la segunda vez, «no repitas»); sondas distintas →
  `unverifiable` con %; lectura de vuelta → `confirmed`; cliente remoto → espera más larga (reloj falso con `vi.setSystemTime`);
  sonda que falla → `unverifiable`; foco que cambia en el 2.º trozo → solo se escribió el 1.º, `focus-stolen`; `wait until_text` que
  aparece a la 3.ª consulta y que nunca aparece; `screenshot: true` devuelve una captura de ventana, nunca de pantalla.
- **Revisión:** las sondas no salen del MCP y se borran; `screenshot: true` nunca captura pantalla completa ni otra app; el troceo no
  cambia qué teclas se pulsan; `wait until_text` exige el nivel de la app.

### T7. Guía tanda 2 y documentación — `haiku`

- **Depende de:** T6 (describe lo que de verdad quedó).
- **Archivos:** `src/main/tasks/unified-apps-prompt.ts`, `src/main/tasks/agent-prompts.test.ts`, `docs/SEGURIDAD.md` (§«Puente de apps
  del modo unificado»), `CHANGELOG-FASE8.md` (siguientes IDs libres, hoy desde `F8-B232`).
- **Qué:** en el prompt, las líneas de `zoom`, `efecto:` y su escalada, `element` + `capture`, `wait` con condición y
  `screenshot: true`. En `SEGURIDAD.md`: lo que ve y no ve el modelo (nombres y %), sondas, códigos de rechazo, límites de §5 y qué se
  probó con helper falso y qué en real.
- **Terminado:** `agent-prompts.test.ts`, `visible-terms.test.ts`, `i18n-coverage.test.ts` y `zonas-intocables.test.ts` pasan (uno por uno).

---

## 4. Verificación

### 4.1 Automática

- En el Mac, **un archivo por vez** (`npx vitest run <archivo>`): T1 `window-probe.test.ts`; T3 los dos `mcp-platform-*.test.ts` y luego
  `mcp-server.equivalence.test.ts`; T5 `mcp-bridge-window.test.ts`, `mcp-bridge-origin.test.ts`, equivalencia; T6
  `mcp-bridge-effect.test.ts`, `service-bridge-round2.test.ts`, equivalencia. Las del puente son `posixOnly` (Mac y VPS, no Windows).
- Cada commit: `npm run typecheck`, `npm run lint`, `npm run format:check` en el Mac; **`npm test` completo y `npm run build` en el
  contenedor del VPS**. Rust puro: `node scripts/build-native.mjs --win-helper-test` en el VPS o en Docker.

### 4.2 Prueba real

Mac de Ben (un monitor), app de desarrollo con userData temporal, modelo gratuito por CDP:

- **Se puede:** zoom legible sobre una ventana con letra chica (Información del sistema, Utilidad de Discos) y sobre Windows App
  conectado; aviso «X tapa ~N %» poniendo otra ventana encima a mano (Safari, Finder) y que desaparece al apartarla; veredictos:
  clic en un botón que hace algo (`unverifiable` con %), clic en una zona vacía (`suspected_noop`), escribir en Notas (`confirmed`),
  escribir en Windows App (`unverifiable` o `suspected_noop`, nunca `confirmed`); `element` + `capture` que pulsa el botón correcto
  y `stale` tras cambiar la ventana; foco robado: abrir otra app a mano mientras escribe un texto largo → se detiene; `wait until_text`
  con algo que tarda en aparecer. Medir el tiempo extra por acción (sondas) y anotarlo.
- **Solo con helper falso:** varios monitores y escalas (como en el plan anterior), carreras de milisegundos, apps colgadas en `app-at`.
- **Windows (PC de pruebas por Tailscale, tarea programada para corridas largas):** con el helper recompilado (Docker desde el Mac o
  `--win-helper`): `covered` con una ventana de Edge encima, `--crop` con escala 125 % y 150 %, sondas PNG, veredictos en el Bloc de
  notas y en una ventana de escritorio remoto si hay una a mano. Lo no probado se escribe como no probado en `SEGURIDAD.md`.

---

## 5. Riesgos y lo que NO se resuelve

- **El veredicto es una pista, no una prueba.** Un cambio en la ventana puede ser de un vídeo, un reloj o una animación (falso
  `unverifiable`); una acción puede hacer algo fuera de la ventana capturada (menú emergente, otra ventana, sonido) y salir
  `suspected_noop`. Por eso `suspected_noop` sugiere, nunca bloquea, y los menús emergentes cuentan como `unverifiable`.
- **Escritorio remoto:** la imagen llega con retraso; 4 s pueden no bastar en una red lenta (falso `suspected_noop`). La lectura de
  vuelta no existe ahí: nunca habrá `confirmed` salvo con `wait until_change`. Leer texto dentro de la sesión remota sigue siendo por
  vista + zoom, hasta un OCR local (decisión de Ben).
- **macOS, tapado por geometría:** no ve ventanas de capa > 0 salvo en los puntos de `app-at`; con ventanas irregulares sobrestima.
  Depende de que `windows-of` siga ordenado de delante hacia atrás (una prueba en `mcp-platform-darwin.test.ts` deja escrito el supuesto).
- **Coste en tiempo:** más llamadas al helper por acción (§2.3). Se mide en la prueba real; si molesta, el umbral de sondeo se ajusta.
  No se promete ahorro de pasos ni de tokens.
- **PNG conservado (macOS) y sondas:** archivos con el contenido de la ventana concedida en el temporal; se borran al caducar, con la
  siguiente captura y con `cleanupShots`. Es lo mismo que el modelo ya vio.
- **Carrera de milisegundos** entre la última comprobación y la acción: igual que hoy (límite documentado).
- **Troceo de `type_text`:** si el foco cambia, una parte del texto ya pudo llegar a otra app; se detiene en el siguiente trozo, no
  antes. Solo se puede reducir el daño, no evitarlo.
- **No se resuelve:** OCR; arrastrar entre apps; menús emergentes fuera del marco; varios monitores reales en macOS sin hardware;
  `computer.md` (Control total) no cambia.

### Siguiente paso a estudiar aparte (no entra en estas tareas): cua-driver como motor opcional

cua-driver (trycua/cua, licencia MIT, muy usado y activo) merece un estudio separado:
- **Qué hace:** en macOS entrega eventos de ratón y teclado a un proceso concreto con APIs privadas de SkyLight, sin mover el cursor
  real ni traer la ventana al frente; en Windows usa UI Automation + `PostMessage` sin robar el foco. Trae modos de permiso
  (standard/bounded/unrestricted) y un `doctor` de diagnóstico.
- **Dolores de hoy que resolvería:** ventana tapada (el clic llegaría a la ventana aunque otra esté encima, sin el rechazo `covered`),
  ventana en otra pantalla o en otro escritorio, y robo de foco (no haría falta traer la app al frente ni teclear sobre lo que esté al
  frente).
- **Costo y riesgos:** APIs privadas de macOS (pueden romperse con cada versión y complicar la notarización); otro binario con su propia
  firma y sus propios permisos TCC (el usuario tendría que concederlos de nuevo); revisar que su modelo de permisos no esquive nuestras
  comprobaciones por app (`requireTier`, lista de teclas, Finder/Explorador) — habría que envolverlo con las mismas barreras; en
  Windows, `PostMessage` no llega igual a todas las apps (juegos, Electron, ventanas elevadas); y la entrega «en segundo plano» haría que
  la persona no vea dónde actúa la IA (habría que mantener el indicador visual). Mantenimiento de una dependencia grande.
- Decisión de Ben si se estudia y cuándo.

### Decisiones que necesita Ben

1. ¿Se aceptan ~0,5–1,5 s extra por acción en apps locales (hasta ~4 s en escritorio remoto) a cambio del veredicto? ¿O apagado por
   defecto y solo con un argumento?
2. ¿`element` en origen aislado con `capture` obligatorio (más seguro, un argumento más para el modelo)?
3. ¿Se planifica el OCR local (binario Swift aparte en macOS, `Windows.Media.Ocr` en Windows) como plan siguiente?
4. ¿Se encarga el estudio de cua-driver?

---

## 6. Orden recomendado por valor

1. **Zoom de la ventana (T1→T3→T5)** junto con el **aviso de tapado** (mismo T5): atacan directamente los dos fallos vistos (letra chica
   y Brave/Finder encima) y quitan la contradicción de `type_text` que manda a usar un zoom que no funciona.
2. **Guía del agente tanda 1 (T4)**: barata y en paralelo; reduce pasos sin código del MCP (preguntar en qué equipo, lotes, atajos,
   no repetir).
3. **Veredicto por acción y foco tras teclear (T6)**: el que más evita repeticiones a ciegas, pero el más caro en tiempo por acción.
4. **Elementos numerados con `stale` (T5)**: ayuda a apuntar en apps con buena accesibilidad; en escritorio remoto no aporta (no hay
   elementos dentro de la sesión remota).
5. **Documentación y guía tanda 2 (T7)** y la prueba real.
