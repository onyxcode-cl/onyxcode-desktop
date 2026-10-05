import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { isRemoteSurface } from '../lib/platform'
import { Tooltip } from './Tooltip'

export type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg'

// Tamaño del área y del icono recomendado (escala 12/14/16/18).
const SIZES: Record<IconButtonSize, string> = {
  xs: 'h-6 w-6 desk:rounded-ctl-sm',
  sm: 'h-7 w-7 desk:rounded-ctl',
  md: 'h-8 w-8 desk:rounded-ctl',
  lg: 'h-9 w-9 desk:rounded-ctl'
}
export const ICON_BUTTON_ICON: Record<IconButtonSize, 12 | 14 | 16 | 18> = { xs: 12, sm: 14, md: 16, lg: 18 }

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  children: ReactNode
  active?: boolean
  /** `xs` = 24px, `sm` = 28px, `md` = 32px (por defecto), `lg` = 36px. */
  size?: IconButtonSize
  /**
   * Tooltip propio en escritorio (opt-in): `true` usa `label`, un texto lo sustituye. Con tooltip se quita el `title` nativo (que
   * dibujaría un segundo globo); por eso NO es el valor por defecto: varios E2E localizan botones con `getByTitle`. Sin él, y en la
   * PWA del celular, queda el `title` de siempre.
   */
  tooltip?: boolean | string
  /** Atajo de teclado que acompaña al tooltip. */
  shortcut?: string
}

export function IconButton({ label, children, active, size = 'md', className = '', tooltip, shortcut, ...rest }: Props): React.JSX.Element {
  const tip = isRemoteSurface() || !tooltip ? undefined : tooltip === true ? label : tooltip
  const button = (
    <button
      type="button"
      title={tip ? undefined : label}
      aria-label={label}
      className={`no-drag inline-flex shrink-0 items-center justify-center rounded-lg text-muted transition-[background-color,color,transform] duration-150 hover:bg-hover hover:text-fg active:scale-95 disabled:opacity-40 disabled:hover:bg-transparent desk:active:scale-100 desk:disabled:cursor-not-allowed desk:disabled:opacity-50 ${SIZES[size]} ${active ? 'bg-active text-fg' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
  return tip ? (
    <Tooltip label={tip} shortcut={shortcut}>
      {button}
    </Tooltip>
  ) : (
    button
  )
}
