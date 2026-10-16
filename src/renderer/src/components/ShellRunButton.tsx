import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Check, ChevronDown, ChevronRight, Loader2, Play, SquareTerminal } from 'lucide-react'
import { dangerousCommandReason, mayAskPassword, prepareTerminalCommand, type PrepareResult } from '@shared/terminal-command'
import { useT } from '../lib/i18n'
import { currentPlatform, isRemoteSurface } from '../lib/platform'
import { ShellRunContext, type ShellRunHandle, type ShellRunSnapshot } from '../lib/shellRun'
import { confirmDialog } from './ConfirmDialog'
import { CopyButton } from './CopyButton'

type Prepared = Extract<PrepareResult, { ok: true }>

/** Si el bloque de código se puede ejecutar aquí (Code de escritorio, shell de esta plataforma, comando completo), lo prepara. */
export function useShellRunnable(code: string, lang: string | null, enabled: boolean): Prepared | null {
  const runner = useContext(ShellRunContext)
  const platform = currentPlatform()
  return useMemo(() => {
    if (!enabled || !runner || isRemoteSurface()) return null
    const r = prepareTerminalCommand(code, lang, platform)
    return r.ok ? r : null
  }, [enabled, runner, code, lang, platform])
}

const noopSub = (): (() => void) => () => undefined
const noopSnap = (): ShellRunSnapshot | null => null

function useRun(run: ShellRunHandle | null): ShellRunSnapshot | null {
  return useSyncExternalStore(run ? run.subscribe : noopSub, run ? run.getSnapshot : noopSnap)
}

const ICON_BTN =
  'no-drag inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'

/**
 * Bloque de comando de Code de escritorio: el código ocupa el bloque; arriba a la derecha solo dos íconos (▶ Ejecutar, Copiar).
 * Al pulsar ▶ aparece debajo la tarjeta con la salida en vivo. Nada se ejecuta solo: cada clic es explícito; los comandos
 * delicados y los de varias líneas se muestran completos en una confirmación antes.
 */
export function ShellRunBlock({
  prepared,
  code,
  children
}: {
  prepared: Prepared
  code: string
  children: React.ReactNode
}): React.JSX.Element {
  const t = useT()
  const runner = useContext(ShellRunContext)
  const [run, setRun] = useState<ShellRunHandle | null>(() => runner?.find(prepared.lines) ?? null)
  const snap = useRun(run)
  const { command, lines } = prepared
  const state: 'idle' | 'running' | 'done' = !snap ? 'idle' : snap.status === 'done' ? 'done' : 'running'

  const onClick = async (): Promise<void> => {
    if (!runner) return
    if (state === 'running') {
      runner.showTerminal()
      return
    }
    const danger = dangerousCommandReason(command)
    if (danger || lines.length > 1) {
      const ok = await confirmDialog({
        title: t('code.run.confirm.title'),
        message: (
          <div className="flex flex-col gap-2">
            {danger && <p className="font-medium text-danger">{t(`code.run.danger.${danger}` as 'code.run.danger.delete')}</p>}
            {mayAskPassword(command) && <p>{t('code.run.mayAskPassword')}</p>}
            <p>{lines.length > 1 ? t('code.run.confirm.multi', { count: lines.length }) : t('code.run.confirm.single')}</p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-code px-2.5 py-2 font-mono text-xs text-fg desk:text-meta">
              {command}
            </pre>
          </div>
        ),
        confirmLabel: t('code.run.confirm.go'),
        danger: danger !== null,
        focusCancel: danger !== null
      })
      if (!ok) return
    }
    const handle = runner.run(lines)
    if (!handle) {
      void confirmDialog({
        title: t('code.run.busy.title'),
        message: t('code.run.busy.message'),
        confirmLabel: t('code.run.open')
      }).then((open) => {
        if (open) runner.showTerminal()
      })
      return
    }
    setRun(handle)
  }

  const label = state === 'idle' ? t('code.run.aria') : state === 'running' ? t('code.run.runningAria') : t('code.run.doneAria')
  return (
    <>
      <div
        className="code-block relative [&>pre]:!overflow-x-hidden [&>pre]:!whitespace-pre-wrap [&>pre]:!pr-16 [&>pre]:![overflow-wrap:anywhere] [&_code]:!whitespace-pre-wrap [&_code]:![overflow-wrap:anywhere]"
        data-shell-block
      >
        <div className="absolute right-1 top-1 z-10 flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => void onClick()}
            aria-label={label}
            title={label}
            data-testid="shell-run"
            data-state={state}
            className={ICON_BTN}
          >
            {state === 'idle' && <Play size={14} />}
            {state === 'running' && <Loader2 size={14} className="animate-spin" />}
            {state === 'done' && <Check size={14} className="text-success" />}
          </button>
          <CopyButton text={() => code} size={14} className={`${ICON_BTN} px-0 py-0`} />
        </div>
        {children}
      </div>
      {run && snap && <OutputCard run={run} snap={snap} warnPassword={mayAskPassword(command)} onOpen={() => runner?.showTerminal()} />}
    </>
  )
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      onClick={() => onChange(!on)}
      className={`no-drag relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${on ? 'bg-accent' : 'bg-border-strong'}`}
    >
      <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${on ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
    </button>
  )
}

