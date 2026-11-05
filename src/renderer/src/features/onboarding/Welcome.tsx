/**
 * Paso 1 del primer uso: la bienvenida. Solo saluda (animación de marca, «Hecho por …») y dice en una frase qué viene: preparar el equipo
 * y conectar la IA. No revisa ni descarga nada: la lista de piezas con sus casillas vive en UNA sola pantalla («Preparando», paso 2) y
 * el asistente de conectar la IA es el paso 3. Así se ve una sola cosa a la vez y la misma lista no aparece tres veces.
 */
import { useEffect, useRef } from 'react'
import { DISPLAY_NAME, MADE_BY } from '@shared/brand'
import { Button } from '../../components/Button'
import { LogoMark } from '../../components/Logo'
import { useT } from '../../lib/i18n'

export function Welcome({ onDone }: { onDone: () => void }): React.JSX.Element {
  const t = useT()
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-bg p-4" data-testid="welcome-screen">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        data-testid="welcome"
        className="relative my-auto flex w-full max-w-md flex-col items-center text-center"
      >
        <div className="relative mb-6 flex h-32 w-32 items-center justify-center">
          <div
            aria-hidden
            className="welcome-glow absolute -inset-5 rounded-full"
            style={{ background: 'radial-gradient(closest-side, hsl(222 85% 62% / 0.55), transparent 70%)' }}
          />
          <div className="welcome-logo relative">
            <LogoMark size={92} variant="tile" animated={false} />
          </div>
        </div>
        <h1
          id="welcome-title"
          ref={titleRef}
          tabIndex={-1}
          className="welcome-rise font-display text-[28px] leading-8 font-semibold tracking-[-0.02em] outline-none"
          style={{ ['--d' as string]: '350ms' }}
        >
          {t('wizard.welcome.title', { app: DISPLAY_NAME })}
        </h1>
        <p className="welcome-rise mt-2 max-w-sm text-[14px] leading-5 text-muted" style={{ ['--d' as string]: '550ms' }}>
          {t('wizard.welcome.tagline')}
        </p>
        <p
          className="welcome-rise mt-3 text-[11.5px] desk:text-meta font-medium tracking-[0.18em] text-subtle uppercase"
          style={{ ['--d' as string]: '750ms' }}
        >
          {t('wizard.welcome.madeBy', { maker: MADE_BY })}
        </p>
        <p className="welcome-rise mt-8 max-w-sm text-[13px] leading-[18px] text-muted" style={{ ['--d' as string]: '1000ms' }}>
          {t('wizard.welcome.greetingNote')}
        </p>
        <div className="welcome-rise mt-6 flex w-full justify-center" style={{ ['--d' as string]: '1200ms' }}>
          <Button variant="primary" onClick={onDone}>
            {t('wizard.welcome.start')}
          </Button>
        </div>
      </section>
    </div>
  )
}
