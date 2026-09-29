/**
 * Ajustes › Navegador (Lote D): dos motores, excluyentes.
 *
 * 1. «Navegador integrado»: pestaña dentro de la propia ventana (Code) o del `aside` de
 *    Cowork, sin depender de un Chrome externo. Apagado por defecto en los dos productos
 *    (`browser:sites:*`, `main/embedded-browser/store.ts`).
 * 2. «Chrome aparte» (Lote C, sin cambios de lógica): `chrome-devtools-mcp` con una pasarela
 *    propia, solo en Control total. Su interruptor `enabled` ahora significa «usar Chrome
 *    aparte en vez del navegador integrado» (B.11): son excluyentes, un solo `mcp.browser`
 *    por servidor. Estado y lógica siguen en `main/browser/service.ts`; aquí solo se lee y
 *    se edita (`cowork:browser:*`, sin tocar).
 */
import { useEffect, useState } from 'react'
import { Eraser, Globe2, Laptop, Loader2, MonitorSmartphone, ShieldCheck, Trash2 } from 'lucide-react'
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
import type { BrowserState } from '@shared/ipc-cowork'
import { COWORK_TERMS } from '@shared/cowork-glossary'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { cw, hasCoworkBridge, onCowork } from '../../cowork/impl/bridge'
import { Badge, Card, ErrorText, Row, SectionHeader, SubTitle, Toggle } from './ui'

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const PRODUCT_LABEL: Record<BrowserProduct, string> = { code: 'Code', cowork: 'Cowork' }

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
  if (!api) throw new Error('El puente del navegador no está disponible (falta window.api.browser en el preload).')
  return api.invoke(channel, ...args)
}

function onBrowser<C extends BrowserEventChannel>(channel: C, listener: (payload: BrowserEventContract[C]) => void): () => void {
  const api = getBrowserApi()
  if (!api) return () => undefined
  return api.on(channel, listener)
}

