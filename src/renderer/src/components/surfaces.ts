/**
 * Recetas de forma del cromo de escritorio que `components/ui/recipes.ts` no cubre (etiquetas de grupo, metadatos, separadores).
 * Solo texto y espacio: ningún color nuevo. Archivos solo de escritorio (Sidebar, CommandPalette…) las usan tal cual; en
 * archivos compartidos se añaden como clases `desk:` detrás de las base.
 */

/** Etiqueta de grupo de lista o de menú: frase (no mayúsculas), 12 px medio, apagada. Solo sobre `sidebar`/`elevated`/`bg` (contraste AA). */
export const GROUP_LABEL = 'px-2.5 pt-3 pb-1 text-meta font-medium text-subtle'
/** Metadato en una fila (tiempo, estado, atajo). */
export const META = 'text-meta text-subtle tabular-nums'
/** Separador horizontal dentro de un menú. */
export const MENU_SEPARATOR = 'my-1 h-px bg-border'
