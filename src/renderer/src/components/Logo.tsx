import { useId } from 'react'
import { DISPLAY_NAME } from '@shared/brand'

/**
 * Identidad visual (independiente del nombre): una gema azul de 4 facetas con puntas redondeadas
 * sobre un cuadrado blanco suave. El wordmark se dibuja siempre desde DISPLAY_NAME.
 * Geometría compartida con build/icon.svg y el icono de bandeja.
 */

/**
 * Aro del indicador «trabajando» (Spark): un anillo abierto y un punto dorado en el hueco, como una luz encendida.
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
  const gemClip = `gem-${uid}`
  const tile = variant === 'tile'
  const mono = variant === 'mono'

  // Gema "B" de 4 facetas con puntas redondeadas, dibujada en 130 unidades (como build/icon.svg) y escalada al lienzo de 32.
  const k = tile ? 32 / 130 : 0.371
  const faces = mono ? ['0.55', '0.8', '0.9', '1'] : null
  const fill = (i: number, c: string): { fill: string; fillOpacity?: string } =>
    faces ? { fill: 'currentColor', fillOpacity: faces[i] } : { fill: c }
  const mark = (
    <g transform={`translate(16 16) scale(${k}) translate(-65 -65)`} className={animated ? 'ring-spin' : undefined}>
      <defs>
        <clipPath id={gemClip}>
          <rect x="44" y="44" width="42" height="42" rx="6" transform="rotate(45 65 65)" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${gemClip})`}>
        <path d="M65 30 L65 65 L30 65 Z" {...fill(0, '#6b86f5')} />
        <path d="M65 30 L100 65 L65 65 Z" {...fill(1, '#4a6cf0')} />
        <path d="M30 65 L65 65 L65 100 Z" {...fill(2, '#2b4fd6')} />
        <path d="M65 65 L100 65 L65 100 Z" {...fill(3, '#1a2a7a')} />
      </g>
    </g>
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
              <stop offset="0" stopColor="#6b86f0" />
              <stop offset="0.5" stopColor="#3556dc" />
              <stop offset="1" stopColor="#1d2a85" />
            </linearGradient>
          </defs>
          <rect width="32" height="32" rx="6.9" fill={`url(#${bg})`} />
          <rect x="4.7" y="4.7" width="22.6" height="22.6" rx="6.4" fill="#fff" />
          {mark}
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
