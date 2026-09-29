/**
 * Panel del navegador integrado, compartido entre Code y Cowork (y la ventana "Navegador"
 * aparte). Solo usa `window.api.browser` (vía `bridge.ts`): no importa nada específico de Code
 * ni de Cowork — quien lo monta decide el `owner`/`product`.
 *
 * El navegador está OFF por defecto para el AGENTE (ver `disabledReason` en el estado): el humano
 * siempre puede escribir una URL y navegar a mano, con o sin el agente activado.
 */
import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Globe, RotateCw, ShieldCheck } from 'lucide-react'
import { APP_NAME } from '@shared/brand'
import type {
  BrowserDecision,
  BrowserOwner,
  BrowserOwnerState,
  BrowserProduct,
  BrowserTab,
  BrowserToChat,
  DevServerCandidate
} from '@shared/ipc-browser'
import { AgentBar } from './AgentBar'
import { br, onBrowser } from './bridge'
import { Cards } from './Cards'
import { DevServerHint } from './DevServerHint'
import { approvalsFor, formatPageChatText, ownerKey, sameOwner, toNavigationInput, useBrowserUi } from './store'
import { TabStrip } from './TabStrip'
import { UrlBar } from './UrlBar'
import { useNativeViewport } from './useNativeViewport'

export interface BrowserPanelProps {
  owner: BrowserOwner
  product: BrowserProduct
  /** Si el panel está visible en pantalla (oculto = la vista nativa se desconecta). */
  visible: boolean
  /** Se llama además de invocar `browser:toChat`, con el mismo payload, al pulsar "Añadir al chat". */
  onAddToChat?: (item: BrowserToChat) => void
  /** La ventana "Navegador" aparte pasa `'popout'` para no repetir el aviso de primer uso. */
  variant?: 'panel' | 'popout'
  className?: string
}

/** ¿Esta pestaña está "vacía" (recién creada, sin contenido de usuario)? Sirve para mostrar el `DevServerHint`. */
function isEmptyTab(tab: BrowserTab | null): boolean {
  return !tab || tab.url === '' || tab.url === 'about:blank'
}

function useDevServers(owner: BrowserOwner, enabled: boolean): DevServerCandidate[] {
  const [list, setList] = useState<DevServerCandidate[]>([])
  const directory = owner.kind === 'code' ? owner.directory : null
  useEffect(() => {
    if (!directory || !enabled) {
      setList([])
      return
    }
    let cancelled = false
    const load = (): void => {
      void br('browser:devServers', { directory })
        .then((res) => !cancelled && setList(res))
        .catch(() => undefined)
    }
    load()
    const t = setInterval(load, 5000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [directory, enabled])
  return list
}

function FirstRunNotice({ onDismiss }: { onDismiss: () => void }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 border-b border-accent/30 bg-accent-soft/40 px-3 py-2 text-[12px]">
      <ShieldCheck size={14} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1 text-fg/90">Estás navegando dentro de {APP_NAME}. Nunca te pediremos contraseñas en esta zona.</span>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded-md px-2 py-0.5 font-medium text-muted hover:bg-hover hover:text-fg"
      >
        Entendido
      </button>
    </div>
  )
}

/** Aviso efímero en el flujo normal (nunca sobre la vista nativa): se oculta a los 8 s o al llegar otro aviso. */
function NoticeLine({ notice }: { notice?: { id: number; text: string } }): React.JSX.Element | null {
  const [dismissedId, setDismissedId] = useState<number | null>(null)
  const id = notice?.id ?? null
  useEffect(() => {
    if (id === null) return
    const t = setTimeout(() => setDismissedId(id), 8_000)
    return () => clearTimeout(t)
  }, [id])
  if (!notice || dismissedId === notice.id) return null
  return (
    <div role="status" className="flex items-center gap-2 border-b border-warning/40 bg-elevated px-3 py-1.5 text-[12px]">
      <span className="min-w-0 flex-1 text-fg/90">{notice.text}</span>
      <button
        type="button"
        onClick={() => setDismissedId(notice.id)}
        className="shrink-0 rounded-md px-2 py-0.5 font-medium text-muted hover:bg-hover hover:text-fg"
      >
        Cerrar
      </button>
    </div>
  )
}

function EmptyState({ disabledReason, onNewTab }: { disabledReason?: string; onNewTab: () => void }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <Globe size={20} />
      </div>
      <div>
        <p className="text-sm font-medium text-fg">Sin pestañas abiertas</p>
        <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-muted">
          Puedes navegar aquí mismo cuando quieras: el navegador es tuyo, con o sin el agente.
        </p>
      </div>
      <button
        type="button"
        onClick={onNewTab}
        className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90"
      >
        Nueva pestaña
      </button>
      {disabledReason && <p className="mt-1 max-w-xs text-[12px] text-subtle">{disabledReason}</p>}
    </div>
  )
}

