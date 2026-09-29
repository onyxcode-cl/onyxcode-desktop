import { useId } from 'react'
import { APP_NAME } from '@shared/brand'

/**
 * Identidad visual (independiente del nombre): "Faceta" — una gema tallada vista desde
 * arriba (lapislázuli, 4 facetas) con una chispa dorada (pirita). El wordmark se dibuja
 * siempre desde APP_NAME. Geometría compartida con build/icon.svg y el icono de bandeja.
 */

/** Rombo con esquinas redondeadas (cuadrado 17×17 rx 3.5 rotado 45° en el centro 16,16). */
const GEM_CLIP = 'rotate(45 16 16)'
const CENTER = '16 14.6'
const FACETS = {
  tl: `16,-2 ${CENTER} -2,16`,
  tr: `16,-2 34,16 ${CENTER}`,
  bl: `-2,16 ${CENTER} 16,34`,
  br: `${CENTER} 34,16 16,34`
}
const SPARK = 'M26 1.2 Q26.85 5.15 30.8 6 Q26.85 6.85 26 10.8 Q25.15 6.85 21.2 6 Q25.15 5.15 26 1.2Z'

export type LogoVariant = 'color' | 'mono' | 'tile'

interface MarkProps {
  size?: number
  className?: string
  /**
   * `color`: gema a color (fondos neutros) · `mono`: usa currentColor con opacidades ·
   * `tile`: icono de app (gema blanca sobre azulejo con degradado).
   */
  variant?: LogoVariant
  /** Anima la chispa (estados de "pensando"). */
  animated?: boolean
  title?: string
}

export function LogoMark({ size = 24, className = '', variant = 'color', animated, title }: MarkProps): React.JSX.Element {
  const uid = useId().replace(/:/g, '')
  const clip = `gem-${uid}`
  const bg = `tile-${uid}`
  const tile = variant === 'tile'
  const fills =
    variant === 'mono'
      ? { tl: 'currentColor', tr: 'currentColor', bl: 'currentColor', br: 'currentColor' }
      : tile
        ? { tl: '#ffffff', tr: '#dfe6ff', bl: '#b7c6ff', br: '#8ea3f5' }
        : { tl: '#a9bbff', tr: '#5f7ff6', bl: '#3556e0', br: '#1c2f94' }
  const opac = variant === 'mono' ? { tl: 1, tr: 0.72, bl: 0.5, br: 0.32 } : { tl: 1, tr: 1, bl: 1, br: 1 }
  const spark = variant === 'mono' ? 'currentColor' : '#f0c35a'

  const gem = (
    <>
      <defs>
        <clipPath id={clip}>
          <rect x="7.5" y="7.5" width="17" height="17" rx="3.6" transform={GEM_CLIP} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <polygon points={FACETS.tl} fill={fills.tl} fillOpacity={opac.tl} />
        <polygon points={FACETS.tr} fill={fills.tr} fillOpacity={opac.tr} />
        <polygon points={FACETS.bl} fill={fills.bl} fillOpacity={opac.bl} />
        <polygon points={FACETS.br} fill={fills.br} fillOpacity={opac.br} />
      </g>
      <path d={SPARK} fill={spark} className={animated ? 'spark-spin' : undefined} />
    </>
  )

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={`shrink-0 ${className}`}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      {tile ? (
        <>
          <defs>
            <linearGradient id={bg} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#4a6ff5" />
              <stop offset="0.5" stopColor="#2c4fd8" />
              <stop offset="1" stopColor="#18277a" />
            </linearGradient>
          </defs>
          <rect width="32" height="32" rx="7.5" fill={`url(#${bg})`} />
          <g transform="translate(16 16.6) scale(0.66) translate(-16 -16)">{gem}</g>
        </>
      ) : (
        gem
      )}
    </svg>
  )
}

interface LogoProps {
  /** Alto del símbolo en px; el wordmark escala con él. */
  size?: number
  className?: string
  variant?: LogoVariant
  /** Oculta el wordmark (sólo símbolo). */
  markOnly?: boolean
  /** Texto del wordmark; por defecto APP_NAME. */
  name?: string
}

/** Símbolo + wordmark (APP_NAME). */
export function Logo({ size = 22, className = '', variant = 'color', markOnly, name = APP_NAME }: LogoProps): React.JSX.Element {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={size} variant={variant} title={markOnly ? name : undefined} />
      {!markOnly && (
        <span className="font-display leading-none font-semibold tracking-[-0.015em] text-fg" style={{ fontSize: Math.round(size * 0.68) }}>
          {name}
        </span>
      )}
    </span>
  )
}
