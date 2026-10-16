/**
 * Tarjeta de permiso de Tareas en ESCRITORIO (plan ND). El celular/PWA usa `GenericPermissionCard`
 * (marcado de siempre, sin cambios); aquí se aplica la anatomía `oc-perm` (DESIGN.md) y el modelo de
 * teclado seguro de `lib/perm-guard`. Solo se importa desde `PermissionPrompt.tsx`, nunca desde la PWA.
 */
import { useEffect, useState } from 'react'
import { Folder, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { PermissionRequest } from '@opencode-ai/sdk/v2/client'
import { DiffView, hasDiffChanges } from '../../../components/DiffView'
import {
  PermActions,
  PermCardFrame,
  PermCommand,
  PermPreview,
  PermScope,
  previewFits,
  usePermGuard,
  type PermAction
} from '../../../components/permission/PermissionShell'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { isMacPlatform } from '../../../lib/platform'
import { alwaysHint, describePermission, hasHiddenChars, RejectWithNote, useCanAlways, useMcpServers, useReply } from './PermissionPrompt'
import { useShowPath } from './conn-paths'
import { useTasks } from './store'

/** Ruta para mostrar: la carpeta personal como «~». */
function displayFolder(path: string, home?: string): string {
  if (home && path === home) return '~'
  if (home && path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`
  return path
}

/** Tarjeta detallada de escritorio (anatomía §3 del plan). */
export function PermissionCardDesk({ request }: { request: PermissionRequest }): React.JSX.Element {
  const t = useT()
  const servers = useMcpServers()
  const showPath = useShowPath()
  const d = describePermission(request, servers, showPath)
  const { busy, error, answer, reject } = useReply(request)
  const [noting, setNoting] = useState(false)
  const canAlways = useCanAlways(request, d.danger)
  const folder = useTasks((s) => s.folder)
  const fullAccess = useTasks((s) => s.conn?.fullAccess === true)
  const home = useTasks((s) => s.fullAccessInfo?.home)
  const mac = isMacPlatform()
  const { armed, onKeyDown } = usePermGuard({ id: request.id, reply: (kind) => answer(kind), busy })

  const showDiff = !!d.diff && hasDiffChanges(d.diff)
  const isBash = request.permission === 'bash'

  const rejectNote = t('tasksComputer.perm.rejectNote')
  const actions: PermAction[] = [
    { label: rejectNote, variant: 'ghost', side: 'left', onClick: () => setNoting(true) },
    ...(canAlways
      ? [
          {
            label: t('tasksComputer.perm.always'),
            variant: 'secondary' as const,
            side: 'left' as const,
            permit: true,
            act: 'always' as const,
            title: alwaysHint(request),
            onClick: () => answer('always')
          }
        ]
      : []),
    {
      label: t('tasksComputer.perm.reject'),
      variant: 'secondary',
      side: 'right',
      kbd: t('tasksComputer.perm.kbdReject'),
      onClick: () => answer('reject')
    },
    {
      label: t('tasksComputer.perm.once'),
      variant: d.danger ? 'danger' : 'primary',
      side: 'right',
      permit: true,
      act: 'once',
      kbd: t('tasksComputer.perm.kbdOnce'),
      ariaKeyshortcuts: mac ? 'Meta+Enter' : 'Control+Enter',
      onClick: () => answer('once')
    }
  ]
  const shownActions = noting ? actions.filter((a) => a.label !== rejectNote) : actions

  // El detalle nace abierto si el resumen de una línea no muestra todo lo que se aprueba: comando largo, de varias líneas o con
  // caracteres ocultos, parámetros sin comando que resumir o un diff con caracteres ocultos.
  const openDetails =
    (!!d.detail && !previewFits(d.detail, hasHiddenChars(d.detail))) ||
    (!d.detail && !!d.sections?.length) ||
    (!!d.diff && hasHiddenChars(d.diff)) ||
    !!d.sections?.some((sec) => hasHiddenChars(sec.text))

  const details = (
    <>
      {d.detail && (
        <PermCommand
          text={d.detail}
          prompt={isBash}
          hasHidden={hasHiddenChars(d.detail)}
          hiddenMessage={t('tasksComputer.perm.hidden')}
          longMessage={(n) => t('tasksComputer.perm.cmdLong', { n })}
        />
      )}
      {d.diff && (
        <div className="overflow-hidden rounded-ctl bg-code ring-1 ring-inset ring-border">
          {showDiff ? (
            <DiffView patch={d.diff} path={d.file} hideFileHeaders className="max-h-56" />
          ) : (
            <pre className="max-h-56 overflow-auto px-3 py-2.5 font-mono text-[13px] whitespace-pre-wrap">{d.diff}</pre>
          )}
        </div>
      )}
      {d.diff && hasHiddenChars(d.diff) && (
        <p className="flex items-start gap-1.5 text-meta text-danger">
          <ShieldAlert size={13} className="mt-0.5 shrink-0" />
          {t('tasksComputer.perm.hidden')}
        </p>
      )}
      {d.sections?.map((sec) => (
        <div key={sec.label}>
          <p className="text-caption font-medium text-subtle">{sec.label}</p>
          <div className="mt-1 rounded-ctl bg-code ring-1 ring-inset ring-border">
            <pre className="max-h-32 overflow-auto px-3 py-2.5 font-mono text-[13px] whitespace-pre-wrap">{sec.text}</pre>
          </div>
          {hasHiddenChars(sec.text) && (
            <p className="mt-1.5 flex items-start gap-1.5 text-meta text-danger">
              <ShieldAlert size={13} className="mt-0.5 shrink-0" />
              {t('tasksComputer.perm.hidden')}
            </p>
          )}
        </div>
      ))}
      {d.aiDescription && (
        <div className="rounded-ctl bg-hover/40 px-3 py-2 ring-1 ring-inset ring-border/70">
          <p className="text-caption font-medium text-subtle">{t('tasksComputer.perm.aiDesc')}</p>
          <p className="mt-0.5 text-ui text-muted">{d.aiDescription}</p>
        </div>
      )}
      <PermScope>
        {folder && (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Folder size={14} className="shrink-0" />
            <span className="truncate">{displayFolder(folder, home)}</span>
          </span>
        )}
        {fullAccess ? (
          <span className="inline-flex items-center gap-1.5 text-danger">
            <ShieldAlert size={14} />
            {t('tasksComputer.perm.sandboxOff')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-accent">
            <ShieldCheck size={14} />
            {t('tasksComputer.perm.sandboxOn')}
          </span>
        )}
      </PermScope>
    </>
  )

  return (
    <>
      <p className="sr-only" aria-live="polite">
        {t('tasksComputer.perm.waiting')}
      </p>
      <PermCardFrame
        id={request.id}
        danger={d.danger}
        armed={armed}
        busy={busy}
        icon={d.icon}
        title={d.title}
        effect={d.effect}
        preview={d.detail ? <PermPreview text={d.detail} prompt={isBash} danger={d.danger} /> : undefined}
        details={details}
        detailsOpen={openDetails}
        onKeyDown={onKeyDown}
      >
        {error && (
          <p role="alert" className="text-meta text-danger">
            {error}
          </p>
        )}
        <PermActions actions={shownActions} armed={armed} busy={busy} />
        {noting && <RejectWithNote busy={busy} onSend={reject} onCancel={() => setNoting(false)} />}
      </PermCardFrame>
    </>
  )
}

/** Barra compacta sobre el compositor (escritorio): sin atajos; «Permitir» armado 600 ms tras montar. */
export function ApprovalBarDesk({ request, more }: { request: PermissionRequest; more: number }): React.JSX.Element {
  const t = useT()
  const servers = useMcpServers()
  const showPath = useShowPath()
  const d = describePermission(request, servers, showPath)
  const { busy, answer } = useReply(request)
  const canAlways = useCanAlways(request, d.danger)
  const Icon = d.icon
  const id = `perm-${request.id}`

  // La barra siempre está a la vista: arma por tiempo (sin IntersectionObserver). `key={first.id}` la reinicia.
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setArmed(true), 600)
    return () => clearTimeout(timer)
  }, [])

  const review = (): void => {
    const el = document.getElementById(id)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el?.focus({ preventScroll: true })
  }

  const detail = d.detail ?? ''
  // Barra compacta (decisión del dueño): nunca se aprueba a ciegas un comando que no cabe entero.
  const compact = d.danger || detail.includes('\n') || detail.length > 120 || hasHiddenChars(detail)
  const mac = isMacPlatform()
  // Atajos de la tarjeta fija (Esc rechaza, ⌘/Ctrl+↵ permite una vez): solo para lo que cabe entero y no es peligroso,
  // y «permitir» solo una vez armada. No pisan un diálogo abierto ni un evento que otro ya atendió.
  const quick = !compact && d.kind !== 'folder' && !d.danger
  useEffect(() => {
    if (!quick) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || busy) return
      if ((e.target as HTMLElement | null)?.closest?.('[role="dialog"]')) return
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault()
        void answer('reject')
      } else if (e.key === 'Enter' && (mac ? e.metaKey : e.ctrlKey) && armed) {
        e.preventDefault()
        void answer('once')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [quick, busy, armed, mac, answer])

  if (quick) {
    // Tarjeta fija sobre la caja de entrada: la pregunta arriba y dos botones a lo ancho con su atajo.
    return (
      <div className="mx-auto mb-2 w-full max-w-3xl px-6 animate-rise-in">
        <div className="rounded-card bg-elevated p-3 shadow-raised ring-1 ring-inset ring-accent/40">
          <div className="flex items-start gap-2.5">
            <Icon size={16} className="mt-0.5 shrink-0 text-accent" />
            <button type="button" className="min-w-0 flex-1 text-left" title={d.detail || undefined} onClick={review}>
              <span className="block text-ui font-medium text-fg">
                {d.title}
                {more > 0 && <span className="ml-1.5 text-meta font-normal text-muted">{t('tasksComputer.perm.more', { more })}</span>}
              </span>
              {d.detail && <span className="mt-0.5 block truncate font-mono text-caption text-muted">{d.detail}</span>}
            </button>
          </div>
          <div className="mt-3 grid gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => answer('reject')} className="w-full justify-center">
              {t('tasksComputer.perm.reject')}
              <kbd
                aria-hidden
                className="ml-1.5 rounded border border-current/25 px-1 font-sans text-[10px] desk:text-meta leading-4 opacity-70"
              >
                {t('tasksComputer.perm.kbdReject')}
              </kbd>
            </Button>
            <Button
              variant="primary"
              disabled={busy || !armed}
              onClick={() => answer('once')}
              aria-keyshortcuts={mac ? 'Meta+Enter' : 'Control+Enter'}
              className="w-full justify-center"
            >
              {t('tasksComputer.perm.once')}
              <kbd
                aria-hidden
                className="ml-1.5 rounded border border-current/25 px-1 font-sans text-[10px] desk:text-meta leading-4 opacity-70"
              >
                {mac ? t('tasksComputer.perm.kbdOnce') : t('tasksComputer.perm.kbdOnce.win')}
              </kbd>
            </Button>
            {canAlways && (
              <Button variant="ghost" size="sm" disabled={busy || !armed} title={alwaysHint(request)} onClick={() => answer('always')}>
                {t('tasksComputer.perm.alwaysShort')}
              </Button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto mb-2 w-full max-w-3xl px-6 animate-rise-in">
      <div
        className={`flex items-center gap-3 rounded-card px-3 py-2 shadow-raised ring-1 ring-inset ${
          d.danger ? 'bg-danger/[0.06] ring-danger/40' : 'bg-elevated ring-accent/40'
        }`}
      >
        <Icon size={16} className={`shrink-0 ${d.danger ? 'text-danger' : 'text-accent'}`} />
        <button type="button" className="min-w-0 flex-1 text-left" title={d.detail || undefined} onClick={review}>
          <span className="block truncate text-ui font-medium text-fg">
            {d.title}
            {more > 0 && <span className="ml-1.5 text-meta font-normal text-muted">{t('tasksComputer.perm.more', { more })}</span>}
          </span>
          <span className="block truncate font-mono text-caption text-muted">{d.detail}</span>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          {d.kind === 'folder' ? (
            <Button variant="secondary" size="sm" onClick={review}>
              {t('tasksComputer.perm.review')}
            </Button>
          ) : compact ? (
            <>
              <Button variant="secondary" size="sm" onClick={review}>
                {t('tasksComputer.perm.review')}
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => answer('reject')}>
                {t('tasksComputer.perm.reject')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => answer('reject')}>
                {t('tasksComputer.perm.reject')}
              </Button>
              {canAlways && (
                <Button size="sm" disabled={busy || !armed} title={alwaysHint(request)} onClick={() => answer('always')}>
                  {t('tasksComputer.perm.alwaysShort')}
                </Button>
              )}
              <Button variant={d.danger ? 'danger' : 'primary'} size="sm" disabled={busy || !armed} onClick={() => answer('once')}>
                {t('tasksComputer.perm.once')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
