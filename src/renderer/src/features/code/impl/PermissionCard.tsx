import { useCallback, useEffect, useRef, useState } from 'react'
import { FilePen, HelpCircle, Loader2, ShieldAlert, SquareTerminal } from 'lucide-react'
import type { MsgKey } from '@shared/i18n'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { isRemoteSurface } from '../../../lib/platform'
import { DiffView, diffStats } from './DiffView'
import { DiffStats, relPath } from './ToolCard'
import { isEditableTarget } from './ui'
import { phoneReplies } from './mobile-logic'
import { useCode } from './store'
import type { PendingPermission, PendingQuestion } from './types'

const PERMISSION_LABEL: Record<string, MsgKey> = {
  edit: 'code.perm.edit',
  write: 'code.perm.write',
  bash: 'code.perm.bash',
  webfetch: 'code.perm.webfetch',
  websearch: 'code.perm.websearch',
  read: 'code.perm.read',
  external_directory: 'code.perm.external_directory',
  task: 'code.perm.task',
  doom_loop: 'code.perm.doom_loop',
  todowrite: 'code.perm.todowrite'
}

export function PermissionCard({
  request,
  root,
  hotkeys = false
}: {
  request: PendingPermission
  root: string | null
  /** Escucha 1/2/3 (solo la primera tarjeta pendiente). */
  hotkeys?: boolean
}): React.JSX.Element {
  const t = useT()
  // Celular: solo «una vez» y «rechazar» (nunca «siempre»); lo que el Mac debe confirmar se aprueba en el propio Mac.
  const mobile = isRemoteSurface()
  const allowed = mobile ? phoneReplies(request.permission) : null
  const reply = useCode((s) => s.replyPermission)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const run = useCallback(
    (r: 'once' | 'always' | 'reject'): void => {
      if (busyRef.current) return
      busyRef.current = true
      setBusy(true)
      void reply(request, r).finally(() => {
        busyRef.current = false
        setBusy(false)
      })
    },
    [reply, request]
  )

  useEffect(() => {
    if (!hotkeys || mobile) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      // Desde el composer vacío también valen (es donde está el foco normalmente).
      const target = e.target
      const emptyComposer = target instanceof HTMLTextAreaElement && target.dataset.codeComposer !== undefined && target.value === ''
      if (isEditableTarget(target) && !emptyComposer) return
      if (e.key === '1') run('once')
      else if (e.key === '2') run('always')
      else if (e.key === '3') run('reject')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hotkeys, mobile, run])

  const md = request.metadata
  const diff = typeof md.diff === 'string' ? md.diff : ''
  const command = typeof md.command === 'string' ? md.command : ''
  const description = typeof md.description === 'string' ? md.description : ''
  const file = typeof md.filepath === 'string' ? md.filepath : typeof md.filePath === 'string' ? md.filePath : ''
  const labelKey = PERMISSION_LABEL[request.permission]
  const label = labelKey ? t(labelKey) : request.permission
  const stats = diff ? diffStats(diff) : null
  const patterns = request.patterns.filter((p) => p && p !== command)
  const Icon =
    request.permission === 'bash' ? SquareTerminal : request.permission === 'edit' || request.permission === 'write' ? FilePen : ShieldAlert

  const actions: { key: string; label: string; reply: 'once' | 'always' | 'reject'; cls: string; title?: string }[] = [
    { key: '1', label: t('code.perm.once'), reply: 'once', cls: 'bg-accent text-accent-fg hover:opacity-90' },
    {
      key: '2',
      label: t('code.perm.always'),
      reply: 'always',
      cls: 'border border-border bg-elevated text-fg hover:bg-hover',
      title: request.always.length ? t('code.perm.alwaysTitle', { patterns: request.always.join(', ') }) : undefined
    },
    { key: '3', label: t('code.perm.reject'), reply: 'reject', cls: 'text-danger hover:bg-danger/10' }
  ]

  const shown = allowed ? actions.filter((a) => allowed.includes(a.reply as 'once' | 'reject')) : actions
  const macOnly = !!allowed && !allowed.includes('once')

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-accent/40 bg-elevated shadow-sm ring-4 ring-accent/5">
      <div className="flex items-start gap-2.5 px-3.5 pt-3 pb-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-medium">{t('code.perm.agentWants', { label })}</div>
          {description && <div className="mt-0.5 text-xs text-muted">{description}</div>}
          {file && (
            <div className="mt-1 flex items-center gap-2 font-mono text-xs text-muted">
              <span className="truncate">{relPath(file, root)}</span>
              {stats && <DiffStats {...stats} />}
            </div>
          )}
        </div>
      </div>
      {command && (
        <pre className="mx-3.5 mb-2.5 max-h-48 overflow-auto rounded-lg bg-code px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all text-fg">
          <span className="text-accent select-none">$ </span>
          {command}
        </pre>
      )}
      {!command && !diff && patterns.length > 0 && (
        <pre className="mx-3.5 mb-2.5 max-h-40 overflow-auto rounded-lg bg-code px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all">
          {patterns.map((p) => relPath(p, root)).join('\n')}
        </pre>
      )}
      {diff && <DiffView patch={diff} path={file} hideFileHeaders className="max-h-80 border-t border-border" />}
      {macOnly && (
        <div role="note" className="flex items-start gap-2 border-t border-border bg-warning/10 px-3.5 py-2.5 text-[13px]">
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warning" />
          <span className="min-w-0">
            <b className="block font-medium text-fg">{t('code.m.macApprove')}</b>
            <span className="text-muted">{t('code.m.macApproveHint')}</span>
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-border bg-bg/40 px-3 py-2">
        {shown.map((a) => (
          <button
            key={a.key}
            type="button"
            disabled={busy}
            title={a.title}
            onClick={() => run(a.reply)}
            className={`no-drag inline-flex items-center gap-2 rounded-lg px-2.5 py-1 text-[13px] font-medium transition disabled:opacity-50 ${mobile ? 'min-h-11 min-w-28 flex-1 justify-center px-4 text-[14px]' : ''} ${a.cls}`}
          >
            {a.label}
            {hotkeys && !mobile && (
              <kbd className="rounded border border-current/25 px-1 font-sans text-[10px] leading-4 opacity-70">{a.key}</kbd>
            )}
          </button>
        ))}
        {busy && <Loader2 size={14} className="ml-1 animate-spin text-muted" />}
      </div>
    </div>
  )
}

export function QuestionCard({ request }: { request: PendingQuestion }): React.JSX.Element {
  const t = useT()
  const reply = useCode((s) => s.replyQuestion)
  const reject = useCode((s) => s.rejectQuestion)
  const [answers, setAnswers] = useState<string[][]>(() => request.questions.map(() => []))
  const [custom, setCustom] = useState<string[]>(() => request.questions.map(() => ''))
  const [busy, setBusy] = useState(false)

  const toggle = (qi: number, label: string, multiple: boolean): void => {
    setAnswers((prev) =>
      prev.map((a, i) => {
        if (i !== qi) return a
        if (!multiple) return [label]
        return a.includes(label) ? a.filter((x) => x !== label) : [...a, label]
      })
    )
  }

  const final = answers.map((a, i) => (custom[i].trim() ? [...a, custom[i].trim()] : a))
  const ready = final.every((a) => a.length > 0)

  return (
    <div className="my-2 rounded-xl border border-accent/40 bg-elevated px-3.5 py-3 shadow-sm ring-4 ring-accent/5">
      {request.questions.map((q, qi) => (
        <div key={qi} className="mb-3">
          <div className="flex items-start gap-2 text-sm">
            <HelpCircle size={16} className="mt-0.5 shrink-0 text-accent" />
            <div>
              {q.header && <div className="text-xs font-medium tracking-wide text-muted uppercase">{q.header}</div>}
              <div className="font-medium">{q.question}</div>
            </div>
          </div>
          <div className="mt-2 ml-6 flex flex-wrap gap-2">
            {q.options.map((o) => {
              const selected = answers[qi]?.includes(o.label)
              return (
                <button
                  key={o.label}
                  type="button"
                  title={o.description}
                  onClick={() => toggle(qi, o.label, !!q.multiple)}
                  className={`rounded-lg border px-2.5 py-1 text-sm transition ${isRemoteSurface() ? 'min-h-11 px-4' : ''} ${selected ? 'border-accent bg-accent-soft text-fg' : 'border-border hover:bg-hover'}`}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
          {q.custom !== false && (
            <input
              value={custom[qi]}
              onChange={(e) => setCustom((prev) => prev.map((c, i) => (i === qi ? e.target.value : c)))}
              placeholder={t('code.question.other')}
              className={`mt-2 ml-6 w-[calc(100%-1.5rem)] rounded-lg border border-border bg-bg px-2.5 py-1 text-sm outline-none focus:border-accent ${isRemoteSurface() ? 'min-h-11' : ''}`}
            />
          )}
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={busy || !ready}
          onClick={() => {
            setBusy(true)
            void reply(request, final).finally(() => setBusy(false))
          }}
        >
          {t('code.question.answer')}
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void reject(request).finally(() => setBusy(false))
          }}
        >
          {t('code.question.skip')}
        </Button>
      </div>
    </div>
  )
}
