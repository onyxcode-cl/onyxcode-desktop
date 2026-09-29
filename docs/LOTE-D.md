# Lote D: navegador integrado en la ventana de la app. Qué se entregó, decisiones y guía de pruebas

Plan de origen: `docs/LOTE-D-PLAN.md` (hallazgos, arquitectura, contratos y reparto en paquetes
D0–D5). Antecedente directo: `docs/COWORK-LOTE-C.md` (el navegador propio con Chrome real, que este
lote conserva como opción avanzada). Hallazgos de seguridad y su estado: `AUDIT.md` §11. Modelo de
seguridad vigente: `docs/SEGURIDAD.md` («3 quater»).

> Nota de nombres: el producto se llama «OnyxCode» pero el código sigue diciendo «Lapis» (`APP_NAME`,
> `persist:lapis-web-*`, `lapis_session`, `embedded-browser/`…). No se renombró nada.

Orden de los paquetes: **D0 solo y primero** (prueba de viabilidad en Electron real, secuencial,
decide los fallbacks); **D1, D2, D3 y D4 en paralelo** (contratos/IPC/aislamiento, herramientas del
agente y MCP, interfaz compartida + Code, Cowork + Ajustes + ventana aparte); **D5 solo y al final**
(integración, documentación, y el único que ejecutó `npx electron-vite build`).

## 1. Qué se entregó, por área

### 1.1 Prueba de viabilidad (D0)
- Arnés propio en Electron real (no simulado) contra una página de prueba con botón, input, input de
  contraseña, `<select>`, enlaces a otro puerto/ruta, `window.open`, descarga, `alert` y `fetch` a
  otro puerto loopback.
- 9 puertas (G1–G9), todas con veredicto y evidencia: `WebContentsView` + `webContents.debugger`
  funciona para AX/clic/texto/captura (G1); una vista NO añadida a ninguna ventana sigue respondiendo
  a CDP pero `capturePage({stayHidden:true})` **cuelga sin resolver nunca** (G2); `input-event` no
  distingue CDP de `sendInputEvent` (G3); `alert`/`confirm` se ven y resuelven por CDP (G4);
  `wc.session === session.fromPartition(p)` es fiable dentro de `web-contents-created` (G5); **sin**
  la regla de `webRequest` un `fetch` a otro puerto loopback SÍ llega, con ella queda bloqueado (G6);
  `will-navigate` no se dispara con `loadURL` programático, sí con un clic real (G7); mover la vista
  entre dos ventanas conserva página y debugger (G8); una descarga NO lleva `com.apple.quarantine`
  automáticamente (G9).
- **5 correcciones obligatorias al encargo original**, verificadas con evidencia directa y aplicadas
  al pie de la letra por D1–D2 (detalle en `docs/LOTE-D-PLAN.md`, sección «Correcciones de D0», y en
  `AUDIT.md` §11): usar siempre `Page.captureScreenshot` por CDP para la captura congelada, nunca
  `webContents.capturePage`; tratar la regla de `webRequest` como obligatoria, no como refuerzo; la
  ventana `userActive` de B.8 es indispensable (no hay forma de distinguir humano de agente en el
  evento nativo); añadir la cuarentena a mano en las descargas del agente; limpiar siempre
  vista+debugger en cada ruta de error (riesgo de contención de recursos entre pruebas encadenadas).

### 1.2 Contratos, superficie aislada, IPC y endurecimiento (D1)
- `src/shared/ipc-browser.ts`: tipos (`BrowserOwner`, `BrowserTab`, `BrowserOwnerState`,
  `BrowserApprovalRequest`, `BrowserSitesState`…), canales `browser:*` (invoke y eventos) y esquemas
  en `schemas.ts`; rol de ventana nuevo `browserHost`.
