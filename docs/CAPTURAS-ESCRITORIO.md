# Capturas de la interfaz de escritorio (Electron, sin tocar la app instalada)

`node scripts/shot-desktop.mjs [--out DIR] [--scenario ESC[,ESC...]] [--theme dark|light] [--size 1280x800|1000x700]`

- Escenarios (50): `onboarding`, `onboarding-motor`, `onboarding-inicio`, `onboarding-conecta`, `onboarding-modelo`, `onboarding-modos`, `onboarding-final`, `chat-vacio`, `chat-conversacion`, `chat-herramientas`, `chat-archivo-ver`, `chat-memoria-propuesta`, `chat-adjunto-office`, `chat-exportar`, `code-proyecto`, `code-diff`, `code-terminal`, `code-terminal-pestanas`, `code-terminal-pestanas-ocupada`, `code-ejecutar`, `code-ejecutar-confirmar`, `code-ejecutar-mensaje`, `code-ejecutar-termina`, `code-terminal-ia`,
  `tareas-primer-uso`, `tareas-nueva`, `tareas-lista`, `tareas-buscar`, `tareas-archivadas`, `tareas-en-curso`, `tareas-permiso`,
  `tareas-plan-sin-apps`, `tareas-plan-sin-apps-cambio`, `code-entorno`, `tareas-entorno`, `inicio-vacio`, `inicio-pendientes`, `aviso-motor`,
  `rutinas-vacio`, `rutinas`, `rutinas-detalle`, `rutinas-editor`, `rutinas-evento`, `rutinas-bandeja`, `rutinas-evento-e2e`, `ajustes-general`, `ajustes-modelos`, `ajustes-celular`, `ajustes-memoria`, `ajustes-instrucciones`, `paleta`, `busqueda-global`, `busqueda-global-abrir`,
  `selector-modelo`, `caja-menus`, `dialogo-confirmar`, `comparar`, `barra-lateral-colapsada`, `inicio-chat`, `inicio-code`.