function CrashedTab({ onReload }: { onReload: () => void }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted">
      <p>La página dejó de responder.</p>
      <button
        type="button"
        onClick={onReload}
        className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 hover:bg-hover"
      >
        <RotateCw size={13} /> Recargar
      </button>
    </div>
  )
}

function Viewport({
  owner,
  tab,
  visible,
  devServers,
  onUseDevServer
}: {
  owner: BrowserOwner
  tab: BrowserTab | null
  visible: boolean
  devServers: DevServerCandidate[]
  onUseDevServer: (url: string) => void
}): React.JSX.Element {
  const { hostRef, shouldShowNative, frozen } = useNativeViewport(owner, tab?.id ?? null, visible && !!tab && !tab.crashed)

  if (tab?.crashed)
    return <CrashedTab onReload={() => void br('browser:history', { owner, tabId: tab.id, action: 'reload' }).catch(() => undefined)} />

  return (
    <div className="relative h-full min-h-0 w-full">
      <div ref={hostRef} className="absolute inset-0" />
      {!shouldShowNative && frozen && (
        <img src={frozen.dataUrl} alt={frozen.title || frozen.url} className="absolute inset-0 h-full w-full object-cover" />
      )}
      {isEmptyTab(tab) && <DevServerHint candidates={devServers} onUse={onUseDevServer} />}
    </div>
  )
}

