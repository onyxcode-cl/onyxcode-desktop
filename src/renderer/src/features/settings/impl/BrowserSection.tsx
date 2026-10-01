/**
 * Ajustes › Navegador: «Navegador integrado», una pestaña dentro de la propia ventana (Code) o
 * del `aside` de Tareas, sin depender de un Chrome externo. Apagado por defecto en los dos
 * productos (`browser:sites:*`, `main/embedded-browser/store.ts`).
 */
import { useEffect, useState } from 'react'
import { Eraser, Globe2, Loader2, ShieldCheck, Trash2 } from 'lucide-react'
import type {
  BrowserApi,
  BrowserEventChannel,
  BrowserEventContract,
  BrowserInvokeChannel,
  BrowserProduct,
  BrowserRequest,
  BrowserResponse,
  BrowserSitesState
} from '@shared/ipc-browser'
import { t as tr, getLang } from '@shared/i18n'
import { MODE_LABELS } from '@shared/labels'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { Card, ErrorText, Row, SectionHeader, SubTitle, Toggle } from './ui'
import { errText } from '../../../lib/format'
import { useT } from '../../../lib/i18n'

/** Nombre visible del producto (se lee al usarse: sigue el idioma activo). */
const PRODUCT_LABEL: Record<BrowserProduct, string> = {
  get code() {
    return MODE_LABELS.code
  },
  get tasks() {
    return MODE_LABELS.tasks
  }
}

function hasBrowserBridge(): boolean {
  return !!(window as unknown as { api?: { browser?: unknown } }).api?.browser
}

function getBrowserApi(): BrowserApi | undefined {
  return (window as unknown as { api?: { browser?: BrowserApi } }).api?.browser
}

async function bw<C extends BrowserInvokeChannel>(
  channel: C,
  ...args: BrowserRequest<C> extends void ? [] : [req: BrowserRequest<C>]
): Promise<BrowserResponse<C>> {
  const api = getBrowserApi()
  if (!api) throw new Error(tr('misc.browser.noBridge'))
  return api.invoke(channel, ...args)
}

function onBrowser<C extends BrowserEventChannel>(channel: C, listener: (payload: BrowserEventContract[C]) => void): () => void {
  const api = getBrowserApi()
  if (!api) return () => undefined
  return api.on(channel, listener)
}

