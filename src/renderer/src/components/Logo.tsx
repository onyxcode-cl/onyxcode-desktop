import { useId } from 'react'
import { DISPLAY_NAME } from '@shared/brand'

/**
 * Identidad visual (independiente del nombre): "Faceta" — una gema tallada vista desde
 * arriba (lapislázuli, 4 facetas) con una chispa dorada (pirita). El wordmark se dibuja
 * siempre desde DISPLAY_NAME. Geometría compartida con build/icon.svg y el icono de bandeja.
 */

/**
 * Marca «Aro»: un anillo abierto (calma y control) en lapislázuli y un punto dorado en el hueco, como una luz encendida.
 * Geometría de 32×32 compartida con build/icon.svg y el icono de bandeja (src/main/extras/tray.ts).
 */
const RING = 'M16 5.6A10.4 10.4 0 1 0 26.4 16'
const DOT = { cx: 22.6, cy: 7.6, r: 2.3 }
const RING_WIDTH = 3.6

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
  const bg = `tile-${uid}`
  const ringGrad = `ring-${uid}`
  const tile = variant === 'tile'
  const mono = variant === 'mono'
  const ringStroke = mono ? 'currentColor' : tile ? '#ffffff' : `url(#${ringGrad})`
  const dotFill = mono ? 'currentColor' : '#f0c35a'

  const mark = (
    <>
      <defs>
        <linearGradient id={ringGrad} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#7a95ff" />
          <stop offset="0.55" stopColor="#2f52dc" />
          <stop offset="1" stopColor="#18277a" />
        </linearGradient>
      </defs>
      <g className={animated ? 'ring-spin' : undefined}>
        <path d={RING} fill="none" stroke={ringStroke} strokeWidth={RING_WIDTH} strokeLinecap="round" />
      </g>
      <circle cx={DOT.cx} cy={DOT.cy} r={DOT.r} fill={dotFill} />
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
          <g transform="translate(16 16.2) scale(0.78) translate(-16 -16)">{mark}</g>
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

/** El aro de la marca solo (color del acento): el indicador de «trabajando»; gira suave mientras `spinning`. */
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
    <svg width={size} height={size} viewBox="0 0 32 32" className={`shrink-0 text-accent ${className}`} aria-hidden>
      <g className={spinning ? 'ring-spin' : undefined}>
        <path d={RING} fill="none" stroke="currentColor" strokeWidth={RING_WIDTH + 0.6} strokeLinecap="round" />
      </g>
      <circle cx={DOT.cx} cy={DOT.cy} r={DOT.r + 0.4} fill="#f0c35a" />
    </svg>
  )
}
