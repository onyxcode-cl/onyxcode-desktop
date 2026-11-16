/**
 * Tarjeta de permiso de Tareas en ESCRITORIO (plan ND). El celular/PWA usa `GenericPermissionCard`
 * (marcado de siempre, sin cambios); aquí se aplica la anatomía `oc-perm` (DESIGN.md) y el modelo de
 * teclado seguro de `lib/perm-guard`. Solo se importa desde `PermissionPrompt.tsx`, nunca desde la PWA.
 */
import { useEffect, useState } from 'react'
import { Folder, ShieldAlert, ShieldCheck } from 'lucide-react'
import { RememberRules, useNewPermissionRules } from '../../../components/permission/RememberRules'
import { rememberablePatterns } from './util'
import { outsideDirectories } from '@shared/auto-review'
import type { PermissionRequest } from '@opencode-ai/sdk/v2/client'
import { DiffView, hasDiffChanges } from '../../../components/DiffView'
import {
  PermActions,
  PermCardFrame,
  PermCommand,
  PermNoteField,
  PermOutside,
  PermCommandNotice,
  PermPreview,
  PermScope,
  previewFits,
  usePermGuard,
  type PermAction
} from '../../../components/permission/PermissionShell'
import { isProtectedPermission } from '@shared/protected-path'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { isMacPlatform } from '../../../lib/platform'
import {
  alwaysHint,
  describePermission,
  hasHiddenChars,
  useCanAlways,
  usePermissionCommandPolicy,
  useMcpServers,
  useReply,
  useRequestTitle,
  useToolInput
} from './PermissionPrompt'
import { sdkDir, useShowPath } from './conn-paths'
import { useTasks } from './store'

/**
 * M5: borrador de «¿Qué hacer distinto?» por petición, compartido entre la tarjeta detallada y la barra compacta, para que
 * un «No» desde la barra lleve el texto que la persona escribió en la tarjeta.
 */
const noteDrafts = new Map<string, string>()

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
  const toolInput = useToolInput(request)
  const d = describePermission(request, servers, showPath, toolInput)
  const title = useRequestTitle(request, d.title)
  const { busy, error, answer, reject } = useReply(request)
  // V29: «No» lleva el campo opcional «¿Qué hacer distinto?» (la IA lo recibe y sigue).
  const [note, setNote] = useState('')
  const autoNote = useTasks((s) => s.autoNotes?.[request.id])
  const canAlways = useCanAlways(request, d.danger)
  const folder = useTasks((s) => s.folder)
  const connection = useTasks((s) => s.conn)
  const newRules = useNewPermissionRules(
    rememberablePatterns(request),
    request.permission,
    folder ? sdkDir(folder) : null,
    request.id,
    connection
  )
  const fullAccess = useTasks((s) => s.conn?.fullAccess === true)
  const home = useTasks((s) => s.fullAccessInfo?.home)
  const mac = isMacPlatform()
  const { armed, onKeyDown } = usePermGuard({ id: request.id, reply: (kind) => (kind === 'reject' ? reject(note) : answer(kind)), busy })

  const showDiff = !!d.diff && hasDiffChanges(d.diff)
  const isBash = request.permission === 'bash'
  const policy = usePermissionCommandPolicy(request)
  const outside = isBash || request.permission === 'bgshell_start' ? outsideDirectories(request.metadata) : []

  const actions: PermAction[] = [
    ...(canAlways
      ? [
          {
            label: t('perm.allowProject'),
            variant: 'secondary' as const,
            side: 'left' as const,
            permit: true,
            act: 'always' as const,
            title: newRules.length ? t('perm.allowProjectRules', { rules: newRules.join(', ') }) : undefined,
            onClick: () => answer('always')
          }
        ]
      : []),
    {
      label: t('perm.no'),
      variant: 'secondary',
      side: 'right',
      kbd: t('tasksComputer.perm.kbdReject'),
      onClick: () => reject(note)
    },
    {
      label: t('perm.allow'),
      variant: d.danger ? 'danger' : 'primary',
      side: 'right',
      permit: true,
      act: 'once',
      kbd: t('tasksComputer.perm.kbdOnce'),
      ariaKeyshortcuts: mac ? 'Meta+Enter' : 'Control+Enter',
      onClick: () => answer('once')
    }
  ]

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
      {isProtectedPermission(request.metadata) && (
        <p role="note" className="flex items-start gap-1.5 text-meta font-medium text-warning">
          <ShieldAlert size={13} className="mt-0.5 shrink-0" />
          {t('tasksComputer.perm.protectedPath')}
        </p>
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
      <PermCardFrame
        id={request.id}
        danger={d.danger}
        armed={armed}
        busy={busy}
        icon={d.icon}
        title={title}
        effect={d.effect}
        preview={
          d.detail || outside.length || autoNote || request.metadata.subcommands || policy.notice ? (
            <>
              {d.detail && <PermPreview text={d.detail} prompt={isBash} danger={d.danger} />}
              <PermOutside dirs={outside} />
              <PermCommandNotice notice={policy.notice} />
              <RememberRules metadata={request.metadata} rules={newRules} available={canAlways} showLimit={!policy.alwaysAsk} />
              {autoNote && (
                <p role="note" className="flex items-start gap-1.5 text-meta text-warning">
                  <ShieldAlert size={13} className="mt-0.5 shrink-0" />
                  {t('perm.reviewNote', { reason: autoNote })}
                </p>
              )}
            </>
          ) : undefined
        }
        details={details}
        detailsOpen={openDetails}
        onKeyDown={onKeyDown}
      >
        {error && (
          <p role="alert" className="text-meta text-danger">
            {error}
          </p>
        )}
        <PermActions actions={actions} armed={armed} busy={busy} />
        {d.kind !== 'folder' && (
          <PermNoteField
            value={note}
            onChange={(v) => {
              setNote(v)
              if (v.trim()) noteDrafts.set(request.id, v)
              else noteDrafts.delete(request.id)
            }}
            onSubmit={() => reject(note)}
            busy={busy}
          />
        )}
      </PermCardFrame>
    </>
  )
}

