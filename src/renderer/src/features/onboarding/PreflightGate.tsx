/**
 * Puerta de la revisión de arranque (primer uso: bienvenida → preparar el equipo → permisos pendientes → conectar la IA). En CADA arranque pide a main `preflight:run` (solo local, sin red) antes de enseñar la app:
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
  toggleChecked,
  type PreflightId,
  type PreflightStage,
  acceptAllPlan,
  firstRunTotal,
  installStageNeeded,
  permsStageNeeded,
  type PreflightReport,
  type RuntimeMap,
  UNCHECKED_BY_DEFAULT,
  AUTO_INSTALL_IDS,
  autoDiskEnough,
  autoInstallPlan,
  screenReport
} from '@shared/preflight'
import { call } from '../../lib/api'
import { useSettings } from '../../stores/settings'
import { useT } from '../../lib/i18n'
import { cw, hasTasksBridge } from '../tasks/impl/bridge'
import { PreflightScreen } from './PreflightScreen'
import { waitForMacPerms } from './perms-wait'
import { runInstall, type InstallApi } from './preflight-run'
import { runtimesApi, runtimesPct } from '../settings/impl/runtimes-view'
import { raceReport, type ReportRace } from './preflight-late'
import { PREFLIGHT_OPEN_EVENT } from './preflight-open'
import { AutoInstallPill } from './AutoInstallPill'
import {
  autoCompleted,
  autoBusy,
  autoPhase,
  clearAutoIfIdle,
  markAutoBlocked,
  retryAutoPieces,
  startAutoInstall,
  useAutoInstall
} from './auto-install'

/** Plazo máximo de espera de la revisión: pasado, se entra a la app (la revisión nunca debe dejarla bloqueada). */
export const PREFLIGHT_TIMEOUT_MS = 3500
/** 20 s de comandos WSL + comprobaciones locales posteriores y margen IPC. Solo el primer recorrido espera más. */
export const FIRST_RUN_PREFLIGHT_TIMEOUT_MS = 30_000
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

/** Pide el informe con plazo. Si vence, `late` sigue esperando ese mismo pedido (ver `preflight-late.ts`). */
async function fetchReport(firstRun: boolean): Promise<ReportRace<PreflightReport>> {
  if (!hasTasksBridge()) return { report: null, timedOut: false, late: Promise.resolve(null) }
  return raceReport(cw('preflight:run'), firstRun ? FIRST_RUN_PREFLIGHT_TIMEOUT_MS : PREFLIGHT_TIMEOUT_MS)
}

type Phase = 'checking' | 'show' | 'clear'

/** Las llamadas reales de instalación (las mismas para la pantalla y para la instalación automática en segundo plano). */
function buildInstallApi(alive: () => boolean): InstallApi {
  return {
    craftInstall: () => cw('craft:install').catch(() => undefined),
    craftProgress: async () => {
      const s = await cw('craft:status')
      const total = s.progress?.total ?? 0
      return s.installing && total > 0 ? Math.min(100, Math.round(((s.progress?.done ?? 0) / total) * 100)) : null
    },
    runtimesInstall: () => runtimesApi.install().catch(() => undefined),
    runtimesProgress: async () => runtimesPct(await runtimesApi.status()),
    trustInstall: () => cw('preflight:trust').catch(() => undefined),
    sandboxSetup: () => cw('tasks:sandbox:setup'),
    sandboxStatus: () => cw('tasks:sandbox:status', { force: true }),
    fail: (id, code, message) =>
      cw('preflight:fail', { id, ...(code ? { code } : {}), ...(message ? { message: message.slice(0, 1000) } : {}) }).catch(() => null),
    sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
    alive
  }
}

/**
 * Instala sola lo instalable que falte (ArtCraft, Node.js y uv, entorno aislado de Windows); la pantalla y el aviso comparten su avance.
 * No descarga sin conexión ni si no alcanza el disco (regla `DISK_FACTOR`); entonces solo deja el aviso discreto. `after` vuelve a revisar.
 */
function maybeStartAuto(r: PreflightReport, alive: () => boolean, after: () => void): void {
  const failed = useAutoInstall.getState().failed
  const plan = autoInstallPlan(r).filter((c) => !autoCompleted().has(c.id) && !failed[c.id])
  if (plan.length === 0) return clearAutoIfIdle()
  const ph = autoPhase()
  if (ph === 'running' || ph === 'waiting') return
  const ids = plan.map((c) => c.id)
  if (!autoDiskEnough(r, plan)) return markAutoBlocked('nodisk', ids)
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return markAutoBlocked('offline', ids)
  void startAutoInstall(ids, {
    api: buildInstallApi(alive),
    online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    wait: (ms) => new Promise((res) => setTimeout(res, ms))
  }).then(() => alive() && after())
}

