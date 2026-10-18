/**
 * Puerta de la revisión de arranque. En CADA arranque pide a main `preflight:run` (solo local, sin red) antes de enseñar la app:
 *  - todo listo (o revisión omitida): deja pasar de inmediato, sin mostrar nada;
 *  - falta algo esencial: pantalla «Preparando Lazunox» que no se puede omitir, con el botón «Instalar lo que falta»;
 *  - solo avisos no esenciales: la misma pantalla con «Continuar de todos modos» (se recuerda por versión y por pendientes).
 * Si la revisión no responde a tiempo o falla, NO bloquea la app. El asistente de cuentas/modelo (`OnboardingGate`) va detrás.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  dismissalFor,
  installPlan,
  parseDismissal,
  shouldShow,
  type PreflightId,
  type PreflightReport,
  type RuntimeMap
} from '@shared/preflight'
import { call } from '../../lib/api'
import { cw, hasTasksBridge } from '../tasks/impl/bridge'
import { PreflightScreen } from './PreflightScreen'
import { waitForMacPerms } from './perms-wait'
import { runInstall, type InstallApi } from './preflight-run'
import { runtimesApi, runtimesPct } from '../settings/impl/runtimes-view'

/** Plazo máximo de espera de la revisión: pasado, se entra a la app (la revisión nunca debe dejarla bloqueada). */
export const PREFLIGHT_TIMEOUT_MS = 3500
const DISMISS_KEY = 'lazunox.preflight.dismissed'

function readDismissed(): ReturnType<typeof parseDismissal> {
  try {
    return parseDismissal(localStorage.getItem(DISMISS_KEY))
  } catch {
    return null
  }
}

function saveDismissed(report: PreflightReport): void {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(dismissalFor(report)))
  } catch {
    /* sin almacenamiento: volverá a preguntar, nada se rompe */
  }
}

async function fetchReport(): Promise<PreflightReport | null> {
  if (!hasTasksBridge()) return null
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), PREFLIGHT_TIMEOUT_MS))
  return Promise.race([cw('preflight:run').catch(() => null), timeout])
}

type Phase = 'checking' | 'show' | 'clear'

export function PreflightGate({ children }: { children?: React.ReactNode }): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('checking')
  const [report, setReport] = useState<PreflightReport | null>(null)
  const [runtime, setRuntime] = useState<RuntimeMap>({})
  const [installing, setInstalling] = useState(false)
  const [details, setDetails] = useState<Partial<Record<PreflightId, string>>>({})
  const [copied, setCopied] = useState<PreflightId | null>(null)
  const [permsWaiting, setPermsWaiting] = useState(false)
  const [permsStalled, setPermsStalled] = useState(false)
  const alive = useRef(true)
  const started = useRef(false)
  useEffect(
    () => () => {
      alive.current = false
    },
    []
  )

  /** Revisa y decide: mostrar la pantalla o dejar pasar. Con `keepOnClear` (revisión manual) no se cierra sola si no hay nada. */
  const check = useCallback(async (): Promise<void> => {
    const r = await fetchReport()
    if (!alive.current) return
    if (!r) return setPhase('clear')
    setReport(r)
    setPhase(shouldShow(r, readDismissed()) ? 'show' : 'clear')
  }, [])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void check()
  }, [check])

  // Al volver de Ajustes del Sistema se revalida (permisos, ubicación) sin esperar a que la persona pulse nada.
  useEffect(() => {
    if (phase !== 'show') return
    const onFocus = (): void => {
      if (!installing) void check()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [phase, installing, check])

  const install = useCallback(async (): Promise<void> => {
    if (!report || installing) return
    const ids = installPlan(report).map((c) => c.id)
    if (ids.length === 0) return
    setInstalling(true)
    setDetails({})
    const api: InstallApi = {
      craftInstall: () => cw('craft:install').catch(() => undefined),
      craftProgress: async () => {
        const s = await cw('craft:status')
        const total = s.progress?.total ?? 0
        return s.installing && total > 0 ? Math.min(100, Math.round(((s.progress?.done ?? 0) / total) * 100)) : null
      },
      runtimesInstall: () => runtimesApi.install().catch(() => undefined),
      runtimesProgress: async () => runtimesPct(await runtimesApi.status()),
      sandboxSetup: () => cw('tasks:sandbox:setup'),
      sandboxStatus: () => cw('tasks:sandbox:status', { force: true }),
      fail: (id, code, message) =>
        cw('preflight:fail', { id, ...(code ? { code } : {}), ...(message ? { message: message.slice(0, 1000) } : {}) }).catch(() => null),
      sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
      alive: () => alive.current
    }
    await runInstall(ids, api, {
      onRuntime: (id, rt) =>
        alive.current &&
        setRuntime((prev) => {
          const next = { ...prev }
          if (rt) next[id] = rt
          else delete next[id]
          return next
        }),
      onDetail: (id, d) => alive.current && setDetails((prev) => ({ ...prev, [id]: d }))
    })
    if (!alive.current) return
    setInstalling(false)
    await check()
  }, [report, installing, check])

  const recheck = useCallback((): void => {
    setRuntime({})
    setDetails({})
    setPermsStalled(false)
    void check()
  }, [check])

  const grantPerms = useCallback(async (): Promise<void> => {
    setPermsWaiting(true)
    setPermsStalled(false)
    await cw('computer:requestPermissions').catch(() => undefined)
    // Igual que la bienvenida: se espera (~90 s) a que la persona active los permisos; con Accesibilidad y sin Pantalla avisa del reinicio.
    const r = await waitForMacPerms({
      status: () => cw('computer:status').catch(() => null),
      request: () => cw('computer:requestPermissions'),
      report: () => cw('computer:reportPermsStall'),
      sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
      alive: () => alive.current,
      onStage: (st) => {
        if (st === 'restart' && alive.current) void check()
      }
    })
    if (!alive.current) return
    setPermsWaiting(false)
    if (r === 'timeout') setPermsStalled(true)
    await check()
  }, [check])

  const pickEngine = useCallback(async (): Promise<void> => {
    const r = await call('app:pickOpencodeBin').catch(() => null)
    if (r?.status === 'ok') await check()
    else
      await call('opencode:restart').then(
        () => check(),
        () => check()
      )
  }, [check])

  const copy = useCallback(
    (id: PreflightId): void => {
      const text = details[id]
      if (!text) return
      void navigator.clipboard
        .writeText(text)
        .then(() => {
          setCopied(id)
          setTimeout(() => alive.current && setCopied(null), 2500)
        })
        .catch(() => undefined)
    },
    [details]
  )

  const proceed = useCallback((): void => {
    if (report) saveDismissed(report)
    setPhase('clear')
  }, [report])

  if (phase === 'clear') return <>{children}</>
  if (phase === 'checking' || !report)
    return <div className="fixed inset-0 z-[60] bg-bg" aria-busy="true" data-testid="preflight-checking" />
  return (
    <PreflightScreen
      report={report}
      runtime={runtime}
      installing={installing}
      details={details}
      copied={copied}
      permsStalled={permsStalled}
      permsWaiting={permsWaiting}
      onInstall={() => void install()}
      onCopy={copy}
      onContinue={proceed}
      onRecheck={recheck}
      onGrantPerms={() => void grantPerms()}
      onPickEngine={() => void pickEngine()}
    />
  )
}
