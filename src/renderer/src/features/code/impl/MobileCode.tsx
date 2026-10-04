/**
 * Code en la pantalla del celular (superficie `remote`). El ARMAZÓN (`app/mobile/MobileShell`) es dueño de la navegación en pila y
 * de la barra superior: la lista de sesiones es la del armazón (`CodeSidebar`), y la conversación (`ChatColumn`) se monta sin
 * lista ni barra propias. Aquí viven las pantallas que Code apila sobre la conversación —Cambios, Archivos y el navegador del
 * agente (solo vista) a pantalla completa, y el menú «⋯» como hoja—; todas son entradas de la pila (`nav.ts`), así que el
 * botón/gesto «atrás» del sistema y el de la interfaz las cierran antes de volver a la lista. Nada de esto se monta en Mac ni
 * en Windows.
 */
import { useCallback, useEffect, useState } from 'react'
import { GitFork, Globe, LayoutGrid, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import type { BrowserCapture, BrowserOwner } from '@shared/ipc-browser'
import { CODE_BROWSER, CODE_CHANGES, CODE_FILES, useMobileNavStore } from '../../../app/mobile/nav'
import { Sheet } from '../../../components/mobile/Sheet'
import { useT } from '../../../lib/i18n'
import { br } from '../../browser'
import { errorMessage } from './client'
import { SheetAction } from './SheetAction'
import { ChangesPanel } from './panels/ChangesPanel'
import { FilesPanel } from './panels/FilesPanel'
import { useCode } from './store'
import './mobile.css'

/**
 * Vista del navegador del agente SOLO para mirar: una captura (`browser:capture`, lectura permitida por la política del celular).
 * No hay barra de URL ni se toca la página; «Actualizar» pide otra captura.
 */
export function BrowserSnapshotView({ directory }: { directory: string }): React.JSX.Element {
  const t = useT()
  const [state, setState] = useState<{ loading: boolean; none?: boolean; error?: string; cap?: BrowserCapture }>({ loading: true })
  const load = useCallback(async (): Promise<void> => {
    setState((s) => ({ ...s, loading: true, error: undefined }))
    const owner: BrowserOwner = { kind: 'code', directory }
    try {
      const st = await br('browser:state', { owner })
      const tab = st.tabs.find((x) => x.id === st.activeTabId) ?? st.tabs[0]
      if (!tab) return setState({ loading: false, none: true })
      const cap = await br('browser:capture', { owner, tabId: tab.id })
      setState({ loading: false, cap })
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: errorMessage(err) }))
    }
  }, [directory])
  useEffect(() => {
    void load()
  }, [load])
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border pr-1 pl-4">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[12px] text-subtle" title={state.cap?.url}>
            {state.cap?.url || state.cap?.title || t('code.m.browser.title')}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={state.loading}
          aria-label={t('code.m.browser.refresh')}
          title={t('code.m.browser.refresh')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-hover hover:text-fg disabled:opacity-50"
        >
          {state.loading ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-code">
        {state.error && (
          <div role="alert" className="px-4 py-3 text-sm text-danger">
            {t('code.m.browser.failed', { error: state.error })}
          </div>
        )}
        {state.none && <div className="px-4 py-8 text-center text-sm text-muted">{t('code.m.browser.none')}</div>}
        {state.cap && (
          <img
            src={state.cap.dataUrl}
            alt={state.cap.title || t('code.m.browser.title')}
            width={state.cap.width}
            height={state.cap.height}
            className="block h-auto w-full"
          />
        )}
      </div>
      <p className="shrink-0 border-t border-border px-4 py-2 text-xs text-subtle">{t('code.m.browser.hint')}</p>
    </div>
  )
}

/** Pantalla completa de Cambios / Archivos / navegador, apilada sobre la conversación (el título lo pone el armazón). */
export function CodePanelScreen({ screen, directory }: { screen: string; directory: string }): React.JSX.Element | null {
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      {screen === CODE_CHANGES && <ChangesPanel key={directory} directory={directory} />}
      {screen === CODE_FILES && <FilesPanel directory={directory} />}
      {screen === CODE_BROWSER && <BrowserSnapshotView directory={directory} />}
    </div>
  )
}

/** Menú «⋯» de la conversación como hoja (es una pantalla de la pila: «atrás» la cierra). */
export function CodeActionsSheet({ open }: { open: boolean }): React.JSX.Element {
  const t = useT()
  const nav = useMobileNavStore
  const close = (): void => nav.getState().pop()
  const activeSessionID = useCode((s) => s.activeSessionID)
  const run = useCode((s) => (s.activeSessionID ? s.runState[s.activeSessionID] : undefined))
  const forkSession = useCode((s) => s.forkSession)
  const compactSession = useCode((s) => s.compactSession)
  const closeProject = useCode((s) => s.closeProject)
  const busy = run === 'busy' || run === 'retry'
  return (
    <Sheet open={open} onClose={close} title={t('code.m.moreTitle')} size="half">
      {activeSessionID && (
        <>
          <SheetAction
            icon={<GitFork size={20} />}
            label={t('code.toolbar.fork')}
            disabled={busy}
            onClick={() => {
              close()
              void forkSession(activeSessionID)
            }}
          />
          <SheetAction
            icon={<Sparkles size={20} />}
            label={t('code.toolbar.compact')}
            disabled={busy}
            onClick={() => {
              close()
              void compactSession(activeSessionID)
            }}
          />
        </>
      )}
      <SheetAction icon={<Globe size={20} />} label={t('code.m.browser.title')} onClick={() => nav.getState().replace(CODE_BROWSER)} />
      <SheetAction
        icon={<LayoutGrid size={20} />}
        label={t('code.menu.recentProjects')}
        onClick={() => {
          close()
          closeProject()
        }}
      />
    </Sheet>
  )
}