export function PreflightGate({
  children,
  welcome
}: {
  children?: React.ReactNode | ((total: number) => React.ReactNode)
  welcome?: (total: number) => React.ReactNode
}): React.JSX.Element {
  const t = useT()
  const auto = useAutoInstall()
  // Se fija con la primera revisión: conceder permisos después no renumera pantallas ya vistas.
  const firstTotal = useRef<number | null>(null)
  const welcoming = Boolean(welcome)
  const [phase, setPhase] = useState<Phase>('checking')
  const [report, setReport] = useState<PreflightReport | null>(null)
  const [runtime, setRuntime] = useState<RuntimeMap>({})
  const [installing, setInstalling] = useState(false)
  /** Casillas desmarcadas: lo recomendado nace marcado y lo opcional (`UNCHECKED_BY_DEFAULT`) desmarcado; la persona elige qué. */
  const [unchecked, setUnchecked] = useState<PreflightId[]>([...UNCHECKED_BY_DEFAULT])
  /** Primer uso (aún sin asistente terminado): la pantalla es un paso del recorrido (instalar y, en Mac, permisos). */
  const firstRun = useSettings((s) => !s.settings.onboarded)
  /** Etapa del recorrido guiado: instalar lo instalable («Aceptar todo e instalar») y, aparte, los permisos de macOS. */
  const [stage, setStage] = useState<PreflightStage>('install')
  /** «Elegir qué instalar»: muestra las casillas en lugar del botón único. */
  const [custom, setCustom] = useState(false)
  /** Piezas de la tanda en curso y las ya terminadas (barra de avance general). */
  const [batch, setBatch] = useState<PreflightId[]>([])
  const [done, setDone] = useState<PreflightId[]>([])
  const [details, setDetails] = useState<Partial<Record<PreflightId, string>>>({})
  const [copied, setCopied] = useState<PreflightId | null>(null)
  const [permsWaiting, setPermsWaiting] = useState(false)
  const [permsStalled, setPermsStalled] = useState(false)
  const alive = useRef(true)
  const started = useRef(false)
  /** Abierta a pedido desde Ajustes: no se cierra sola aunque «Más tarde» ya se hubiera elegido; se cierra con «Continuar». */
  const forced = useRef(false)
  const continued = useRef(false)
  const presented = useRef(false)
  const initialFirstRun = useRef(firstRun)
  // Se vuelve a marcar vivo al montar: con StrictMode (desarrollo) React monta, desmonta y monta de nuevo el mismo componente, y sin esto la
  // primera revisión se descartaba (`alive` quedaba en false) y la pantalla se quedaba en «checking» para siempre.
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  /** Revisa y decide: mostrar la pantalla o dejar pasar. Con `keepOnClear` (revisión manual) no se cierra sola si no hay nada. */
  const check = useCallback(async (): Promise<void> => {
    const race = await fetchReport(initialFirstRun.current)
    if (!alive.current) return
    const present = (r: PreflightReport): void => {
      if (!alive.current) return
      const current = { ...r, components: r.components.map((c) => (autoCompleted().has(c.id) ? { ...c, ok: true } : c)) }
      setReport(r)
      // Si venció la revisión inicial, el informe tardío permite descargar sin retroceder en el recorrido ya anunciado.
      if (initialFirstRun.current && firstTotal.current === 2 && !forced.current) return
      firstTotal.current ??= firstRunTotal(r)
      const v = screenReport(current, true)
      const autoMissing = !v.skipped && v.components.some((c) => AUTO_INSTALL_IDS.includes(c.id) && !c.ok)
      const show =
        forced.current ||
        (!continued.current &&
          ((!v.skipped && initialFirstRun.current) || presented.current || autoMissing || shouldShow(screenReport(v), readDismissed())))
      setStage((cur) => {
        if (!initialFirstRun.current && cur === 'install' && !installStageNeeded(v) && permsStageNeeded(v)) return 'perms'
        return cur
      })
      presented.current = Boolean(show)
      setPhase(show ? 'show' : 'clear')
    }
    if (race.report) present(race.report)
    else {
      // Un fallo al revisar de nuevo no salta etapas que ya se anunciaron.
      if (firstTotal.current === null) {
        firstTotal.current = firstRunTotal(null)
        setPhase('clear')
      }
      if (race.timedOut) void race.late.then((r) => r && present(r))
    }
  }, [])

  useEffect(() => {
    if (!report || welcoming) return
    const current = { ...report, components: report.components.map((c) => (autoCompleted().has(c.id) ? { ...c, ok: true } : c)) }
    maybeStartAuto(
      current,
      () => alive.current,
      () => void check()
    )
  }, [report, welcoming, check])

  const retryAuto = useCallback((): void => {
    retryAutoPieces(AUTO_INSTALL_IDS)
    void check()
  }, [check])

  // Al volver internet se retoma la instalación que esperaba conexión.
  useEffect(() => {
    const onOnline = (): void => {
      if (autoPhase() === 'offline') void check()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [check])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void check()
  }, [check])

  // «Instalar o activar piezas» (Ajustes › Diagnóstico) vuelve a abrir la lista aunque se haya dejado para más tarde.
  useEffect(() => {
    const onOpen = (): void => {
      forced.current = true
      setStage('install')
      setCustom(false)
      void check()
    }
    window.addEventListener(PREFLIGHT_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(PREFLIGHT_OPEN_EVENT, onOpen)
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

  const install = useCallback(
    async (only?: PreflightId[]): Promise<void> => {
      if (!report || installing) return
      const wanted = only ?? installPlan(report, unchecked).map((c) => c.id)
      // Lo que la instalación automática tiene en curso no se instala dos veces a la vez.
      const automatic = wanted.filter((id) => AUTO_INSTALL_IDS.includes(id))
      if (automatic.length > 0 && !autoBusy(useAutoInstall.getState())) {
        retryAutoPieces(automatic)
        maybeStartAuto(
          report,
          () => alive.current,
          () => void check()
        )
      }
      const ids = wanted.filter((id) => !AUTO_INSTALL_IDS.includes(id))
      if (ids.length === 0) return
      setInstalling(true)
      setDetails({})
      setBatch(ids)
      setDone([])
      const api = buildInstallApi(() => alive.current)
      await runInstall(ids, api, {
        onRuntime: (id, rt) => {
          if (!alive.current) return
          setRuntime((prev) => {
            const next = { ...prev }
            if (rt) next[id] = rt
            else delete next[id]
            return next
          })
          if (!rt) setDone((d) => (d.includes(id) ? d : [...d, id]))
        },
        onCancelled: (id) => alive.current && setDone((d) => d.filter((x) => x !== id)),
        onDetail: (id, d) => alive.current && setDetails((prev) => ({ ...prev, [id]: d }))
      })
      if (!alive.current) return
      setInstalling(false)
      await check()
    },
    [report, installing, unchecked, check]
  )

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

  const guided = firstRun || forced.current

  /** «Aceptar todo e instalar»: todo lo instalable, sin mirar casillas y sin tocar los permisos (esos tienen su paso). */
  const acceptAll = useCallback((): void => {
    if (!report) return
    void install(acceptAllPlan(report).map((c) => c.id))
  }, [report, install])

  const proceed = useCallback((): void => {
    // De «Instalar» a «Permisos» (solo macOS y si falta alguno); de «Permisos» —o sin permisos— se sale.
    if (guided && stage === 'install' && report && (firstRun && !forced.current ? firstTotal.current === 4 : permsStageNeeded(report))) {
      setStage('perms')
      return
    }
    if (report) saveDismissed(forced.current ? report : screenReport(report))
    forced.current = false
    continued.current = true
    setPhase('clear')
  }, [report, guided, stage, firstRun])

  const total = firstTotal.current ?? firstRunTotal(report)
  const stepLabel =
    firstRun && !forced.current
      ? t(stage === 'perms' ? 'preflight.step.perms' : 'preflight.step.install', { n: stage === 'perms' ? 3 : 2, total })
      : undefined
  const pill = <AutoInstallPill onRetry={retryAuto} />
  if (phase !== 'checking' && welcome) return <>{welcome(total)}</>
  if (phase === 'clear')
    return (
      <>
        {typeof children === 'function' ? children(total) : children}
        {pill}
      </>
    )
  if (phase === 'checking' || !report)
    return <div className="fixed inset-0 z-[60] bg-bg" aria-busy="true" data-testid="preflight-checking" />
  return (
    <>
      <PreflightScreen
        report={
          forced.current
            ? report
            : { ...report, components: report.components.map((c) => (autoCompleted().has(c.id) ? { ...c, ok: true } : c)) }
        }
        runtime={{ ...auto.runtime, ...runtime }}
        automatic={!forced.current}
        backgroundInstalling={autoBusy(auto)}
        installing={installing}
        details={{ ...auto.details, ...details }}
        copied={copied}
        permsStalled={permsStalled}
        permsWaiting={permsWaiting}
        unchecked={unchecked}
        mode={forced.current ? 'manual' : firstRun ? 'firstRun' : 'startup'}
        stage={guided ? stage : undefined}
        stepLabel={guided ? stepLabel : undefined}
        onAcceptAll={guided ? acceptAll : undefined}
        custom={custom}
        onCustom={() => setCustom((c) => !c)}
        progress={{
          total: autoBusy(auto) ? auto.ids.length : batch.length,
          done: autoBusy(auto) ? auto.done.length : done.length,
          pct: autoBusy(auto) ? auto.pct : (Object.values(runtime).find((r) => r?.state === 'downloading')?.pct ?? null)
        }}
        onToggle={(id) => setUnchecked((u) => toggleChecked(u, id))}
        onInstall={(ids) => void install(ids)}
        onCopy={copy}
        onContinue={proceed}
        onRecheck={recheck}
        onGrantPerms={() => void grantPerms()}
        onOpenFullDisk={() => void cw('computer:guideAppAccess', { pane: 'allFiles' }).catch(() => undefined)}
        onPickEngine={() => void pickEngine()}
      />
      {pill}
    </>
  )
}
