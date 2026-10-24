/**
 * Modo Code: agente de programación sobre una carpeta (sesiones OpenCode con `directory` = proyecto).
 *
 *  ┌ sesiones ┬──────────── chat ────────────┬─ panel derecho ─┐
 *  │          │ toolbar (agente, acciones)    │ Cambios          │
 *  │          │ mensajes + permisos           │ Terminal         │
 *  │          │ composer (Plan / Build)       │ Archivos         │
 *  └──────────┴──────────────────────────────┴──────────────────┘
 */
import { useRetryLabel } from '../../../lib/retry-info'
import { displayTitle } from '@shared/session-title'
import { NoAiBanner } from '../../../components/NoAiBanner'
import { ReadingModeSwitch } from '../../../components/ReadingModeSwitch'
import { ExportMenuButton } from '../../../components/ExportConversation'
import { exportCodeConversation } from './export'
import { EnvironmentPanel } from '../../../components/EnvironmentPanel'
import { useHostName } from '../../../lib/use-host-name'
import { ErrorNotice } from '../../../components/conversation/ErrorNotice'
import type { ConvError } from '../../../lib/session-reducer'
import type { MsgKey } from '@shared/i18n'
import { tildify } from '../../../lib/paths'
import { useT } from '../../../lib/i18n'
import { LogoMark } from '../../../components/Logo'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Session } from '@opencode-ai/sdk/v2/client'
import {
  ChevronDown,
  Code2,
  FileCode2,
  FolderOpen,
  FolderSearch,
  GitBranch,
  GitCompare,
  GitFork,
  Globe,
  Hammer,
  LayoutGrid,
  ListChecks,
  ListTodo,
  Loader2,
  Search,
  Sparkles,
  Square,
  SquareTerminal,
  X
} from 'lucide-react'
import type { BrowserOwner } from '@shared/ipc-browser'
import { br, BrowserPanel, onBrowser } from '../../browser'
import { IconButton } from '../../../components/IconButton'
import { isRemoteSurface, platformCaps } from '../../../lib/platform'
import { nativeCode, useClient } from './client'
import { diffStats } from '../../../components/DiffView'
import { CodeMemoryProposalCard } from './CodeMemoryProposalCard'
import { PersonalizeButton } from '../../memory/PersonalizeButton'
import { ToolbarMore } from './ToolbarMore'
import { Composer } from './Composer'
import { CodeHomeBlocks, useCodeHome } from './CodeHomeBlocks'
import { HomeIdeas } from '../../../components/HomeBlocks'
import { loadCodeLearnedMemory } from './learned-memory-store'
import { CompareConfirmDialog, CompareView, RecoveryBanner, useCompareBoot, useShownCompare } from '../../compare'
import { useCodeAiGate } from './ComposerControls'
import { MessageStream } from './MessageStream'
import { CODE_CHANGES, useMobileNavStore } from '../../../app/mobile/nav'
import { useVisibleFsVersion } from './useVisibleFsVersion'
import { TranscriptLoading } from '../../../components/TranscriptLoader'
import { ChangesPanel } from './panels/ChangesPanel'
import { FilesPanel } from './panels/FilesPanel'
import { TerminalPanel } from './panels/TerminalPanel'
import { ShellRunProvider } from './ShellRunProvider'
import { ensureFolderReadable } from './folder-access'
import { ProjectPicker, baseName, pickAndOpenFolder, TrustGate, openProjectTrusted } from './ProjectPicker'
import { askCloseProject, SessionList } from './SessionList'
import { ensureCodeSubscription, isCodeTranscriptLoading, liveHelperCount, rootSessionID, selectCodeRunOf, useCode } from './store'
import { TodoList } from './ToolCard'
import { PlanCard } from './PlanCard'
import type { RightPanel } from './types'
import { panelLayout } from './review-logic'
import { sharedFullDiff } from './full-diff'
import { Tip } from './ui'
import { hintText, useEffectiveBindings } from '../../../keybindings/bindings'

const PANEL_LABEL: Record<RightPanel, MsgKey> = {
  changes: 'code.panel.changes',
  terminal: 'code.panel.terminal',
  files: 'code.panel.files',
  browser: 'code.panel.browser'
}
const PANEL_MIN_WIDTH: Record<RightPanel, number> = { changes: 280, terminal: 280, files: 280, browser: 640 }
const PANEL_WIDTH_KEY = 'code.panelWidth'

function readWidth(): number {
  try {
    const v = Number(localStorage.getItem(PANEL_WIDTH_KEY))
    if (v >= 280 && v <= 1200) return v
  } catch {
    // ignorar
  }
  // Sin valor guardado, en escritorio el panel ocupa ~45 % de la ventana pero el chat conserva al menos ~480 px
  // (barra lateral de 256 px incluida); nunca baja de 300 px de panel.
  if (!isRemoteSurface() && typeof window !== 'undefined') {
    const w = window.innerWidth
    return Math.round(Math.min(880, Math.max(300, Math.min(w * 0.45, w - 256 - 480))))
  }
  return 460
}

/** Margen lateral de la columna: más estrecho en el celular. */
const gutter = (): string => (isRemoteSurface() ? 'px-3' : 'px-6')

