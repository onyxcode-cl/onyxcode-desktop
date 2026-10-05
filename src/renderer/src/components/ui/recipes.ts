/**
 * Recetas de clases del rediseño de escritorio: cadenas que antes se repetían a mano en cada pantalla. Cada una es la cadena BASE
 * dominante de hoy (lo que ve el celular, sin cambios) + las clases `desk:` de escritorio (el plugin de la PWA las quita del CSS).
 * Importarlas en vez de inventar cadenas: `className={`${CARD} p-4`}`. Todas llevan al menos una clase base delante de la primera
 * `desk:` (Regla U). Ver DESIGN.md «Fundamentos de escritorio».
 */

/** Popover / menú flotante: radio 12, sombra de nivel 2. Lleva la animación de entrada; el posicionamiento lo pone quien la usa. */
export const POP =
  'animate-pop-in overflow-hidden rounded-xl border border-border bg-elevated p-1 text-sm shadow-lg desk:rounded-card desk:text-ui desk:shadow-pop'

/** Tarjeta plana (nivel 0): radio 12, borde 1 px. */
export const CARD = 'rounded-xl border border-border bg-elevated desk:rounded-card'
/** Tarjeta que flota (nivel 1). */
export const CARD_RAISED = `${CARD} shadow-xs desk:shadow-raised`

/** Fila de lista o de lateral: 32 px, radio 8, 13 px. Añadir el estado (`bg-active font-medium` si está seleccionada). */
export const ROW =
  'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] hover:bg-hover desk:h-8 desk:rounded-ctl desk:px-2 desk:py-0 desk:text-ui'
export const ROW_ACTIVE = 'bg-active font-medium text-fg'

/** Ítem de menú: 28 px, radio 6. */
export const MENU_ITEM =
  'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-hover disabled:opacity-50 desk:h-7 desk:rounded-ctl-sm desk:px-2 desk:py-0 desk:text-ui desk:disabled:cursor-not-allowed'

/** Campo de texto (sin altura: `Input` añade 32 px; un `textarea` la deja libre). Foco: borde acento + halo. */
export const INPUT =
  'w-full rounded-lg border border-border bg-bg px-3 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-50 desk:rounded-ctl desk:text-ui desk:focus:shadow-focus desk:disabled:cursor-not-allowed'
export const INPUT_INVALID = 'border-danger focus:border-danger'

/** Control segmentado: pista + segmento (activo: elevado). */
export const SEGMENT = 'inline-flex items-center gap-0.5 rounded-lg bg-inset p-0.5 desk:rounded-ctl'
export const SEGMENT_ITEM =
  'inline-flex items-center justify-center rounded-md px-3 py-1 text-[13px] font-medium text-muted hover:text-fg desk:h-7 desk:rounded-ctl-sm desk:py-0 desk:text-ui'
export const SEGMENT_ITEM_ACTIVE = 'bg-elevated text-fg shadow-xs desk:shadow-raised'

/** Pestaña: 28 px, radio 6. */
export const TAB =
  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium text-muted hover:bg-hover hover:text-fg desk:h-7 desk:rounded-ctl-sm desk:py-0 desk:text-ui'
export const TAB_ACTIVE = 'bg-active text-fg'

/** Contenedor de estado vacío (ver `EmptyState`). */
export const EMPTY = 'flex flex-col items-center gap-2 text-center'
