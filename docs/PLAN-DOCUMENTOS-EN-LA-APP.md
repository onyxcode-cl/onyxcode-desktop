# Plan: documentos con el motor del Chat en Code y Overdrive (macOS y Windows)

Estado: PROPUESTA (2026-10-29), sin código. Rama `feat/modo-unificado`. Autor: revisión de arquitectura (solo lectura), guardada sin cambios por el asistente.
**Nada de esto se implementa sin el OK de Ben** (toca `manager.ts`, que AGENTS.md §7 protege, y hay decisiones abiertas en §8).

## 0. Problema y objetivo
En el Chat el modelo escribe un JSON y la APP arma el archivo (`src/main/extras/chat-docs.ts` → `renderChatDeck`, `renderChatDocx`,
`renderChatGrid`, `renderHtmlToPdf`). En Overdrive/Code el agente corre aislado. En macOS (Seatbelt) llama a los `.cjs` empaquetados
(`resources/opencode/skills/*/scripts/build_chat_*.cjs`, vía `_shared/chat_engine.py`) si hay Node y ArtCraft en `userData/bin`.
En Windows la distro `Lazunox-Tareas` no tiene Node ni ArtCraft y no puede ejecutar nada de Windows, así que cae a python-docx/python-pptx.
Objetivo: que el MISMO motor del Chat arme el archivo en Chat, Code y Overdrive, en macOS y Windows, sin aflojar el aislamiento.

Verificado el 2026-10-29 en el PC Windows de pruebas: una tarea de Word y de presentación salió por el respaldo de Python, con encabezados de tabla casi ilegibles,
sin render para verificar y páginas de más; el motor del Chat no pudo correr en el Linux aislado (sin Node ni DeckCraft, a propósito).

## 1. Arquitectura propuesta (y por qué es la mínima)
Un servidor MCP «documentos» que vive en el proceso principal (main, fuera del sandbox), calcado de `src/main/embedded-browser/mcp-server.ts`:
JSON-RPC por HTTP en 127.0.0.1, `Bearer` de 32 bytes POR ATADURA (servidor de Tareas o sidecar de Code), `Origin` → 403, cuerpo ≤ 1 MiB.
- **Overdrive (sandbox, macOS y WSL):** una ruta más del `McpProxy` de ese servidor (`mcp-proxy.ts`, `addRoute({name:'documentos', exactPath:true, headers:{Authorization: token real}})`),
  igual que el navegador y el puente de apps en `manager.ts` (`buildInlineConfig`). Es el MISMO puerto que ya está en `extraOutboundPorts`
  (Seatbelt) y en `allowedPorts` del puente WSL (`backends/wsl.ts`). No se abre ningún puerto, no cambia el perfil y no cambia el lanzador.
  El sandbox solo ve la URL del proxy y un token de sesión; el token real y la carpeta autorizada viven en main.
- **Code (sidecar sin sandbox):** bloque `mcp.documentos` directo en `src/main/opencode/config.ts`, como `browserMcp`/`bgshellMcp`.
- **Control total:** bloque directo en la config inline. La puerta del plan ya bloquea las herramientas de acción hasta aprobar.
- **Chat:** sin cambios (ya usa el motor).

Herramientas (el motor las expone como `documentos_<herr>`):
1. `crear {tipo: pptx|docx|xlsx|pdf, nombre, spec | html, subcarpeta?}` → `{ruta (en la vista del agente), bytes, avisos}`.
2. `renderizar {ruta, max_paginas≤12}` → PNG como contenido `image` del resultado MCP (el MCP de control ya devuelve imágenes así,
   `computer/mcp-server.ts`), más una línea de texto con páginas y avisos. Por defecto SOLO acepta archivos creados por `crear` en esta misma atadura (registro sha256 en memoria).
3. `traducir_*`: va en una tanda aparte y está sujeta a decisión (§8). Mientras tanto la traducción sigue en el sandbox con `translate_docx/xlsx/pdf.py`,
   y su resultado solo se puede verificar con `renderizar` si Ben amplía su alcance (§8).