export function BrowserSection(): React.JSX.Element {
  // Navegador integrado (nuevo).
  const [sitesState, setSitesState] = useState<BrowserSitesState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Chrome aparte (Lote C, sin cambios).
  const [chromeState, setChromeState] = useState<BrowserState | null>(null)
  const [chromeBusy, setChromeBusy] = useState<string | null>(null)
  const [chromeError, setChromeError] = useState<string | null>(null)

  useEffect(() => {
    if (!hasBrowserBridge()) return
    void bw('browser:sites:get')
      .then(setSitesState)
      .catch((err: unknown) => setError(errText(err)))
    return onBrowser('browser:sites', setSitesState)
  }, [])

  useEffect(() => {
    if (!hasCoworkBridge()) return
    void cw('cowork:browser:state')
      .then(setChromeState)
      .catch((err: unknown) => setChromeError(errText(err)))
    // El diálogo nativo de aprobación ("Permitir siempre"/"Denegar") cambia el estado sin pasar por
    // ningún invoke de este panel: hay que escuchar el evento para no quedarse desactualizado.
    return onCowork('cowork:browser:changed', setChromeState)
  }, [])

  if (!hasBrowserBridge() && !hasCoworkBridge()) {
    return (
      <div>
        <SectionHeader title="Navegador" description="Solo disponible en la app de escritorio." />
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
      title: '¿Borrar los datos del navegador integrado?',
      message: `Se borrarán las cookies, sesiones e historial del navegador integrado de ${PRODUCT_LABEL[product]}. No se puede deshacer.`,
      confirmLabel: 'Borrar',
      danger: true
    })
    if (!ok) return
    run(`clearData:${product}`, () => bw('browser:clearData', { product }))
  }

  // ---- Chrome aparte (Lote C, sin cambios de lógica) ----
  const runChrome = (key: string, fn: () => Promise<BrowserState>): void => {
    setChromeError(null)
    setChromeBusy(key)
    fn()
      .then(setChromeState)
      .catch((err: unknown) => setChromeError(errText(err)))
      .finally(() => setChromeBusy(null))
  }
  const toggleExternalChrome = (v: boolean): void => runChrome('enabled', () => cw('cowork:browser:set', { enabled: v }))
  const removeChromeSite = (site: string): void => runChrome(`site:${site}`, () => cw('cowork:browser:removeSite', { site }))
  const undenyChromeSite = (site: string): void => runChrome(`deny:${site}`, () => cw('cowork:browser:undeny', { site }))
  const clearChromeData = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: '¿Borrar los datos de Chrome aparte?',
      message:
        'Se borrará el perfil propio de Chrome aparte (cookies, sesiones, historial) y sus descargas. No se puede deshacer. Tu Chrome personal no se toca.',
      confirmLabel: 'Borrar',
      danger: true
    })
    if (!ok) return
    runChrome('clearData', () => cw('cowork:browser:clearData'))
  }
  const chromeOk = !!chromeState?.chromePath
  const runtimeOk = !!chromeState?.runtime

  const products: BrowserProduct[] = ['code', 'cowork']

  return (
    <div>
      <SectionHeader
        title="Navegador"
        description="Dos formas de dejar que el agente navegue: el navegador integrado en la propia ventana, o un Chrome aparte para cuando un sitio rechaza navegadores embebidos."
      />

      {sitesState?.policyDisabled && (
        <div role="status" className="mb-5 flex items-start gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-xs">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0 text-muted">
            <div className="text-sm font-medium text-fg">Gestionado por tu organización</div>
            <p className="mt-0.5">Tu organización desactivó el navegador integrado.</p>
          </div>
        </div>
      )}

      <SubTitle>Navegador integrado</SubTitle>
      <Card>
        {products.map((product) => (
          <Row
            key={product}
            label={
              <span className="flex items-center gap-2">
                <Globe2 size={14} className="text-accent" /> Permitir que el agente use el navegador en {PRODUCT_LABEL[product]}
              </span>
            }
            description={
              product === 'cowork'
                ? 'Disponible en Sandbox y en Control total, con permiso previo por sitio. Desactivado por defecto.'
                : 'El agente pide permiso antes de abrir cada sitio nuevo. Desactivado por defecto.'
            }
          >
            {busy === `agent:${product}` ? (
              <Loader2 size={14} className="animate-spin text-muted" />
            ) : (
              <Toggle
                checked={sitesState?.prefs.agentEnabled[product] === true}
                onChange={(v) => toggleAgentEnabled(product, v)}
                label={`Permitir que el agente use el navegador en ${PRODUCT_LABEL[product]}`}
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
            <SubTitle>
              {PRODUCT_LABEL[product]} · Sitios con «Permitir siempre»
            </SubTitle>
            <Card>
              {sites.length === 0 ? (
                <Row label="Ninguno todavía" description="Se añaden desde la tarjeta de aprobación cuando el agente pide abrir un sitio nuevo." />
              ) : (
                sites.map((s) => (
                  <Row key={s.site} label={<span className="font-mono">{s.site}</span>} description={new Date(s.addedAt).toLocaleDateString('es-CL')}>
                    <button
                      type="button"
                      onClick={() => removeSite(product, s.site)}
                      disabled={busy === `site:${product}:${s.site}`}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-danger hover:bg-danger/10 disabled:opacity-50"
                    >
                      {busy === `site:${product}:${s.site}` ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Quitar
                    </button>
                  </Row>
                ))
              )}
            </Card>

            {denied.length > 0 && (
              <>
                <SubTitle>{PRODUCT_LABEL[product]} · Sitios denegados</SubTitle>
                <Card>
                  {denied.map((site) => (
                    <Row key={site} label={<span className="font-mono">{site}</span>}>
                      <button
                        type="button"
                        onClick={() => undenySite(product, site)}
                        disabled={busy === `deny:${product}:${site}`}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-accent hover:bg-hover disabled:opacity-50"
                      >
                        {busy === `deny:${product}:${site}` ? <Loader2 size={12} className="animate-spin" /> : null} Permitir de nuevo
                      </button>
                    </Row>
                  ))}
                </Card>
              </>
            )}
          </div>
        )
      })}

      <SubTitle>Orígenes locales aprobados</SubTitle>
      <Card>
        {(sitesState?.localOrigins.length ?? 0) === 0 ? (
          <Row
            label="Ninguno todavía"
            description="Servidores de desarrollo (localhost:PUERTO) que aprobaste para que el agente los abra."
          />
        ) : (
          sitesState?.localOrigins.map((origin) => (
            <Row key={origin} label={<span className="font-mono">{origin}</span>}>
              <button
                type="button"
                onClick={() => removeLocalOrigin(origin)}
                disabled={busy === `origin:${origin}`}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-danger hover:bg-danger/10 disabled:opacity-50"
              >
                {busy === `origin:${origin}` ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Quitar
              </button>
            </Row>
          ))
        )}
      </Card>

      <SubTitle>Datos del navegador integrado</SubTitle>
      <Card>
        {products.map((product) => (
          <Row
            key={product}
            label={`Borrar datos — ${PRODUCT_LABEL[product]}`}
            description="Borra cookies, sesiones e historial del perfil integrado de este producto. Se rechaza si una tarea lo está usando."
          >
            <button
              type="button"
              onClick={() => void clearData(product)}
              disabled={busy === `clearData:${product}`}
              className="flex items-center gap-1.5 rounded-lg border border-danger/30 px-2.5 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
            >
              {busy === `clearData:${product}` ? <Loader2 size={13} className="animate-spin" /> : <Eraser size={13} />} Borrar datos
            </button>
          </Row>
        ))}
      </Card>

      {error && (
        <div className="mt-3">
          <ErrorText>{error}</ErrorText>
        </div>
      )}

      <SubTitle>
        Chrome aparte (avanzado, solo {COWORK_TERMS.fullControlShort})
      </SubTitle>
      <p className="mb-3 text-xs text-subtle">
        Un Chrome real y aparte de {COWORK_TERMS.fullControlShort.toLowerCase()}, con permiso previo por sitio. Útil cuando un sitio (Google,
        Microsoft…) rechaza el navegador integrado. Excluyente con él: si lo activas, {COWORK_TERMS.fullControlShort.toLowerCase()} deja de
        usar el navegador integrado y pasa a usar este Chrome aparte.
      </p>

      {chromeState?.policyDisabled && (
        <div role="status" className="mb-5 flex items-start gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-xs">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0 text-muted">
            <div className="text-sm font-medium text-fg">Gestionado por tu organización</div>
            <p className="mt-0.5">Tu organización desactivó Chrome aparte.</p>
          </div>
        </div>
      )}

      <Card>
        <Row
          label={
            <span className="flex items-center gap-2">
              <MonitorSmartphone size={14} className="text-accent" /> Usar Chrome aparte en vez del navegador integrado
            </span>
          }
          description={
            chromeState?.available
              ? `Perfil propio, aislado de tu Chrome personal: no comparte cookies, historial ni sesiones. Solo en ${COWORK_TERMS.fullControl}.`
              : chromeState?.reason ?? 'No disponible.'
          }
        >
          {chromeBusy === 'enabled' ? (
            <Loader2 size={14} className="animate-spin text-muted" />
          ) : (
            <Toggle
              checked={chromeState?.enabled === true}
              onChange={toggleExternalChrome}
              label="Usar Chrome aparte en vez del navegador integrado"
              disabled={!chromeState?.available}
            />
          )}
        </Row>
        <Row label="Chrome detectado" description={chromeState?.chromePath ?? 'No se encontró Google Chrome ni Brave en /Applications.'}>
          <Badge tone={chromeOk ? 'ok' : 'error'}>{chromeOk ? 'Detectado' : 'No detectado'}</Badge>
        </Row>
        <Row
          label="Runtime para ejecutarlo"
          description={
            chromeState?.runtime === 'node'
              ? 'Node ≥20.19 del sistema.'
              : chromeState?.runtime === 'bun'
                ? 'Binario de OpenCode (sin Node ≥20.19 instalado).'
                : 'No se encontró Node ≥20.19 ni el binario de OpenCode.'
          }
        >
          <Badge tone={runtimeOk ? 'ok' : 'error'}>{runtimeOk ? chromeState?.runtime : 'Ninguno'}</Badge>
        </Row>
      </Card>

      <SubTitle>Chrome aparte · Sitios con «Permitir siempre»</SubTitle>
      <Card>
        {(chromeState?.sites.length ?? 0) === 0 ? (
          <Row label="Ninguno todavía" description="Se añaden desde el diálogo de aprobación cuando el agente pide abrir un sitio nuevo." />
        ) : (
          chromeState?.sites.map((s) => (
            <Row key={s.site} label={<span className="font-mono">{s.site}</span>} description={new Date(s.addedAt).toLocaleDateString('es-CL')}>
              <button
                type="button"
                onClick={() => removeChromeSite(s.site)}
                disabled={chromeBusy === `site:${s.site}`}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-danger hover:bg-danger/10 disabled:opacity-50"
              >
                {chromeBusy === `site:${s.site}` ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Quitar
              </button>
            </Row>
          ))
        )}
      </Card>

      {(chromeState?.denied.length ?? 0) > 0 && (
        <>
          <SubTitle>Chrome aparte · Sitios denegados</SubTitle>
          <Card>
            {chromeState?.denied.map((site) => (
              <Row key={site} label={<span className="font-mono">{site}</span>}>
                <button
                  type="button"
                  onClick={() => undenyChromeSite(site)}
                  disabled={chromeBusy === `deny:${site}`}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-accent hover:bg-hover disabled:opacity-50"
                >
                  {chromeBusy === `deny:${site}` ? <Loader2 size={12} className="animate-spin" /> : null} Permitir de nuevo
                </button>
              </Row>
            ))}
          </Card>
        </>
      )}

      <SubTitle>Chrome aparte · Datos</SubTitle>
      <Card>
        <Row
          label="Borrar datos de Chrome aparte"
          description="Borra el perfil propio (cookies, sesiones, historial) y sus descargas. Se rechaza si una tarea lo está usando."
        >
          <button
            type="button"
            onClick={() => void clearChromeData()}
            disabled={chromeBusy === 'clearData'}
            className="flex items-center gap-1.5 rounded-lg border border-danger/30 px-2.5 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            {chromeBusy === 'clearData' ? <Loader2 size={13} className="animate-spin" /> : <Eraser size={13} />} Borrar datos
          </button>
        </Row>
      </Card>

      {chromeError && (
        <div className="mt-3">
          <ErrorText>{chromeError}</ErrorText>
        </div>
      )}
      <p className="mt-4 flex items-center gap-1.5 text-xs text-subtle">
        <Laptop size={12} className="shrink-0" />
        Solo en {COWORK_TERMS.fullControl}; usa su propio perfil (<span className="font-mono break-all">{chromeState?.profileDir}</span>) y
        nunca toca tu Chrome.
      </p>
    </div>
  )
}
