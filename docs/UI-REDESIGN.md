# Plan de mejora UX/UI — nivel clientes de escritorio de referencia

> Documento histórico. "Cowork" es el nombre interno del modo que la app muestra como "Tareas"; las menciones a productos de terceros eran referencias de diseño.

Base: el sistema "Lapislázuli" (`DESIGN.md`) ya es sólido en color, tipografía y componentes. La
brecha con Claude Desktop / Codex está en **estructura del shell, consistencia entre modos y
pulido de interacción**, no en la paleta. Se conserva la identidad y los nombres de tokens.

Método: guía del plugin `frontend-design` (plan de tokens → revisión contra defaults → build →
autocrítica con capturas). Las capturas se toman con CDP contra una instancia aislada
(`--user-data-dir` + `--remote-debugging-port`), sin permiso de grabación de pantalla.

## Diagnóstico (capturas del estado inicial)

| # | Hallazgo | Dónde |
|---|---|---|
| 1 | Cowork tiene **doble barra lateral** (264 px vacía + 256 px de tareas); Chat/Code usan una sola | Cowork |
| 2 | Cabeceras de página distintas en cada modo (sin barra / título suelto / barra con borde) | todos |
| 3 | Selector de modo: etiquetas apiladas de 11 px, sin atajos de teclado | Sidebar |
| 4 | Botón "nuevo" en acento a todo ancho (Cowork) o círculo (resto): ruidoso, inconsistente | Sidebar/Cowork |
| 5 | Sin paleta de comandos ni atajos por modo (⌘K, ⌘1–4, ⌘N) | global |
| 6 | Halo de foco del compositor grueso (doble anillo) | Composer |
| 7 | ~~Primer mensaje pegado a la cabecera~~ — descartado: era el scroll pegado al final, no un defecto | MessageList |
| 8 | Code: "Nueva sesión" duplicado (botón de barra + fila de lista); barra superior densa | Code |
| 9 | Estados vacíos con marco discontinuo y tarjetas genéricas | Code/Rutinas |

## Fases (estado)

1. ✅ **Fundamentos** — halo de foco del compositor sutil. Los tokens de superficie/borde no necesitaron cambios.
2. ✅ **Shell** — navegación vertical de modos (icono + etiqueta) con buscador; fila "nuevo" neutra con ⌘N;
   `PageHeader` compartido (Proyectos y Rutinas); lista de tareas de Cowork movida a la barra lateral.
   Se descartó ⌘1–4: ⌘1–3 ya son paneles de Code. Modos: **⌃Tab** / **⌃⇧Tab**.
3. ✅ **Paleta de comandos ⌘K / ⌘⇧P** — cambiar de modo, nueva conversación/sesión, ir a Ajustes, tema, recientes.
4. ✅ **Conversación** — foco del compositor sutil (lo demás ya estaba bien).
5. ✅ **Code / vacíos** — "Nueva sesión" duplicado quitado, estados vacíos sin marco discontinuo,
   mayúsculas forzadas fuera de las listas. La barra superior de Code se aligeró en la ronda 2
   (los controles pasaron al compositor).
6. 🟡 **QA** — hecho: claro/oscuro, 900 px, atajos con teclado real, `typecheck`. Pendiente: pasada con `prefers-reduced-motion` y revisión de Code con una sesión real (diff, terminal).

## Ronda 2 — controles en el compositor + uso y gasto

Petición: los controles (permisos, Plan/Build, esfuerzo del modelo, modelo) estaban en la cabecera de Code;
deben ir abajo, en el compositor, como en Claude Code y Codex, y hay que poder ver cuánto se ha gastado.

- **Compositor de Code:** `[Build] [@] [adjuntar] [permisos] ········ [modelo] [esfuerzo] [uso] [enviar]`.
  Menús hacia arriba (`features/code/impl/ComposerControls.tsx`). La cabecera queda con proyecto, rama,
  título y paneles (Cambios, Terminal, Archivos).
- **`UsageMeter`** (`components/UsageMeter.tsx`, usado en Code y Chat): anillo de contexto; el popover
  muestra contexto usado, gasto de la sesión (suma de los mensajes) y el de hoy / 30 días de todos los
  proyectos (`experimental.session.list`, cacheado 60 s), con enlace a Ajustes → Uso. También en la paleta ("Uso y gasto").
- Los tooltips antiguos anunciaban ⌘⇧M y ⌘⇧E, pero **ningún código los manejaba**; se eliminaron.
- Pendiente: Cowork sigue con su compositor propio (carpeta + modelo), sin `UsageMeter`.

## No se toca (a propósito)

- Marca, paleta y nombres de tokens; lógica de stores, IPC y seguridad.
- Idioma (todo en español) y `APP_NAME` solo desde `brand.ts`.

## Atajos añadidos (`app/App.tsx`)

| Atajo | Acción |
|---|---|
| ⌘K | Paleta de comandos (en Code con proyecto abierto sigue siendo su selector de sesiones) |
| ⌘⇧P | Paleta de comandos, siempre |
| ⌘N | Nuevo (conversación / sesión / tarea) según el modo |
| ⌃Tab · ⌃⇧Tab | Modo siguiente / anterior |

## Cómo capturar pantallas sin permiso de grabación

`npx electron-vite dev -- --user-data-dir=<dir aislado> --remote-debugging-port=9333` y capturar con
`Page.captureScreenshot` (CDP). Con la ventana en segundo plano Chromium congela las transiciones CSS:
activar `Emulation.setFocusEmulationEnabled` y desactivar `transition` antes de capturar.