export function BrowserSection(): React.JSX.Element {
  const t = useT()
  const [sitesState, setSitesState] = useState<BrowserSitesState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!hasBrowserBridge()) return
    void bw('browser:sites:get')
      .then(setSitesState)
      .catch((err: unknown) => setError(errText(err)))
    return onBrowser('browser:sites', setSitesState)
  }, [])

  if (!hasBrowserBridge()) {
    return (
      <div>
        <SectionHeader title={t('misc.browser.title')} description={t('misc.desktopOnly')} />
      </div>
    )
  }

  const run = (key: string, fn: () => Promise<BrowserSitesState>): void => {
    setError(null)
    setBusy(key)
    fn()
      .then(setSitesState)
      .catch((err: unknown) => setError(errText(err)))
      .finally(() => setBusy(null))
  }

  const toggleAgentEnabled = (product: BrowserProduct, v: boolean): void =>
    run(`agent:${product}`, () => bw('browser:sites:setPrefs', { agentEnabled: { [product]: v } }))
  const removeSite = (product: BrowserProduct, site: string): void =>
    run(`site:${product}:${site}`, () => bw('browser:sites:remove', { product, site }))
  const undenySite = (product: BrowserProduct, site: string): void =>
    run(`deny:${product}:${site}`, () => bw('browser:sites:undeny', { product, site }))
  const removeLocalOrigin = (origin: string): void => run(`origin:${origin}`, () => bw('browser:sites:removeLocal', { origin }))

  const clearData = async (product: BrowserProduct): Promise<void> => {
    const ok = await confirmDialog({
      title: t('misc.browser.confirmTitle'),
      message: t('misc.browser.confirmMessage', { product: PRODUCT_LABEL[product] }),
      confirmLabel: t('misc.browser.confirmBtn'),
      danger: true
    })
    if (!ok) return
    run(`clearData:${product}`, () => bw('browser:clearData', { product }))
  }

  const products: BrowserProduct[] = ['code', 'tasks']

  return (
    <div>
      <SectionHeader title={t('misc.browser.title')} description={t('misc.browser.desc')} />

      {sitesState?.policyDisabled && (
        <div role="status" className="mb-5 flex items-start gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-xs">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0 text-muted">
            <div className="text-sm font-medium text-fg">{t('misc.managedTitle')}</div>
            <p className="mt-0.5">{t('misc.browser.orgOff')}</p>
          </div>
        </div>
      )}

      <SubTitle>{t('misc.browser.builtIn')}</SubTitle>
      <Card>
        {products.map((product) => (
          <Row
            key={product}
            label={
              <span className="flex items-center gap-2">
                <Globe2 size={14} className="text-accent" /> {t('misc.browser.allow', { product: PRODUCT_LABEL[product] })}
              </span>
            }
            description={product === 'tasks' ? t('misc.browser.tasksDesc') : t('misc.browser.codeDesc')}
          >
            {busy === `agent:${product}` ? (
              <Loader2 size={14} className="animate-spin text-muted" />
            ) : (
              <Toggle
                checked={sitesState?.prefs.agentEnabled[product] === true}
                onChange={(v) => toggleAgentEnabled(product, v)}
                label={t('misc.browser.allow', { product: PRODUCT_LABEL[product] })}
                disabled={!hasBrowserBridge() || sitesState?.policyDisabled}
              />
            )}
          </Row>
        ))}
      </Card>

      {products.map((product) => {
        const sites = sitesState?.sites[product] ?? []
        const denied = sitesState?.denied[product] ?? []
        return (
          <div key={product}>
            <SubTitle>{t('misc.browser.alwaysTitle', { product: PRODUCT_LABEL[product] })}</SubTitle>
            <Card>
              {sites.length === 0 ? (
                <Row label={t('misc.browser.none')} description={t('misc.browser.noneDesc')} />
              ) : (
                sites.map((s) => (
                  <Row
                    key={s.site}
                    label={<span className="font-mono">{s.site}</span>}
                    description={new Date(s.addedAt).toLocaleDateString(getLang() === 'en' ? 'en-US' : 'es-CL')}
                  >
                    <button
                      type="button"
                      onClick={() => removeSite(product, s.site)}
                      disabled={busy === `site:${product}:${s.site}`}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-danger hover:bg-danger/10 disabled:opacity-50"
                    >
                      {busy === `site:${product}:${s.site}` ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}{' '}
                      {t('misc.remove')}
                    </button>
                  </Row>
                ))
              )}
            </Card>

            {denied.length > 0 && (
              <>
                <SubTitle>{t('misc.browser.deniedTitle', { product: PRODUCT_LABEL[product] })}</SubTitle>
                <Card>
                  {denied.map((site) => (
                    <Row key={site} label={<span className="font-mono">{site}</span>}>
                      <button
                        type="button"
                        onClick={() => undenySite(product, site)}
                        disabled={busy === `deny:${product}:${site}`}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-accent hover:bg-hover disabled:opacity-50"
                      >
                        {busy === `deny:${product}:${site}` ? <Loader2 size={12} className="animate-spin" /> : null}{' '}
                        {t('misc.browser.allowAgain')}
                      </button>
                    </Row>
                  ))}
                </Card>
              </>
            )}
          </div>
        )
      })}

      <SubTitle>{t('misc.browser.localTitle')}</SubTitle>
      <Card>
        {(sitesState?.localOrigins.length ?? 0) === 0 ? (
          <Row label={t('misc.browser.none')} description={t('misc.browser.localDesc')} />
        ) : (
          sitesState?.localOrigins.map((origin) => (
            <Row key={origin} label={<span className="font-mono">{origin}</span>}>
              <button
                type="button"
                onClick={() => removeLocalOrigin(origin)}
                disabled={busy === `origin:${origin}`}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-danger hover:bg-danger/10 disabled:opacity-50"
              >
                {busy === `origin:${origin}` ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} {t('misc.remove')}
              </button>
            </Row>
          ))
        )}
      </Card>

      <SubTitle>{t('misc.browser.dataTitle')}</SubTitle>
      <Card>
        {products.map((product) => (
          <Row
            key={product}
            label={t('misc.browser.deleteData', { product: PRODUCT_LABEL[product] })}
            description={t('misc.browser.deleteDataDesc')}
          >
            <button
              type="button"
              onClick={() => void clearData(product)}
              disabled={busy === `clearData:${product}`}
              className="flex items-center gap-1.5 rounded-lg border border-danger/30 px-2.5 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
            >
              {busy === `clearData:${product}` ? <Loader2 size={13} className="animate-spin" /> : <Eraser size={13} />}{' '}
              {t('misc.browser.deleteDataBtn')}
            </button>
          </Row>
        ))}
      </Card>

      {error && (
        <div className="mt-3">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </div>
  )
}
