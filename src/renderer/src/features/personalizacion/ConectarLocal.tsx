/**
 * Instalar un conector LOCAL, paso a paso y en lenguaje llano (F8-B186). A diferencia de los remotos, esto SÍ instala y ejecuta un
 * programa de un tercero en el equipo, y por eso:
 *   1. «Lee esto»: qué instala (autor, licencia, versión fijada, de dónde se descarga, tamaño), cómo corre (sin el aislamiento de
 *      Overdrive; Lazunox no revisó su código), qué podrá y qué NO. Dos casillas SEPARADAS: «instala un programa de un tercero» y
 *      «podrá ver mis datos». Sin las dos, «Seguir» no se habilita.
 *   2. «Prepara e instala»: lo que la persona hace una vez en su cuenta (con enlace) y el archivo de su cliente, elegido con el
 *      diálogo del sistema: su contenido NO pasa por esta pantalla. Luego «Instalar».
 *   3. «Listo»: cómo entrar a la cuenta (desde el chat; la contraseña se escribe en el sitio del servicio, no aquí).
 */
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, ExternalLink, FileJson, Loader2, X } from 'lucide-react'
import type { CatalogLocalConnector } from '@shared/catalogo'
import type { LocalConnectorReadiness } from '@shared/mcp-catalog'
import { catalogText, tx } from '@shared/mcp-catalog'
import { Button } from '../../components/Button'
import { Toggle } from '../../components/Toggle'
import { openExternalUrl } from '../../lib/open-external'
import { useT } from '../../lib/i18n'
import { errorMessage } from '../../lib/opencode'
import { suggestName } from '../settings/impl/McpCatalogDialog'
import { IconTile } from './Ficha'
import { LocalFacts, LocalTools, previewLocalJson } from './LocalFacts'
import { Modal } from './Modal'
import { runtimesApi, runtimesErrorKey, runtimesPct } from '../settings/impl/runtimes-view'
import { DISPLAY_NAME } from '@shared/brand'

type Step = 1 | 2 | 3

/** Texto suelto de la ficha (pasos de preparación, cómo entrar): `pers.cat.conn.<id>.<clave>`; vacío si la ficha no lo trae. */
export const localText = (item: CatalogLocalConnector, key: string): string => tx(`pers.cat.conn.${item.id}.${key}`, '')

export function prepSteps(item: CatalogLocalConnector): string[] {
  const out: string[] = []
  for (let i = 1; i <= 8; i++) {
    const s = localText(item, `prep${i}`)
    if (!s) break
    out.push(s)
  }
  return out
}