- `src/main/embedded-browser/{api.ts,session.ts,cdp.ts,surface.ts,service.ts,approvals.ts,
  downloads.ts,store.ts,popout.ts,dev-servers.ts}`: la superficie aislada completa (B.2), dos
  particiones propias (`persist:lapis-web-code`/`cowork`), `webRequest` obligatorio, lista blanca de
  CDP (`ALLOWED_CDP`), cola de aprobaciones con respaldo nativo, descargas con cuarentena manual,
  límite de 6 pestañas por owner y 12 en total.
- Exención quirúrgica de una línea en `web-security.ts::harden()` por identidad de objeto de sesión
  (`isEmbeddedBrowserSession`), nunca por cadena; el resto del endurecimiento global no se toca.
- `src/preload/{browser-api.ts,browser-host.ts}`: sin tocar `pill.ts` ni sus roles.

### 1.3 Herramientas del agente, MCP en main y cableado con OpenCode (D2)
- `src/main/embedded-browser/{snapshot.ts,input.ts,keys.ts,tools.ts,mcp-server.ts,owner.ts}`: MCP
  HTTP JSON-RPC **en el proceso principal** (nunca un `utilityProcess`: `webContents.debugger` solo
  existe en main), transporte calcado de `computer/mcp-server.ts` (Bearer de 32 bytes por servidor de
  OpenCode, rechazo de cualquier `Origin`).
- 17 herramientas comunes a Code y Cowork (`list_pages`, `new_page`, `navigate_page`, `take_snapshot`,
  `click`, `fill`, `fill_form`, `type_text`, `press_key`, `scroll`, `wait_for`, `handle_dialog`,
  `get_page_text`…) y 4 más solo en Code (`list_console_messages`, `list_network_requests`,
  `get_network_request`, `evaluate_script`, esta última solo contra un origen loopback).
- Guardas en orden fijo: actor (`lapis_session` obligatorio, falla cerrado) → activación → control
  (`beginAgentAction`, pausado/`userActive`/otra tarea) → clic con verificación anti-clickjacking
  (`DOM.getNodeForLocation`) → campos sensibles rechazados → acciones sensibles con confirmación
  (`confirmSensitive`) → verificación posterior (`verifyAfterAction`) → marca de contenido no
  confiable → ritmo (150 ms entre acciones de entrada, 30 s por llamada).
- Plugin `lapis-session.js` (inyecta `lapis_session` en toda llamada `browser_*`, igual patrón que
  `plan-gate`); cableado en el sidecar de Code (`server.ts`/`config.ts`) y en Cowork
  (`manager.ts`/`sandbox.ts`, con la elección de motor de B.11 — navegador integrado o Chrome aparte
  del Lote C); `computer.md`/`cowork.md` actualizados.

### 1.4 UI compartida, Code, Cowork, Ajustes y ventana aparte (D3 + D4)
- `features/browser/` (`BrowserPanel`, `TabStrip`, `UrlBar`, `AgentBar`, `Cards`, `DevServerHint`,
  `useNativeViewport`): pestañas, barra de URL con indicador de conexión segura, «Seleccionar
  elemento», «Añadir al chat», «Abrir en ventana aparte», tarjetas de aprobación armadas a 700 ms,
  captura congelada como respaldo cuando un overlay de React tapa la vista nativa o el panel está
  oculto.
- Code: `RightPanel` con pestaña «Navegador» (⌘4), aviso de servidor de desarrollo detectado, bandeja
  del compositor para «Añadir al chat»/elemento elegido.
- Cowork: `aside` con pestañas «Progreso | Navegador», ancho redimensionable; `BrowserSection`
  reescrita en Ajustes (activar por producto, sitios permitidos/denegados, orígenes locales, borrar
  datos, y «Chrome aparte (avanzado)» con los controles del Lote C sin cambios de lógica).
- Ventana «Navegador» aparte (`src/renderer/browser/{index.html,main.tsx}`, rol `browserHost`,
  preload propio): se abre a petición o sola con `showInactive()` cuando el agente actúa y la
  ventana principal está minimizada u oculta (Control total).