- `trabajo-legible` / `trabajo-legible-abierto` / `trabajo-legible-code` / `trabajo-legible-permiso` (F8-B183): respuesta con cuatro herramientas lentas (`runMs`, tiempo real) y narración entre pasos. Chat plegado («Trabajó durante Xs · 4 pasos ›», respuesta final limpia) y abierto (una línea por paso, comando abierto); Code «Con pasos» (plegado con qué hizo y el archivo editado); y Code con un permiso pendiente tras plegar el trabajo (imprime `VERIF-PERMISO-VISIBLE-CON-TRABAJO-PLEGADO true`). También salen a 1000x700.
- `chat-archivo-ver`: archivos que la IA crea o menciona en el Chat. El motor falso escribe un Markdown, un SVG, un PDF y un script en la carpeta del chat (`<userData>/chat-workspace`) y los nombra con su ruta; cada uno sale como tarjeta (el script solo con «Mostrar en la carpeta»). La captura abre el Markdown con «Ver aquí» en el panel lateral. El PDF y Office se muestran en el visor nativo (una vista de Electron fuera de la página): no aparecen en las capturas por CDP.
- `chat-adjunto-office`: adjuntar documentos de oficina al Chat. El script genera al vuelo un Word, un Excel y un PowerPoint de muestra (`<userData>/office-muestras`, con jszip y xlsx del repo) y los pasa al selector de archivos del compositor; main los convierte a texto (Markdown) y cada uno sale como tarjeta con su tipo y cantidad («documento de texto · 3 páginas», «hoja de cálculo · 2 hojas», «presentación · 3 diapositivas»). Tras las capturas envía el mensaje y, mirando lo que recibió el motor falso, imprime `VERIF-OFFICE` (partes enviadas) y `VERIF-OFFICE-TEXT <archivo>` con el texto exacto que le llega a la IA (marco de «datos, no instrucciones» + Markdown).
- `chat-memoria-propuesta`: el motor falso responde con un bloque `lazunox-memoria` al final; la captura muestra la tarjeta «La IA propone recordar esto» (casillas, alcance/tipo, texto editable, «Guardar seleccionadas», «Descartar», «Gestionar memoria»). El bloque no se ve en la respuesta. Nada se guarda al capturar.
- `ajustes-memoria`: Ajustes > Memoria con cuatro notas inventadas escritas en `<userData temporal>/memoria/usuario.md` (formato real del almacén): interruptor, aviso de privacidad, pestañas «Para todo» / «De un proyecto», buscador, editar/borrar por nota, «Olvidar todo».
- `ajustes-instrucciones`: Ajustes > Instrucciones: el escenario escribe una instrucción global (se guarda al salir del campo) y, con el proyecto de `code-proyecto` abierto, un AGENTS.md de ejemplo SIN guardar (solo se ve el texto en la caja; el botón «Guardar en la carpeta» queda activo y no se pulsa, para no ensuciar el repo de muestra).
- `chat-exportar`: menú «…» de una conversación del Chat con las acciones de exportar: «Copiar conversación», «Guardar como Markdown…», «Guardar como PDF…» y «Opciones de exportación…» (razonamiento, resumen de herramientas y nombres de adjuntos). El diálogo de guardar es el nativo del sistema y no sale en las capturas por CDP; el PDF y el `.md` reales se comprueban a mano en la app de desarrollo (ver `src/shared/conversation-export.ts`).
- `code-terminal-pestanas`: terminal de Code con dos pestañas: la primera, renombrada «servidor», deja un proceso largo en marcha; la segunda (botón «+») corre otro comando a la vez.
- `code-terminal-pestanas-ocupada`: pulsa ▶ en dos bloques de una respuesta; con el primero aún en marcha, el segundo muestra el aviso «La terminal está ocupada» con «Usar una pestaña nueva» / «Abrir en la terminal». Tras la captura elige la pestaña nueva y anota en consola (`VERIF-PESTANAS`, `VERIF-TARJETAS`) que cada comando corre en su pestaña.
- `inicio-chat` / `inicio-code`: pantallas de inicio con trabajo previo (reutilizan los datos de `barra-chat` y `barra-code`). Chat: «Respondiendo ahora» arriba, «Retomar» con las recientes e ideas plegadas. Code: abre una sesión nueva y muestra «Esperando tu aprobación», «Retomar» e ideas plegadas.
- `tareas-plan-sin-apps` / `tareas-plan-sin-apps-cambio`: pasan a Control total y usan el paso `request-access` del OpenCode falso (el mismo POST que `computer_request_access`, con `apps: []`) para mostrar la tarjeta del plan con «Cambiar a Solo en tu carpeta»; el segundo pulsa el botón y comprueba que vuelve a «Solo en tu carpeta».
- `code-entorno` / `tareas-entorno`: abren el panel «Entorno» (botón de la barra de Code y de la cabecera de la tarea) y capturan el popover con el equipo, la carpeta, la rama (Code) o el modo y el punto de restauración (Tareas).
- `rutinas-evento`: editor de Rutinas con la pestaña «Archivo» (disparador por carpeta): carpeta vigilada, filtro `*.pdf, factura-*.csv`, nuevo o modificado, espera de estabilización y tope por hora.
- `rutinas-bandeja`: ejecuta dos rutinas con el motor falso y captura la bandeja «Resultados por revisar» (Aprobar / Descartar / Ver detalle / Volver a ejecutar), con un detalle abierto y el contador en el riel. Debe ir después de los demás escenarios de Rutinas (cambia su «última ejecución»).
- `rutinas-evento-e2e`: prueba de punta a punta del disparador por archivo con el motor falso (carpeta temporal bajo el home, tope 2/h, espera 1 s). Escribe en consola `VERIF-EVENTO-1` (un archivo = una ejecución; lo que aparece al terminar no dispara), `VERIF-EVENTO-5` (cinco seguidos = una ejecución agrupada) y `VERIF-EVENTO-TOPE` (la tercera queda frenada por el tope, `capped: true`). Tarda ~80 s.
- Estados de error, carga y vacío (H24; motor falso, sin tocar datos reales):
  - `chat-error-conexion`: el motor falso responde con error de clave (401); tarjeta «La IA rechazó la conexión» con «Conectar una IA».
  - `chat-carga-larga`: respuesta parcial con indicador «Pensando» y botón de detener; al terminar se pulsa «Detener».
  - `motor-error`: arranca sin motor con la app ya configurada (`OPENCODE_BIN` inexistente): aviso superior «No se pudo conectar con la IA», «Reintentar», esqueleto de carga de la barra lateral y «Error de conexión».
  - `tareas-lista-vacia` (antes de crear tareas) y `tareas-error` (tarea que termina con error del proveedor).
  - `rutinas-vigilante`: rutina por archivo cuya carpeta se borra: «Carpeta no disponible». `rutinas-sin-vigilar`: con el aviso de Rutinas sin aceptar: «Sin vigilar: falta aceptar el aviso de Rutinas».
  - `ajustes-modelos-vacio`: Ajustes › Modelos sin servicios conectados («Ningún servicio de IA conectado»).
    Se piden con `--scenario`; los de Tareas/Rutinas necesitan `--size 1000x700` para sacar también el tamaño pequeño.
