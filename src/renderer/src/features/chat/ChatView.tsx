import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, Languages, Lightbulb, ListChecks, PenLine, type LucideIcon } from 'lucide-react'
import { ApprovalNotice } from '../../app/mobile/ApprovalNotice'
import { ChatComposer } from './ChatComposer'
import { ErrorNotice } from '../../components/conversation/ErrorNotice'
import { LogoMark } from '../../components/Logo'
import { ChatMessageList } from './ChatMessageList'
import { ModelPicker } from '../../components/ModelPicker'
import { NoAiBanner } from '../../components/NoAiBanner'
import { TranscriptLoader } from '../../components/TranscriptLoader'
import { UsageMeter } from '../../components/UsageMeter'
import { t as tr, type MsgKey } from '@shared/i18n'
import { isRemoteSurface } from '../../lib/platform'
import { useAiGate } from '../../lib/ai-gate'
import { useT } from '../../lib/i18n'
import { onStreamReconnect, useServer } from '../../stores/server'
import { ExportMenuButton } from '../../components/ExportConversation'
import { exportChatConversation } from './export'
import { useSessions, type MessageEntry } from '../../stores/sessions'
import { setModeModel, useModeModel } from '../settings/impl/extras'
import type { ChatAttachment } from '../../lib/attachments'
import {
  CompareConfirmDialog,
  CompareControls,
  CompareView,
  RecoveryBanner,
  requestCompare,
  useCompare,
  useCompareBoot,
  useShownCompare
} from '../compare'
import {
  abortChat,
  compactChat,
  loadChatSessions,
  openChatSession,
  renameChat,
  resendFromMessage,
  retryChat,
  sendChatMessage
} from './actions'
import { useChat } from './store'
import { ReadingModeSwitch } from '../../components/ReadingModeSwitch'
import { MemoryProposalCard } from '../memory/MemoryProposalCard'
import { PersonalizeButton } from '../memory/PersonalizeButton'
import { ConversationInstructionsButton } from './ConversationInstructionsButton'
import { ChatDocPanel } from './ChatDocPanel'
import { ChatFilePanel } from './ChatFilePanel'
import { ChatProgressHud } from './ChatProgressHud'
import { ChatHomeBlocks, useChatHome } from './ChatHomeBlocks'
import { HomeIdeas } from '../../components/HomeBlocks'
import { useChatDocPanel } from './useChatDocPanel'
import { ProjectChip } from '../projects/ProjectChip'
import { ProjectView } from '../projects/ProjectView'
import { useProjects } from '../projects/store'

const EMPTY: MessageEntry[] = []

function greeting(date = new Date()): string {
  const h = date.getHours()
  if (h >= 5 && h < 12) return tr('chat.greeting.morning')
  if (h >= 12 && h < 20) return tr('chat.greeting.afternoon')
  return tr('chat.greeting.evening')
}

const SUGGESTIONS: { icon: LucideIcon; label: MsgKey; prompt: MsgKey }[] = [
  { icon: PenLine, label: 'chat.suggest.write', prompt: 'chat.suggest.write.prompt' },
  { icon: Lightbulb, label: 'chat.suggest.brainstorm', prompt: 'chat.suggest.brainstorm.prompt' },
  { icon: BookOpen, label: 'chat.suggest.explain', prompt: 'chat.suggest.explain.prompt' },
  { icon: ListChecks, label: 'chat.suggest.plan', prompt: 'chat.suggest.plan.prompt' },
  { icon: Languages, label: 'chat.suggest.translate', prompt: 'chat.suggest.translate.prompt' }
]

