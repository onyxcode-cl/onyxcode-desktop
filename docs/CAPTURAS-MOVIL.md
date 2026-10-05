# Capturas de la interfaz móvil (sin celular)

`node scripts/shot-mobile.mjs [--out DIR] [--scenario ESC] [--theme dark|light] [--device iphone14|android360] [--no-build]`

- Escenarios (rediseño F8-B102): `inicio` (raíz de Chat), `panel` (menú abierto), `conversacion`, `chat-largo`, `tareas` (permiso destructivo
  `bash rm -rf ./tmp/*.log` + «En curso»), `permiso` (Code), `ajustes` (desde el pie del panel), `rutinas`, `bloqueo`, `vinculacion`. Sin
  argumentos saca todos (10 escenarios × 2 dispositivos × 2 temas = 40 PNG). Nombre: `<escenario>-<dispositivo>-<tema>.png`. Los viejos
  `lista`, `chat` y `mas` ya no existen (la pestaña «Más» desapareció y la raíz de Chat ya no es la lista).
- `tareas`: Inicio de Tareas no carga la carpeta por su cuenta (decisión 3), así que el guion entra y sale del detalle con «Nueva tarea» y
  «Atrás» (con `tasks.lastFolder` sembrado) para que el store quede conectado. `SHOT_DEBUG=<carpeta>` guarda una captura `FALLO-*.png` si un escenario falla.
- **Nueva línea base**: las 40 capturas del rediseño (carpeta `shots-pwa-int`) sustituyen a las 32 de 0.4.5 (`shots-0.4.5-mobile`, que se conservan para auditar).
  `bloqueo-*` y `vinculacion-*` (capa ligera) deben seguir con 0 píxeles distintos frente a 0.4.5: `node scripts/shot-diff.mjs <0.4.5> <nueva>`.
- Salida por defecto: el scratchpad de la sesión (`.../scratchpad/shots`). Dispositivos: iPhone 14 (390×844, DPR 3) y Android
  gama media (360×740, DPR 3), con tacto y UA móvil.
- Cómo funciona: compila con Vite (misma config que `pwa/vite.full.config.ts`) un arnés en `scripts/shot-mobile/` que monta la
  interfaz real de `src/renderer/remote` sobre el `FakeLink` con datos inventados (`fixtures.ts`: chats con markdown, código,
  tabla y tarjetas de herramientas; un proyecto de Code con un permiso pendiente). `bloqueo` y `vinculacion` usan la capa ligera
  de `pwa/src/ui.ts` con un cliente de mentira. Se sirve en un puerto libre de 127.0.0.1 y se abre en el Chromium headless que
  Playwright ya tiene en `~/Library/Caches/ms-playwright` (no descarga nada). Transiciones desactivadas y
  `Emulation.setFocusEmulationEnabled` activo. No toca la app instalada, su `userData` ni el motor OpenCode.
- Seguridad: tope de 240 s en total; al terminar (o con Ctrl+C) cierra el navegador y mata solo los pids hijos de este proceso.
- Para cambiar datos o añadir un escenario: `scripts/shot-mobile/fixtures.ts` (datos) y `drive()` en `scripts/shot-mobile.mjs`
  (cómo se llega a la pantalla, tocando los controles reales).
- Límites: no es Safari/WebKit (el motor es Chromium), la barra de estado y el teclado no se dibujan, y los datos del Mac son falsos.
