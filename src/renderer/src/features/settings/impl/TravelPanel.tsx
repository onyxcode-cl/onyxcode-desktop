/**
 * Ajustes › Celular › «Modo viaje (sin cuenta), experimental»: explicación honesta, duración del enlace, estado del túnel y motivos
 * de bloqueo. Vista pura (sin llamadas IPC): `RemoteSection` le pasa el estado y los manejadores. La lógica de «consentimiento antes de
 * descargar» vive en `activateTravelFlow`, que se prueba aparte.
 */
import { Loader2, TriangleAlert } from 'lucide-react'
import type { MsgKey, Params } from '@shared/i18n'
import type { RemoteState } from '@shared/ipc-remote'
import {
  TRAVEL_KEEPS,
  type TravelBlocked,
  type TravelError,
  type TravelInstallResult,
  type TravelKeep,
  type TravelStatus
} from '@shared/remote/travel'
import { Badge, Card, Row, Select, SubTitle } from './ui'

type T = (key: MsgKey, params?: Params) => string

const KEEP_HOURS: Record<TravelKeep, number | null> = { idle30: null, h4: 4, h12: 12, h24: 24 }
const KEEP_KEYS = {
  idle30: 'remote.travel.keep.idle30',
  h4: 'remote.travel.keep.h4',
  h12: 'remote.travel.keep.h12',
  h24: 'remote.travel.keep.h24'
} as const satisfies Record<TravelKeep, MsgKey>

const STATUS_KEYS = {
  idle: 'remote.travel.status.idle',
  downloading: 'remote.travel.status.downloading',
  starting: 'remote.travel.status.starting',
  checking: 'remote.travel.status.checking',
  online: 'remote.travel.status.online',
  connecting: 'remote.travel.status.connecting',
  retrying: 'remote.travel.status.retrying',
  failed: 'remote.travel.status.failed'
} as const satisfies Record<TravelStatus, MsgKey>

const ERROR_KEYS: Record<Exclude<TravelError, `exited:${number}`>, MsgKey> = {
  rate: 'remote.travel.error.rate',
  'edge-unreachable': 'remote.travel.error.edge-unreachable',
  'config-conflict': 'remote.travel.error.config-conflict',
  timeout: 'remote.travel.error.timeout',
  'bad-url': 'remote.travel.error.bad-url',
  unreachable: 'remote.travel.error.unreachable',
  'site-mismatch': 'remote.travel.error.site-mismatch',
  'no-binary': 'remote.travel.error.no-binary',
  download: 'remote.travel.error.download'
}

const INSTALL_KEYS: Record<string, MsgKey> = {
  policy: 'remote.travel.install.policy',
  consent: 'remote.travel.install.consent',
  unsupported: 'remote.travel.install.unsupported',
  'bad-hash': 'remote.travel.install.bad-hash',
  'bad-signature': 'remote.travel.install.bad-signature',
  download: 'remote.travel.install.download',
  extract: 'remote.travel.install.extract',
  busy: 'remote.travel.install.busy',
  'no-binary': 'remote.travel.install.no-binary'
}

const BLOCKED_KEYS = {
  policy: 'remote.travel.blocked.policy',
  'confirm-required': 'remote.travel.blocked.confirm',
  'passkey-required': 'remote.travel.blocked.passkey'
} as const satisfies Record<TravelBlocked, MsgKey>

/** Texto del error del túnel (`exited:<código>` incluido); nunca el texto crudo de la herramienta. */
export function travelErrorText(t: T, error: string): string {
  const m = /^exited:(\d{1,3})$/.exec(error)
  if (m) return t('remote.travel.error.exited', { code: m[1] as string })
  const key = (ERROR_KEYS as Record<string, MsgKey | undefined>)[error]
  return key ? t(key) : t('remote.travel.error.exited', { code: '?' })
}

