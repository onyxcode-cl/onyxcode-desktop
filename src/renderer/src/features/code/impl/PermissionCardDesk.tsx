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
  hasHiddenChars,
  PermCommand,
  PermNoteField,
  PermOutside,
  PermPreview,
  PermScope,
  previewFits,
  usePermGuard,
  type PermAction
} from '../../../components/permission/PermissionShell'
import { isProtectedPermission } from '@shared/protected-path'
import { readPermissionSuggestion } from '@shared/permission-suggestion'
import { outsideDirectories, subcommandRules } from '@shared/auto-review'
import { useT } from '../../../lib/i18n'
import { isMacPlatform } from '../../../lib/platform'
import { DiffView, diffStats } from './DiffView'
import { DiffStats, relPath } from './ToolCard'
import { useCode } from './store'
import { useSubagentOfRequest } from './subagent-of-request'
import type { PendingPermission, PermissionReplyExtra } from './types'

const PERMISSION_LABEL: Record<string, MsgKey> = {
  edit: 'code.perm.edit',
  write: 'code.perm.write',
  bash: 'code.perm.bash',
  bgshell_start: 'code.perm.background',
  webfetch: 'code.perm.webfetch',
  websearch: 'code.perm.websearch',
  read: 'code.perm.read',
  external_directory: 'code.perm.external_directory',
  task: 'code.perm.task',
  doom_loop: 'code.perm.doom_loop',
  todowrite: 'code.perm.todowrite',
  documentos_crear: 'code.perm.documentos_crear',
  documentos_renderizar: 'code.perm.documentos_renderizar'
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
  const sub = useSubagentOfRequest(request.sessionID)
  const [note, setNote] = useState('')
  const run = useCallback(
    (r: 'once' | 'always' | 'reject', extra?: PermissionReplyExtra): void => {
      if (busyRef.current) return
      busyRef.current = true
      setBusy(true)
      void reply(request, r, false, extra).finally(() => {
        busyRef.current = false
        setBusy(false)
      })
    },
    [reply, request]
  )
  // «No» lleva el texto de «¿Qué hacer distinto?» (si lo hay): la IA lo recibe y sigue.
  const reject = (): void => run('reject', note.trim() ? { message: note.trim() } : undefined)
  const { armed, onKeyDown } = usePermGuard({ id: request.id, reply: (kind) => (kind === 'reject' ? reject() : run(kind)), busy })
  const reviewNote = useCode((s) => s.reviewNotes[request.id])

  const tool = useCode((s) =>
    request.tool
      ? s.messages[request.sessionID]
          ?.find((m) => m.info.id === request.tool!.messageID)
          ?.parts.find((p) => p.type === 'tool' && p.callID === request.tool!.callID)
      : undefined
  )
  const input = tool?.type === 'tool' ? tool.state.input : undefined
  const md = request.metadata
  // Ruta protegida del motor: el motor ya manda `always: []`; aquí tampoco se ofrece «Permitir siempre» y se avisa con una línea clara.
  const protectedPath = isProtectedPermission(md)
  // Solo informa: texto plano, sin tocar botones, foco ni orden; en ruta protegida no se muestra.
  const suggestion = readPermissionSuggestion(request, { protectedPath, isChild: sub.child })
  const diff = typeof md.diff === 'string' ? md.diff : ''
  const command =
    typeof md.command === 'string'
      ? md.command
      : request.permission === 'bgshell_start' && typeof input?.command === 'string'
        ? input.command
        : ''
  const cwd =
    typeof input?.cwd === 'string'
      ? input.cwd
      : typeof input?.workdir === 'string'
        ? input.workdir
        : typeof md.workdir === 'string'
          ? md.workdir
          : request.permission === 'bgshell_start'
            ? null
            : root
  const description = typeof md.description === 'string' ? md.description : ''
  const file = typeof md.filepath === 'string' ? md.filepath : typeof md.filePath === 'string' ? md.filePath : ''
  const labelKey = PERMISSION_LABEL[request.permission]
  const label = labelKey ? t(labelKey) : request.permission
  const stats = diff ? diffStats(diff) : null
  const patterns = request.patterns.filter((p) => p && p !== command)
  const shell = request.permission === 'bash' || request.permission === 'bgshell_start'
  // Contrato V29 §1: reglas por parte del comando; sin `subcommands` (motor viejo) se conserva el «siempre» de antes.
  const rules = shell ? subcommandRules(md) : null
  const outside = shell
    ? outsideDirectories(md)
    : request.permission === 'external_directory' && command
      ? [...new Set(patterns.map((p) => p.replace(/[\\/]\*$/, '')))]
      : []
  const Icon =
    request.permission === 'bash' || request.permission === 'bgshell_start'
      ? SquareTerminal
      : request.permission === 'edit' || request.permission === 'write'
        ? FilePen
        : ShieldAlert

  const actions: PermAction[] = [
    // «No volver a preguntar» no se ofrece a un ayudante (ampliaría lo que la persona permitió) ni sin reglas que guardar.
    ...(sub.child || protectedPath || (rules !== null && !rules.length)
      ? []
      : [
          {
            label: t('perm.allowProject'),
            variant: 'secondary' as const,
            side: 'left' as const,
            permit: true,
            act: 'always' as const,
            title: rules?.length
              ? t('perm.allowProjectRules', { rules: rules.join(', ') })
              : request.always.length
                ? t('code.perm.alwaysTitle', { patterns: request.always.join(', ') })
                : undefined,
            onClick: () => run('always', rules?.length ? { rules } : undefined)
          }
        ]),
    { label: t('perm.no'), variant: 'secondary', side: 'right', kbd: t('code.perm.kbdReject'), onClick: reject },
    {
      label: t('perm.allow'),
      variant: 'primary',
      side: 'right',
      permit: true,
      act: 'once',
      kbd: hotkeys ? t('code.perm.kbdOnce') : undefined,
      ariaKeyshortcuts: mac ? 'Meta+Enter' : 'Control+Enter',
      onClick: () => run('once')
    }
  ]

  const previewText = command || (file ? relPath(file, root) : patterns.map((p) => relPath(p, root)).join(', '))
  const previewNode = command ? (
    <div className="max-h-40 overflow-auto">
      <PermCommand text={command} prompt hasHidden={false} hiddenMessage="" longMessage={(n) => t('code.perm.cmdLong', { n })} />
    </div>
  ) : previewText ? (
    <PermPreview text={previewText} prompt={!!command} extra={!command && stats ? <DiffStats {...stats} /> : undefined} />
  ) : undefined
  // Nace abierto si el resumen de una línea no muestra todo el comando (largo, varias líneas o caracteres ocultos).
  const openDetails = protectedPath || (!!previewText && !previewFits(previewText, hasHiddenChars(previewText)))

  // Sugerencia de la IA: una línea visible fuera del desplegable; la nota «no decide nada» va como ayuda y para lectores de pantalla.
  const suggestionNode = suggestion ? (
    <p className="text-meta text-muted" title={t('code.perm.suggestion.note')}>
      {t(`code.perm.suggestion.${suggestion.value}` as MsgKey, { reason: suggestion.reason })}
      <span className="sr-only"> {t('code.perm.suggestion.note')}</span>
    </p>
  ) : undefined
  // Tope de bloqueos del revisor automático: la persona ve por qué lo habría frenado.
  const reviewNode = reviewNote ? (
    <p role="note" className="flex items-start gap-1.5 text-meta text-warning">
      <ShieldAlert size={13} className="mt-0.5 shrink-0" />
      {t('perm.reviewNote', { reason: reviewNote })}
    </p>
  ) : undefined

  const details = (
    <>
      {protectedPath && (
        <p role="note" className="flex items-start gap-1.5 text-meta font-medium text-warning">
          <ShieldAlert size={13} className="mt-0.5 shrink-0" />
          {t('code.perm.protectedPath')}
        </p>
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
      {rules && rules.length > 0 && (
        <p className="break-all font-mono text-meta text-muted">{t('perm.allowProjectRules', { rules: rules.join(', ') })}</p>
      )}
      {description && (
        <div className="rounded-ctl bg-hover/40 px-3 py-2 ring-1 ring-inset ring-border/70">
          <p className="text-caption font-medium text-subtle">{t('code.perm.aiDesc')}</p>
          <p className="mt-0.5 text-ui text-muted">{description}</p>
        </div>
      )}
      {cwd && (
        <PermScope>
          <span className="inline-flex items-center gap-1.5">
            <ShieldAlert size={14} className="text-muted" />
            {t('code.perm.workingFolder', { root: cwd })}
          </span>
        </PermScope>
      )}
    </>
  )

  return (
    <PermCardFrame
      id={request.id}
      danger={false}
      armed={armed}
      busy={busy}
      icon={Icon}
      title={
        sub.child
          ? sub.name
            ? t('code.perm.subagentWants', { name: sub.name, label })
            : t('code.perm.subagentWantsAnon', { label })
          : t('code.perm.agentWants', { label })
      }
      preview={
        previewNode || suggestionNode || reviewNode || outside.length ? (
          <>
            {previewNode}
            <PermOutside dirs={outside} />
            {reviewNode}
            {suggestionNode}
          </>
        ) : undefined
      }
      details={details}
      detailsOpen={openDetails}
      onKeyDown={onKeyDown}
    >
      <PermActions actions={actions} armed={armed} busy={busy} />
      <PermNoteField value={note} onChange={setNote} onSubmit={reject} busy={busy} />
    </PermCardFrame>
  )
}