- `conectores-cotidianos` / `conectores-cotidianos-detalle` / `conectores-cotidianos-e2e` (F8-B184): la etiqueta «Aún sin probar con una cuenta real» en las tarjetas y el detalle de los conectores que lo admiten (Notion, Linear, Atlassian, Sentry; GitHub no la lleva), y una verificación (`VERIF-COTIDIANOS`, `VERIF-COTIDIANOS-E2E`) del paso a paso de un conector con inicio de sesión: la casilla «Entiendo» frena, no hay campo de contraseña, «Ahora no» no escribe nada en el perfil temporal. Sin servicios reales. También salen a 1000x700.
- `personalizacion-habilidades` / `personalizacion-conectores` / `personalizacion-detalle` / `personalizacion-conectar` (F8-B181): abren Personalización desde la barra lateral; pestañas Habilidades y Conectores, el detalle de una ficha (Context7) y el paso a paso para conectar (GitHub, hasta la casilla «Entiendo»; no se conecta nada). También se sacan a 1000x700.
- `aviso-motor`: arranca con una ruta de motor elegida aparte (el falso, 1.18.32) y un motor incluido falso (`LAZUNOX_TEST_BUNDLED_DIR`, solo pruebas); captura la tarjeta «Estás usando un motor de IA instalado aparte…» con «Usar el motor incluido» y «Ahora no».
- Sin argumentos: claro y oscuro, 1280x800 para todo y 1000x700 solo para `chat-*` y `ajustes-*` (~64 PNG; con tantos escenarios conviene partir en dos corridas por el tope de 330 s).
  Con `--size` se usa solo ese tamaño. Nombre: `<escenario>-<tema>-<tamaño>.png`, a 2x (2560x1600 para 1280x800).
  Salida por defecto: `.../scratchpad/shots-desktop`. Si un escenario falla, deja su captura en `<out>/_fallos/` y la lista de controles visibles.
- Cómo funciona: arranca la app compilada (`out/`, hay que compilar antes con `npx electron-vite build`; carga por `lazunox://app`)
  con Electron de `node_modules`, `--use-mock-keychain`, `LAZUNOX_E2E_HEADLESS=1` (sin ventana visible ni Dock), un userData
  TEMPORAL y el OpenCode falso de `e2e/fake-opencode` (guiones con markdown, tabla, código, herramientas, permiso, diff, todos).
  Captura por CDP (`Page.captureScreenshot`, `Emulation.setDeviceMetricsOverride` a 2x, `setFocusEmulationEnabled`, tema con
  `prefers-color-scheme`, transiciones desactivadas). Dos arranques seguidos: uno para Chat/Code/Ajustes/diálogos, otro para
  Tareas y Rutinas (el falso numera las sesiones igual en ambos y la interfaz mezclaría mensajes), más uno para `onboarding`.
