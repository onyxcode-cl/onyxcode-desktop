import type { HTMLAttributes } from 'react'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'gold'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-inset text-muted',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
  gold: 'bg-gold-soft text-gold-text'
}

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  /** `pill` = totalmente redondeada (estado); por defecto, etiqueta de radio 4 en escritorio. */
  pill?: boolean
}

/** Insignia de estado o conteo (`Listo`, `2 activas`, `recomendado`, `1/3`). 11 px, números tabulares. El dorado es solo de marca. */
export function Badge({ tone = 'neutral', pill, className = '', ...rest }: Props): React.JSX.Element {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 text-[11px] desk:text-meta leading-none font-medium whitespace-nowrap tabular-nums desk:text-caption ${
        pill ? 'rounded-full' : 'rounded-md desk:rounded-2xs'
      } ${TONES[tone]} ${className}`}
      {...rest}
    />
  )
}
