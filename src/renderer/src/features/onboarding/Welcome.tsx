/**
 * Bienvenida del primer uso: animación de marca («Hecho por …»), revisión de lo que ya hay en el equipo y preparación de lo que falta
 * (ArtCraft, el diseñador de documentos, y el entorno aislado de Tareas en Windows).
 * Si todo está bien, solo se ve un saludo de una frase y «Empezar»; la lista de chequeos aparece únicamente cuando algo requiere
 * atención (falta el motor, hay algo por descargar o algo falló). Con algo por descargar la persona ve la lista con los tamaños y una
 * botón «Instalar lo que falta»; nada se descarga sin que la persona lo pida. Los permisos de macOS ya no se piden aquí: se piden al usar «Control total».
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
import { installFailureCode, officeErrorKey } from '../settings/impl/component-install'
import { runtimesApi, runtimesErrorKey, runtimesPct } from '../settings/impl/runtimes-view'
import {
  WELCOME_ORDER,
  canRetry,
  engineState,
  toInstall,
  welcomeOverall,
  welcomeView,
  type WelcomeItemId,
  type WelcomeItemState,
  type WelcomeItems
} from './welcome-plan'

/** Sondeos (cada 1,5 s) que se esperan al entorno aislado: ~45 min como máximo. */
const SANDBOX_WAIT_POLLS = 1800

