# Sistema de diseño — "Lapislázuli"

Identidad visual de la app, **independiente del nombre** (el nombre vive sólo en
`src/shared/brand.ts` → `APP_NAME`; el wordmark siempre se renderiza desde ahí).

## Concepto

- **Lapislázuli** (piedra nacional de Chile): azul profundo como acento.
- **Pirita**: las vetas doradas del lapislázuli → una *chispa* dorada, usada con mucha moderación
  (logo, estados de "razonando", insignias "recomendado").
- Neutros **fríos** (papel / tinta), deliberadamente lejos del beige cálido de otros clientes.
- Tema oscuro = "noche de Atacama": casi negro azulado, acento azul luminoso.

## Marca

| Pieza | Dónde |
|---|---|
| Símbolo "Faceta" (gema de 4 facetas + chispa) | `src/renderer/src/components/Logo.tsx` → `LogoMark` |
| Símbolo + wordmark (`APP_NAME`) | `Logo` (mismo archivo) |
| Icono de app (1024 px, macOS squircle) | `build/icon.svg` → `build/icon.png`, `build/icon.icns` |
| Icono de bandeja (template image) | `src/main/extras/tray.ts` (`createTrayIcon`, dibujado en runtime) |
| Colores para el proceso main | `BRAND_COLORS` en `src/shared/brand.ts` |

`LogoMark` props: `size`, `variant` (`color` | `mono` | `tile`), `animated` (chispa girando), `title`.
Todas las piezas comparten una geometría de 32 unidades: rombo = cuadrado 17×17, rx 3.6,
rotado 45° en (16,16); centro óptico de las facetas (16,14.6); chispa de 4 puntas en (26,6).

Regenerar el icono tras editar `build/icon.svg`:

```sh
npx electron build/render-icon.mjs   # escribe build/icon.png (1024) y build/icon.icns
```

## Tokens (CSS custom properties en `src/renderer/src/app/globals.css`)

Los **nombres** son contrato para todo el renderer: se pueden cambiar valores y agregar tokens,
nunca renombrar ni eliminar. Cada token de color tiene utilidad Tailwind (`bg-*`, `text-*`, `border-*`).

| Token CSS | Utilidad | Claro | Oscuro | Uso |
|---|---|---|---|---|
| `--bg` | `bg-bg` | `#f7f8fb` | `#11131a` | Fondo de la ventana |
| `--bg-sidebar` | `bg-sidebar` | `#eff1f6` | `#0c0e14` | Barra lateral, cabeceras de tabla |
| `--bg-elevated` | `bg-elevated` | `#ffffff` | `#191c25` | Tarjetas, popovers, compositor |
| `--bg-hover` | `bg-hover` | `#e7eaf2` | `#20242f` | Hover |
| `--bg-active` | `bg-active` | `#dde2ee` | `#292e3c` | Seleccionado |
| `--bg-code` | `bg-code` | `#f1f3f8` | `#0b0d12` | Bloques de código |
| `--bg-inset` *(nuevo)* | `bg-inset` | `#eceff5` | `#0e1017` | Pistas hundidas (segmentados, detalles) |
| `--fg` | `text-fg` | `#131722` | `#e7e9f0` | Texto principal |
| `--fg-muted` | `text-muted` | `#586074` | `#a0a6b6` | Texto secundario |
| `--fg-subtle` | `text-subtle` | `#8a91a3` | `#6c7386` | Ayudas, placeholders |
| `--border` | `border-border` | `#e0e4ed` | `#242835` | Bordes |
| `--border-strong` | `border-border-strong` | `#c7cddb` | `#343a4b` | Bordes en hover / separadores fuertes |
| `--accent` | `text-accent`, `bg-accent` | `#2c4fd8` | `#7d97ff` | Lapislázuli |
| `--accent-hover` *(nuevo)* | `bg-accent-hover` | `#2442bd` | `#97acff` | Hover de botones primarios |
| `--accent-fg` | `text-accent-fg` | `#ffffff` | `#0a1033` | Texto sobre acento |
| `--accent-soft` | `bg-accent-soft` | `#e4e9ff` | `#1b2450` | Fondos tintados |
| `--accent-ring` *(nuevo)* | `shadow-[0_0_0_3px_var(--accent-ring)]` | 35 % acento | 40 % acento | Halo de foco |
| `--gold` / `--gold-soft` *(nuevos)* | `text-gold`, `bg-gold-soft` | `#b7851f` / `#fbf1d9` | `#e6b84e` / `#2e2615` | Chispa (con moderación) |
| `--success` *(nuevo)* | `text-success`, `bg-success` | `#15803d` | `#4ade80` | OK |
| `--warning` *(nuevo)* | `text-warning`, `bg-warning` | `#b45309` | `#fbbf24` | Aviso |
| `--danger` | `text-danger`, `bg-danger` | `#c0352b` | `#ff7a6e` | Error / destructivo |
| `--user-bubble` | `bg-user` | `#e8ecf8` | `#1e2331` | Burbuja del usuario |
| `--selection` *(nuevo)* | — | | | `::selection` |
| `--scrollbar`, `--scrollbar-hover` *(nuevos)* | — | | | Scrollbars |
| `--brand-gradient` *(nuevo)* | `.bg-brand`, `.text-brand` | | | Degradado de marca |

