/**
 * Code en la pantalla del celular (superficie `remote`, tanda T8 `movil-code`).
 *
 * Una sola columna: lista de sesiones → conversación (MessageStream + Composer). Cambios, Archivos, el navegador del agente (solo
 * vista) y las acciones de la sesión se abren como hojas (`Sheet`) a pantalla completa o desde abajo. Nada de esto se monta en
 * Mac ni en Windows: `CodeWorkspace` solo entra aquí con `isRemoteSurface()`.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  ChevronLeft,
  FileCode2,
  GitCompare,
  GitFork,
  Globe,
  LayoutGrid,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Sparkles,
  Square
} from 'lucide-react'
import type { BrowserCapture, BrowserOwner } from '@shared/ipc-browser'
import { Sheet } from '../../../components/mobile/Sheet'
import { useT } from '../../../lib/i18n'
import { br } from '../../browser'
import { errorMessage } from './client'
import { abbreviatePath } from './mobile-logic'
import { showCodeChat, useCodeMobile } from './mobile-store'
import { SheetAction } from './SheetAction'
import { ChangesPanel } from './panels/ChangesPanel'
import { FilesPanel } from './panels/FilesPanel'
import { baseName, TrustGate } from './ProjectPicker'
import { SessionList } from './SessionList'
import { useCode } from './store'
import './mobile.css'

const SHEET_BODY_H = 'h-[calc(100dvh-3rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))]'

/** Barra superior de la conversación: volver, título, detener, Cambios, Archivos y más. */
export function MobileToolbar({ directory, branch }: { directory: string; branch: ReactNode }): React.JSX.Element {
  const t = useT()
  const session = useCode((s) => (s.activeSessionID ? s.sessions[s.activeSessionID] : undefined))
  const run = useCode((s) => (s.activeSessionID ? s.runState[s.activeSessionID] : undefined))
  const abort = useCode((s) => s.abort)
  const setScreen = useCodeMobile((s) => s.setScreen)
  const openSheet = useCodeMobile((s) => s.openSheet)
  const sheet = useCodeMobile((s) => s.sheet)
  const busy = run === 'busy' || run === 'retry'
  const btn = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-hover hover:text-fg active:bg-active'
  return (
    <div className="flex min-h-14 shrink-0 items-center gap-0.5 border-b border-border px-1">
      <button type="button" aria-label={t('code.m.back')} title={t('code.m.back')} onClick={() => setScreen('list')} className={btn}>
        <ChevronLeft size={22} />
      </button>
      <div className="min-w-0 flex-1 px-1">
        <div className="truncate text-[15px] leading-tight font-semibold">{session?.title || t('code.sessions.untitled')}</div>
        <div className="flex min-w-0 items-center gap-1.5 pt-0.5">
          {branch}
          <span className="min-w-0 truncate font-mono text-[11px] text-subtle" title={directory}>
            {abbreviatePath(directory, 26)}
          </span>
        </div>
      </div>
      {busy && (
        <button
          type="button"
          onClick={() => void abort()}
          aria-label={t('code.toolbar.stop')}
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-danger hover:bg-danger/10 active:bg-danger/15"
        >
          <Square size={12} fill="currentColor" /> {t('code.toolbar.stop')}
        </button>
      )}
      <button
        type="button"
        aria-label={t('code.panel.changes')}
        title={t('code.panel.changes')}
        aria-pressed={sheet === 'changes'}
        onClick={() => openSheet('changes')}
        className={btn}
      >
        <GitCompare size={19} />
      </button>
      <button
        type="button"
        aria-label={t('code.panel.files')}
        title={t('code.panel.files')}
        aria-pressed={sheet === 'files'}
        onClick={() => openSheet('files')}
        className={btn}
      >
        <FileCode2 size={19} />
      </button>
      <button
        type="button"
        aria-label={t('code.m.more')}
        title={t('code.m.more')}
        aria-haspopup="dialog"
        onClick={() => openSheet('actions')}
        className={btn}
      >
        <MoreHorizontal size={20} />
      </button>
    </div>
  )
}

