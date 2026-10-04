import { isRemoteSurface } from '../../lib/platform'

/**
 * Gancho de estilo para el CSS móvil sin tocar el marcado del escritorio: `<div {...m('tool-row')} className=…>`.
 * En Mac y Windows no añade ningún atributo; en el celular pone `data-m="tool-row"` y el CSS apunta a
 * `[data-surface='mobile'] [data-m='tool-row']`. Evaluar en el render (no a nivel de módulo).
 */
export const m = (name: string): { 'data-m'?: string } => (isRemoteSurface() ? { 'data-m': name } : {})