export function ChatView(): React.JSX.Element {
  const t = useT()
  const ready = useServer((s) => s.status.state === 'ready' && !!s.client)
  const activeId = useChat((s) => s.activeSessionId)
  const session = useSessions((s) => (activeId ? s.sessions[activeId] : undefined))
  const allQuestions = useChat((s) => s.questions)
  const questions = useMemo(() => Object.values(allQuestions).filter((q) => q.sessionID === activeId), [allQuestions, activeId])
  const entries = useSessions((s) => (activeId ? (s.messages[activeId] ?? EMPTY) : EMPTY))
  const busy = useSessions((s) => (activeId ? (s.status[activeId] ?? 'idle') !== 'idle' : false))
  /** El motor está reintentando (p. ej. el modelo no está disponible): se dice en vez de quedarse en «Pensando…». */
  const retrying = useSessions((s) => (activeId ? s.status[activeId] === 'retry' : false))
  const error = useSessions((s) => (activeId ? s.errors[activeId] : null))
  const docPanel = useChatDocPanel(activeId, entries)
  // Cada modo recuerda su propio modelo (`modelsByMode.chat`); sin elección propia vale el predeterminado global.
  const model = useModeModel('chat')
  const { effective, gate, free, unavailable } = useAiGate(model, { strict: true })
  const [sendError, setSendError] = useState<unknown>(null)
  const [insert, setInsert] = useState<{ text: string; key: number; attachments?: ChatAttachment[] } | null>(null)
  // «Comparar modelos» (solo texto): activo únicamente en escritorio.
  useCompareBoot()
  const compareId = useShownCompare('chat', null)
  const home = useChatHome()
  const projectViewId = useProjects((s) => s.viewId)

  // Si la conversación abierta se eliminó (aquí o desde otro cliente), volver a "nueva".
  const listLoading = useChat((s) => s.listLoading)
  useEffect(() => {
    if (activeId && !session && !listLoading) useChat.getState().setActive(null)
  }, [activeId, session, listLoading])

  // Tras reconectar el stream, recargar los mensajes de la conversación abierta.
  useEffect(
    () =>
      onStreamReconnect(() => {
        const id = useChat.getState().activeSessionId
        const { client, connection } = useServer.getState()
        if (id && client && connection) void useSessions.getState().loadMessages(client, id, connection.chatDirectory)
      }),
    []
  )

  /** `false` = no se envió: el compositor restaura el borrador. */
  const send = async (text: string, files: ChatAttachment[] = []): Promise<boolean> => {
    setSendError(null)
    // Con una comparación armada el envío lo hace la comparación (con su diálogo previo); si se cancela, el borrador vuelve.
    if (useCompare.getState().armed['chat:']) {
      const started = await requestCompare({ mode: 'chat', directory: null, text, attachments: files })
      if (!started) setInsert({ text, key: Date.now(), attachments: files })
      return started
    }
    try {
      const ok = await sendChatMessage(
        text,
        files.map((f) => ({ mime: f.mime, filename: f.name, url: f.url }))
      )
      if (!ok) setInsert({ text, key: Date.now(), attachments: files })
      return ok
    } catch (err) {
      const id = useChat.getState().activeSessionId
      if (id) useSessions.getState().setError(id, typeof err === 'object' && err ? err : String(err))
      else setSendError(err)
      // Al crear la conversación la vista cambia de pantalla y el compositor se remonta: el texto vuelve por `insert`.
      setInsert({ text, key: Date.now(), attachments: files })
      return false
    }
  }

  // Reintentar / editar deshacen la conversación desde el mensaje (sin duplicarlo) y lo reenvían con sus adjuntos.
  // Si el motor no pudo ni recibirlo, el fallo se muestra como error de la conversación.
  const guarded = useCallback(
    async <T,>(fn: (id: string) => Promise<T>): Promise<T | undefined> => {
      if (!activeId) return undefined
      try {
        return await fn(activeId)
      } catch (err) {
        useSessions.getState().setError(activeId, typeof err === 'object' && err ? err : String(err))
        throw err
      }
    },
    [activeId]
  )
  const retry = useCallback(() => guarded((id) => retryChat(id)), [guarded])
  const compact = useCallback(() => guarded((id) => compactChat(id)), [guarded])
  const edit = useCallback((messageID: string, text: string) => guarded((id) => resendFromMessage(id, messageID, text)), [guarded])

  const picker = (
    <div className="flex w-full items-center">
      <ProjectChip />
      <CompareControls mode="chat" directory={null} current={effective ?? model} />
      <ModelPicker value={effective ?? model} unavailable={unavailable} onChange={(m) => setModeModel('chat', m)} />
      <span className="ml-auto" />
      <UsageMeter messages={entries} model={effective ?? model} />
    </div>
  )
  const composerEl = (hero: boolean): React.JSX.Element => (
    <>
      <CompareConfirmDialog mode="chat" directory={null} />
      <ChatComposer
        onSend={send}
        onAbort={() => activeId && void abortChat(activeId)}
        busy={busy}
        disabled={!ready || gate.blocked}
        placeholder={
          !ready
            ? t('chat.placeholder.connecting')
            : unavailable
              ? t('chat.placeholder.modelUnavailable')
              : gate.blocked
                ? t('chat.placeholder.noAi')
                : t('chat.placeholder.message')
        }
        footer={picker}
        autoFocusKey={activeId}
        showAttach
        insert={insert}
        hero={hero}
      />
    </>
  )
  const composer = composerEl(false)

  const notices = (
    <div className={`mx-auto w-full max-w-3xl desk:max-w-[calc(var(--measure-prose)+48px)] ${isRemoteSurface() ? 'px-4' : 'px-6'}`}>
      <RecoveryBanner mode="chat" directory={null} />
      {activeId && !busy && !isRemoteSurface() && (
        <div className="mb-2">
          <MemoryProposalCard sessionId={activeId} messages={entries} />
        </div>
      )}
      {sendError != null && (
        <div className="mb-2">
          <ErrorNotice error={sendError} variant="chat" />
        </div>
      )}
      {unavailable && (
        <div role="status" data-testid="model-unavailable-notice" className="mb-2 px-1 text-xs text-warning">
          {t('chat.modelUnavailable.notice', { model: model.modelID })}
        </div>
      )}
      <NoAiBanner
        gate={unavailable ? { blocked: false, reason: null, freeNote: false } : gate}
        freeModel={free}
        onUseFree={(m) => setModeModel('chat', m)}
      />
    </div>
  )

  if (projectViewId && !isRemoteSurface()) return <ProjectView />

  if (compareId) {
    return (
      <div className="flex h-full flex-col">
        <RecoveryBanner mode="chat" directory={null} />
        <CompareView
          id={compareId}
          onAdopted={(info) => {
            // La sesión elegida pasa a ser una conversación normal: con título del mensaje, en la lista y abierta.
            const sid = info.column.sessionID
            if (!sid) return
            void (async () => {
              await renameChat(sid, info.promptPreview.replace(/\s+/g, ' ').trim().slice(0, 60)).catch(() => undefined)
              await loadChatSessions()
              await openChatSession(sid)
            })()
          }}
        />
        <CompareConfirmDialog mode="chat" directory={null} />
      </div>
    )
  }

  if (!activeId && isRemoteSurface()) {
    // Celular (Inicio): aviso de aprobaciones arriba, saludo a la izquierda, rejilla 2×2 de sugerencias y compositor abajo.
    return (
      <div className="flex h-full flex-col">
        <div className="shrink-0 px-4 pt-2 empty:hidden">
          <ApprovalNotice />
        </div>
        <div className="flex min-h-0 flex-1 animate-rise-in flex-col justify-center px-5">
          <h1 className="font-display text-[28px] leading-9 font-semibold tracking-[-0.02em]">{greeting()}</h1>
          <p className="mt-1 text-[16px] leading-6 text-muted">{t('chat.empty.prompt')}</p>
        </div>
        {notices}
        <div className="grid grid-cols-2 gap-2 px-4 pb-3" data-m="suggest-grid">
          {SUGGESTIONS.slice(0, 4).map(({ icon: Icon, label, prompt }) => (
            <button
              key={label}
              type="button"
              disabled={!ready}
              title={t(prompt)}
              onClick={() => setInsert({ text: t(prompt), key: Date.now() })}
              className="flex min-h-11 flex-col items-start gap-2 rounded-xl bg-elevated p-3.5 text-left shadow-sm active:bg-hover disabled:opacity-50"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-active">
                <Icon size={16} className="text-accent" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] leading-5 font-medium text-fg">{t(label)}</span>
                <span className="block text-[13px] leading-4 text-muted">{t(`${label}.desc` as MsgKey)}</span>
              </span>
            </button>
          ))}
        </div>
        {composerEl(true)}
      </div>
    )
  }

  const docFullscreen = docPanel.open && docPanel.fullscreen
  const docPanelEl = docPanel.open && (
    <div className={`hidden shrink-0 desk:block ${docFullscreen ? 'w-full' : 'w-[42%] min-w-[360px] max-w-[640px]'}`}>
      {docPanel.file && docPanel.file.mode === 'inline' ? (
        <ChatFilePanel
          file={docPanel.file}
          fullscreen={docPanel.fullscreen}
          onToggleFullscreen={docPanel.toggleFullscreen}
          onClose={docPanel.close}
        />
      ) : (
        <ChatDocPanel
          creating={docPanel.creating}
          title={docPanel.title}
          doc={docPanel.doc}
          problem={docPanel.problem}
          file={docPanel.file}
          onRetry={docPanel.retry}
          fullscreen={docPanel.fullscreen}
          onToggleFullscreen={docPanel.toggleFullscreen}
          onClose={docPanel.close}
        />
      )}
    </div>
  )

  if (!activeId) {
    return (
      <div className="flex h-full">
        <div className={`flex h-full min-w-0 flex-1 flex-col ${docFullscreen ? 'hidden' : ''}`}>
          <div className="drag h-12 shrink-0" data-mobile="hide" />
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto pb-20">
            <div className="mb-8 flex animate-rise-in flex-col items-center gap-4 px-6 text-center">
              <div className="relative isolate desk:hidden">
                <div
                  className="pointer-events-none absolute inset-0 -z-10 scale-[3] rounded-full bg-[radial-gradient(closest-side,var(--accent-soft),transparent)]"
                  aria-hidden
                />
                <LogoMark size={44} />
              </div>
              <div>
                <h1 className="font-display text-[32px] leading-tight font-semibold tracking-[-0.02em] desk:font-[var(--font-title)] desk:leading-10">
                  {greeting()}
                </h1>
                <p className="mt-1.5 text-[15px] text-muted">{t('chat.empty.prompt')}</p>
              </div>
            </div>
            <div className="w-full animate-rise-in [animation-delay:60ms]">
              {home.working.length > 0 && (
                <div className="mx-auto w-full max-w-3xl px-6 desk:max-w-[calc(var(--measure-prose)+48px)]">
                  <ChatHomeBlocks home={home} part="working" />
                </div>
              )}
              {notices}
              {composerEl(true)}
            </div>
            {home.recent.length > 0 && (
              <div className="mx-auto w-full max-w-3xl px-6 desk:max-w-[calc(var(--measure-prose)+48px)]">
                <ChatHomeBlocks home={home} part="resume" />
              </div>
            )}
            <HomeIdeas
              storageKey="chat.hideIdeas"
              className="mx-auto max-w-3xl px-6 desk:max-w-[calc(var(--measure-prose)+48px)]"
              secondary={home.hasChats}
              label={t('chat.home.ideas')}
              showLabel={t('chat.home.ideas.show')}
              hideLabel={t('chat.home.ideas.hide')}
            >
              <div className="mt-1 flex max-w-2xl animate-rise-in flex-wrap justify-center gap-2 px-6 [animation-delay:120ms] desk:mt-2 desk:grid desk:w-full desk:max-w-[calc(var(--measure-prose)+48px)] desk:grid-cols-4 desk:gap-3">
                {SUGGESTIONS.slice(0, 4).map(({ icon: Icon, label, prompt }) => (
                  <button
                    key={label}
                    type="button"
                    disabled={!ready}
                    title={t(prompt)}
                    onClick={() => setInsert({ text: t(prompt), key: Date.now() })}
                    className="no-drag inline-flex items-center gap-1.5 rounded-full border border-border bg-elevated px-3 py-1.5 text-[13px] text-muted shadow-xs transition-[color,border-color,background-color,transform] duration-150 hover:-translate-y-px hover:border-accent/40 hover:text-fg active:translate-y-0 disabled:opacity-50 desk:h-auto desk:flex-col desk:items-start desk:gap-2.5 desk:rounded-card desk:border-transparent desk:p-4 desk:text-left desk:shadow-sm desk:duration-[var(--dur-base)] desk:hover:translate-y-0 desk:hover:border-transparent desk:hover:bg-hover"
                  >
                    <span className="shrink-0 desk:flex desk:h-8 desk:w-8 desk:items-center desk:justify-center desk:rounded-ctl desk:bg-active">
                      <Icon size={14} className="text-accent desk:h-4 desk:w-4" />
                    </span>
                    <span className="min-w-0 desk:flex desk:flex-col">
                      <span className="block desk:text-sm desk:leading-5 desk:font-medium desk:text-fg">{t(label)}</span>
                      <span className="hidden desk:block desk:text-meta desk:font-normal desk:text-muted">
                        {t(`${label}.desc` as MsgKey)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </HomeIdeas>
          </div>
        </div>

        {docPanelEl}
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <div className={`relative flex h-full min-w-0 flex-1 flex-col ${docFullscreen ? 'hidden' : ''}`}>
        <header
          data-mobile="hide"
          className="drag relative flex h-12 shrink-0 items-center justify-center border-b border-border/70 bg-bg/80 px-24 backdrop-blur desk:@container desk:px-[max(15rem,calc(var(--controls-inset,0px)+8px))] desk:@max-[44rem]:px-[max(6rem,calc(var(--controls-inset,0px)+8px))]"
        >
          <span className="truncate text-[13.5px] font-medium">{session?.title || t('chat.newConversation')}</span>
          <div className="absolute right-3 top-0 hidden h-12 items-center gap-1.5 desk:flex desk:right-[max(0.75rem,calc(var(--controls-inset,0px)+8px))]">
            <ConversationInstructionsButton sessionId={activeId} />
            <PersonalizeButton />
            {session && <ExportMenuButton onAction={(a) => void exportChatConversation(session, a)} />}
            <ReadingModeSwitch surface="chat" />
          </div>
        </header>
        <ChatProgressHud entries={entries} busy={busy} />
        <TranscriptLoader sessionId={activeId} />
        <ChatMessageList
          entries={entries}
          busy={busy}
          retrying={retrying}
          error={error}
          onRetry={retry}
          onCompact={compact}
          onEdit={edit}
          questions={questions}
        />
        {notices}
        {composer}
      </div>
      {docPanelEl}
    </div>
  )
}