/** Texto de un fallo de `remote:travelInstall` (código corto del Mac). */
export function travelInstallErrorText(t: T, code: string | undefined): string {
  return t(INSTALL_KEYS[code ?? ''] ?? 'remote.travel.install.download')
}

export function travelBlockedText(t: T, blocked: TravelBlocked): string {
  return t(BLOCKED_KEYS[blocked])
}

/** Duraciones que se ofrecen: `idle30` siempre; las demás solo si caben en `travelMaxHours` de la política. */
export function travelKeepOptions(maxHours: number | undefined): TravelKeep[] {
  return TRAVEL_KEEPS.filter((k) => {
    const h = KEEP_HOURS[k]
    return h === null || maxHours === undefined || h <= maxHours
  })
}

/** «1 h 05 min» / «12 min 03 s» hasta `ms` (nunca negativo). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const p2 = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h} h ${p2(m)} min` : `${m} min ${p2(s)} s`
}

/** ¿El modo viaje ya tiene la herramienta lista? (si no, activar pasa antes por el consentimiento). */
export function travelNeedsDownload(state: RemoteState): boolean {
  const b = state.travel?.binary
  return b !== 'ready'
}

export interface ActivateTravelDeps {
  binaryReady: boolean
  /** Diálogo de consentimiento del Mac: `true` solo si el dueño pulsó «Descargar y activar». */
  confirm: () => Promise<boolean>
  install: () => Promise<TravelInstallResult>
  start: () => Promise<RemoteState>
}
export type ActivateTravelResult =
  { kind: 'started'; state: RemoteState } | { kind: 'cancelled' } | { kind: 'install-failed'; error?: string }

/**
 * Activar el modo viaje. Sin la herramienta verificada, NUNCA se llama a `install` sin que el consentimiento se haya aceptado en
 * esta misma activación; si se rechaza no se descarga ni se activa nada.
 */
export async function activateTravelFlow(d: ActivateTravelDeps): Promise<ActivateTravelResult> {
  if (!d.binaryReady) {
    if (!(await d.confirm())) return { kind: 'cancelled' }
    const r = await d.install()
    if (!r.ok) return { kind: 'install-failed', error: r.error }
  }
  return { kind: 'started', state: await d.start() }
}

export interface TravelPanelViewProps {
  t: T
  state: RemoteState
  busy: boolean
  now: number
  /** El Mac no admite el modo (no es macOS o el Mac dijo `unsupported`). */
  unsupported: boolean
  /** Último fallo de descarga (código corto), si lo hubo. */
  installError: string | null
  onKeep: (keep: TravelKeep) => void
}

const LIMIT_KEYS = [
  'remote.travel.limit.link',
  'remote.travel.limit.home',
  'remote.travel.limit.mac',
  'remote.travel.limit.networks',
  'remote.travel.limit.install'
] as const satisfies readonly MsgKey[]

function statusTone(s: TravelStatus, blocked: boolean): 'ok' | 'warn' | 'error' | 'muted' | 'accent' {
  if (blocked) return 'warn'
  if (s === 'online') return 'ok'
  if (s === 'failed') return 'error'
  if (s === 'idle') return 'muted'
  return 'accent'
}