function TodoBar({ sessionID }: { sessionID: string }): React.JSX.Element | null {
  const t = useT()
  const todos = useCode((s) => s.todos[sessionID])
  const [open, setOpen] = useState(false)
  if (!todos || todos.length === 0) return null
  const done = todos.filter((x) => x.status === 'completed' || x.status === 'cancelled').length
  if (done === todos.length && !open) return null
  const current = todos.find((x) => x.status === 'in_progress') ?? todos.find((x) => x.status === 'pending')
  const pct = Math.round((done / todos.length) * 100)
  return (
    <div className={`mx-auto w-full max-w-3xl pb-2 desk:max-w-[var(--measure-prose)] ${gutter()}`}>
      <div className="overflow-hidden rounded-xl border border-border bg-elevated text-[13px] shadow-sm">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={`flex w-full items-center gap-2.5 px-3 text-left text-muted hover:text-fg ${isRemoteSurface() ? 'min-h-11' : 'py-2'}`}
        >
          <ListTodo size={14} className="shrink-0 text-accent" />
          <span className="shrink-0 font-medium text-fg">{t('code.todo.title')}</span>
          <span className="shrink-0 text-xs tabular-nums text-subtle">
            {done}/{todos.length}
          </span>
          {current && !open && <span className="min-w-0 truncate">{current.content}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <span className="h-1 w-16 overflow-hidden rounded-full bg-hover">
              <span className="block h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
            </span>
            <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </span>
        </button>
        {open && (
          <div className="max-h-56 overflow-y-auto border-t border-border px-3 py-2">
            <TodoList todos={todos} />
          </div>
        )}
      </div>
    </div>
  )
}

/** Título de la pestaña activa del navegador (para la etiqueta del panel), truncado por CSS. */
function useBrowserTabTitle(directory: string): string {
  const t = useT()
  const [title, setTitle] = useState<string | null>(null)
  useEffect(() => {
    const owner: BrowserOwner = { kind: 'code', directory }
    const apply = (s: { owner: BrowserOwner; tabs: { id: string; title: string }[]; activeTabId: string | null }): void => {
      if (s.owner.kind !== 'code' || s.owner.directory !== directory) return
      const tabTitle = s.tabs.find((x) => x.id === s.activeTabId)?.title
      setTitle(tabTitle && tabTitle.trim() ? tabTitle : null)
    }
    let cancelled = false
    void br('browser:state', { owner })
      .then((s) => !cancelled && apply(s))
      .catch(() => undefined)
    const off = onBrowser('browser:state', apply)
    return () => {
      cancelled = true
      off()
    }
  }, [directory])
  return title ?? t('code.panel.browser')
}

/** Ancho (px) del elemento (ref de callback: el elemento puede montarse más tarde), al día con `ResizeObserver`. 0 hasta la primera medida. */
function useElementWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return
    const sync = (): void => setW((prev) => (Math.round(el.clientWidth) === prev ? prev : Math.round(el.clientWidth)))
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, w]
}

function SidePanels({ directory, containerWidth }: { directory: string; containerWidth: number }): React.JSX.Element | null {
  const bindings = useEffectiveBindings()
  const t = useT()
  const panel = useCode((s) => s.panel)
  const togglePanel = useCode((s) => s.togglePanel)
  const branch = useBranch(directory)
  const [width, setWidth] = useState(readWidth)
  // «Cambios» va fijo a la derecha mientras el centro conserve ~36 rem; con menos espacio va lado a lado (≤ 26 rem) o, si ni así caben dos mitades útiles, cubre toda el área
  // (nunca tapa la conversación a medias). Los demás paneles conservan su regla de siempre (el chat nunca baja de 22 rem).
  const layout = panel === 'changes' ? panelLayout(containerWidth, width) : null
  const full = layout?.mode === 'full'
  // La terminal se mantiene montada tras abrirse para conservar el shell; el navegador igual,
  // para no perder pestañas/sesión al ocultar el panel.
  const [terminalMounted, setTerminalMounted] = useState(panel === 'terminal')
  const [browserMounted, setBrowserMounted] = useState(panel === 'browser')
  useEffect(() => {
    if (panel === 'terminal') setTerminalMounted(true)
    if (panel === 'browser') setBrowserMounted(true)
  }, [panel])
  useEffect(() => {
    setTerminalMounted(panel === 'terminal')
    setBrowserMounted(panel === 'browser')
    // Al cambiar de proyecto se descartan la terminal y el navegador anteriores (solo depende de `directory`).
  }, [directory]) // eslint-disable-line react-hooks/exhaustive-deps
  // Al abrir el navegador, el panel pasa a tener al menos 640px de ancho.
  useEffect(() => {
    if (panel === 'browser') setWidth((w) => Math.max(w, PANEL_MIN_WIDTH.browser))
  }, [panel])

  const dragging = useRef<{ x: number; w: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent): void => {
    dragging.current = { x: e.clientX, w: layout ? layout.width : width }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    if (!dragging.current) return
    const min = panel ? PANEL_MIN_WIDTH[panel] : 280
    const next = Math.min(1200, Math.max(min, dragging.current.w + (dragging.current.x - e.clientX)))
    setWidth(next)
  }
  const onPointerUp = (): void => {
    dragging.current = null
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, String(width))
    } catch {
      // ignorar
    }
  }

  const owner = useMemo<BrowserOwner>(() => ({ kind: 'code', directory }), [directory])
  const browserTitle = useBrowserTabTitle(directory)

  if (!panel && !terminalMounted && !browserMounted) return null
  return (
    <div
      className={`${full ? 'absolute inset-0 z-30' : 'relative'} desk:@container flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-l border-border bg-bg ${panel ? '' : 'hidden'}`}
      data-panel-layout={layout?.mode}
      role={panel ? 'complementary' : undefined}
      aria-label={panel ? t(PANEL_LABEL[panel]) : undefined}
      // El chat conserva siempre 22 rem: con la ventana estrecha el panel cede espacio (antes lo aplastaba y la caja de entrada se deformaba).
      style={layout ? { width: layout.width, maxWidth: full ? '100%' : undefined } : { width, maxWidth: 'calc(100% - 22rem)' }}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="absolute top-0 bottom-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-accent/20"
      />
      <div aria-hidden="true" className="hidden shrink-0 desk:block" style={{ height: 'var(--controls-band, 0px)' }} />
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2 desk:h-12 desk:overflow-x-auto desk:px-3 desk:gap-0.5 desk:[scrollbar-width:none]">
        {(Object.keys(PANEL_LABEL) as RightPanel[]).map((p) => (
          <Tip key={p} label={t(PANEL_LABEL[p])} shortcut={hintText(bindings[`code.panel.${p}`])}>
            <button
              type="button"
              onClick={() => p !== panel && togglePanel(p)}
              aria-label={p === 'browser' ? browserTitle : t(PANEL_LABEL[p])}
              className={`no-drag rounded-md px-2.5 py-1 text-xs font-medium transition desk:h-7 desk:shrink-0 desk:whitespace-nowrap desk:py-0 desk:px-2.5 desk:rounded-ctl-sm desk:text-ui ${p === panel ? 'bg-active text-fg desk:font-medium' : 'text-muted hover:bg-hover hover:text-fg'}`}
            >
              {/* Panel estrecho (< 28 rem): solo el icono (el nombre sigue en el tooltip y en aria-label); ancho: solo el texto, como siempre. */}
              <span aria-hidden className="hidden desk:@max-[28rem]:inline-flex desk:@max-[28rem]:align-middle">
                {ALL_PANELS.find((x) => x.id === p)?.icon}
              </span>
              <span className="inline-block max-w-32 truncate align-bottom desk:@max-[28rem]:hidden">
                {p === 'browser' ? browserTitle : t(PANEL_LABEL[p])}
              </span>
              {p === 'changes' && !isRemoteSurface() && (branch?.changes ?? 0) > 0 && (
                <span
                  aria-hidden
                  className="ml-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-active px-1.5 align-middle text-[11px] desk:text-meta font-medium tabular-nums"
                >
                  {branch!.changes}
                </span>
              )}
            </button>
          </Tip>
        ))}
        <IconButton
          size="sm"
          label={t('code.panel.close')}
          className="sticky right-0 ml-auto bg-bg desk:shrink-0"
          onClick={() => panel && togglePanel(panel)}
        >
          <X size={14} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1">
        {panel === 'changes' && <ChangesPanel key={directory} directory={directory} />}
        {panel === 'files' && <FilesPanel directory={directory} />}
        {terminalMounted && (
          <div className={panel === 'terminal' ? 'h-full' : 'hidden'}>
            <TerminalPanel key={directory} directory={directory} visible={panel === 'terminal'} />
          </div>
        )}
        {browserMounted && (
          <div className={panel === 'browser' ? 'h-full' : 'hidden'}>
            <BrowserPanel key={directory} owner={owner} product="code" visible={panel === 'browser'} />
          </div>
        )}
      </div>
    </div>
  )
}

