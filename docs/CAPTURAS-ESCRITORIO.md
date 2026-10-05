# Capturas de la interfaz de escritorio (Electron, sin tocar la app instalada)

`node scripts/shot-desktop.mjs [--out DIR] [--scenario ESC[,ESC...]] [--theme dark|light] [--size 1280x800|1000x700]`

- Escenarios (19): `onboarding`, `chat-vacio`, `chat-conversacion`, `chat-herramientas`, `code-proyecto`, `code-diff`, `code-terminal`,
  `tareas-lista`, `tareas-en-curso`, `tareas-permiso`, `rutinas`, `ajustes-general`, `ajustes-modelos`, `ajustes-celular`, `paleta`,
  `selector-modelo`, `dialogo-confirmar`, `comparar`, `barra-lateral-colapsada`.
- Sin argumentos: claro y oscuro, 1280x800 para todo y 1000x700 solo para `chat-*` y `ajustes-*` (50 PNG, ~1,5 min).
  Con `--size` se usa solo ese tamaño. Nombre: `<escenario>-<tema>-<tamaño>.png`, a 2x (2560x1600 para 1280x800).
  Salida por defecto: `.../scratchpad/shots-desktop`. Si un escenario falla, deja su captura en `<out>/_fallos/` y la lista de controles visibles.
- Cómo funciona: arranca la app compilada (`out/`, hay que compilar antes con `npx electron-vite build`; carga por `onyxcode://app`)
  con Electron de `node_modules`, `--use-mock-keychain`, `ONYXCODE_E2E_HEADLESS=1` (sin ventana visible ni Dock), un userData
  TEMPORAL y el OpenCode falso de `e2e/fake-opencode` (guiones con markdown, tabla, código, herramientas, permiso, diff, todos).
  Captura por CDP (`Page.captureScreenshot`, `Emulation.setDeviceMetricsOverride` a 2x, `setFocusEmulationEnabled`, tema con
  `prefers-color-scheme`, transiciones desactivadas). Dos arranques seguidos: uno para Chat/Code/Ajustes/diálogos, otro para
  Tareas y Rutinas (el falso numera las sesiones igual en ambos y la interfaz mezclaría mensajes), más uno para `onboarding`.
- Datos inventados: repo git `tienda-web` en /private/tmp con cambios sin confirmar, carpeta «Informes» colgando del home
  (Tareas rechaza carpetas de sistema), 4 conversaciones, una tarea en curso con plan, otra con permiso pendiente y tres rutinas.
- Seguridad: tope de 330 s; no lanza si la carga pasa de 8; al terminar o con Ctrl+C mata solo los procesos cuya línea de comandos
  lleva su prefijo temporal `onyx-shotd-<pid>-` y borra sus carpetas. Úsalo con `perl -e 'alarm shift; exec @ARGV' 345 node ...`
  (el alarm no mata hijos: el propio script los limpia). No toca la app instalada, su userData ni su cloudflared.
- Límites: `dialogo-confirmar` es el diálogo «¿Lanzar la comparación?» (el borrado de conversaciones confirma en la propia fila);
  `onboarding` sale en el paso 2 (OpenCode ausente); `ajustes-celular` muestra el estado apagado, sin QR ni celulares; la terminal
  es una shell real con el prompt cambiado; los modelos son «Fake Model/Reasoner».