Por qué es la mínima: reutiliza el canal ya auditado (proxy MCP F8-B79, token por ruta, sin redirecciones, topes) y el patrón de MCP en main
(navegador). No necesita un canal IPC nuevo (ni esquema, ni `CHANNEL_ROLES`, ni clase en `remote/policy.ts`), ni un binario dentro de la distro,
ni interop. Se descartaron: instalar Node y ArtCraft en la imagen WSL (ArtCraft no tiene binario Linux en `resources/craft/pin.json` y además engordaría la imagen) y
cualquier ejecución de binarios Windows desde WSL (decisión de seguridad firme).

## 2. Zonas intocables y archivos que se tocarían
Ningún archivo de `docs/zonas-intocables.json` es necesario en el camino recomendado:
- NUEVOS: `src/main/documents/mcp-server.ts` (servidor y ataduras), `src/main/documents/engine.ts` (motor común, §5), `src/main/documents/output-path.ts`
  (confinamiento de la ruta de salida) y sus pruebas.
- MODIFICADOS (no zona): `src/main/extras/chat-docs.ts` (extraer `renderBytes`), `src/main/extras/artifact-window.ts` (opción `remoteImages:false`),
  `src/main/tasks/inline-config.ts` (+`documentosMcp`), `src/main/opencode/config.ts`, `src/main/opencode/server.ts`, `src/main/opencode/code-mcp-permission.ts`,
  `src/main/diagnostics/*` (ocultar tokens: basta con que `addRoute` ya registra el de sesión; falta el real), `resources/opencode/skills/{pptx,docx,xlsx,pdf}/SKILL.md`, `resources/opencode/agents/tasks.md`.
- **REVISIÓN ESPECIAL (OK de Ben):** `src/main/tasks/manager.ts`. No tiene huella en el manifiesto, pero AGENTS.md §7 protege «su uso» de la puerta del plan.
  Solo se tocaría `buildInlineConfig`/`spawn` (alta y revocación de la ruta, como `revokeBrowserToken`), no la puerta.
- **ZONA INTOCABLE, solo si se elige la variante B de Code (§8):** `src/main/tasks/opencode-config.ts`, para inyectar `lazunox_session` en `documentos_*`
  (hoy solo `browser_*`, `bgshell_*` y `computer_*`). Exigiría `npm run zonas:actualizar` y una revisión independiente.
- NO se tocan: `sandbox-profile.ts`, `sandbox.ts`, `proxy*.ts`, `provider-egress.ts`, `folder-policy*.ts`, `backends/wsl*.ts`, `resources/wsl/*`, `ui-path.ts`, `wsl-paths.ts`.
  Se USAN `resolveUiPath`, `fromSandboxPath`/`toSandboxPath` y `segmentProblem` sin cambiarlos.

## 3. Modelo de amenazas
Atacante: el agente dentro del sandbox, quizá manipulado por inyección desde un archivo o una web, y que puede leer el token de sesión del proxy (KERN_PROCARGS2, §3 sexagies ter).
- **Ruta de salida confinada.** La carpeta NO la elige el agente: sale de la atadura del token (carpeta principal de ESE servidor más sus adicionales `rw`; nunca las `ro`).
  - `nombre` pasa por `safeDocumentName`, sin separadores; la extensión la fija `tipo` (nunca la del agente).
  - `subcarpeta` es relativa, pasa por `segmentProblem` (`..`, ADS `:`, reservados, punto o espacio final, 8.3, control) y tiene como mucho 4 niveles.
  - Se hace `realpath` del padre y se exige que caiga dentro de la carpeta concedida (misma lógica que `assertInsideApproved`, pero contra la atadura, no contra todas las aprobadas).
  - Se escribe con `O_CREAT|O_EXCL|O_NOFOLLOW` (en Windows `wx` más `lstat` de cada ancestro, como `chat-folders-win.ts`).
  - **Nunca se sobrescribe:** si el nombre existe, se añade el sufijo « (2)» y así hasta 20; después, error.
  - Tras escribir, `fstat` y `realpath` del resultado otra vez; si no cuadra, se borra lo escrito y se registra «carrera».
  - Residual honesto (macOS): un cambio de directorio por enlace entre la comprobación y la apertura deja como mucho un archivo NUEVO `.docx/.pptx/.xlsx/.pdf`
    en otra carpeta del usuario, sin pisar nada y con la extensión fijada. En WSL Landlock no concede `MAKE_SYM` en las carpetas de Windows (§3 tricies octies),
    así que el agente no puede crear el enlace.