interface BranchInfo {
  branch: string | null
  ahead: number
  behind: number
  changes: number
  upstream: string | null
}

/** Última consulta de rama por (carpeta, versión): `SidePanels` y `BranchPill` la comparten y solo hay un `git:status` por aviso (Pf1). */
let branchLoad: { key: string; at: number; promise: Promise<BranchInfo | null> } | null = null
/** Ventana en la que dos consumidores montados por el mismo aviso comparten la consulta (no sirve para remontajes tardíos). */
const BRANCH_SHARE_MS = 1_000

function loadBranch(directory: string, fsVersion: number): Promise<BranchInfo | null> {
  const key = `${directory}\0${fsVersion}`
  if (branchLoad?.key === key && Date.now() - branchLoad.at < BRANCH_SHARE_MS) return branchLoad.promise
  const api = nativeCode()
  const promise: Promise<BranchInfo | null> = api
    ? api.git.status(directory).then((st) =>
        st.isRepo
          ? {
              branch: st.detached ? (st.head?.slice(0, 7) ?? null) : st.branch,
              ahead: st.ahead,
              behind: st.behind,
              changes: st.files.length,
              upstream: st.upstream
            }
          : null
      )
    : Promise.resolve(null)
  branchLoad = { key, at: Date.now(), promise }
  // Una consulta fallida no se reutiliza (el siguiente cambio la vuelve a pedir).
  promise.catch(() => {
    if (branchLoad?.promise === promise) branchLoad = null
  })
  return promise
}

/** Rama actual + ahead/behind (se refresca cuando cambian archivos). */
function useBranch(directory: string): BranchInfo | null {
  const fsVersion = useVisibleFsVersion()
  const [info, setInfo] = useState<BranchInfo | null>(null)
  // Al cambiar de proyecto no se muestra la rama del anterior mientras carga la nueva.
  useEffect(() => {
    setInfo(null)
  }, [directory])
  useEffect(() => {
    let cancelled = false
    loadBranch(directory, fsVersion)
      .then((i) => !cancelled && setInfo(i))
      .catch(() => !cancelled && setInfo(null))
    return () => {
      cancelled = true
    }
  }, [directory, fsVersion])
  return info
}