- Datos inventados: repo git `tienda-web` en /private/tmp con cambios sin confirmar, carpeta «Informes» colgando del home
  (Tareas rechaza carpetas de sistema), 4 conversaciones, una tarea en curso con plan, otra con permiso pendiente y tres rutinas.
- Seguridad: tope de 330 s; no lanza si la carga pasa de 8; al terminar o con Ctrl+C mata solo los procesos cuya línea de comandos
  lleva su prefijo temporal `lazunox-shotd-<pid>-` y borra sus carpetas. Úsalo con `perl -e 'alarm shift; exec @ARGV' 345 node ...`
  (el alarm no mata hijos: el propio script los limpia). No toca la app instalada, su userData ni su cloudflared.
- Límites: `dialogo-confirmar` es el diálogo «¿Lanzar la comparación?» (el borrado de conversaciones confirma en la propia fila);
  `onboarding*` recorren el asistente de primer uso completo (ver «Asistente de primer uso» abajo); `ajustes-celular` muestra el estado apagado, sin QR ni celulares; la terminal
  es una shell real con el prompt cambiado; los modelos son «Fake Model/Reasoner».

## Opciones nuevas (F8-B89)

- El ratón se saca de la ventana antes de cada captura (`parkMouse`): ningún elemento queda en `:hover`. Si no se logra, el script lo anota.
- `--reduced-motion`: prueba la regla REAL de `prefers-reduced-motion` (no inyecta el estilo que apaga animaciones y transiciones).
  Sin la bandera se emula igual `reduce` y además se apagan todas, para capturas deterministas.
- Las capturas de escritorio NO son deterministas al píxel entre arranques (puntos de carga, brillo, anillo de uso): dos corridas del
  mismo código difieren en 0–2000 px en ~10 de 50 archivos, y 4 escenarios (`chat-herramientas-light-1000x700`, `tareas-en-curso-*`,
  `comparar-*`) saltan entre dos estados. Las del celular (`shot-mobile`) sí lo son, salvo textos de hora relativa («hace 23 h» / «ayer»).

## Comparar capturas

`node scripts/shot-diff.mjs <dirA> <dirB> [--max N] [--out dirDiff]`: compara píxel a píxel los PNG de dos carpetas. Imprime, por
archivo, los píxeles distintos y la caja que los contiene; con `--out` escribe un PNG de diferencia (rojo = distinto). Sale con
código 1 si algún archivo supera `--max` (por defecto 0), si falta alguno o si cambia el tamaño. Usa `pngjs` de `node_modules`
(dependencia transitiva; no se instala nada). Uso típico: `shot-mobile` antes y después de un cambio de escritorio → 0 píxeles.

## Escenarios de Tareas, Rutinas y primer uso (F8-B97)

El grupo de Tareas corre en el orden de `SCENARIOS`, pidas lo que pidas: `tareas-primer-uso` captura la tarjeta antes de descartarla; `tareas-nueva` y
`rutinas-vacio` van antes de crear tareas y rutinas; `tareas-buscar` y `tareas-archivadas` crean la lista si hace falta. `onboarding*` comparten
arranque (`onboarding-inicio` vuelve con «Atrás» al paso 1).

`inicio-vacio` (carpeta sin tareas: el inicio de siempre, sugerencias abiertas) corre justo después de `tareas-nueva`; `inicio-pendientes` corre al final del grupo y deja una tarea con permiso y otra con pregunta esperando, más dos terminadas, para ver la tarjeta «Esperando tu aprobación» y el bloque «Retomar» (las sugerencias salen plegadas).

## Windows, alto contraste y escala (plan de paridad Windows, S5)

`shot-desktop.mjs` corre también en Windows; en macOS no cambia nada (mismas rutas, mismos nombres, mismo control de carga).

- Opciones nuevas: `--forced-colors` (emula `forced-colors: active` por CDP `Emulation.setEmulatedMedia`; sirve por SSH, sin tema real de alto
  contraste) y `--dsf <factor>` (escala del dispositivo; por defecto 2; usar 1.25, 1.5 o 2 para revisar el escalado de Windows).
