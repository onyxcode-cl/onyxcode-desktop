# Capturas de la interfaz móvil (sin celular)

`node scripts/shot-mobile.mjs [--out DIR] [--scenario ESC] [--theme dark|light] [--device iphone14|android360] [--no-build]`

- Escenarios: `lista`, `chat`, `chat-largo`, `permiso`, `ajustes`, `mas`, `bloqueo`, `vinculacion`. Sin argumentos saca todos
  (8 escenarios × 2 dispositivos × 2 temas = 32 PNG, ~40 s). Nombre: `<escenario>-<dispositivo>-<tema>.png`.
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