/** Barra compacta sobre el compositor (escritorio): sin atajos; «Permitir» armado 600 ms tras montar. */
export function ApprovalBarDesk({ request, more }: { request: PermissionRequest; more: number }): React.JSX.Element {
  const t = useT()
  const servers = useMcpServers()
  const showPath = useShowPath()
  const toolInput = useToolInput(request)
  const d = describePermission(request, servers, showPath, toolInput)
  const title = useRequestTitle(request, d.title)
  const { busy, answer, reject } = useReply(request)
  const canAlways = useCanAlways(request, d.danger)
  const Icon = d.icon
  const id = `perm-${request.id}`
  // M5: un «No» desde la barra lleva lo que la persona escribió en «¿Qué hacer distinto?» de la tarjeta.
  const rejectWithDraft = (): void => reject(noteDrafts.get(request.id) ?? '')

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
        void reject(noteDrafts.get(request.id) ?? '')
      } else if (e.key === 'Enter' && (mac ? e.metaKey : e.ctrlKey) && armed) {
        e.preventDefault()
        void answer('once')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [quick, busy, armed, mac, answer, reject, request.id])

  if (quick) {
    // Tarjeta fija sobre la caja de entrada: la pregunta arriba y dos botones a lo ancho con su atajo.
    return (
      <div className="mx-auto mb-2 w-full max-w-3xl px-6 animate-rise-in">
        <div className="rounded-card bg-elevated p-3 shadow-raised ring-1 ring-inset ring-accent/40">
          <div className="flex items-start gap-2.5">
            <Icon size={16} className="mt-0.5 shrink-0 text-accent" />
            <button type="button" className="min-w-0 flex-1 text-left" title={d.detail || undefined} onClick={review}>
              <span className="block text-ui font-medium text-fg">
                {title}
                {more > 0 && <span className="ml-1.5 text-meta font-normal text-muted">{t('tasksComputer.perm.more', { more })}</span>}
              </span>
              {d.detail && <span className="mt-0.5 block truncate font-mono text-caption text-muted">{d.detail}</span>}
            </button>
          </div>
          <div className="mt-3 grid gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => rejectWithDraft()} className="w-full justify-center">
              {t('perm.no')}
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
              {t('perm.allow')}
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
            {title}
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
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => rejectWithDraft()}>
                {t('perm.no')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => rejectWithDraft()}>
                {t('perm.no')}
              </Button>
              {canAlways && (
                <Button size="sm" disabled={busy || !armed} title={alwaysHint(request)} onClick={() => answer('always')}>
                  {t('tasksComputer.perm.alwaysShort')}
                </Button>
              )}
              <Button variant={d.danger ? 'danger' : 'primary'} size="sm" disabled={busy || !armed} onClick={() => answer('once')}>
                {t('perm.allow')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
