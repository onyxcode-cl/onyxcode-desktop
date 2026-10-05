# Interfaz móvil (PWA del celular): convenciones para quien la toque

La PWA reutiliza la interfaz de escritorio (`src/renderer/src`) con una superficie «remota» (`isRemoteSurface()`). Esta guía fija las
reglas comunes de la mejora estética y de rendimiento; los planes detallados están fuera del repo. **El escritorio no cambia.**

## Reglas de oro

1. Toda diferencia móvil va tras `isRemoteSurface()` (`src/renderer/src/lib/platform.ts`), tras `props.mobile` o en CSS colgado de
   `[data-surface='mobile']`. Se evalúa en el render, nunca a nivel de módulo (las pruebas simulan la plataforma).
2. Hooks siempre antes de cualquier `return` temprano; solo el resultado se condiciona.
3. Colores solo con los tokens Lapislázuli (`globals.css`); ningún hex nuevo. Se pueden añadir tokens, nunca renombrar ni borrar.
4. Texto visible con `t('…')` y clave en es y en. Sin nombres de productos de terceros (`visible-terms`, también sobre `pwa/src`).
5. Sin `vitest -u`. Los literales de `app/mobile/desktop-unchanged.test.tsx` no se editan: si uno falla, el cambio se escapó al escritorio.
6. Animaciones de pantalla: fill-mode `backwards`, nunca `both`/`forwards` (un `transform` que se queda aplicado convierte al
   contenedor en bloque de los `position:fixed` sin portal: editores de Rutinas, paneles, diálogos).

## Tokens (`src/renderer/src/app/mobile/mobile-tokens.css`, solo bajo `[data-surface='mobile']`)

- Medidas: `--m-row` 56, `--m-row-compact` 48, `--m-bar` 52, `--m-tab` 56 (alias `--m-bar-h`, `--m-tab-h`), `--m-gutter` 16,
  `--m-radius-card` 16, `--m-radius-sheet` 22, `--m-tap` 44, `--m-icon-btn` 36, `--m-composer-radius` 24.
- Añadidos por el rediseño (F8-B102): `--m-card-radius` 12 (aviso, permiso, «En curso», código), `--m-btn-radius` 10 (botones de 44 de las
  tarjetas; en Tailwind v4 se escribe `rounded-(--m-btn-radius)!`), `--m-drawer` (ancho del panel), `--m-pill-w`/`--m-pill-h` (píldora de la
  barra inferior), `--m-row-list`, `--m-tab-item`.
- Conversación: `--m-turn-gap`, `--m-block-gap`, `--m-body`, `--m-body-lh`, `--m-meta`, `--m-mono`.
- Superficies: `--m-backdrop` (velo de modales, igual en claro y oscuro), `--m-hairline`.
- Movimiento: `--ease-sheet`, `--dur-screen`, `--dur-push`, `--dur-pop`, `--dur-tab`, `--dur-sheet-in`, `--dur-sheet-out`.
- Animaciones en `@theme` (`globals.css`): `animate-m-push`, `animate-m-pop`, `animate-m-tab`, `animate-sheet-down`, `animate-fade-out`
  (solo las usa código móvil). `animate-sheet-up` no se ha tocado: la cambia HOJAS.
- La capa ligera (`pwa/src/style.css`) copia a mano los colores y las medidas `--m-row…--dur-screen`; `src/renderer/remote/pwa-tokens.test.ts`
  vigila que no se desvíen. Al cambiar un valor, cámbialo en los dos sitios.

## Estructura de navegación (rediseño F8-B102)

- Pestañas de la barra inferior: **Chat · Code · Tareas · Rutinas** (`nav.ts`; «Más» ya no existe). La raíz de Chat es **Inicio**
  (`ChatView` sin conversación) y la raíz de Tareas es **Inicio de Tareas** (`MobileTasksHome`: aprobaciones arriba y «En curso»).
- **Panel lateral** (`MobileDrawer.tsx` puerta perezosa + `DrawerPanel.tsx`): se abre con el botón de menú (`aria-label` `mobile.drawer.open`)
  o deslizando; contiene la lista del modo activo (conversaciones, tareas por carpeta, sesiones de Code), «Nueva …», el buscador y, en el
  pie, **Ajustes** y el estado de la conexión. Las listas ya no son la raíz de cada pestaña (salvo la lista de sesiones de Code).
- **Ajustes** es una sola pantalla apilada con la tarjeta de conexión («Tu Mac», Bloquear ahora, Desvincular; `ConnectionCard.tsx`) y los
  grupos de ajustes. La pantalla `phone` («Este celular») se unificó con `settings` y la cabecera dice «Ajustes».
- **Punto de aprobación** en la pestaña Tareas: `role="img"` con `aria-label` en texto. Refleja los permisos del store de Tareas **solo si ya
  está conectado a una carpeta** (decisión 3: no se carga nada nuevo al arrancar).
- **Tarjeta de permiso** (`GenericPermissionCard`): recorre `perm-actions.ts`. Destructivo: «Rechazar» arriba (ancho completo, 44), luego
  «Permitir una vez» (peligro) y «Rechazar con indicaciones», sin «siempre». No destructivo: «Permitir una vez» arriba, «Rechazar», «Con
  indicaciones» y «Permitir siempre» (fila 3, solo si hoy aparece). Sin `autoFocus`.

## Ganchos de código

