/**
 * Puerta de la revisión de arranque (en el primer uso es el paso 2 de 3: bienvenida → preparar el equipo → conectar la IA). En CADA arranque pide a main `preflight:run` (solo local, sin red) antes de enseñar la app:
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
import { PREFLIGHT_OPEN_EVENT } from './preflight-open'
import { AutoInstallPill } from './AutoInstallPill'
import {
  autoAttempted,
  autoBusy,
  autoPhase,
  clearAutoIfIdle,
  markAutoBlocked,
  resetAutoInstall,
  startAutoInstall,
  useAutoInstall
} from './auto-install'

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
 * Instala sola, en segundo plano, lo instalable que falte (ArtCraft, Node.js y uv, entorno aislado de Windows): sin pantalla ni casillas.
 * No descarga sin conexión ni si no alcanza el disco (regla `DISK_FACTOR`); entonces solo deja el aviso discreto. `after` vuelve a revisar.
 */
function maybeStartAuto(r: PreflightReport, alive: () => boolean, after: () => void): void {
  const plan = autoInstallPlan(r).filter((c) => !autoAttempted().has(c.id))
  if (plan.length === 0) return clearAutoIfIdle()
  const ph = autoPhase()
  if (ph === 'running' || ph === 'waiting' || ph === 'failed') return
  const ids = plan.map((c) => c.id)
  if (!autoDiskEnough(r, plan)) return markAutoBlocked('nodisk', ids)
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return markAutoBlocked('offline', ids)
  void startAutoInstall(ids, {
    api: buildInstallApi(alive),
    online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    wait: (ms) => new Promise((res) => setTimeout(res, ms))
  }).then(() => alive() && after())
}

export function PreflightGate({ children }: { children?: React.ReactNode }): React.JSX.Element {
  const t = useT()
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
    const r = await fetchReport()
    if (!alive.current) return
    if (!r) return setPhase('clear')
    setReport(r)
    // Lo instalable lo instala la app sola, en segundo plano; la pantalla solo enseña lo que exige a una persona (permisos, firma, motor…).
    // Abierta a pedido desde Ajustes (`forced`) enseña todo, con sus casillas, como siempre.
    maybeStartAuto(
      r,
      () => alive.current,
      () => void check()
    )
    const v = forced.current ? r : screenReport(r)
    const show = forced.current || shouldShow(v, readDismissed())
    // Recorrido guiado: al terminar «Instalar» se pasa solo a «Permisos» (si hay) y, sin nada que hacer en una etapa, se salta.
    setStage((cur) => {
      if (cur === 'install' && !installStageNeeded(v) && permsStageNeeded(v)) return 'perms'
      return cur
    })
    setPhase(show ? 'show' : 'clear')
  }, [])

  const retryAuto = useCallback((): void => {
    resetAutoInstall()
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
      const ids = autoBusy(useAutoInstall.getState()) ? wanted.filter((id) => !AUTO_INSTALL_IDS.includes(id)) : wanted
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
    void install(acceptAllPlan(forced.current ? report : screenReport(report)).map((c) => c.id))
  }, [report, install])

  const proceed = useCallback((): void => {
    // De «Instalar» a «Permisos» (solo macOS y si falta alguno); de «Permisos» —o sin permisos— se sale.
    if (guided && stage === 'install' && report && permsStageNeeded(report)) {
      setStage('perms')
      return
    }
    forced.current = false
    if (report) saveDismissed(forced.current ? report : screenReport(report))
    setPhase('clear')
  }, [report, guided, stage])

  const total = report ? firstRunTotal(report) : 3
  const stepLabel = firstRun
    ? t(stage === 'perms' ? 'preflight.step.perms' : 'preflight.step.install', { n: stage === 'perms' ? 3 : 2, total })
    : undefined
  const pill = <AutoInstallPill onRetry={retryAuto} />
  if (phase === 'clear')
    return (
      <>
        {children}
        {pill}
      </>
    )
  if (phase === 'checking' || !report)
    return <div className="fixed inset-0 z-[60] bg-bg" aria-busy="true" data-testid="preflight-checking" />
  return (
    <>
      <PreflightScreen
        report={forced.current ? report : screenReport(report)}
        runtime={runtime}
        installing={installing}
        details={details}
        copied={copied}
        permsStalled={permsStalled}
        permsWaiting={permsWaiting}
        unchecked={unchecked}
        stage={guided ? stage : undefined}
        stepLabel={guided ? stepLabel : undefined}
        onAcceptAll={guided ? acceptAll : undefined}
        custom={custom}
        onCustom={() => setCustom((c) => !c)}
        progress={{
          total: batch.length,
          done: done.length,
          pct: Object.values(runtime).find((r) => r?.state === 'downloading')?.pct ?? null
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