- `src/shared/cowork-glossary.ts`: añade `browser: 'Navegador'` y `externalChrome: 'Chrome aparte'`.

### 1.5 Integración, documentación y build (D5, este paquete)
- **Corrección de integración encontrada por el orquestador, verificada aquí:** la ventana
  «Navegador» se quedaba en «Abriendo el navegador…» para siempre porque `popout.ts` (D1) nunca
  codificaba el `owner` en la URL y `renderer/browser/main.tsx` (D4) esperaba leerlo del hash/query.
  Corregida con `pushOwnerToPopout(win, owner)` (`embedded-browser/service.ts`), que empuja el owner
  por `browser:state` en cuanto la página de la ventana emergente termina de cargar; el renderer
  escucha el primer `browser:state`/`browser:reveal` en vez de parsear la URL.
- **Bug real encontrado y corregido en este paquete:** `new_page` no dejaba ninguna pestaña
  «seleccionada» para el agente (`openTabAsAgent` nunca fijaba `rt.agentTabId`), así que cualquier
  herramienta posterior fallaba con «No hay ninguna pestaña seleccionada». Solo se detectó al probar
  contra la `EmbeddedBrowserApi` **real** en vez de la implementación de prueba que usó D2 (detalle en
  §3 y en `AUDIT.md` §11). Corrección de 2 líneas, mismo patrón que `beginAgentAction`.
- `npm run typecheck` y `npx electron-vite build` limpios sobre el árbol final; `AUDIT.md` §11,
  `docs/SEGURIDAD.md` («3 quater») y este documento.

## 2. Las decisiones del usuario (2026-09-28)

| Decisión | Valor | Dónde |
|---|---|---|
| Anfitrión de la vista | En línea (panel de Code / `aside` de Cowork) **+** ventana «Navegador» propia cuando la principal está minimizada o se pide | `embedded-browser/{service,popout}.ts` |
| Navegador del agente por defecto | **Apagado** en Code y en Cowork (igual criterio que el Lote C: se activa a mano en Ajustes) | `embedded-browser/store.ts` (`agentEnabled: {code:false, cowork:false}`) |
| Chrome aparte (Lote C) | Se **conserva** como opción avanzada, sin borrar código, excluyente con el navegador integrado | `cowork/manager.ts`, B.11 |
| Navegador en Cowork Sandbox | **Se activa también ahí** (antes solo existía en Control total), con permiso por sitio, aceptando que ese tráfico no pasa por el proxy de egress | `cowork/{manager,sandbox}.ts` |
| Particiones de sesión | Code y Cowork **separados** (`persist:lapis-web-code` / `-cowork`); dentro de Cowork, **una sola partición compartida** para Sandbox y Control total (reconfirmado por el usuario junto con el resto, no es un descuido) | `embedded-browser/session.ts` |
| Buscador de la barra de URL | Google (si el texto no parece una URL) | `embedded-browser/service.ts::normalizeInput` |

> **Bug encontrado y corregido en D5:** el esqueleto original de `store.ts` (B.4/D1 paso 6 del plan)
> traía `agentEnabled: {code:true, cowork:true}` como valor por defecto, contradiciendo la decisión
> final del usuario (fila de arriba) y el mismo criterio que el Lote C. Corregido a `{code:false,
> cowork:false}` en este paquete; reverificado con el harness real de MCP de la §3 activando el
> navegador explícitamente por `store.setPrefs`, tal como haría la UI de Ajustes.

## 3. Qué se verificó y qué NO

### Verificado con Electron real (no simulado, no solo lectura de código)

- **D0** (arnés propio, ver §1.1): 9 puertas con veredicto y evidencia. `report.json` y las capturas
  quedaron en el scratchpad del paquete.