- `m(name)` (`src/renderer/src/app/mobile/m.ts`): `<div {...m('tool-row')}>` añade `data-m="tool-row"` solo en el celular; el CSS apunta a
  `[data-surface='mobile'] [data-m='tool-row']` (nada de selectores frágiles por clase).
- `isRemoteSurface()` / `useIsRemote()` para ramas en TSX. Nada de ramas por tamaño de pantalla.
- Tema: el Mac decide (`data-theme`). `watchThemeSync()` (`app/mobile/theme-sync.ts`, llamada en `remote/boot.tsx`) guarda el tema en
  `localStorage['onyx.theme']` (`src/shared/remote/theme-pref.ts`) y ajusta `theme-color`; la capa ligera lo lee en `pwa/src/theme.ts`
  (`followTheme`, `hostCss`). Aviso al usuario: «Se aplica también en tu Mac». No tocar `useTheme.ts`.

## Dónde va el CSS móvil

- Tokens: `app/mobile/mobile-tokens.css`. Armazón, listas, Más: `app/mobile/mobile-shell.css` (lo crea SHELL e importa desde `MobileShell.tsx`).
  Conversación: `app/mobile/conversation.css` (lo crea CHAT). El bloque «Superficie móvil» de `globals.css` y `features/code/impl/mobile.css`
  se amplían solo con selectores que empiecen por `[data-surface='mobile']` (lo exige `desktop-unchanged.test.tsx`).

## Reparto de archivos (rediseño F8-B102: tandas T0–T5 ya integradas)

- Armazón y panel: `MobileShell.tsx`, `MobileDrawer.tsx`, `DrawerPanel.tsx`, `mobile-shell.css`, `nav.ts`, `nav-history.ts`. Ajustes: `MoreScreens.tsx`
  (`SettingsHome`, `RoutinesScreen`), `ConnectionCard.tsx`, `components/mobile/List.tsx`, `switch.css`. Inicio y conversación: `ChatView`,
  `ChatComposer`, `ChatMessageList`, `ApprovalNotice.tsx`, `MobileSessionList.tsx`, `conversation.css`, `markdown.css`. Tareas: `MobileTasksHome.tsx`,
  `PermissionPrompt.tsx`, `perm-actions.ts`, `TaskList.tsx`. PWA y capturas: `pwa/public/manifest.webmanifest`, `icon-maskable-512.png`, `scripts/shot-mobile*`.

## Reparto de archivos anterior (sin solaparse)

- SHELL: `MobileShell.tsx`, `mobile-shell.css`, `MoreScreens.tsx`, listas (`ChatSessionList`, listas de Code y Tareas), `nav.ts`, `link.ts`.
- HOJAS: `components/mobile/Sheet.tsx`, `ConfirmDialog.tsx` (rama móvil), toasts, selector de modelo (`ModelPicker.tsx`), `PopoverPanel.tsx`.
- LIGERA: `pwa/src/*` (`ui.ts`, `style.css`, `i18n.ts`, `main.ts`, `full.ts`, `client.ts`), `pwa/index.html`, el arranque y `scripts/shot-mobile/*`.
- CHAT: `conversation.css`, `ChatComposer.tsx`, `use-stick-to-bottom.ts`, `ToolRow`/`ToolCard.tsx`, `ChatMessageList.tsx`, `MessageStream.tsx`, `PermissionCard.tsx`.
- RENDIMIENTO: `pwa/vite.full.config.ts` (`SWAPS`), `Markdown.tsx` y resaltado, `remote/lazy/*`, `remote/main.tsx`, `pwa/budget.json`.

## CSS que viaja con trozos perezosos (presupuesto de `boot.css`: 20 KB gzip, no se sube)

- `markdown.css` (respuesta, código y tablas) se importa desde `components/Markdown.tsx`: en la PWA va en `Markdown-*.css`, con el trozo de Markdown.
- `switch.css` (interruptor 44×26) se importa desde `SettingsView`, `RoutinesView` y `TasksWorkspace` (impl): va en su propio `switch-*.css`.
- Regla: el CSS que solo necesita una pantalla perezosa se importa desde esa pantalla, no desde el arranque; el giro «Trabajando» de las filas
  de Tareas usa el icono `Loader2` ya existente (no `before:` en Tailwind). Medidas tras la integración: `boot.js` 687,8 KB min (límite 690),
  arranque 287,9 KB gzip (límite 300), `boot.css` ~19,9 KB gzip.

## Peso y verificación

- `npm run build:pwa` y `npm run size:pwa` (informa y falla con `--check` si se pasa `pwa/budget.json`; todavía fuera de `npm run verify`).
  Base: arranque 391 KB gzip, objetivo 300; capa ligera ≤ 32 KB gzip (`index.js`).
- Por cambio: `npx vitest run src/renderer/src/app/mobile src/renderer/remote src/shared/remote src/test`, `npm run typecheck`, `npm run lint`,
  `npx prettier --check <archivos>`. Con límite: `perl -e 'alarm shift; exec @ARGV' SEG …`. Sin e2e masivos ni cargas artificiales.
- Commits pequeños en español, `git add <ruta>`, con la línea `Co-Authored-By` del agente.
- La variante `desk:` de Tailwind y `src/renderer/src/app/desktop/*` son SOLO de escritorio (`<html data-shell="desktop">`, lo pone `main.tsx`): nunca en código móvil ni en `remote/`. La PWA no carga esa capa y el plugin `stripDesktopCss` de `pwa/vite.full.config.ts` quita del CSS del celular toda regla con `data-shell`. Guardia: `app/desktop/desktop-scope.test.ts`.
