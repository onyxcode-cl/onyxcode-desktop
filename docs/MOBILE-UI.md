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
- Conversación: `--m-turn-gap`, `--m-block-gap`, `--m-body`, `--m-body-lh`, `--m-meta`, `--m-mono`.
- Superficies: `--m-backdrop` (velo de modales, igual en claro y oscuro), `--m-hairline`.
- Movimiento: `--ease-sheet`, `--dur-screen`, `--dur-push`, `--dur-pop`, `--dur-tab`, `--dur-sheet-in`, `--dur-sheet-out`.
- Animaciones en `@theme` (`globals.css`): `animate-m-push`, `animate-m-pop`, `animate-m-tab`, `animate-sheet-down`, `animate-fade-out`
  (solo las usa código móvil). `animate-sheet-up` no se ha tocado: la cambia HOJAS.
- La capa ligera (`pwa/src/style.css`) copia a mano los colores y las medidas `--m-row…--dur-screen`; `src/renderer/remote/pwa-tokens.test.ts`
  vigila que no se desvíen. Al cambiar un valor, cámbialo en los dos sitios.

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

## Reparto de archivos (sin solaparse)

- SHELL: `MobileShell.tsx`, `mobile-shell.css`, `MoreScreens.tsx`, listas (`ChatSessionList`, listas de Code y Tareas), `nav.ts`, `link.ts`.
- HOJAS: `components/mobile/Sheet.tsx`, `ConfirmDialog.tsx` (rama móvil), toasts, selector de modelo (`ModelPicker.tsx`), `PopoverPanel.tsx`.
- LIGERA: `pwa/src/*` (`ui.ts`, `style.css`, `i18n.ts`, `main.ts`, `full.ts`, `client.ts`), `pwa/index.html`, el arranque y `scripts/shot-mobile/*`.
- CHAT: `conversation.css`, `ChatComposer.tsx`, `use-stick-to-bottom.ts`, `ToolRow`/`ToolCard.tsx`, `ChatMessageList.tsx`, `MessageStream.tsx`, `PermissionCard.tsx`.
- RENDIMIENTO: `pwa/vite.full.config.ts` (`SWAPS`), `Markdown.tsx` y resaltado, `remote/lazy/*`, `remote/main.tsx`, `pwa/budget.json`.

## Peso y verificación

- `npm run build:pwa` y `npm run size:pwa` (informa y falla con `--check` si se pasa `pwa/budget.json`; todavía fuera de `npm run verify`).
  Base: arranque 391 KB gzip, objetivo 300; capa ligera ≤ 32 KB gzip (`index.js`).
- Por cambio: `npx vitest run src/renderer/src/app/mobile src/renderer/remote src/shared/remote src/test`, `npm run typecheck`, `npm run lint`,
  `npx prettier --check <archivos>`. Con límite: `perl -e 'alarm shift; exec @ARGV' SEG …`. Sin e2e masivos ni cargas artificiales.
- Commits pequeños en español, `git add <ruta>`, con la línea `Co-Authored-By` del agente.