- **D1**: 17 comprobaciones repartidas en 7 harnesses (`t1`–`t7`: instalación segura + navegación de
  usuario, sesión por defecto sigue bloqueada, aislamiento de cookies entre la partición del
  navegador y `defaultSession`, permisos denegados (`window.open`, `file://`, `getDisplayMedia`),
  `sendInputEvent` marca `userActive`, `browser:attach` aplica bounds escalados, y el test
  negativo→positivo de la regla de `webRequest`) más una prueba de cookies aparte. Todas en verde.
- **D2**: 30 comprobaciones (`tools/list`, `initialize`, 401/403, `new_page` con aprobación
  `local-origin`, `take_snapshot`, `click`, `get_page_text`, `fill` verificado por CDP,
  `fill` en contraseña rechazado con el mensaje exacto, `press_key`, navegación a otro origen
  denegada, `take_screenshot` con firma JPEG real, `userActive`/`paused`, `evaluate_script` en Code
  contra loopback y fuera de loopback, `list_network_requests`/`get_network_request`/
  `list_console_messages`, `fill_form`) contra una implementación de prueba de `EmbeddedBrowserApi`
  respaldada por **Chrome real (headless)** por CDP, ya que D1 aún no había publicado el servicio
  real cuando D2 corrió. **D5 reprodujo esta misma corrida (30 OK, 0 FAIL) contra el árbol final**
  para confirmar que nada regresionó, y por separado montó un harness nuevo contra la
  `EmbeddedBrowserApi` **real** de `service.ts` (ver más abajo).
- **D5 (este paquete), contra el árbol final y la implementación real, no la de prueba:**
  - Re-ejecución del test negativo→positivo de la regla de `webRequest` (D1, `t7`): sigue en verde.
  - Un round-trip MCP real completo por HTTP JSON-RPC: `tools/list` (17 en Cowork), `initialize`,
    401 sin token, 403 con `Origin`, `new_page` con aprobación `local-origin` real, `take_snapshot`
    con el prefijo de datos no confiables, `click` real (con `DOM.getNodeForLocation` y
    `Overlay.highlightNode` reales), `get_page_text`, `fill` verificado leyendo el DOM por CDP
    directamente (no por la respuesta del MCP), `fill` en un campo de contraseña real rechazado,
    `take_screenshot` con firma JPEG real, y navegación a otro origen denegada. Se ejercitó contra la
    `EmbeddedBrowserApi` real (`service.ts`), el MCP real (`mcp-server.ts`) y, para el clic/relleno,
    los handlers IPC reales (`browser-handlers.ts`) con el renderer real compilado
    (`out/renderer/browser/index.html` + `out/preload/browser-host.js`) cargado de verdad dentro de
    una ventana «Navegador» real. 20/20 en 3 corridas seguidas tras la corrección del bug de §1.5.
  - El fix del owner del popout (orquestador): con la ventana principal ausente, cualquier acción del
    agente abrió sola la ventana «Navegador» (`showInactive`, sin robar el foco) y esta recibió un
    `browser:state` real con el owner exacto y sus pestañas — nunca se quedó en el placeholder
    «Abriendo el navegador…».
  - `npm run typecheck` y `npx electron-vite build` limpios; `ls out/preload/browser-host.js
    out/renderer/browser/index.html` confirmado; sumas SHA-1 de `helper.swift`/`cu-helper` sin
    cambios desde D0; `git diff --stat src/preload/pill.ts` vacío; `grep -rn "remote-debugging" src`
    vacío; `ALLOWED_CDP` sin ninguno de los métodos prohibidos.

### NO verificado en vivo (solo se puede probar dentro de la app real; ver §4)

- **El flujo completo de `confirmSensitive`** (tarjeta «acción sensible», p. ej. «El agente quiere
  pulsar “Pagar ahora” en tienda.com») contra un botón real de pago/borrado: ninguna de las páginas
  de prueba usadas en D0/D2/D5 tiene un elemento así. Solo se verificó la lógica de coincidencia del
  regex de acciones sensibles y el guardado de campos de contraseña, no la tarjeta de confirmación en
  sí ni el clic real tras aprobarla.
