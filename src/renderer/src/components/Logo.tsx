import { useId } from 'react'
import { DISPLAY_NAME } from '@shared/brand'

/**
 * Identidad visual (independiente del nombre): "Faceta" — una gema tallada vista desde
 * arriba (lapislázuli, 4 facetas) con una chispa dorada (pirita). El wordmark se dibuja
 * siempre desde DISPLAY_NAME. Geometría compartida con build/icon.svg y el icono de bandeja.
 */

/**
 * Marca «Faceta» (estilo de globo suave): un blob lobulado de lapislázuli con la gema tallada en el centro. Geometría de 32×32 compartida con build/icon.svg y el icono de bandeja.
 */

/** Blob de 6 lóbulos suaves (radio medio 12 en el centro 16,16). */
const BLOB =
  'M16.00 3.10C16.85 3.10 17.79 3.56 18.55 3.99C19.32 4.42 19.91 5.22 20.58 5.70C21.26 6.18 21.87 6.53 22.63 6.88C23.38 7.23 24.37 7.34 25.12 7.78C25.88 8.23 26.75 8.81 27.17 9.55C27.60 10.29 27.67 11.33 27.68 12.21C27.68 13.08 27.29 13.99 27.21 14.82C27.13 15.65 27.13 16.35 27.21 17.18C27.29 18.01 27.68 18.92 27.68 19.79C27.67 20.67 27.60 21.71 27.17 22.45C26.75 23.19 25.88 23.77 25.12 24.22C24.37 24.66 23.38 24.77 22.63 25.12C21.87 25.47 21.26 25.82 20.58 26.30C19.91 26.78 19.32 27.58 18.55 28.01C17.79 28.44 16.85 28.90 16.00 28.90C15.15 28.90 14.21 28.44 13.45 28.01C12.68 27.58 12.09 26.78 11.42 26.30C10.74 25.82 10.13 25.47 9.37 25.12C8.62 24.77 7.63 24.66 6.88 24.22C6.12 23.77 5.25 23.19 4.83 22.45C4.40 21.71 4.33 20.67 4.32 19.79C4.32 18.92 4.71 18.01 4.79 17.18C4.87 16.35 4.87 15.65 4.79 14.82C4.71 13.99 4.32 13.08 4.32 12.21C4.33 11.33 4.40 10.29 4.83 9.55C5.25 8.81 6.12 8.23 6.88 7.78C7.63 7.34 8.62 7.23 9.37 6.88C10.13 6.53 10.74 6.18 11.42 5.70C12.09 5.22 12.68 4.42 13.45 3.99C14.21 3.56 15.15 3.10 16.00 3.10Z'
/** Gema: rombo de esquinas redondeadas CENTRADO en el blob (16,16), en 4 facetas. */
const GEM_CLIP = 'rotate(45 16 16)'
const GC = '16 14.9'
const FACETS = {
  tl: `16,9.3 ${GC} 9.4,16`,
  tr: `16,9.3 22.6,16 ${GC}`,
  bl: `9.4,16 ${GC} 16,22.7`,
  br: `${GC} 22.6,16 16,22.7`
}
const SPARK = 'M22.60 6.62Q23.13 9.07 25.58 9.60Q23.13 10.13 22.60 12.58Q22.07 10.13 19.62 9.60Q22.07 9.07 22.60 6.62Z'

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
  const blobGrad = `blob-${uid}`
  const tile = variant === 'tile'
  const mono = variant === 'mono'
  // Gema: sobre el blob de color es blanca; sobre el azulejo (blob blanco) es de lapislázuli.
  const fills = mono
    ? { tl: 'currentColor', tr: 'currentColor', bl: 'currentColor', br: 'currentColor' }
    : tile
      ? { tl: '#6f8cff', tr: '#4a6ff5', bl: '#2c4fd8', br: '#18277a' }
      : { tl: '#ffffff', tr: '#e4eaff', bl: '#c4d0ff', br: '#9db0f8' }
  const opac = mono ? { tl: 1, tr: 0.72, bl: 0.5, br: 0.32 } : { tl: 1, tr: 1, bl: 1, br: 1 }

  const mark = (
    <>
      <defs>
        <clipPath id={clip}>
          <rect x="11.3" y="11.3" width="9.4" height="9.4" rx="2.1" transform={GEM_CLIP} />
        </clipPath>
        <linearGradient id={blobGrad} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#7a95ff" />
          <stop offset="0.5" stopColor="#2f52dc" />
          <stop offset="1" stopColor="#18277a" />
        </linearGradient>
      </defs>
      {mono ? (
        <path d={BLOB} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      ) : (
        <path d={BLOB} fill={tile ? '#ffffff' : `url(#${blobGrad})`} />
      )}
      <g clipPath={`url(#${clip})`} className={animated ? 'gem-breathe' : undefined}>
        <polygon points={FACETS.tl} fill={fills.tl} fillOpacity={opac.tl} />
        <polygon points={FACETS.tr} fill={fills.tr} fillOpacity={opac.tr} />
        <polygon points={FACETS.bl} fill={fills.bl} fillOpacity={opac.bl} />
        <polygon points={FACETS.br} fill={fills.br} fillOpacity={opac.br} />
      </g>
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
          <g transform="translate(16 16.2) scale(0.74) translate(-16 -16)">{mark}</g>
        </>
      ) : (
        mark
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
  /** Texto del wordmark; por defecto DISPLAY_NAME. */
  name?: string
}

/** Símbolo + wordmark (DISPLAY_NAME). */
export function Logo({ size = 22, className = '', variant = 'color', markOnly, name = DISPLAY_NAME }: LogoProps): React.JSX.Element {
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

/** La chispa sola (color del acento): el indicador de «trabajando» (gira suave mientras `spinning`). */
export function Spark({
  size = 14,
  spinning = true,
  className = ''
}: {
  size?: number
  spinning?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="19 6 7 7" className={`shrink-0 text-accent ${className}`} aria-hidden>
      <path d={SPARK} fill="currentColor" className={spinning ? 'spark-spin' : undefined} />
    </svg>
  )
}
