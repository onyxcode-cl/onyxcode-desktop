/**
 * Escala de capas (z-index) del cromo de escritorio. Son clases completas para que Tailwind las vea. Solo se aplica en los archivos
 * de la estructura general (paleta, diálogos propios); el resto de pantallas conserva sus valores y se migra a su ritmo.
 * `popover` < `drawer` < `palette` < `dialog` < `critical` (confirmaciones del control remoto, siempre encima de todo).
 */
export const LAYER = {
  popover: 'z-50',
  drawer: 'z-[60]',
  palette: 'z-[200]',
  dialog: 'z-[300]',
  critical: 'z-[310]'
} as const