- El comportamiento visual real de la vista nativa superpuesta al DOM de React: que un menú/popover
  la oculte y la muestre como captura congelada, y que vuelva a aparecer al cerrarlo.
- El redimensionado en vivo del panel (Code) y del `aside` (Cowork) con el usuario arrastrando.
- Que un inicio de sesión real de Google/Microsoft rechace el navegador embebido (fallback esperado:
  Chrome aparte).
- El comportamiento del selector de elemento (`Overlay.setInspectMode`) y «Añadir al chat» dentro de
  la interfaz real (Code/Cowork), más allá de que el contrato IPC y los componentes compilan y
  typecheckan.
- Detección real del dev server a partir de `pty:data` de la Terminal (regex verificado por lectura,
  no contra una sesión de terminal real corriendo `npm run dev`).
- Los 13 puntos de la guía de prueba manual del plan original (`docs/LOTE-D-PLAN.md`, sección D),
  condensados en la §4 de aquí abajo.
- Que el interruptor «Permitir que el agente use el navegador» de `BrowserSection.tsx` se vea
  realmente apagado al abrir Ajustes en la app empaquetada (el default corregido en `store.ts` se
  verificó por código y con el harness de la §3, no clicando la UI en vivo).

## 4. Guía de prueba manual (`npm run dev -- --watch`, desde tu terminal habitual)

1. **Code, uso humano.** ⌘4 → «Escribe una URL» → example.com. Clic, scroll, teclear, copiar/pegar y
   menú contextual funcionan; al redimensionar el panel la página se ajusta; abre el menú del
   proyecto encima → la página se congela/oculta y vuelve al cerrarlo.
2. **Dev server.** `npm run dev` en la Terminal de un proyecto web → pestaña nueva del navegador →
   «Servidor de desarrollo detectado · Usar esta».
3. **Agente en Code.** Activa el navegador en Ajustes → «abre localhost:5173 y pulsa X»: el panel se
   abre solo, el elemento se resalta antes de cada clic, aparece la barra «El agente está usando…».
   «abre wikipedia.org»: tarjeta de sitio, botones activos tras un momento; «No» → el agente lo
   explica.
4. **Tomar el control.** Clic en la página mientras el agente trabaja → espera 3 s. Prueba «Pausar»,
   «Reanudar» y «Detener».
5. **Seleccionar elemento / Añadir al chat.** Aparecen el chip y la captura en el compositor.
6. **Login.** El agente se niega a escribir la contraseña; la escribes tú.
7. **Pago (tienda de prueba con un botón real de «Pagar»/«Comprar»).** Aparece la tarjeta «acción
   sensible» — **este es el único punto que D5 no pudo ejercitar con Electron real** (§3): confírmalo
   con especial atención.
8. **Descarga.** Tarjeta de descarga y archivo en `~/Downloads/<APP_NAME>/` (o
   `<carpeta>/.cowork/descargas/` en Cowork) con cuarentena de Gatekeeper; tus propias descargas piden
   «Guardar» nativo.
9. **Cowork Sandbox.** Tarea «busca en wikipedia…» → pestaña Navegador y las mismas tarjetas. En
   Ajustes aparecen los sitios por producto; prueba quitar uno y «Borrar datos».
10. **Cowork Control total.** Minimiza la ventana → aparece la ventana «Navegador» sin robar el foco,
    en vivo. ⌘⇧Esc la detiene.
11. **Chrome aparte.** Actívalo en Ajustes → Control total pasa a usar el Chrome del Lote C.
    Desactívalo y confirma que vuelve al navegador integrado.
12. **Seguridad a mano:** un demo de `getDisplayMedia`/geolocalización se deniega; un `mailto:` no
    abre Mail; `file:///etc/hosts` en la barra se rechaza; `ps aux | grep remote-debugging` vacío; un
    login de Google puede rechazar el navegador embebido (esperado).
13. `curl -u … <baseUrl>/config` muestra `mcp.browser` (remote 127.0.0.1) en el sidecar de Code y en
    los servidores de Cowork.

