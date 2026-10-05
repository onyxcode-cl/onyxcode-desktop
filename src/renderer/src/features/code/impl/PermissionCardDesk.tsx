/**
 * Tarjeta de permiso de Code en ESCRITORIO (plan ND). El celular/PWA usa `MobilePermissionCard`
 * (marcado de siempre, sin cambios); aquí se aplica el shell de permiso (DESIGN.md) y el teclado
 * seguro de `lib/perm-guard`. Se retiró el atajo global 1/2/3 (permitir siempre con «2»).
 */
import { useCallback, useRef, useState } from 'react'
import { FilePen, ShieldAlert, SquareTerminal } from 'lucide-react'
import type { MsgKey } from '@shared/i18n'
import {
  PermActions,
  PermCardFrame,
  PermCommand,
  PermScope,
  usePermGuard,
  type PermAction
} from '../../../components/permission/PermissionShell'
import { useT } from '../../../lib/i18n'
import { isMacPlatform } from '../../../lib/platform'
import { DiffView, diffStats } from './DiffView'
import { DiffStats, relPath } from './ToolCard'
import { useCode } from './store'
import type { PendingPermission } from './types'

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

export function PermissionCardDesk({
  request,
  root,
  hotkeys = false
}: {
  request: PendingPermission
  root: string | null
  hotkeys?: boolean
}): React.JSX.Element {
  const t = useT()
  const reply = useCode((s) => s.replyPermission)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const mac = isMacPlatform()
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
  const { armed, onKeyDown } = usePermGuard({ id: request.id, reply: (kind) => run(kind), busy })

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

  const actions: PermAction[] = [
    {
      label: t('code.perm.always'),
      variant: 'secondary',
      side: 'left',
      permit: true,
      act: 'always',
      title: request.always.length ? t('code.perm.alwaysTitle', { patterns: request.always.join(', ') }) : undefined,
      onClick: () => run('always')
    },
    { label: t('code.perm.reject'), variant: 'secondary', side: 'right', kbd: t('code.perm.kbdReject'), onClick: () => run('reject') },
    {
      label: t('code.perm.once'),
      variant: 'primary',
      side: 'right',
      permit: true,
      act: 'once',
      kbd: hotkeys ? t('code.perm.kbdOnce') : undefined,
      ariaKeyshortcuts: mac ? 'Meta+Enter' : 'Control+Enter',
      onClick: () => run('once')
    }
  ]

  return (
    <PermCardFrame
      id={request.id}
      danger={false}
      armed={armed}
      busy={busy}
      icon={Icon}
      title={t('code.perm.agentWants', { label })}
      effect={description || undefined}
      onKeyDown={onKeyDown}
    >
      {file && (
        <div className="flex items-center gap-2 font-mono text-meta text-muted">
          <span className="truncate">{relPath(file, root)}</span>
          {stats && <DiffStats {...stats} />}
        </div>
      )}
      {command && (
        <PermCommand text={command} prompt hasHidden={false} hiddenMessage="" longMessage={(n) => t('code.perm.cmdLong', { n })} />
      )}
      {!command && !diff && patterns.length > 0 && (
        <div className="rounded-ctl bg-code ring-1 ring-inset ring-border">
          <pre className="max-h-40 overflow-auto px-3 py-2.5 font-mono text-[13px] whitespace-pre-wrap break-all">
            {patterns.map((p) => relPath(p, root)).join('\n')}
          </pre>
        </div>
      )}
      {diff && (
        <div className="overflow-hidden rounded-ctl bg-code ring-1 ring-inset ring-border">
          <DiffView patch={diff} path={file} hideFileHeaders className="max-h-80" />
        </div>
      )}
      {root && (
        <PermScope>
          <span className="inline-flex items-center gap-1.5">
            <ShieldAlert size={14} className="text-muted" />
            {t('code.perm.noSandbox', { root })}
          </span>
        </PermScope>
      )}
      <PermActions actions={actions} armed={armed} busy={busy} />
    </PermCardFrame>
  )
}