- **Validación.** Se usan los mismos `isPptxSpec`/`isDocxSpec`/`isXlsxSpec` de `src/shared/chat-doc-spec.ts` y sus topes (`MAX_SLIDES`, `MAX_DOCX_BLOCKS`…).
  Los JSON tienen como mucho 1 MB (`MAX_SPEC_BYTES`) y el HTML 5 MB (`MAX_HTML_BYTES`). Claves desconocidas o `__proto__` → error con la pista de `explainDocx`/`explainXlsx`.
- **El contenido es DATO.** Los specs no tienen campos de URL ni de imagen (comprobado en `chat-doc-spec.ts`). Los comandos de ArtCraft se arman como valores JSON
  (`chatDeckCommands`, `chatDocxCommands`) y se lanzan sin shell (`runCraft`: `execFile`, entorno mínimo `craftEnv`, HOME temporal).
- **Red.** La herramienta no hace red. Hay un riesgo NUEVO en el PDF: `renderHtmlToPdf` incrusta imágenes de bancos permitidos (`remote-images.ts`, §3.2),
  lo que en Overdrive saltaría la lista blanca del sandbox (`proxy-policy`) y abriría un canal de salida por la consulta de la URL. Por eso en `documentos` va con
  `remoteImages:false` (imagen gris), igual que sin red. Habría que comprobar que ArtCraft no hace red; en macOS cabe envolverlo en `sandbox-exec` sin red (§8).
- **DoS/recursos.**
  - Una operación a la vez por atadura y 2 en toda la app (429 al resto).
  - Tiempos máximos: ArtCraft 60 s, PDF 60 s, render 90 s.
  - Salida de 50 MB como mucho; si el disco tiene menos de 500 MB libres, se rechaza.
  - Como mucho 60 documentos y 30 renders por hora y atadura.
  - El render entrega como mucho 12 PNG y 6 MB en total, a resolución acotada.
  - Los temporales van en `os.tmpdir()` con limpieza en `finally` (ya lo hace `runCraft`).
  - El proxy ya pone 8 MB por petición, 16 simultáneas por ruta y 120 s.
- **Qué ve cada parte.** El agente recibe la ruta en SU vista (`/win/c/…` en WSL), el tamaño, los avisos y los PNG. Nunca recibe rutas de userData, tokens ni la salida de error cruda de ArtCraft
  (se recorta a 200 caracteres y se le quitan las rutas del anfitrión). Main solo escribe en la carpeta de la atadura.
- **Inyección hacia herramientas.** El resultado es breve y nunca repite el texto del documento. Los PNG son contenido no confiable para el modelo (como `app_screenshot`).
  La herramienta no ofrece leer archivos arbitrarios: con `renderizar` restringido, no sirve para sacar datos de fuera del sandbox.
- **Permisos.** Crear un archivo nuevo dentro de la carpeta equivale a `edit`.
  - Overdrive: `documentos_*: allow` explícito en la inline (el agente ya tiene `edit: allow`); la tarjeta del plan y Detener siguen igual.
  - Modo automático y Rutinas: no preguntan, porque es `allow` por configuración y no por aprobación.
  - Code: sigue al modo, con `ask` en «Preguntar» y `allow` en «Aceptar ediciones»/«Todo sin preguntar», usando las reglas de sesión (como `bgshellSessionRules`).
  - Subagentes: `lazunox-helper` tiene `'*': deny`, así que no puede usarla.
  - Nombre `documentos` reservado: se rechaza un MCP del usuario con ese nombre.
- **Auditoría.** Registro de main SIN contenido: hora, atadura (clave de servidor con hash), herramienta, tipo, bytes, nombre final relativo, duración, resultado y motivo de rechazo.
  Los tokens se añaden al redactor de Diagnóstico. Se revocan al terminar el servidor (`onExit`, como el del navegador) y caducan a las 12 h (`ttlMs` del proxy).

