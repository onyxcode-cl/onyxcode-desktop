/**
 * Bienvenida del primer uso: animación de marca («Hecho por …»), revisión de lo que ya hay en el equipo y preparación de lo que falta
 * (LibreOffice para ver documentos, el entorno aislado de Tareas en Windows). La persona ve la lista con los tamaños y una cuenta atrás;
 * puede empezar ya u omitirlo. Nada se descarga sin esa cuenta atrás visible. Los permisos de macOS siguen en el último paso del asistente.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Clock, Loader2 } from 'lucide-react'
import { DISPLAY_NAME, MADE_BY } from '@shared/brand'
import type { OpencodeInfo } from '@shared/types'
import { Button } from '../../components/Button'
import { LogoMark } from '../../components/Logo'
import { useT } from '../../lib/i18n'
import { platformCaps } from '../../lib/platform'
import { cw, hasTasksBridge } from '../tasks/impl/bridge'
import {
  WELCOME_COUNTDOWN_S,
  WELCOME_ORDER,
  canRetry,
  engineState,
  toInstall,
  welcomeOverall,
  type WelcomeItemId,
  type WelcomeItemState,
  type WelcomeItems
} from './welcome-plan'

export function Welcome({ info, onDone }: { info: OpencodeInfo | null; onDone: () => void }): React.JSX.Element {
  const t = useT()
  const caps = platformCaps()
  const [found, setFound] = useState<WelcomeItems>({})
  const [officeMb, setOfficeMb] = useState(0)
  const [pct, setPct] = useState<number | null>(null)
  const [left, setLeft] = useState<number | null>(null)
  const checked = useRef(false)
  const started = useRef(false)
  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
    },
    []
  )

  const items: WelcomeItems = { ...found, engine: engineState(info === null ? null : info.found) }
  const overall = welcomeOverall(items)
  const set = useCallback((id: WelcomeItemId, st: WelcomeItemState): void => {
    if (alive.current) setFound((p) => ({ ...p, [id]: st }))
  }, [])

  // 1) Revisar qué hay ya en el equipo.
  useEffect(() => {
    if (checked.current) return
    checked.current = true
    void (async () => {
      if (!hasTasksBridge()) return
      const o = await cw('office:status').catch(() => null)
      if (o?.status.state === 'missing') {
        if (alive.current) setOfficeMb(Math.round(o.status.sizeBytes / 1e6))
        set('office', 'pending')
      } else if (o?.status.state === 'installed') set('office', 'ready')
      if (caps.tasks && caps.tasksSandbox === 'wsl') {
        const s = await cw('tasks:sandbox:status', undefined).catch(() => null)
        if (s) set('sandbox', s.state === 'ready' ? 'ready' : 'pending')
      }
    })()
  }, [caps.tasks, caps.tasksSandbox, set])

  // 2) Preparar lo que falta, en orden.
  const install = useCallback(
    async (ids: WelcomeItemId[]): Promise<void> => {
      for (const id of ids) {
        set(id, 'downloading')
        if (id === 'office') {
          const r = await cw('office:install').catch(() => ({ ok: false as const }))
          set('office', r.ok ? 'ready' : 'failed')
        } else if (id === 'sandbox') {
          const poll = setInterval(() => {
            void cw('tasks:sandbox:status', undefined)
              .then((s) => alive.current && setPct(s.setup?.running ? s.setup.pct : null))
              .catch(() => undefined)
          }, 1500)
          const s = await cw('tasks:sandbox:setup').catch(() => null)
          clearInterval(poll)
          if (alive.current) setPct(null)
          set('sandbox', s?.state === 'ready' ? 'ready' : 'failed')
        }
      }
    },
    [set]
  )

  const startNow = useCallback((): void => {
    if (started.current) return
    started.current = true
    setLeft(null)
    void install(toInstall(found))
  }, [found, install])

  const retry = (): void => {
    const failed = WELCOME_ORDER.filter((id) => id !== 'engine' && items[id] === 'failed')
    failed.forEach((id) => set(id, 'pending'))
    void install(failed)
  }

  // Cuenta atrás visible: solo corre si hay algo que descargar y aún no se empezó.
  const pending = toInstall(items)
  const countingDown = !started.current && pending.length > 0
  useEffect(() => {
    if (!countingDown) {
      setLeft(null)
      return
    }
    setLeft((l) => l ?? WELCOME_COUNTDOWN_S)
    const id = setInterval(() => setLeft((l) => (l === null ? l : Math.max(0, l - 1))), 1000)
    return () => clearInterval(id)
  }, [countingDown])
  useEffect(() => {
    if (left === 0) startNow()
  }, [left, startNow])

  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true })
  }, [])

  const rows: Array<{ id: WelcomeItemId; label: string; hint: string }> = [
    {
      id: 'engine',
      label: t('wizard.welcome.engine'),
      hint: items.engine === 'ready' ? t('wizard.welcome.engine.ok') : t('wizard.welcome.engine.missing')
    }
  ]
  if (found.office) rows.push({ id: 'office', label: t('wizard.setup.office'), hint: t('wizard.setup.office.hint', { mb: officeMb }) })
  if (found.sandbox) rows.push({ id: 'sandbox', label: t('wizard.setup.sandbox'), hint: t('wizard.setup.sandbox.hint') })

  const stateText = (id: WelcomeItemId, st: WelcomeItemState): string => {
    if (st === 'downloading')
      return id === 'sandbox' && pct !== null ? t('wizard.welcome.progress', { pct }) : t('wizard.welcome.state.downloading')
    return t(`wizard.welcome.state.${st}` as const)
  }

  const headline =
    overall === 'ready'
      ? t('wizard.welcome.allReady')
      : overall === 'failed'
        ? canRetry(items)
          ? t('wizard.welcome.someFailed')
          : t('wizard.welcome.reviewed')
        : started.current
          ? t('wizard.welcome.preparing')
          : t('wizard.welcome.checking')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-bg p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        className="relative flex w-full max-w-md flex-col items-center text-center"
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
          className="welcome-rise mt-3 text-[11.5px] font-medium tracking-[0.18em] text-subtle uppercase"
          style={{ ['--d' as string]: '750ms' }}
        >
          {t('wizard.welcome.madeBy', { maker: MADE_BY })}
        </p>

        <div className="welcome-rise mt-8 w-full text-left" style={{ ['--d' as string]: '1000ms' }}>
          <p className="mb-2 text-[13px] text-muted" role="status" aria-live="polite">
            {headline}
          </p>
          <ul className="space-y-2">
            {rows.map((r) => {
              const st = items[r.id] ?? 'checking'
              return (
                <li key={r.id} className="flex items-start gap-3 rounded-ctl bg-inset px-3.5 py-3">
                  <span className="mt-0.5 shrink-0">
                    {st === 'ready' ? (
                      <Check size={16} className="text-success" />
                    ) : st === 'downloading' || st === 'checking' ? (
                      <Loader2 size={16} className="animate-spin text-accent" />
                    ) : st === 'failed' ? (
                      <AlertTriangle size={16} className="text-warning" />
                    ) : (
                      <Clock size={16} className="text-subtle" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1 text-[13px] leading-[18px]">
                    <p className="font-medium text-fg">{r.label}</p>
                    <p className="text-muted">{r.hint}</p>
                  </div>
                  <span className="shrink-0 pt-0.5 text-[12px] text-muted">{stateText(r.id, st)}</span>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="welcome-rise mt-6 flex w-full items-center justify-between gap-2" style={{ ['--d' as string]: '1200ms' }}>
          <Button variant="ghost" onClick={onDone}>
            {t('wizard.welcome.skip')}
          </Button>
          <div className="flex items-center gap-2">
            {countingDown && (
              <Button variant="secondary" onClick={startNow}>
                {left === null ? t('wizard.setup.run') : `${t('wizard.setup.run')} (${left})`}
              </Button>
            )}
            {canRetry(items) && overall === 'failed' && (
              <Button variant="secondary" onClick={retry}>
                {t('wizard.welcome.retry')}
              </Button>
            )}
            <Button variant="primary" onClick={onDone} disabled={overall === 'working' && started.current}>
              {t('wizard.welcome.continue')}
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