export function Welcome({ info, onDone }: { info: OpencodeInfo | null; onDone: () => void }): React.JSX.Element {
  const t = useT()
  const caps = platformCaps()
  const [found, setFound] = useState<WelcomeItems>({})
  const [craftMb, setCraftMb] = useState(0)
  const [craftError, setCraftError] = useState<string | undefined>()
  const [runtimesMb, setRuntimesMb] = useState(0)
  const [runtimesError, setRuntimesError] = useState<string | undefined>()
  const [pct, setPct] = useState<number | null>(null)
  /** La revisión del equipo terminó (hasta entonces el saludo dice «Revisando…» y «Empezar» espera). */
  const [scanned, setScanned] = useState(false)
  /** Una vez que algo requirió atención la lista se queda (no vuelve al saludo a mitad de una descarga). */
  const [sawAttention, setSawAttention] = useState(false)
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
      if (!hasTasksBridge()) {
        if (alive.current) setScanned(true)
        return
      }
      const o = await cw('craft:status').catch(() => null)
      if (o?.status.state === 'missing') {
        if (alive.current) setCraftMb(Math.round(o.status.sizeBytes / 1e6))
        set('craft', 'pending')
      } else if (o?.status.state === 'installed') set('craft', 'ready')
      // Node.js y uv (conectores locales): solo donde hay conectores locales.
      const rs = await runtimesApi.status().catch(() => null)
      if (rs?.offered) {
        if (alive.current) setRuntimesMb(Math.round(rs.missingBytes / 1e6))
        set('runtimes', rs.ready ? 'ready' : 'pending')
      }
      if (caps.tasks && caps.tasksSandbox === 'wsl') {
        const s = await cw('tasks:sandbox:status', undefined).catch(() => null)
        if (s) set('sandbox', s.state === 'ready' ? 'ready' : 'pending')
      }
      if (alive.current) setScanned(true)
    })()
  }, [caps.tasks, caps.tasksSandbox, set])

  // 2) Preparar lo que falta, en orden.
  const install = useCallback(
    async (ids: WelcomeItemId[]): Promise<void> => {
      for (const id of ids) {
        set(id, 'downloading')
        if (id === 'craft') {
          // El progreso real de la descarga (main lo expone en `craft:status`) se muestra como porcentaje.
          const poll = setInterval(() => {
            void cw('craft:status')
              .then((s) => {
                const total = s.progress?.total ?? 0
                if (alive.current)
                  setPct(s.installing && total > 0 ? Math.min(100, Math.round(((s.progress?.done ?? 0) / total) * 100)) : null)
              })
              .catch(() => undefined)
          }, 1000)
          const r = await cw('craft:install').catch(() => undefined)
          clearInterval(poll)
          if (alive.current) {
            setPct(null)
            setCraftError(installFailureCode(r))
          }
          set('craft', r?.ok ? 'ready' : 'failed')
        } else if (id === 'runtimes') {
          const poll = setInterval(() => {
            void runtimesApi
              .status()
              .then((s) => alive.current && setPct(runtimesPct(s)))
              .catch(() => undefined)
          }, 1000)
          const r = await runtimesApi.install().catch(() => undefined)
          clearInterval(poll)
          if (alive.current) {
            setPct(null)
            setRuntimesError(installFailureCode(r))
          }
          set('runtimes', r?.ok ? 'ready' : 'failed')
        } else if (id === 'sandbox') {
          const poll = setInterval(() => {
            void cw('tasks:sandbox:status', undefined)
              .then((s) => alive.current && setPct(s.setup?.running ? s.setup.pct : null))
              .catch(() => undefined)
          }, 1500)
          // `tasks:sandbox:setup` devuelve al EMPEZAR: se espera sondeando el estado hasta que la instalación termine de verdad
          // (antes se daba por fallida nada más llamar, aunque siguiera instalándose bien por detrás).
          let s = await cw('tasks:sandbox:setup').catch(() => null)
          for (let i = 0; i < SANDBOX_WAIT_POLLS && alive.current; i++) {
            const st = await cw('tasks:sandbox:status', undefined).catch(() => null)
            if (st && !st.setup?.running) {
              s = st
              break
            }
            await new Promise((res) => setTimeout(res, 1500))
          }
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
    void install(toInstall(found))
  }, [found, install])

  const retry = (): void => {
    const failed = WELCOME_ORDER.filter((id) => id !== 'engine' && items[id] === 'failed')
    failed.forEach((id) => set(id, 'pending'))
    void install(failed)
  }

  // Nada se descarga solo: si hay algo por descargar, la persona lo inicia con el botón (o sigue sin instalarlo).
  const pending = toInstall(items)
  const countingDown = !started.current && pending.length > 0

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
  if (found.craft)
    rows.push({
      id: 'craft',
      label: t('wizard.setup.craft'),
      // Si falló, se muestra el MOTIVO (sin conexión, hash, firma, disco…) en vez de solo «No se pudo».
      hint:
        found.craft === 'ready'
          ? t('wizard.setup.status.ready')
          : found.craft === 'failed' && craftError
            ? t(officeErrorKey(craftError))
            : t('wizard.setup.craft.hint', { mb: craftMb })
    })
  if (found.runtimes)
    rows.push({
      id: 'runtimes',
      label: t('wizard.setup.runtimes'),
      hint:
        found.runtimes === 'ready'
          ? t('wizard.setup.status.ready')
          : found.runtimes === 'failed' && runtimesError
            ? `${t(runtimesErrorKey(runtimesError))} ${t('wizard.setup.runtimes.retryHint')}`
            : t('wizard.setup.runtimes.hint', { mb: runtimesMb })
    })
  if (found.sandbox)
    rows.push({
      id: 'sandbox',
      label: t('wizard.setup.sandbox'),
      hint: found.sandbox === 'ready' ? t('wizard.setup.status.ready') : t('wizard.setup.sandbox.hint')
    })

  const stateText = (id: WelcomeItemId, st: WelcomeItemState): string => {
    if (id === 'engine' && st === 'failed') return t('wizard.welcome.state.missing')
    if (st === 'downloading')
      return (id === 'sandbox' || id === 'craft' || id === 'runtimes') && pct !== null
        ? t('wizard.welcome.progress', { pct })
        : t('wizard.welcome.state.downloading')
    return t(`wizard.welcome.state.${st}` as const)
  }

  const view = welcomeView(items, scanned)
  useEffect(() => {
    if (view === 'attention') setSawAttention(true)
  }, [view])
  // Con algo que requirió atención se queda la lista (aunque luego todo quede listo); si no, solo el saludo.
  const showList = view === 'attention' || sawAttention

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
        data-testid="welcome"
        data-view={showList ? 'attention' : view}
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
          className="welcome-rise mt-3 text-[11.5px] desk:text-meta font-medium tracking-[0.18em] text-subtle uppercase"
          style={{ ['--d' as string]: '750ms' }}
        >
          {t('wizard.welcome.madeBy', { maker: MADE_BY })}
        </p>

        {showList ? (
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
        ) : (
          <p className="welcome-rise mt-8 flex min-h-5 items-center gap-2 text-[13px] text-muted" style={{ ['--d' as string]: '1000ms' }}>
            {view === 'checking' ? (
              <span role="status" aria-live="polite" className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin text-accent" /> {t('wizard.welcome.checking')}
              </span>
            ) : (
              <span>{t('wizard.welcome.greetingNote')}</span>
            )}
          </p>
        )}

        <div
          className={`welcome-rise mt-6 flex w-full items-center gap-2 ${showList ? 'justify-between' : 'justify-center'}`}
          style={{ ['--d' as string]: '1200ms' }}
        >
          {showList && (
            <Button variant="ghost" onClick={onDone}>
              {t('wizard.welcome.skip')}
            </Button>
          )}
          <div className="flex items-center gap-2">
            {showList && countingDown && (
              <Button variant="secondary" onClick={startNow}>
                {t('wizard.setup.run')}
              </Button>
            )}
            {showList && canRetry(items) && overall === 'failed' && (
              <Button variant="secondary" onClick={retry}>
                {t('wizard.welcome.retry')}
              </Button>
            )}
            {showList ? (
              <Button variant="primary" onClick={onDone}>
                {t('wizard.welcome.continue')}
              </Button>
            ) : (
              <Button variant="primary" disabled={view === 'checking'} onClick={onDone}>
                {t('wizard.welcome.start')}
              </Button>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