/** Tarjeta de salida en vivo de un comando ejecutado con ▶ (bajo el bloque, dentro del mismo mensaje). */
function OutputCard({
  run,
  snap,
  warnPassword,
  onOpen
}: {
  run: ShellRunHandle
  snap: ShellRunSnapshot
  warnPassword: boolean
  onOpen: () => void
}): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(true)
  const bodyRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [snap.lines, open])
  const status =
    snap.status === 'running'
      ? t('code.run.status.running')
      : snap.status === 'done'
        ? t('code.run.status.done')
        : snap.waitKind === 'password'
          ? t('code.run.status.password')
          : t('code.run.status.answer')
  const shareNote =
    snap.share === 'sent'
      ? t('code.run.share.sent')
      : snap.share === 'queued'
        ? t('code.run.share.queued')
        : snap.share === 'attached'
          ? t('code.run.share.attached')
          : snap.share === 'blocked-secret'
            ? t('code.run.share.secret')
            : null
  return (
    <div
      className="my-2 overflow-hidden rounded-lg border border-border bg-code"
      data-shell-output
      role="group"
      aria-label={t('code.run.card')}
    >
      <div className="flex items-center gap-1 px-1.5 py-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? t('code.run.fold') : t('code.run.unfold')}
          title={open ? t('code.run.fold') : t('code.run.unfold')}
          className={ICON_BTN}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span role="status" className="min-w-0 flex-1 text-xs leading-snug text-muted desk:text-meta">
          {status}
        </span>
        <button
          type="button"
          onClick={onOpen}
          aria-label={t('code.run.open')}
          title={t('code.run.open')}
          data-testid="shell-open-terminal"
          className={ICON_BTN}
        >
          <SquareTerminal size={14} />
        </button>
      </div>
      {open && (
        <>
          <pre
            ref={bodyRef}
            data-testid="shell-output"
            className="m-0 max-h-[9.5rem] overflow-auto whitespace-pre-wrap break-all border-t border-border px-3 py-1.5 font-mono text-xs leading-[1.5] text-fg desk:text-meta"
          >
            {snap.lines.length ? snap.lines.join('\n') : '…'}
          </pre>
          {warnPassword && snap.status === 'running' && (
            <p className="m-0 border-t border-border px-3 py-1 text-xs text-muted desk:text-meta">{t('code.run.mayAskPassword')}</p>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 text-xs text-muted desk:text-meta">
            <span className="flex items-center gap-1.5">
              <Switch on={snap.shareOn} onChange={run.setShareOn} label={t('code.run.shareToggle')} />
              {snap.shareOn ? t('code.run.aiSees') : t('code.run.shareToggle')}
            </span>
            {shareNote && <span role="status">{shareNote}</span>}
            {!snap.shareOn && snap.share !== 'sent' && snap.lineCount > 0 && (
              <button
                type="button"
                onClick={run.sendNow}
                className="no-drag rounded-md px-1.5 py-0.5 font-medium text-accent hover:bg-accent-soft"
              >
                {t('code.run.sendNow')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