## 5. Aplazado y fuera de alcance

- **DNS rebinding contra un origen local ya aprobado por el usuario.** La regla de `webRequest`
  bloquea por IP en el momento de la petición, pero un origen `localhost:PUERTO` aprobado una vez
  queda aprobado por origen; si ese nombre resuelve más tarde a otra cosa, no hay una segunda
  comprobación. Riesgo heredado del mismo patrón que `websearch`/MCP remotos.
- **Subrecursos y JavaScript de un sitio aprobado pueden contactar otros hosts.** El control es sobre
  la navegación de primer nivel, igual que en el Lote C.
- **Canal de salida del navegador en Sandbox de Cowork fuera del proxy de egress.** Es una decisión
  explícita del usuario (§2), no un descuido: el tráfico del navegador sale por el proceso de la app,
  no por el proxy; lo cubre el permiso por sitio.
- **Huella del anfitrión (fingerprinting).** Aunque el user agent se limpia, otras señales pueden
  delatar Electron; el fallback documentado es Chrome aparte (Lote C).
- **Firma/notarización y Developer ID:** sin cambios respecto al Lote C (`docs/DISTRIBUCION.md`).
- Nada de `resources/computer-use/**` ni de la píldora de Control total se tocó ni se rediseñó en
  este lote.

## 6. Riesgos y avisos

- El renderer de Chromium de una página arbitraria es la nueva clase principal de riesgo del
  producto: mitigado por sandbox, aislamiento de sitio, partición propia y ningún IPC privilegiado
  alcanzable desde esa pestaña (sin preload); pendiente mantener Electron al día.
- La heurística de «acción sensible» (regex sobre el nombre accesible del botón) es parcial: un sitio
  con textos distintos a los previstos («proceder al cobro», por ejemplo) podría no disparar la
  tarjeta. No sustituye el juicio del usuario dentro de un sitio ya aprobado.
- Una redirección tardía mal atribuida al usuario en vez de al agente es el error peligroso; por eso
  el sentido por defecto es «agente» y existe `verifyAfterAction` como red de seguridad.
- Rendimiento: un proceso de Chromium por pestaña, con topes de 6 por owner y 12 en total.
- Las aprobaciones esperan como mucho 10 minutos y luego se deniegan solas (rutinas desatendidas).
- Reverificar al subir de versión de Electron/Chromium: en particular si `LocalNetworkAccessChecks`
  se reactiva algún día (cambiaría la relevancia relativa de los permission handlers frente a la
  regla de `webRequest`, aunque esta última debe seguir aplicada de todos modos) y si el nombre real
  de los métodos CDP usados en `ALLOWED_CDP` cambia.

## 7. Archivos comprobados al escribir este documento

`docs/LOTE-D-PLAN.md`; `src/main/security/web-security.ts`; `src/main/embedded-browser/{api,session,
cdp,surface,service,approvals,downloads,store,popout,dev-servers,snapshot,input,keys,tools,
mcp-server,owner}.ts`; `src/main/ipc/browser-handlers.ts`; `src/main/ipc/schemas.ts`;
`src/preload/{browser-api,browser-host}.ts`; `src/shared/{ipc-browser,cowork-glossary}.ts`;
`src/renderer/browser/{index.html,main.tsx}`; `src/renderer/src/features/browser/**`;
`src/renderer/src/features/code/impl/{CodeWorkspace,composer-inbox}.{tsx,ts}`;
`src/renderer/src/features/cowork/impl/CoworkWorkspace.tsx`;
`src/renderer/src/features/settings/impl/BrowserSection.tsx`; `src/main/opencode/{config,server}.ts`;
`src/main/cowork/{manager,sandbox,opencode-config}.ts`; `resources/opencode/agents/{computer,
cowork}.md`; `resources/computer-use/{helper.swift,bin/cu-helper}` (solo sumas, sin tocar).