## 4. Windows/WSL y macOS
- **WSL.** El agente llama a `http://127.0.0.1:<puerto del proxy>`. El multiplexor del puente (`wsl-bridge-host.ts`, intocable y sin cambios) solo deja salir a los puertos
  permitidos, y el del proxy MCP ya lo es. Main recibe `subcarpeta` relativa, o una ruta `/win/c/…` que traduce con `fromSandboxPath` contra los montajes de ESA atadura
  y luego `resolveUiPath`; traducir no autoriza, la autorización es la atadura. Escribe en `C:\…` y devuelve `toSandboxPath` (`/win/c/…`) para que el agente lo abra
  (montaje `noexec`, `case=off`). ArtCraft y Chromium corren en Windows, en main, como en el Chat. Tiene que haber Craft instalado en Windows: `pin.json` trae `win32-x64`
  y `win32-arm64`, pero NO VERIFICADO que el Chat de Windows lo use hoy (el comentario de `craftBinary` dice «null si no es macOS» y el código no lo comprueba).
- **macOS Seatbelt.** El perfil no cambia. Main escribe en la carpeta; quien escribe es Lazunox (TCC de la app), no el motor desvinculado. Hay que comprobar que
  Lazunox tiene acceso a `~/Documents` o `~/Desktop` cuando la tarea está allí (§3 sexagies quater); no verificado.
- **Code en Windows:** sidecar nativo, rutas `C:\` (identidad).

## 5. Reutilizar el código del Chat sin duplicar
Crear `src/main/documents/engine.ts` con `renderDocument(input, {remoteImages})`. Es el `renderBytes` de `chat-docs.ts` movido tal cual
(GridCraft→`renderXlsx` de respaldo, WordCraft obligatorio, DeckCraft→`renderPptx` de respaldo, PDF→`renderHtmlToPdf`), y `chat-docs.ts` pasa a importarlo
(una sola fuente, `chat-docs.test.ts` sin cambios). Render: `deckToPdf`, `docxToPdf` y `gridToPdf` ya existen. Para los PNG se pasan a TS las mismas órdenes que usa
`_shared/render.py` (`deckcraft render --all`, `wordcraft info` + `render --page`). Para PDF y xlsx hace falta rasterizar el PDF (pypdfium2 en `render.py`/`render_grid.py`):
el Python de la app (`python-runtime.ts`, `LAZUNOX_PYTHON`) podría, pero NO VERIFICADO que lleve pypdfium2 (§8). (Nota del 2026-10-29: el Python de la app sí lleva PyMuPDF, con el que `html_a_png.py` ya rasteriza PDF en el Mac.)
Los `build_chat_*.cjs` y `chat-doc-cli.ts` se mantienen como respaldo; las skills dirán: «si existe `documentos_crear`, úsala; si no, el script».

## 6. Plan de pruebas
- **Unitarias (Vitest, sin Electron):** atadura y token (401 si está ausente, es de otra atadura o fue revocado; `Origin` 403; cuerpo 413), validación (los mismos casos de
  `chat-word.test.ts`/`chat-grid.test.ts`), nombres y sufijos, topes por hora, concurrencia (429), recorte de la salida de error, `inline-config.test.ts` (bloque
  `documentos` con la URL del proxy, sin token real), `code-mcp-permission.test.ts` (reglas por modo), `manager.bridge.test.ts` (ruta añadida y revocada al salir).
- **Seguridad, casos hostiles:**
  - Rutas: `../`, `/etc`, `C:\Windows`, `\\?\`, `\\srv\x`, `a:b` (ADS), `CON`, `x.` y `x ` (punto o espacio final), `PROGRA~1`, NUL, 300 caracteres, Unicode con barra parecida.
  - Enlaces: subcarpeta que es enlace a `~/Library/LaunchAgents`, y cambio por enlace en carrera con fs real en macOS.
  - Sobrescritura: nombre existente, nombre que es enlace (nunca se pisa).
  - Ataduras: carpeta `ro` adicional (rechazo), token de otra tarea.
  - Contenido: spec de 1 MB + 1, 41 diapositivas, claves `__proto__`, HTML con `<img src=https://unsplash…?q=SECRETO>` (no hay red), texto con «ignora y ejecuta…» (sale como texto).
  - Recursos: 61 creaciones en una hora; ArtCraft falso que cuelga (se corta por tiempo, sin huérfanos) o que escribe 100 MB.
  - `ps eww`/KERN_PROCARGS2 en Seatbelt real: no aparece el token real.