export function BrowserPanel({
  owner,
  product,
  visible,
  onAddToChat,
  variant = 'panel',
  className = ''
}: BrowserPanelProps): React.JSX.Element {
  const key = ownerKey(owner)
  const [state, setState] = useState<BrowserOwnerState | null>(null)
  const firstRunSeen = useBrowserUi((s) => s.firstRunSeen)
  const markFirstRunSeen = useBrowserUi((s) => s.markFirstRunSeen)
  const approvals = useBrowserUi(useShallow((s) => approvalsFor(s, owner)))

  useEffect(() => {
    let cancelled = false
    void br('browser:state', { owner })
      .then((s) => !cancelled && setState(s))
      .catch(() => undefined)
    const offState = onBrowser('browser:state', (s) => {
      if (sameOwner(s.owner, owner)) setState(s)
    })
    const offApproval = onBrowser('browser:approval', (req) => {
      if (sameOwner(req.owner, owner)) useBrowserUi.getState().pushApproval(req)
    })
    const offApprovalDone = onBrowser('browser:approvalDone', ({ id }) => {
      useBrowserUi.getState().removeApprovalById(id)
    })
    return () => {
      cancelled = true
      offState()
      offApproval()
      offApprovalDone()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const tabs = useMemo(() => state?.tabs ?? [], [state?.tabs])
  const activeTabId = state?.activeTabId ?? null
  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId) ?? null, [tabs, activeTabId])
  const devServers = useDevServers(owner, product === 'code' && isEmptyTab(activeTab))

  const newTab = (input?: string): void => {
    void br('browser:newTab', input ? { owner, input } : { owner }).catch(() => undefined)
  }
  const handleNavigate = (raw: string): void => {
    const input = toNavigationInput(raw)
    if (!input) return
    if (activeTabId) void br('browser:navigate', { owner, tabId: activeTabId, input }).catch(() => undefined)
    else newTab(input)
  }
  const handleHistory = (action: 'back' | 'forward' | 'reload' | 'stop'): void => {
    if (activeTabId) void br('browser:history', { owner, tabId: activeTabId, action }).catch(() => undefined)
  }
  const handleTogglePick = (): void => {
    if (activeTabId) void br('browser:pick', { owner, tabId: activeTabId, on: !state?.picking }).catch(() => undefined)
  }
  const handleAddToChat = async (): Promise<void> => {
    if (!activeTab) return
    const text = formatPageChatText(activeTab.title, activeTab.url)
    let image: BrowserToChat['image']
    try {
      const cap = await br('browser:capture', { owner, tabId: activeTab.id })
      image = { name: 'captura.jpg', mime: 'image/jpeg', dataUrl: cap.dataUrl }
    } catch {
      image = undefined
    }
    const payload: BrowserToChat = { owner, text, image }
    onAddToChat?.(payload)
    await br('browser:toChat', payload).catch(() => undefined)
  }
  const handlePopOut = (): void => {
    void br('browser:popOut', { owner, on: state?.hostedIn !== 'popout' }).catch(() => undefined)
  }
  const handleOpenExternal = (): void => {
    if (activeTabId) void br('browser:openExternal', { owner, tabId: activeTabId }).catch(() => undefined)
  }
  const handleRespond = (id: string, decision: BrowserDecision): void => {
    useBrowserUi.getState().removeApprovalById(id)
    void br('browser:respond', { id, decision }).catch(() => undefined)
  }

  const control = state?.control ?? 'idle'
  const showFirstRun = variant !== 'popout' && !firstRunSeen

  return (
    <div className={`flex h-full min-h-0 w-full flex-col bg-bg ${className}`}>
      {showFirstRun && <FirstRunNotice onDismiss={markFirstRunSeen} />}
      <TabStrip
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={(tabId) => void br('browser:selectTab', { owner, tabId }).catch(() => undefined)}
        onClose={(tabId) => void br('browser:closeTab', { owner, tabId }).catch(() => undefined)}
        onNew={() => newTab()}
      />
      {tabs.length > 0 && (
        <UrlBar
          tab={activeTab}
          picking={!!state?.picking}
          popoutActive={state?.hostedIn === 'popout'}
          onNavigate={handleNavigate}
          onHistory={handleHistory}
          onTogglePick={handleTogglePick}
          onAddToChat={() => void handleAddToChat()}
          onPopOut={handlePopOut}
          onOpenExternal={handleOpenExternal}
        />
      )}
      <AgentBar
        control={control}
        agentLabel={state?.agentLabel ?? null}
        userActive={!!state?.userActive}
        onPause={() => void br('browser:agent', { owner, action: 'pause' }).catch(() => undefined)}
        onResume={() => void br('browser:agent', { owner, action: 'resume' }).catch(() => undefined)}
        onStop={() => void br('browser:agent', { owner, action: 'stop' }).catch(() => undefined)}
      />
      <NoticeLine notice={state?.notice} />
      <Cards requests={approvals} onRespond={handleRespond} />
      <div className="min-h-0 flex-1">
        {state?.hostedIn === 'popout' ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted">
            <p>Abierto en ventana aparte</p>
            <button type="button" onClick={handlePopOut} className="rounded-md border border-border px-2.5 py-1 hover:bg-hover">
              Traer aquí
            </button>
          </div>
        ) : tabs.length === 0 ? (
          <EmptyState disabledReason={state?.disabledReason} onNewTab={() => newTab()} />
        ) : (
          <Viewport owner={owner} tab={activeTab} visible={visible} devServers={devServers} onUseDevServer={(url) => handleNavigate(url)} />
        )}
      </div>
    </div>
  )
}