export function LocalConnectWizard({
  item,
  existingNames,
  readiness,
  onPickClient,
  onInstall,
  onRuntimeChanged,
  onClose
}: {
  item: CatalogLocalConnector
  existingNames: string[]
  readiness: LocalConnectorReadiness | undefined
  onPickClient: (id: string) => Promise<{ fileName: string; hint: string } | null>
  onInstall: (req: { id: string; name: string; askEachUse: boolean }) => Promise<void>
  /** Se instaló Node.js y uv de la app: vuelve a pedir el estado del equipo (la ficha pasa de «falta» a «listo»). */
  onRuntimeChanged: () => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const ct = catalogText(item)
  const rt = item.runtime
  const [step, setStep] = useState<Step>(1)
  const [ackThird, setAckThird] = useState(false)
  const [ackData, setAckData] = useState(false)
  const [picked, setPicked] = useState<{ fileName: string; hint: string } | null>(null)
  const [askEachUse, setAskEachUse] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [rtBusy, setRtBusy] = useState(false)
  const [rtPct, setRtPct] = useState<number | null>(null)
  const [rtError, setRtError] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
    },
    []
  )
  const name = suggestName(item.name, existingNames)
  const steps = prepSteps(item)

  const platformOk = readiness?.platformOk ?? false
  const managerFound = readiness?.managerFound ?? false
  const needsClient = !!rt.clientFile
  // Si falta Node.js o uv, «Instalar» los descarga primero (con su aviso a la vista) y sigue con el conector.
  const canInstall = !busy && !rtBusy && platformOk && (!needsClient || !!picked)
  const stepLabel = (n: Step): string => (n === 1 ? t('pers.local.step1') : n === 2 ? t('pers.local.step2') : t('pers.local.step3'))

  const pick = async (): Promise<void> => {
    setError(null)
    try {
      const r = await onPickClient(item.id)
      if (r) setPicked(r)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  /** Descarga Node.js y uv de la app (con huella fijada) y devuelve `true` si quedaron listos. */
  const installRuntime = async (): Promise<boolean> => {
    setRtBusy(true)
    setRtError(null)
    setRtPct(null)
    const poll = setInterval(() => {
      void runtimesApi
        .status()
        .then((st) => alive.current && setRtPct(runtimesPct(st)))
        .catch(() => undefined)
    }, 1000)
    try {
      const r = await runtimesApi.install()
      if (!r.ok) {
        if (alive.current) setRtError(r.error)
        return false
      }
      await onRuntimeChanged()
      return true
    } catch {
      if (alive.current) setRtError('download')
      return false
    } finally {
      clearInterval(poll)
      if (alive.current) {
        setRtBusy(false)
        setRtPct(null)
      }
    }
  }

  const install = async (): Promise<void> => {
    if (!canInstall) return
    if (!managerFound && !(await installRuntime())) return
    setBusy(true)
    setError(null)
    try {
      await onInstall({ id: item.id, name, askEachUse })
      setDone(true)
      setStep(3)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      labelId="pers-wizard-title"
      onClose={onClose}
      busy={busy}
      wide
      header={
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex min-w-0 items-center gap-3">
            <IconTile icon={item.icon} size={40} />
            <div className="min-w-0">
              <h3 id="pers-wizard-title" className="text-base font-semibold desk:text-[17px] desk:leading-6">
                {t('pers.wiz.title', { title: ct.title })}
              </h3>
              <p className="text-xs text-muted">{t('pers.local.title')}</p>
            </div>
          </div>
          <ol className="ml-auto flex items-center gap-2 text-xs" aria-label={t('pers.wiz.steps')}>
            {([1, 2, 3] as Step[]).map((n) => (
              <li
                key={n}
                aria-current={step === n ? 'step' : undefined}
                className={`flex items-center gap-1.5 ${step === n ? 'font-semibold text-fg' : 'text-muted'}`}
              >
                <span
                  className={`grid size-5 place-items-center rounded-full text-meta ${step === n ? 'bg-accent text-accent-fg' : step > n ? 'bg-success/20 text-success' : 'border border-border'}`}
                >
                  {step > n ? <Check size={11} aria-hidden="true" /> : n}
                </span>
                {stepLabel(n)}
              </li>
            ))}
          </ol>
        </div>
      }
      footer={
        step === 1 ? (
          <>
            <Button variant="ghost" onClick={onClose} data-initial-focus="">
              {t('pers.wiz.notNow')}
            </Button>
            <Button variant="primary" data-testid="pers-local-next" disabled={!(ackThird && ackData)} onClick={() => setStep(2)}>
              {t('pers.wiz.next')}
            </Button>
          </>
        ) : step === 2 ? (
          <>
            <Button variant="ghost" onClick={() => setStep(1)} disabled={busy}>
              {t('pers.wiz.back')}
            </Button>
            <Button variant="primary" data-testid="pers-local-install" disabled={!canInstall} onClick={() => void install()}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : null} {busy ? t('pers.local.installing') : t('pers.local.install')}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose} data-initial-focus="">
            {t('pers.done')}
          </Button>
        )
      }
    >
      {step === 1 && (
        <div className="grid gap-5 desk:grid-cols-2">
          <div>
            <h4 className="text-meta font-semibold tracking-[0.04em] text-subtle uppercase">{t('pers.detail.can')}</h4>
            <ul className="mt-2 space-y-2 text-sm">
              {ct.capabilities.map((c) => (
                <li key={c} className="flex items-start gap-2">
                  <Check size={16} className="mt-0.5 shrink-0 text-success" aria-hidden="true" /> <span>{c}</span>
                </li>
              ))}
            </ul>
            <h4 className="mt-5 text-meta font-semibold tracking-[0.04em] text-subtle uppercase">{t('pers.detail.cannot')}</h4>
            <ul className="mt-2 space-y-2 text-sm">
              {ct.cannot.map((c) => (
                <li key={c} className="flex items-start gap-2">
                  <X size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" /> <span>{c}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4">
              <LocalTools item={item} />
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-xl border border-warning/40 bg-warning/10 p-3.5">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-warning">
                <AlertTriangle size={15} aria-hidden="true" /> {t('pers.local.title')}
              </p>
              <div className="mt-2.5">
                <LocalFacts item={item} />
              </div>
              <p className="mt-2.5 text-xs text-muted">{ct.dataLeaves}</p>
            </div>
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                data-testid="pers-local-ack-third"
                checked={ackThird}
                onChange={(e) => setAckThird(e.target.checked)}
                className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
              />
              <span>{t('pers.local.ackThird')}</span>
            </label>
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                data-testid="pers-local-ack-data"
                checked={ackData}
                onChange={(e) => setAckData(e.target.checked)}
                className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
              />
              <span>{t('pers.local.ackData', { title: ct.title })}</span>
            </label>
            {!(ackThird && ackData) && <p className="text-xs text-muted">{t('pers.local.ackNeed')}</p>}
            <p className="text-xs text-muted">{t('pers.wiz.undo')}</p>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          {!platformOk && (
            <p role="alert" className="text-sm text-danger">
              {t('pers.local.needPlatform')}
            </p>
          )}
          {platformOk && !managerFound && (
            <div data-testid="pers-local-need-manager" className="rounded-xl border border-warning/40 bg-warning/10 p-3.5 text-sm">
              <p>
                {t('pers.local.needRuntime', {
                  what: t(rt.manager === 'uv' ? 'pers.local.what.uv' : 'pers.local.what.npm'),
                  mb: Math.max(1, Math.round((readiness?.installBytes ?? 0) / 1e6)),
                  app: DISPLAY_NAME
                })}
              </p>
              <Button
                variant="secondary"
                className="mt-2.5"
                data-testid="pers-local-install-runtime"
                disabled={rtBusy || busy}
                onClick={() => void installRuntime()}
              >
                {rtBusy ? <Loader2 size={14} className="animate-spin" /> : null}{' '}
                {rtBusy
                  ? rtPct !== null
                    ? t('pers.local.installingRuntimePct', { pct: rtPct })
                    : t('pers.local.installingRuntime')
                  : t('pers.local.installRuntime')}
              </Button>
              {rtError && (
                <p role="alert" data-testid="pers-local-runtime-error" className="mt-2 text-sm text-danger">
                  {t(runtimesErrorKey(rtError))}
                </p>
              )}
            </div>
          )}
          {platformOk && managerFound && readiness && readiness.runtime !== 'missing' && (
            <p data-testid="pers-local-runtime-ready" className="text-xs text-muted">
              {t(readiness.runtime === 'app' ? 'pers.local.runtime.app' : 'pers.local.runtime.system', { app: DISPLAY_NAME })}
            </p>
          )}
          {steps.length > 0 && (
            <div className="rounded-xl border border-border bg-bg p-3.5 text-sm">
              <p className="font-semibold">{t('pers.local.prepareTitle')}</p>
              <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-muted">
                {steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              {localText(item, 'prepNote') && <p className="mt-2 text-xs text-muted">{localText(item, 'prepNote')}</p>}
              <p className="mt-1 text-xs text-muted">{t('pers.local.once')}</p>
              {rt.clientFile && (
                <Button variant="secondary" className="mt-2.5" onClick={() => void openExternalUrl(rt.clientFile!.helpUrl)}>
                  <ExternalLink size={14} /> {t('pers.local.openHelp')}
                </Button>
              )}
            </div>
          )}
          {needsClient && (
            <div>
              <Button variant="secondary" data-testid="pers-local-pick" onClick={() => void pick()} disabled={busy}>
                <FileJson size={14} /> {t('pers.local.pick')}
              </Button>
              {picked ? (
                <p data-testid="pers-local-picked" className="mt-1.5 flex items-center gap-1.5 text-sm text-success">
                  <Check size={14} aria-hidden="true" /> {t('pers.local.picked', { name: picked.fileName, hint: picked.hint })}
                </p>
              ) : (
                <p className="mt-1.5 text-xs text-muted">{t('pers.local.pickMissing')}</p>
              )}
              <p className="mt-1 text-xs text-subtle">{t('pers.local.pickNote')}</p>
            </div>
          )}
          <label className="flex items-center gap-2.5 text-sm">
            <Toggle checked={askEachUse} onChange={setAskEachUse} label={t('pers.local.askEach')} disabled={busy} />
            <span>{t('pers.local.askEach')}</span>
          </label>
          <p className="text-xs text-muted">{t('pers.wiz.tasksOff')}</p>
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">{t('pers.local.showExact')}</summary>
            <pre
              tabIndex={0}
              aria-label={t('mcp.dlg.configAria')}
              className="mt-1.5 max-h-48 overflow-auto rounded-lg border border-border bg-bg p-2.5 font-mono text-meta leading-relaxed"
            >
              {previewLocalJson(item, name, askEachUse)}
            </pre>
          </details>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3 text-sm" role="status">
          {done && (
            <p className="flex items-center gap-2 font-semibold text-success">
              <Check size={18} aria-hidden="true" /> {t('pers.local.done', { title: ct.title })}
            </p>
          )}
          <p>{t('pers.local.doneNote')}</p>
          <div className="rounded-xl border border-border bg-bg p-3.5">
            <p className="font-semibold">{t('pers.local.signinTitle')}</p>
            <p className="mt-1.5 text-muted">{localText(item, 'signin')}</p>
            <p className="mt-2 text-xs text-muted">{t('pers.wiz.neverSeen')}</p>
          </div>
          <p className="text-muted">{t('pers.wiz.tryIt')}</p>
          <ul className="space-y-1.5">
            {ct.examples.map((x) => (
              <li key={x} className="rounded-lg border border-border bg-bg px-3 py-1.5 text-muted">
                «{x}»
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">{t('pers.local.removeNote')}</p>
          {item.accountTested === false && <p className="text-xs text-subtle">{t('pers.local.unverified')}</p>}
        </div>
      )}
    </Modal>
  )
}