export function TravelPanelView({ t, state, busy, now, unsupported, installError, onKeep }: TravelPanelViewProps): React.JSX.Element {
  const tr = state.travel
  const status: TravelStatus = tr?.status ?? 'idle'
  const maxHours = state.policy?.managed ? state.policy.travelMaxHours : undefined
  const options = travelKeepOptions(maxHours)
  const keep: TravelKeep = tr && options.includes(tr.keep) ? tr.keep : 'idle30'
  const working =
    status === 'downloading' || status === 'starting' || status === 'checking' || status === 'connecting' || status === 'retrying'
  const showCountdown = status === 'online' && keep !== 'idle30' && tr?.expiresAt != null
  const host = tr?.url ? tr.url.replace(/^https:\/\//, '') : null

  return (
    <>
      <SubTitle>{t('remote.travel.title')}</SubTitle>
      <Card>
        <div className="space-y-2 border-b border-border px-4 py-3 text-xs leading-relaxed text-muted">
          <p className="text-sm text-fg">{t('remote.travel.what')}</p>
          <p className="font-medium text-fg">{t('remote.travel.limits.title')}</p>
          <ul className="list-disc space-y-1 pl-5">
            {LIMIT_KEYS.map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </ul>
          <p>{t('remote.travel.privacy')}</p>
        </div>
        {unsupported ? (
          <div role="status" className="px-4 py-3 text-sm text-muted">
            {t('remote.travel.unsupported')}
          </div>
        ) : (
          <>
            <Row
              label={t('remote.travel.keep.label')}
              description={
                maxHours !== undefined && maxHours < 24
                  ? `${t('remote.travel.keep.hint')} ${t('remote.travel.keep.capped', { hours: maxHours })}`
                  : t('remote.travel.keep.hint')
              }
            >
              <Select
                aria-label={t('remote.travel.keep.label')}
                value={keep}
                disabled={busy || tr?.blocked === 'policy'}
                onChange={(e) => {
                  const k = TRAVEL_KEEPS.find((x) => x === e.target.value)
                  if (k) onKeep(k)
                }}
              >
                {options.map((k) => (
                  <option key={k} value={k}>
                    {t(KEEP_KEYS[k])}
                  </option>
                ))}
              </Select>
            </Row>
            <Row
              label={t('remote.travel.status.label')}
              description={
                <span className="block space-y-0.5">
                  {tr?.binary === 'outdated' && <span className="block">{t('remote.travel.binary.outdated')}</span>}
                  {tr?.binary === 'bad-hash' && <span className="block">{t('remote.travel.binary.bad-hash')}</span>}
                  {tr?.binary === 'missing' && status === 'idle' && !tr.blocked && (
                    <span className="block">{t('remote.travel.binary.missing')}</span>
                  )}
                  {host && status !== 'idle' && <span className="block font-mono">{host}</span>}
                  {showCountdown && (
                    <span className="block">{t('remote.travel.countdown', { time: formatCountdown((tr?.expiresAt ?? 0) - now) })}</span>
                  )}
                  {status === 'retrying' && <span className="block">{t('remote.travel.urlChanged')}</span>}
                  {tr?.directFailures ? (
                    <span className="block">{t('remote.travel.directFailures', { count: tr.directFailures })}</span>
                  ) : null}
                </span>
              }
            >
              <span role="status" aria-live="polite">
                <Badge tone={statusTone(status, !!tr?.blocked)}>
                  {working && <Loader2 size={11} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                  {t(STATUS_KEYS[status])}
                </Badge>
              </span>
            </Row>
            {tr?.blocked && (
              <div
                role="alert"
                className="border-b border-border px-4 py-3 text-xs text-warning last:border-b-0 desk:flex desk:gap-2.5 desk:text-[13px] desk:text-fg"
              >
                <TriangleAlert size={16} className="hidden shrink-0 desk:block desk:text-warning" aria-hidden />
                {travelBlockedText(t, tr.blocked)}
              </div>
            )}
            {!tr?.blocked && tr?.error && status !== 'online' && (
              <div
                role="alert"
                className="border-b border-border px-4 py-3 text-xs text-danger last:border-b-0 desk:flex desk:gap-2.5 desk:text-[13px] desk:text-fg"
              >
                <TriangleAlert size={16} className="hidden shrink-0 desk:block desk:text-danger" aria-hidden />
                {travelErrorText(t, tr.error)}
              </div>
            )}
            {installError && (
              <div role="alert" className="px-4 py-3 text-xs text-danger desk:flex desk:gap-2.5 desk:text-[13px] desk:text-fg">
                <TriangleAlert size={16} className="hidden shrink-0 desk:block desk:text-danger" aria-hidden />
                {travelInstallErrorText(t, installError)}
              </div>
            )}
          </>
        )}
      </Card>
    </>
  )
}