/** Primera pantalla: proyecto, «Nueva sesión» y la lista de sesiones. */
function SessionsScreen({ directory }: { directory: string }): React.JSX.Element {
  const t = useT()
  const closeProject = useCode((s) => s.closeProject)
  const newSession = useCode((s) => s.newSession)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-14 shrink-0 items-center gap-1 border-b border-border pr-1 pl-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] leading-tight font-semibold">{baseName(directory)}</div>
          <div className="truncate font-mono text-[11px] text-subtle" title={directory}>
            {abbreviatePath(directory, 34)}
          </div>
        </div>
        <button
          type="button"
          onClick={closeProject}
          aria-label={t('code.menu.recentProjects')}
          title={t('code.menu.recentProjects')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-hover hover:text-fg"
        >
          <LayoutGrid size={19} />
        </button>
      </div>
      <div className="shrink-0 px-3 pt-3 pb-1">
        <button
          type="button"
          onClick={() => {
            void newSession()
            showCodeChat()
          }}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-medium text-accent-fg active:opacity-90"
        >
          <Plus size={18} /> {t('app.mode.newSession')}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pt-1 pb-3">
        <SessionList compact />
      </div>
    </div>
  )
}

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
      <div className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border pr-1 pl-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium">{state.cap?.title || t('code.m.browser.title')}</div>
          {state.cap?.url && (
            <div className="truncate font-mono text-[11px] text-subtle" title={state.cap.url}>
              {state.cap.url}
            </div>
          )}
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

function MobileSheets({ directory }: { directory: string }): React.JSX.Element {
  const t = useT()
  const sheet = useCodeMobile((s) => s.sheet)
  const close = useCodeMobile((s) => s.closeSheet)
  const openSheet = useCodeMobile((s) => s.openSheet)
  const activeSessionID = useCode((s) => s.activeSessionID)
  const run = useCode((s) => (s.activeSessionID ? s.runState[s.activeSessionID] : undefined))
  const forkSession = useCode((s) => s.forkSession)
  const compactSession = useCode((s) => s.compactSession)
  const closeProject = useCode((s) => s.closeProject)
  const busy = run === 'busy' || run === 'retry'
  return (
    <>
      <Sheet open={sheet === 'changes'} onClose={close} title={t('code.panel.changes')} size="full">
        <div className={SHEET_BODY_H}>{sheet === 'changes' && <ChangesPanel key={directory} directory={directory} />}</div>
      </Sheet>
      <Sheet open={sheet === 'files'} onClose={close} title={t('code.panel.files')} size="full">
        <div className={SHEET_BODY_H}>{sheet === 'files' && <FilesPanel directory={directory} />}</div>
      </Sheet>
      <Sheet open={sheet === 'browser'} onClose={close} title={t('code.m.browser.title')} size="full">
        <div className={SHEET_BODY_H}>{sheet === 'browser' && <BrowserSnapshotView directory={directory} />}</div>
      </Sheet>
      <Sheet open={sheet === 'actions'} onClose={close} title={t('code.m.moreTitle')} size="half">
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
        <SheetAction icon={<Globe size={20} />} label={t('code.m.browser.title')} onClick={() => openSheet('browser')} />
        <SheetAction
          icon={<LayoutGrid size={20} />}
          label={t('code.menu.recentProjects')}
          onClick={() => {
            close()
            closeProject()
          }}
        />
      </Sheet>
    </>
  )
}

/** Estructura de Code en el celular. `chat` es la columna de conversación (la crea `CodeWorkspace`). */
export function MobileCodeLayout({ directory, chat }: { directory: string; chat: ReactNode }): React.JSX.Element {
  const screen = useCodeMobile((s) => s.screen)
  useEffect(() => {
    document.documentElement.dataset.surface = 'mobile'
  }, [])
  // Otro proyecto: se vuelve a la lista (y se cierran las hojas).
  useEffect(() => {
    useCodeMobile.setState({ screen: 'list', sheet: null })
  }, [directory])
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-bg text-fg">
      <TrustGate />
      {screen === 'list' ? <SessionsScreen directory={directory} /> : chat}
      <MobileSheets directory={directory} />
    </div>
  )
}