- Nombres de salida: `<escenario>-<tema>-<tamaño>[-win][-fc][-dsf<n>].png`. `-win` solo en Windows, `-fc` con `--forced-colors`, `-dsf<n>` si se
  pasa `--dsf`. Así no se pisan con las capturas del Mac.
- En Windows: carpetas temporales en `os.tmpdir()` (en macOS sigue `/private/tmp`), procesos propios listados con `Get-CimInstance Win32_Process`
  (en vez de `ps -axo`) y muertos solo si su línea de comandos lleva `lazunox-shotd-<pid>-`; sin `uptime`: se mira la CPU con `typeperf` y no se
  lanza por encima del 90 % (si `typeperf` falla, no se comprueba). El OpenCode falso se lanza con un `opencode.cmd` generado en la carpeta temporal.
- `scripts/win/shots.ps1 -Branch <rama> [-Scenario a,b] [-Theme dark|light] [-Size 1280x800] [-ForcedColors] [-Dsf 1.5]`: llama a `shot-desktop`
  con tope de 330 s (más 15 s de cinturón con `taskkill /T`) y deja los PNG y `shots.log` en `C:\onyx\shots\<rama>`. Requiere `out\` compilado
  en `C:\onyx\wt`.
- `scripts/win/capture-console.ps1 -Out <png>`: captura la pantalla interactiva con `CopyFromScreen`. Una sesión SSH no tiene escritorio, así que se
  lanza desde una tarea programada con `/IT` (comando de ejemplo en la cabecera del script). Sirve para ver el tema real de alto contraste.
- Nota: los `.ps1` y la ejecución en Windows aún NO se han probado en el PC (esta tanda es solo código).

## Barra lateral 2c

`--clip sidebar` recorta cada captura al `<aside>` (sufijo `-lateral`). Escenarios `barra-chat`, `barra-chat-fijadas` (una fijada, una archivada con su contador y el menú «⋯» abierto), `barra-code` (sesiones lista / esperando / trabajando) y `barra-code-hover` (ratón sobre una fila); además `chat-vacio`, `barra-lateral-colapsada` y `tareas-permiso`.

## Asistente de primer uso (`onboarding*`)

Dos arranques con `onboarded: false`: **sin motor** (OpenCode ausente, sin servidor) para `onboarding` (primera pantalla con la tarjeta de atención «Lo que hace funcionar la IA… Falta») y `onboarding-motor` (paso del motor, «Paso 1 de 5»); y **con motor incluido** (`LAZUNOX_TEST_BUNDLED_DIR` con un `connected.json` que deja conectado solo el gratuito, que no cuenta como configurado) para `onboarding-inicio` (saludo directo con «Empezar»), `onboarding-conecta` («Paso 1 de 4»), `onboarding-modelo`, `onboarding-modos` y `onboarding-final` («Prepara tu equipo» con «Probar con un ejemplo»). Cada escenario avanza o retrocede con los botones reales hasta su paso (`onbTo`, que lee «Paso N de M»). `ONB_OFFSET=1` sirve solo para comparar con versiones anteriores, que llevaban siempre el paso del motor (5 pasos). La bienvenida con la lista de ArtCraft o del entorno aislado de Windows no se captura (necesita el puente de componentes reales); la cubre `Welcome.render.test.tsx`.

- `busqueda-global` / `busqueda-global-abrir` (F8-B182): siembra 4 conversaciones de Chat y una de Code con el motor falso y abre la paleta (⌘K). `busqueda-global` comprueba (líneas `VERIF-BUSQUEDA`) que una palabra que solo está en el CUERPO de un mensaje se encuentra en Chat y en Code, que una inexistente da «No hay mensajes con…» y fotografía los resultados de «iva» (varias conversaciones, fragmento resaltado, fecha). `busqueda-global-abrir` elige un resultado con Enter en Code y en Chat y comprueba (`VERIF-ABRIR`) que se abre la conversación y el mensaje resaltado queda a la vista; para la captura el resaltado se mantiene. Pedir ambos con `--scenario busqueda-global,busqueda-global-abrir` (tamaños 1280x800 y 1000x700).