### Tipografía

- `--font-sans` (`font-sans`): pila del sistema (SF Pro en macOS). Cuerpo 14 px, mensajes 15 px / 1.7.
- `--font-display` (`font-display`, nuevo): `ui-rounded` (SF Pro Rounded) → títulos, saludo, wordmark, encabezados Markdown.
- `--font-mono` (`font-mono`): SF Mono / JetBrains Mono / Menlo.
- Etiquetas de grupo: 10.5–11.5 px, `uppercase`, `tracking-[0.06em]`, `text-subtle`.
- No se empaquetan fuentes (no hay `@fontsource` instalado).

### Radios, sombras y movimiento

- Radios: Tailwind por defecto (`rounded-lg` controles, `rounded-xl` tarjetas/popovers,
  `rounded-[20px]` compositor, `rounded-full` chips/botón enviar). Tokens `--radius-xs…xl` disponibles.
- Sombras: `shadow-xs/sm/md/lg/xl` redefinidas con tinte azul (`--shadow-color`), más profundas en oscuro.
- Movimiento: `--ease-out` `cubic-bezier(.22,1,.36,1)`, `--dur-fast` 120 ms, `--dur-base` 180 ms, `--dur-slow` 320 ms.
- Animaciones Tailwind nuevas: `animate-fade-in`, `animate-rise-in`, `animate-pop-in` (popovers/menús),
  `animate-shimmer`, `animate-caret`. Clases: `.text-shimmer` (texto "pensando"), `.typing-dots`,
  `.spark-spin`, `.kbd` (tecla), `.select-field` (select nativo con chevron propio).
- `prefers-reduced-motion`: se anulan animaciones/transiciones (excepto `animate-spin`).
- Foco: anillo de 2 px en color acento sólo con teclado (`:focus-visible`); campos usan halo `--accent-ring`.

## Componentes compartidos (`src/renderer/src/components`)

| Componente | Novedades (todas las props anteriores se mantienen) |
|---|---|
| `Logo`, `LogoMark` | **Nuevo.** |
| `Button` | Sombras, `active:scale`, hover `accent-hover`; prop opcional `size: 'sm' \| 'md'`. |
| `IconButton` | Prop opcional `size: 'sm' \| 'md'`, micro-escala al presionar. |
| `Composer` | Autoajuste robusto (ResizeObserver), halo de foco, botón enviar redondo; props opcionales `showAttach`, `onAttach`, `insert` (prellenar desde chips), `hint`. |
| `ModelPicker` | Popover con navegación por teclado (↑ ↓ Enter Esc), proveedor recomendado primero. |
| `Markdown` | Bloques de código con cabecera (lenguaje + Copiar); prop opcional `streaming` (cursor); exporta `CopyButton`. |
| `MessageList` | Cursor de streaming, acciones Copiar/Reintentar, botón "ir al final", indicador `ThinkingIndicator` (exportado); prop opcional `onRetry(userText)`. |
| `ToolCall` | Icono por herramienta, borde de estado, título con brillo mientras corre. |
| `SessionList` | Indicador activo, esqueletos de carga, estado vacío, búsqueda (> 8 sesiones), menú animado. |
| `PlaceholderView` | Halo de acento, tipografía display. |
| `UsageMeter` | **Nuevo.** Anillo de contexto + popover de gasto (sesión, hoy, 30 días) para el compositor de Code y Chat. |
| `PageHeader` | **Nuevo.** Cabecera de 48 px (título, metadatos, acciones) para páginas de lista (Proyectos, Rutinas). |
| `CommandPalette` (`app/`) | **Nuevo.** ⌘K / ⌘⇧P: ir a modo, nuevo, Ajustes, tema, conversaciones recientes. |

## Shell

- Barra lateral: buscador/paleta (⌘K), navegación vertical de modos (icono + etiqueta), fila "nuevo" neutra (⌘N),
  lista contextual del modo (Tareas incluye carpeta y tareas; ya no hay segunda columna), pie con símbolo + nombre
  + estado del servidor (punto de color) + Ajustes.
- Colapso animado (ancho) con `⌘\`; `⌘,` abre/cierra Ajustes.
- Chat vacío: saludo según hora ("Buenos días / Buenas tardes / Buenas noches"), subtítulo neutro, chips de sugerencias.
- Ajustes: navegación con elemento activo "elevado", encabezados display, vista previa de temas.
- Quick Entry: cápsula translúcida con símbolo, halo de foco y botón enviar que se activa al escribir.

## Reglas

1. Nunca hardcodear colores en componentes: usar tokens (excepción: vistas previas de tema y el logo).
2. El dorado es un acento *de marca*, no de UI: no usarlo para botones ni estados de error/aviso.
3. Todo texto de UI en español; el nombre del producto siempre desde `APP_NAME`.