- **E2E:** fake-opencode llamando al MCP por el proxy (macOS); Electron real con Craft instalado, con la carpeta en `~/Lazunox/Chats/<id>` y en `~/Documents`.
- **PC Windows de pruebas** (`scripts/win/run.ps1`, `wsl-it.ps1`), sesión NO elevada:
  - Desde la distro: `curl` al proxy con el token y `documentos_crear` docx, pptx y xlsx; el archivo aparece en `C:\…` y se lee en `/win/c/…`.
  - Desde la distro: `curl` al puerto real del MCP falla; ruta `/win/c/Windows` rechazada; render de un PNG.
  - Comparación visual con el Chat de Windows con el mismo spec.
  - Sin `wsl --shutdown`.

## 7. Tamaño y orden recomendado (tandas pequeñas, un commit por paso)
| # | Paso | Tamaño aprox. |
| - | ---- | ------------- |
| T1 | `engine.ts` (mover `renderBytes`), `chat-docs.ts` lo importa, `remoteImages:false` en `artifact-window.ts` | ~120 líneas + pruebas |
| T2 | `output-path.ts` (confinamiento, nombres, O_EXCL, sufijos) con todas las pruebas hostiles | ~180 + ~300 de pruebas |
| T3 | `mcp-server.ts` con `crear` (ataduras, tokens, topes, auditoría, redactor) | ~350 + ~350 de pruebas |
| T4 | Overdrive: ruta en el proxy, `inline-config.ts`, `manager.ts` (revisión especial), permiso `allow`, nombre reservado | ~80 + pruebas |
| T5 | Skills y `tasks.md`: preferir la herramienta; prueba en macOS real; luego PC Windows | ~60 de texto |
| T6 | `renderizar` (DeckCraft/WordCraft a PNG; PDF/xlsx según §8) | ~200 + pruebas |
| T7 | Code (variante A o B) y Control total | ~120 + pruebas |
| T8 | `traducir_*` solo si Ben lo aprueba | ~250 + pruebas |
Cada tanda: `typecheck` → `test` → `lint` → `format:check` → `build`, entrada `F8-B<n>` en el changelog y sección nueva en `docs/SEGURIDAD.md`.

## 8. Riesgos abiertos y decisiones de Ben
1. **ArtCraft fuera del sandbox con JSON influido por el agente.** El Chat ya corre el mismo riesgo, pero en Overdrive la entrada puede venir de archivos inyectados.
   En macOS se puede envolver `runCraft` con `sandbox-exec` (sin red, escritura solo en el temporal); en Windows no hay equivalente barato. ¿Se acepta igual que en el Chat?
2. **Alcance de `renderizar`:** solo archivos creados por `crear` (recomendado) o cualquier archivo de la carpeta. La segunda opción hace que ArtCraft procese archivos
   NO confiables fuera del sandbox, pero permite verificar traducciones.
3. **`traducir_*` en el anfitrión:** ejecuta Python (PyMuPDF/python-docx) sobre archivos hostiles con los permisos de la app (§3 quinquagies undevicies).
   Recomendación: dejarla en el sandbox mientras `translate_*.py` dé buen resultado allí (verificado el 2026-10-29: `translate_docx.py` funcionó dentro del WSL).
4. **Code, cómo sabe la carpeta.** (A) recomendado, sin zona: el agente pasa su directorio y main exige que sea un proyecto abierto en Code y que la salida caiga dentro.
   (B) inyectar `lazunox_session` en `documentos_*` (`opencode-config.ts`, ZONA) y que main pregunte el directorio de la sesión al sidecar.
5. **Permiso en Overdrive:** `allow`, como `edit` (recomendado), o `ask` la primera vez.
6. **Rasterizar PDF/xlsx en el anfitrión:** el Python de la app ya lleva PyMuPDF (verificado en el Mac); pypdfium2 sigue sin verificar.
7. Que las sesiones hermanas del mismo servidor comparten atadura (como H4). Es aceptable porque comparten carpeta.

## Lo que NO se verificó (leyendo código, sin ejecutar)
- Que el Chat de Windows use hoy ArtCraft.
- Que el multiplexor WSL deje pasar las respuestas grandes (PNG en base64) sin problemas de créditos.
- El acceso TCC de main a carpetas protegidas.
- Que ArtCraft no haga red.
- Que el panel «Entregables» detecte archivos que no escribió el motor (`monitor.ts`).
- Que el motor 1.19 entregue al modelo el contenido `image` de un MCP remoto pasado por el proxy (con el MCP de control sí ocurre).