function ProjectMenu({ directory }: { directory: string }): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const showProjectPicker = useCode((s) => s.showProjectPicker)
  const openDirectories = useCode((s) => s.openDirectories)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  const item = 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-muted hover:bg-hover hover:text-fg'
  // Mostrar en Finder / abrir en el editor / elegir otra carpeta: diálogos y apps del Mac (no existen en la PWA del celular).
  const native = nativeCode('dialogs')
  const dialogs = platformCaps().nativeDialogs
  // Desktop: puede haber otros proyectos abiertos a la vez (en segundo plano); el celular reemplaza, como siempre.
  const others = isRemoteSurface() ? [] : openDirectories.filter((d) => d !== directory)
  return (
    <div
      ref={ref}
      className="no-drag relative max-w-48 min-w-12 shrink-0 desk:max-w-[min(22rem,40%)] desk:min-w-[7.5rem] desk:shrink desk:@max-[40rem]:min-w-[5.5rem]"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={directory}
        className="flex max-w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-md px-1.5 py-1 text-sm font-semibold hover:bg-hover desk:font-medium"
      >
        <FolderOpen size={15} className="shrink-0 text-accent" />
        <span className="truncate" title={baseName(directory)}>
          {baseName(directory)}
        </span>
        <ChevronDown size={13} className="shrink-0 text-subtle" />
      </button>
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-64 overflow-hidden rounded-xl border border-border bg-elevated py-1 shadow-xl">
          <div className="truncate px-3 py-1.5 font-mono text-[11px] desk:text-meta text-subtle" title={directory}>
            {tildify(directory)}
          </div>
          {others.length > 0 && (
            <>
              <div className="px-3 pt-1 pb-0.5 text-[11px] desk:text-meta font-medium text-subtle">{t('code.menu.openProjects')}</div>
              {others.map((d) => (
                <button key={d} type="button" className={item} onClick={() => (setOpen(false), void useCode.getState().focusProject(d))}>
                  <FolderOpen size={14} />
                  <span className="truncate" title={d}>
                    {baseName(d)}
                  </span>
                </button>
              ))}
              <div className="my-1 h-px bg-border" />
            </>
          )}
          {dialogs && (
            <button type="button" className={item} onClick={() => (setOpen(false), void pickAndOpenFolder())}>
              <FolderOpen size={14} /> {t('code.menu.openAnother')}
            </button>
          )}
          <button type="button" className={item} onClick={() => (setOpen(false), showProjectPicker())}>
            <LayoutGrid size={14} /> {t('code.menu.recentProjects')}
          </button>
          <button
            type="button"
            className={item}
            onClick={() => {
              setOpen(false)
              void askCloseProject(t, directory)
            }}
          >
            <X size={14} /> {t('code.menu.closeProject')}
          </button>
          {native && (
            <>
              <div className="my-1 h-px bg-border" />
              <button type="button" className={item} onClick={() => (setOpen(false), void native.dialog.revealInFinder(directory))}>
                <FolderSearch size={14} /> {t('code.menu.reveal')}
              </button>
              <button type="button" className={item} onClick={() => (setOpen(false), void native.dialog.openInEditor(directory))}>
                <Code2 size={14} /> {t('code.menu.openEditor')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Panel «Entorno» de la barra de Code (solo escritorio): equipo, carpeta del proyecto y rama. */
function CodeEnvironment({ directory }: { directory: string }): React.JSX.Element {
  const hostName = useHostName()
  const info = useBranch(directory)
  return (
    <EnvironmentPanel
      hostName={hostName}
      directory={directory}
      branch={info && info.branch ? { name: info.branch, changes: info.changes } : null}
    />
  )
}

export function BranchPill({ directory }: { directory: string }): React.JSX.Element | null {
  const t = useT()
  const info = useBranch(directory)
  const togglePanel = useCode((s) => s.togglePanel)
  const panel = useCode((s) => s.panel)
  if (!info || !info.branch) return null
  const sync = info.ahead > 0 || info.behind > 0
  const tip = [
    t('code.branch.name', { branch: info.branch }),
    info.upstream ? t('code.branch.tracks', { upstream: info.upstream }) : t('code.branch.noUpstream'),
    info.changes ? t('code.branch.changes', { count: info.changes }) : t('code.branch.clean')
  ].join(' · ')
  return (
    <Tip label={tip} className="no-drag desk:max-w-40 desk:shrink-0">
      <button
        type="button"
        onClick={() =>
          isRemoteSurface() ? useMobileNavStore.getState().push(CODE_CHANGES) : panel !== 'changes' && togglePanel('changes')
        }
        className={`no-drag flex max-w-52 items-center gap-1.5 rounded-full border border-border bg-bg font-mono text-[11px] text-muted hover:border-border-strong hover:text-fg desk:max-w-full desk:min-w-0 desk:rounded-ctl-sm desk:border-transparent desk:hover:border-transparent desk:bg-active desk:hover:bg-hover desk:h-6 desk:text-[12px] desk:px-2 ${isRemoteSurface() ? 'min-h-8 px-2.5' : 'px-2 py-0.5'}`}
      >
        <GitBranch size={12} className="shrink-0" />
        <span className="truncate" title={info.branch}>
          {info.branch}
        </span>
        {sync && (
          <span className="flex shrink-0 items-center gap-1 text-subtle">
            {info.ahead > 0 && <span>↑{info.ahead}</span>}
            {info.behind > 0 && <span>↓{info.behind}</span>}
          </span>
        )}
        {info.changes > 0 && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />}
      </button>
    </Tip>
  )
}

const STATS_MAX_CHARS = 4_000_000

/** +líneas / −líneas de todos los cambios del repo (staged + unstaged + nuevos). Null si no se puede o el diff es enorme. */
function useChangeStats(directory: string, changes: number): { additions: number; deletions: number } | null {
  const fsVersion = useVisibleFsVersion()
  const [stats, setStats] = useState<{ additions: number; deletions: number } | null>(null)
  useEffect(() => {
    const native = nativeCode()
    if (!native || changes <= 0) {
      setStats(null)
      return
    }
    let cancelled = false
    // El mismo diff que pide el panel Cambios (misma carpeta y versión del disco): una sola llamada.
    void sharedFullDiff(directory, fsVersion, () => native.git.diff({ cwd: directory }))
      .then((patch) => {
        if (cancelled) return
        setStats(patch.length > STATS_MAX_CHARS ? null : diffStats(patch))
      })
      .catch(() => !cancelled && setStats(null))
    return () => {
      cancelled = true
    }
  }, [directory, changes, fsVersion])
  return stats
}

/** Barra fija sobre la caja de entrada: cuántos archivos tienen cambios y un botón para revisarlos (como en Codex y Claude). */
function ChangesBar({ directory }: { directory: string }): React.JSX.Element | null {
  const t = useT()
  const info = useBranch(directory)
  const togglePanel = useCode((s) => s.togglePanel)
  const panel = useCode((s) => s.panel)
  const stats = useChangeStats(directory, info?.changes ?? 0)
  if (isRemoteSurface() || !info || info.changes <= 0) return null
  const open = panel === 'changes'
  return (
    <div className={`mx-auto mb-2 w-full max-w-3xl desk:max-w-[var(--measure-prose)] ${gutter()}`}>
      <div
        data-testid="changes-bar"
        className="flex min-w-0 animate-rise-in flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border bg-elevated px-3 py-2 text-sm shadow-sm"
      >
        <GitCompare size={15} className="shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 flex-1 basis-40 truncate">
          {t('code.changesbar.text', { count: info.changes })}
          {stats && (
            <span className="ml-2 font-mono text-xs tabular-nums">
              <span className="text-success">+{stats.additions}</span> <span className="text-danger">−{stats.deletions}</span>
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => togglePanel('changes')}
          className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent-soft"
        >
          {open ? t('code.changesbar.hide') : t('code.changesbar.review')}
        </button>
      </div>
    </div>
  )
}

const ALL_PANELS: { id: RightPanel; label: MsgKey; icon: React.JSX.Element }[] = [
  { id: 'changes', label: 'code.panel.changes', icon: <GitCompare size={16} /> },
  { id: 'terminal', label: 'code.panel.terminal', icon: <SquareTerminal size={16} /> },
  { id: 'files', label: 'code.panel.files', icon: <FileCode2 size={16} /> },
  { id: 'browser', label: 'code.panel.browser', icon: <Globe size={16} /> }
]
/** Grupos lógicos de la barra: revisión (Cambios) y herramientas (Terminal, Archivos, Navegador). Separados por una línea fina. */
const PANEL_GROUPS: { key: string; label: MsgKey; ids: RightPanel[] }[] = [
  { key: 'review', label: 'code.toolbar.group.review', ids: ['changes'] },
  { key: 'tools', label: 'code.toolbar.group.tools', ids: ['terminal', 'files', 'browser'] }
]
/** Sin terminal (pty) ni vista nativa del navegador en la PWA del celular; en Mac y Windows no cambia nada. */
const PANEL_META = ALL_PANELS.filter(
  (p) => (p.id !== 'terminal' || platformCaps().terminal) && (p.id !== 'browser' || platformCaps().nativeBrowser)
)

function Toolbar({ directory }: { directory: string }): React.JSX.Element {
  const t = useT()
  const bindings = useEffectiveBindings()
  const session = useCode((s) => (s.activeSessionID ? s.sessions[s.activeSessionID] : undefined))
  const activeSessionID = useCode((s) => s.activeSessionID)
  // Cuenta también a los ayudantes en segundo plano: la raíz puede figurar `idle` mientras ellos trabajan.
  const run = useCode((s) => selectCodeRunOf(s, s.activeSessionID))
  const helpers = useCode((s) => (s.activeSessionID ? liveHelperCount(s, s.activeSessionID) : 0))
  const panel = useCode((s) => s.panel)
  const togglePanel = useCode((s) => s.togglePanel)
  const abort = useCode((s) => s.abort)
  const forkSession = useCode((s) => s.forkSession)
  const compactSession = useCode((s) => s.compactSession)
  const busy = run === 'busy' || run === 'retry'

  return (
    <div
      className="drag flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 desk:@container desk:pl-[calc(var(--header-inset,0px)+12px)] desk:pr-[calc(var(--controls-inset,0px)+12px)]"
      // Con un panel abierto a la derecha, los controles de ventana de Windows quedan sobre ÉL: la barra no reserva ese hueco.
      style={panel ? ({ '--controls-inset': '0px' } as React.CSSProperties) : undefined}
    >
      <ProjectMenu directory={directory} />
      {/* La rama también está en «Entorno» y en el panel Cambios: con la barra estrecha cede el sitio al título de la sesión. */}
      <span className="contents desk:@max-[40rem]:hidden">
        <BranchPill directory={directory} />
      </span>
      {session && (
        // Escritorio: el título se muestra (truncado, con el título completo en el tooltip) según el ancho REAL de la barra
        // (consulta de contenedor), no por punto de quiebre de la ventana; nunca baja de ~5 rem.
        <span className="hidden min-w-0 items-center gap-2 text-sm text-muted lg:flex desk:flex desk:min-w-[5rem] desk:flex-1 desk:shrink-[4]">
          <span className="text-subtle">/</span>
          <span className="truncate" title={displayTitle(session.title, t('code.sessions.untitled'))} data-testid="toolbar-session-title">
            {displayTitle(session.title, t('code.sessions.untitled'))}
          </span>
        </span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {busy && (
          <Tip
            label={helpers > 0 ? t('code.toolbar.stopAll', { count: helpers }) : t('code.toolbar.stop')}
            shortcut={hintText(bindings['session.stop']).replace(/^Esc$/, 'esc')}
          >
            <button
              type="button"
              aria-label={t('code.toolbar.stop')}
              onClick={() => void abort()}
              className="no-drag flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10"
            >
              <Square size={10} fill="currentColor" />
              <span className="block desk:@max-[32rem]:hidden">{t('code.toolbar.stop')}</span>
            </button>
          </Tip>
        )}
        {!isRemoteSurface() && <CodeEnvironment directory={directory} />}
        <ReadingModeSwitch surface="code" />
        {/* Conversación: memoria, exportar, bifurcar y compactar. Barra ancha: iconos con la etiqueta en el tooltip; estrecha: menú «…» con texto. */}
        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
        <div role="group" aria-label={t('code.toolbar.group.conversation')} className="flex items-center gap-1.5">
          <span className="contents desk:@max-[44rem]:hidden">
            <PersonalizeButton />
            {session && !isRemoteSurface() && <ExportMenuButton onAction={(a) => void exportCodeConversation(session, a)} />}
            {activeSessionID && (
              <>
                <Tip label={t('code.toolbar.fork')}>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={t('code.toolbar.fork')}
                    onClick={() => void forkSession(activeSessionID)}
                    className="no-drag flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
                  >
                    <GitFork size={14} />
                  </button>
                </Tip>
                <Tip label={t('code.toolbar.compact')}>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={t('code.toolbar.compact')}
                    onClick={() => void compactSession(activeSessionID)}
                    className="no-drag flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
                  >
                    <Sparkles size={14} />
                  </button>
                </Tip>
              </>
            )}
          </span>
          {!isRemoteSurface() && (
            <ToolbarMore
              hasSession={!!session}
              busy={busy}
              onExport={(a) => session && void exportCodeConversation(session, a)}
              onFork={() => activeSessionID && void forkSession(activeSessionID)}
              onCompact={() => activeSessionID && void compactSession(activeSessionID)}
            />
          )}
        </div>
        {/* Con un panel abierto y la barra estrecha, sus pestañas ya están en el panel: se ocultan aquí y el título de la sesión cabe. */}
        <span className={panel ? 'contents desk:@max-[48rem]:hidden' : 'contents'}>
          {PANEL_GROUPS.map((group) => {
            const items = PANEL_META.filter((p) => group.ids.includes(p.id))
            if (items.length === 0) return null
            return (
              <Fragment key={group.key}>
                <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
                <div role="group" aria-label={t(group.label)} className="flex items-center gap-0.5">
                  {items.map((p) => (
                    <Tip
                      key={p.id}
                      label={t(p.label)}
                      shortcut={hintText(bindings[`code.panel.${p.id}`])}
                      align={p.id === 'browser' ? 'end' : 'center'}
                    >
                      <button
                        type="button"
                        aria-label={t(p.label)}
                        aria-pressed={panel === p.id}
                        onClick={() => togglePanel(p.id)}
                        className={`no-drag inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg px-1.5 transition-colors desk:@[64rem]:px-2.5 ${panel === p.id ? 'bg-active text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
                      >
                        {p.icon}
                        {/* La etiqueta solo aparece cuando la ventana es ancha: en estrecha quedan los iconos de siempre. */}
                        <span className="hidden text-[13px] font-medium desk:@[64rem]:inline">{t(p.label)}</span>
                      </button>
                    </Tip>
                  ))}
                </div>
              </Fragment>
            )
          })}
        </span>
      </div>
    </div>
  )
}

const SUGGESTIONS: { label: MsgKey; prompt: MsgKey; agent: 'plan' | 'build' }[] = [
  { label: 'code.suggest.explain', prompt: 'code.suggest.explain.prompt', agent: 'plan' },
  { label: 'code.suggest.review', prompt: 'code.suggest.review.prompt', agent: 'plan' },
  { label: 'code.suggest.types', prompt: 'code.suggest.types.prompt', agent: 'build' },
  { label: 'code.suggest.tests', prompt: 'code.suggest.tests.prompt', agent: 'build' }
]

function EmptySession({ directory, error }: { directory: string; error: ConvError | null }): React.JSX.Element {
  const t = useT()
  const send = useCode((s) => s.send)
  const setAgent = useCode((s) => s.setAgent)
  const client = useClient()
  const home = useCodeHome(directory)
  // Celular: la pantalla vacía no cambia. Escritorio: con sesiones previas, retomar va primero y los ejemplos pasan a segundo plano.
  const returning = home.hasSessions && !isRemoteSurface()
  return (
    <div className="my-auto w-full max-w-xl">
      <LogoMark size={44} className="mx-auto mb-3" />
      <h2 className="text-xl font-semibold tracking-tight">{t('code.empty.title', { name: baseName(directory) })}</h2>
      {!returning && (
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted">
          {t('code.empty.use')}
          <b className="font-medium text-fg">{'Plan'}</b>
          {t('code.empty.planDesc')}
          <b className="font-medium text-fg">{'Build'}</b>
          {t('code.empty.buildDesc')}
        </p>
      )}
      {returning && (
        <div className="mt-5">
          <CodeHomeBlocks home={home} part="waiting" />
        </div>
      )}
      {returning && <CodeHomeBlocks home={home} part="resume" />}
      <HomeIdeas
        storageKey="code.hideIdeas"
        secondary={returning}
        label={t('code.home.ideas')}
        showLabel={t('code.home.ideas.show')}
        hideLabel={t('code.home.ideas.hide')}
      >
        <div className="mt-6 grid grid-cols-1 gap-2 text-left sm:grid-cols-2">
          {SUGGESTIONS.map((sug) => {
            const plan = sug.agent === 'plan'
            const Icon = plan ? Search : Hammer
            return (
              <button
                key={sug.label}
                type="button"
                disabled={!client}
                onClick={() => {
                  setAgent(sug.agent)
                  void send(t(sug.prompt))
                }}
                className="group flex items-start gap-3 rounded-xl border border-border bg-elevated px-3.5 py-3 text-left transition hover:-translate-y-px hover:border-border-strong hover:bg-hover hover:shadow-sm disabled:opacity-50"
              >
                <span
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${plan ? 'bg-accent-soft text-accent' : 'bg-emerald-500/15 text-emerald-600 [[data-theme=dark]_&]:text-emerald-400'}`}
                >
                  <Icon size={15} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-fg">{t(sug.label)}</span>
                  <span className="block text-xs text-muted">{plan ? t('code.suggest.tag.plan') : t('code.suggest.tag.build')}</span>
                </span>
              </button>
            )
          })}
        </div>
      </HomeIdeas>
      {error && (
        <div className="mt-3 w-full max-w-xl text-left">
          <ErrorNotice error={error} />
        </div>
      )}
    </div>
  )
}

function belongs(sessions: Record<string, Session>, sessionID: string, active: string): boolean {
  const root = rootSessionID(sessions, sessionID)
  return root === active || !sessions[root]
}

/**
 * Tarjeta que aparece cuando el agente "plan" termina de responder: ofrece pasar a Build y pedirle
 * que ejecute lo planificado, sin que el usuario tenga que escribirlo.
 */
function PlanApprovalCard({ sessionID }: { sessionID: string }): React.JSX.Element | null {
  const t = useT()
  const agent = useCode((s) => s.agent)
  const run = useCode((s) => s.runState[sessionID])
  const entries = useCode((s) => s.messages[sessionID])
  const setAgent = useCode((s) => s.setAgent)
  const send = useCode((s) => s.send)
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const busy = run === 'busy' || run === 'retry'

  const lastAssistant = useMemo(() => {
    if (!entries) return null
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i].info.role === 'assistant') return entries[i]
    return null
  }, [entries])

  if (agent !== 'plan' || busy || !lastAssistant) return null
  const hasText = lastAssistant.parts.some((p) => p.type === 'text' && p.text.trim())
  if (!hasText || dismissedFor === lastAssistant.info.id) return null

  return (
    <div className={`mx-auto mb-2 w-full max-w-3xl desk:max-w-[var(--measure-prose)] ${gutter()}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-accent/40 bg-accent-soft/40 px-3.5 py-2.5 text-sm">
        <ListChecks size={16} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 basis-48 text-fg/90">{t('code.plan.ask')}</span>
        <button
          type="button"
          onClick={() => setDismissedFor(lastAssistant.info.id)}
          className={`shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-hover hover:text-fg ${isRemoteSurface() ? 'min-h-11 flex-1 px-4 text-[13px]' : ''}`}
        >
          {t('code.plan.notNow')}
        </button>
        <button
          type="button"
          onClick={() => {
            setDismissedFor(lastAssistant.info.id)
            setAgent('build')
            void send(t('code.plan.proceed'))
          }}
          className={`shrink-0 whitespace-nowrap rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:opacity-90 ${isRemoteSurface() ? 'min-h-11 flex-1 px-4 text-[13px]' : ''}`}
        >
          {t('code.plan.approve')}
        </button>
      </div>
    </div>
  )
}

function ChatColumn({ directory }: { directory: string }): React.JSX.Element {
  const t = useT()
  const sid = useCode((s) => s.activeSessionID)
  const entries = useCode((s) => (sid ? s.messages[sid] : undefined))
  const run = useCode((s) => (sid ? s.runState[sid] : undefined))
  const retryLabel = useRetryLabel(sid)
  const error = useCode((s) => (sid ? (s.errors[sid] ?? null) : null))
  const loading = useCode((s) => (sid ? !!s.loadingMessages[sid] : false))
  const evictedLoading = useCode((s) => isCodeTranscriptLoading(s, sid))
  const revertID = useCode((s) => (sid ? s.sessions[sid]?.revert?.messageID : undefined))
  const globalError = useCode((s) => s.globalError)
  const setGlobalError = useCode((s) => s.setGlobalError)
  const unrevert = useCode((s) => s.unrevert)
  const permissionsAll = useCode(useShallow((s) => Object.values(s.permissions)))
  const questionsAll = useCode(useShallow((s) => Object.values(s.questions)))
  const sessions = useCode((s) => s.sessions)
  const permissions = useMemo(
    // Permisos de sesiones desconocidas (subagentes aún no listados) se muestran en la sesión activa.
    () => permissionsAll.filter((p) => !!sid && belongs(sessions, p.sessionID, sid)),
    [permissionsAll, sessions, sid]
  )
  const questions = useMemo(() => questionsAll.filter((q) => !!sid && belongs(sessions, q.sessionID, sid)), [questionsAll, sessions, sid])
  const client = useClient()
  const aiGate = useCodeAiGate()
  const setModel = useCode((s) => s.setModel)
  const busy = run === 'busy' || run === 'retry'
  // «Comparar modelos»: activo solo en escritorio (en el celular nunca hay una comparación abierta ni se sincroniza nada).
  useCompareBoot()
  const compareId = useShownCompare('code', directory)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Celular: la barra superior es la del armazón (MobileShell); aquí no hay otra. */}
      {!isRemoteSurface() && <Toolbar directory={directory} />}
      <RecoveryBanner mode="code" directory={directory} />
      <CompareConfirmDialog mode="code" directory={directory} />
      {globalError && (
        <div className="flex items-center gap-2 border-b border-danger/30 bg-danger/10 px-4 py-1.5 text-xs text-danger">
          <span className="min-w-0 flex-1 truncate">{globalError}</span>
          <button type="button" onClick={() => setGlobalError(null)} className="shrink-0 hover:underline">
            {t('code.chat.close')}
          </button>
        </div>
      )}
      {compareId ? (
        <CompareView
          id={compareId}
          onAdopted={() => useCode.getState().touchFs()}
          onOpenWorktree={(path) => void openProjectTrusted(path)}
        />
      ) : sid && entries && entries.length > 0 ? (
        <MessageStream
          entries={entries}
          busy={busy}
          retrying={run === 'retry'}
          retryLabel={retryLabel}
          error={error}
          root={directory}
          permissions={permissions}
          questions={questions}
          revertMessageID={revertID}
          onUnrevert={() => void unrevert()}
          loading={loading}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 text-center">
          {evictedLoading ? (
            <TranscriptLoading />
          ) : loading ? (
            <Loader2 size={18} className="animate-spin text-muted" />
          ) : (
            <EmptySession directory={directory} error={error} />
          )}
        </div>
      )}
      {/* Escritorio: tarjeta «Plan»; la barra de tareas compacta queda para el celular (sin cambios allí). */}
      {sid && !isRemoteSurface() && <PlanCard sessionID={sid} />}
      {sid && isRemoteSurface() && <TodoBar sessionID={sid} />}
      {sid && <PlanApprovalCard sessionID={sid} />}
      <ChangesBar directory={directory} />
      {sid && entries && !busy && (
        <div className={`mx-auto mb-2 w-full max-w-3xl desk:max-w-[var(--measure-prose)] ${gutter()}`}>
          <CodeMemoryProposalCard sessionId={sid} messages={entries} folder={directory} />
        </div>
      )}
      <div className={`mx-auto w-full max-w-3xl desk:max-w-[var(--measure-prose)] ${gutter()}`}>
        <NoAiBanner gate={aiGate.gate} freeModel={aiGate.free} onUseFree={setModel} />
      </div>
      <Composer busy={busy} disabled={!client || aiGate.gate.blocked} />
    </div>
  )
}

interface CodeWorkspaceProps {
  /**
   * Muestra la lista de sesiones como columna interna. Desactivar si el layout ya la
   * muestra en la barra lateral global (usando `CodeSidebar`).
   */
  showSessionList?: boolean
}

export function CodeWorkspace({ showSessionList = true }: CodeWorkspaceProps): React.JSX.Element {
  const client = useClient()
  const directory = useCode((s) => s.directory)
  useEffect(() => ensureCodeSubscription(), [])
  // Memoria aprendida global (decisión del dueño, 2026-10-07): se relee al abrir Code, no en cada envío.
  useEffect(() => {
    void loadCodeLearnedMemory()
  }, [])

  // Atajos de Code (⌘1 Cambios · ⌘2 Terminal · ⌘3 Archivos · ⌘4 Navegador · Esc detiene): registro central `keybindings/`.

  // El navegador pide abrirse (el agente empezó a usarlo, o se aprobó un sitio) sin robar el foco.
  useEffect(() => {
    const off = onBrowser('browser:reveal', ({ owner }) => {
      const dir = useCode.getState().directory
      if (dir && owner.kind === 'code' && owner.directory === dir) useCode.getState().revealBrowserPanel()
    })
    return off
  }, [])

  // Al conectar (o reconectar con un cliente nuevo), recarga el proyecto con foco y, en paralelo, los demás abiertos.
  const loadedFor = useRef<unknown>(null)
  useEffect(() => {
    if (!client) return
    const dir = useCode.getState().directory
    if (!dir || loadedFor.current === client) return
    loadedFor.current = client
    void useCode.getState().restoreOpenProjects()
    // Si no confía en la carpeta restaurada, no se queda enfocada (sin sesiones cargadas ni motor para ella).
    void openProjectTrusted(dir, { passive: true }).then((ok) => {
      if (!ok) useCode.getState().declineFocusedProject(dir)
    })
  }, [client])

  // Cualquier carpeta que reciba el foco (barra lateral, chip, búsqueda…) se comprueba igual que al abrirla: la comprobación de «Abrir carpeta»
  // no cubre esas vías, y con el permiso del motor denegado la persona solo vería «Unexpected server error».
  const focusedDir = useCode((s) => s.directory)
  useEffect(() => {
    if (!focusedDir) return
    let live = true
    void ensureFolderReadable(focusedDir).then((ok) => {
      if (!live || ok) return
      // El «Unexpected server error» viene del intento anterior del motor contra esa carpeta: la tarjeta de permisos ya explica la causa.
      useCode.getState().setGlobalError(null)
      useCode.getState().declineFocusedProject(focusedDir)
    })
    return () => {
      live = false
    }
  }, [focusedDir])

  const [rootRef, containerWidth] = useElementWidth()
  const projectPickerOpen = useCode((s) => s.projectPickerOpen)
  const hideProjectPicker = useCode((s) => s.hideProjectPicker)

  // Título del documento: prefijo "(n)" con sesiones no leídas de TODOS los proyectos abiertos (no solo el que tiene
  // el foco) + marca como leída la activa al recuperar el foco. Nota: esto es lo más parecido a un badge que se puede
  // hacer sin tocar el proceso principal (Electron `Notification`/`app.dock.setBadge` requieren un canal IPC nuevo).
  const unread = useCode((s) => s.unread)
  const sessionProject = useCode((s) => s.sessionProject)
  const openDirectories = useCode((s) => s.openDirectories)
  const markRead = useCode((s) => s.markRead)
  useEffect(() => {
    if (!directory) return
    const open = new Set(openDirectories.length ? openDirectories : [directory])
    const count = Object.entries(unread).filter(([sid, v]) => v && open.has(sessionProject[sid])).length
    const base = document.title.replace(/^\(\d+\)\s*/, '')
    document.title = count > 0 ? `(${count}) ${base}` : base
  }, [unread, sessionProject, directory, openDirectories])
  useEffect(() => {
    const onFocus = (): void => {
      const st = useCode.getState()
      if (st.activeSessionID) markRead(st.activeSessionID)
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [markRead])

  // Sin proyectos, o pidiendo agregar uno más (la barra lateral global sigue mostrando los ya abiertos: es un
  // componente aparte, `CodeSidebar`, que no depende de esto).
  if (!directory || projectPickerOpen) return <ProjectPicker onCancel={directory ? hideProjectPicker : undefined} />

  // Celular: solo la conversación (la lista de sesiones, la barra y las pantallas de Cambios/Archivos son del armazón).
  if (isRemoteSurface())
    return (
      <div className="flex h-full min-h-0 w-full flex-col bg-bg text-fg">
        <TrustGate />
        <ChatColumn directory={directory} />
      </div>
    )

  return (
    <div ref={rootRef} className="relative flex h-full min-h-0 w-full bg-bg text-fg">
      <TrustGate />
      {showSessionList && (
        <div className="flex w-60 shrink-0 flex-col border-r border-border bg-sidebar pt-2">
          <SessionList />
        </div>
      )}
      <ShellRunProvider directory={directory}>
        <ChatColumn directory={directory} />
      </ShellRunProvider>
      <SidePanels directory={directory} containerWidth={containerWidth - (showSessionList ? 240 : 0)} />
    </div>
  )
}

/** Contenido para la barra lateral global del modo Code (sesiones del proyecto actual). */
export function CodeSidebar(): React.JSX.Element | null {
  useEffect(() => ensureCodeSubscription(), [])
  return <SessionList />
}

/** Acción "nueva sesión" para el botón principal de la barra lateral. */
export function newCodeSession(): void {
  const { directory, newSession } = useCode.getState()
  if (directory) void newSession()
  else void pickAndOpenFolder()
}

export default CodeWorkspace
