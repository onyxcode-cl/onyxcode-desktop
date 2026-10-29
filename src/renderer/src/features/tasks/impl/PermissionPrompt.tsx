/**
 * Aprobaciones de Tareas: tarjeta detallada (en la conversación) y barra fija sobre el
 * compositor con "Permitir una vez / Siempre / Rechazar" y qué ocurrirá exactamente.
 * Las peticiones de otra carpeta (`external_directory`) tienen su propia tarjeta (`FolderRequestCard`).
 * Siempre se muestra el comando, la ruta o los parámetros LITERALES; la descripción del modelo va aparte
 * y marcada como no verificada.
 */
import { hasHiddenChars } from '../../../components/permission/PermissionShell'
import { useEffect, useRef, useState } from 'react'
import type { PermissionRequest } from '@opencode-ai/sdk/v2/client'
import { FileEdit, FolderInput, Globe, PlugZap, Repeat, ShieldAlert, Terminal, Trash2, type LucideIcon } from 'lucide-react'
import { t } from '@shared/i18n'
import { isProtectedPermission } from '@shared/protected-path'
import { Button } from '../../../components/Button'
import { DiffView, hasDiffChanges } from '../../../components/DiffView'
import { useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import { isRemoteSurface } from '../../../lib/platform'
import { ApprovalBarDesk, PermissionCardDesk } from './PermissionCardDesk'
import { replyPermission, replyPermissionAlways } from './actions'
import { cw } from './bridge'
import { computerToolInfo, computerToolKind } from './computer-tools'
import { metadataJson, parseMcpPermission, showAlways } from './conversation-logic'
import { FolderRequestCard } from './FolderRequestCard'
import { permActions } from './perm-actions'
import { useShowPath } from './conn-paths'
import { useTaskSubagentOfRequest } from './subagent-of-request'
import { useTasks } from './store'
import { baseName, rememberablePatterns } from './util'

type Reply = 'once' | 'always' | 'reject'

interface Described {
  icon: LucideIcon
  title: string
  /** Qué hará exactamente (frase, redactada por nosotros, no por el modelo). */
  effect: string
  /** Detalle literal (comando, ruta, URL…) tal como lo ejecutará el agente. Se muestra primero. */
  detail: string
  /** Descripción libre generada por el modelo (p. ej. el "description" de un comando bash). No verificada. */
  aiDescription?: string
  /** Diferencia (diff unificado) que producirá una edición: se muestra con colores en lugar de texto plano. */
  diff?: string
  /** Ruta del archivo que se edita (resaltado de sintaxis del diff). */
  file?: string
  /** Bloques literales adicionales (etiqueta + texto), p. ej. los patrones de una herramienta MCP. */
  sections?: Array<{ label: string; text: string }>
  /** `folder`: otra carpeta (tarjeta propia, sin botones rápidos). */
  kind?: 'folder'
  danger: boolean
}

export { hasHiddenChars }

function meta(p: PermissionRequest, ...keys: string[]): string {
  for (const key of keys) {
    const v = p.metadata[key]
    if (typeof v === 'string' && v) return v
  }
  return ''
}

const DELETE_RE = /(^|[;&|]\s*)(rm|rmdir|unlink|trash|srm)\b|\s-delete\b/

/** Traduce la solicitud de permiso a lenguaje claro. */
export function describePermission(
  p: PermissionRequest,
  mcpServers: string[] = [],
  showPath: (path: string) => string = (x) => x
): Described {
  const patterns = p.patterns.join(', ')
  switch (p.permission) {
    case 'bash': {
      const cmd = meta(p, 'command') || patterns
      const desc = meta(p, 'description')
      if (DELETE_RE.test(cmd)) {
        return {
          icon: Trash2,
          title: t('tasksComputer.perm.deleteTitle'),
          effect: t('tasksComputer.perm.deleteEffect'),
          detail: cmd,
          aiDescription: desc || undefined,
          danger: true
        }
      }
      return {
        icon: Terminal,
        title: t('tasksComputer.perm.bashTitle'),
        effect: t('tasksComputer.perm.bashEffect'),
        detail: cmd,
        aiDescription: desc || undefined,
        danger: false
      }
    }
    case 'edit': {
      const file = meta(p, 'filepath', 'filePath', 'path') || patterns
      return {
        icon: FileEdit,
        title: file ? t('tasksComputer.perm.editTitle', { file: baseName(file) }) : t('tasksComputer.perm.editTitleNone'),
        effect: t('tasksComputer.perm.editEffect'),
        detail: showPath(file),
        diff: meta(p, 'diff') || undefined,
        file: file || undefined,
        danger: false
      }
    }
    case 'external_directory': {
      const dir = meta(p, 'parentDir', 'filepath', 'filePath', 'path') || patterns
      return {
        icon: FolderInput,
        title: t('tasksComputer.perm.folderTitle'),
        effect: t('tasksComputer.perm.folderEffect'),
        detail: showPath(dir),
        kind: 'folder',
        danger: true
      }
    }
    case 'webfetch':
    case 'websearch':
      return {
        icon: Globe,
        title: t('tasksComputer.perm.webTitle'),
        effect: t('tasksComputer.perm.webEffect'),
        detail: meta(p, 'url', 'query') || patterns,
        danger: false
      }
    case 'equipo_ejecutar': {
      // Nivel 2: un comando que corre en el equipo, FUERA del aislamiento. Se muestra completo y nunca ofrece «siempre» (`danger`).
      const cmd = meta(p, 'comando') || patterns
      return {
        icon: Terminal,
        title: t('tasksComputer.perm.hostTitle'),
        effect: t('tasksComputer.perm.hostEffect'),
        detail: cmd,
        aiDescription: meta(p, 'motivo') || undefined,
        danger: true
      }
    }
    case 'equipo_detener':
      return {
        icon: Terminal,
        title: t('tasksComputer.perm.hostStopTitle'),
        effect: t('tasksComputer.perm.hostStopEffect'),
        detail: meta(p, 'pid') || patterns,
        danger: false
      }
    case 'doom_loop':
      return {
        icon: Repeat,
        title: t('tasksComputer.perm.loopTitle'),
        effect: t('tasksComputer.perm.loopEffect'),
        detail: patterns,
        danger: false
      }
    default: {
      const kind = computerToolKind(p.permission)
      if (kind) {
        return {
          icon: computerToolInfo(kind).icon,
          title: t('tasksComputer.perm.macTitle', { action: computerToolInfo(kind).label.toLowerCase() }),
          effect: t('tasksComputer.perm.macEffect'),
          detail: patterns,
          danger: true
        }
      }
      const mcp = parseMcpPermission(p.permission, mcpServers)
      if (mcp) {
        const json = metadataJson(p.metadata)
        return {
          icon: PlugZap,
          title: t('tasksComputer.perm.mcpTitle', { tool: mcp.tool, server: mcp.server }),
          effect: t('tasksComputer.perm.mcpEffect'),
          detail: json || patterns,
          sections: json && patterns ? [{ label: t('tasksComputer.perm.patterns'), text: p.patterns.join('\n') }] : undefined,
          danger: false
        }
      }
      return {
        icon: ShieldAlert,
        title: t('tasksComputer.perm.genericTitle', { permission: p.permission }),
        effect: t('tasksComputer.perm.genericEffect'),
        detail: patterns || JSON.stringify(p.metadata),
        danger: false
      }
    }
  }
}

/** Título de la solicitud; si la pide un ayudante (subagente) lo dice: «Ayudante «X»: …». */
export function useRequestTitle(request: PermissionRequest, title: string): string {
  const t = useT()
  const sub = useTaskSubagentOfRequest(request.sessionID)
  if (!sub.child) return title
  return sub.name ? t('tasks.perm.subagentTitle', { name: sub.name, title }) : t('tasks.perm.subagentTitleAnon', { title })
}

/** Nombres de los conectores MCP del usuario (una sola consulta): sirven para separar «servidor_herramienta». */
let mcpNamesPromise: Promise<string[]> | null = null
export function useMcpServers(): string[] {
  const [names, setNames] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    mcpNamesPromise ??= cw('tasks:mcp:list')
      .then((l) => l.map((m) => m.name))
      .catch(() => {
        mcpNamesPromise = null
        return []
      })
    void mcpNamesPromise.then((n) => alive && setNames(n))
    return () => {
      alive = false
    }
  }, [])
  return names
}

export function useReply(request: PermissionRequest): {
  busy: boolean
  error: string | null
  answer: (r: Reply) => void
  reject: (message: string) => void
} {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Doble envío: guardia SÍNCRONA (useState se actualiza en el siguiente render, llega tarde).
  const busyRef = useRef(false)
  const answer = (reply: Reply): void => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    // «Siempre» además guarda la regla en main para que valga al reabrir la carpeta.
    const call = reply === 'always' ? replyPermissionAlways(request) : replyPermission(request.id, reply)
    // Éxito: la tarjeta se desmonta al resolverse el permiso, no hace falta rearmar. Error: rehabilita (y desarma).
    call.catch((err: unknown) => {
      setError(errorMessage(err))
      busyRef.current = false
      setBusy(false)
    })
  }
  /** Rechaza y le dice al agente qué cambiar (`message` llega al agente como indicación del usuario). */
  const reject = (message: string): void => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    replyPermission(request.id, 'reject', message.trim() || undefined).catch((err: unknown) => {
      setError(errorMessage(err))
      busyRef.current = false
      setBusy(false)
    })
  }
  return { busy, error, answer, reject }
}

/** Área de texto «Dile al agente qué cambiar…» del botón «Rechazar con indicaciones». */
export function RejectWithNote({
  busy,
  onSend,
  onCancel
}: {
  busy: boolean
  onSend: (text: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const t = useT()
  const [text, setText] = useState('')
  const box = useRef<HTMLDivElement>(null)
  // Los botones quedan bajo el pliegue de la conversación: se trae todo el bloque a la vista.
  useEffect(() => {
    box.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])
  return (
    <div ref={box} className="mt-3">
      <textarea
        autoFocus
        value={text}
        rows={3}
        disabled={busy}
        data-perm-note
        aria-label={t('tasksComputer.perm.noteAria')}
        placeholder={t('tasksComputer.perm.notePlaceholder')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) onSend(text)
        }}
        className="w-full resize-y rounded-lg border border-border-strong bg-elevated px-3 py-2 text-sm focus:shadow-[0_0_0_3px_var(--accent-ring)] focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-2">
        <Button variant="primary" disabled={busy || !text.trim()} onClick={() => onSend(text)}>
          {t('tasksComputer.perm.rejectSend')}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          {t('tasksComputer.cancel')}
        </Button>
      </div>
    </div>
  )
}

/** ¿Se ofrece «Siempre»? Oculto con la política `disableAlwaysAllow` o si nada de la petición se puede recordar. */
export function useCanAlways(request: PermissionRequest, danger: boolean): boolean {
  const disable = useTasks((s) => s.policy?.disableAlwaysAllow === true)
  // Un ayudante (subagente) nunca ofrece «Siempre»: la regla se guardaría para la carpeta y ampliaría lo que la persona permitió.
  const { child } = useTaskSubagentOfRequest(request.sessionID)
  if (child) return false
  return showAlways({ danger, disableAlwaysAllow: disable, rememberableCount: rememberablePatterns(request).length })
}

export function alwaysHint(p: PermissionRequest): string {
  const list = rememberablePatterns(p)
  return list.length > 0 ? t('tasksComputer.perm.alwaysHint', { list: list.join(', ') }) : t('tasksComputer.perm.alwaysHintNone')
}

/** Tarjeta detallada dentro de la conversación (otra carpeta ⇒ `FolderRequestCard`). */
export function PermissionCard({ request }: { request: PermissionRequest }): React.JSX.Element | null {
  // Lote C: mientras el Modo auto está considerando esta petición (vía rápida), no se muestra
  // ninguna tarjeta; si no la aprueba, `autoPending` se limpia y vuelve a aparecer con normalidad.
  const autoPending = useTasks((s) => !!s.autoPending[request.id])
  if (autoPending) return null
  if (request.permission === 'external_directory') return <FolderRequestCard request={request} />
  // Celular/PWA: marcado de siempre, sin cambios. Escritorio: rediseño ND (anatomía y teclado seguros).
  if (isRemoteSurface()) return <GenericPermissionCard request={request} />
  return <PermissionCardDesk request={request} />
}

const BTN_VARIANT = { primary: 'primary', danger: 'danger', neutral: 'ghost', outline: 'secondary' } as const
const BTN_EXTRA = { primary: '', danger: '', neutral: 'bg-active! text-fg!', outline: 'bg-transparent! border-border-strong!' } as const

function GenericPermissionCard({ request }: { request: PermissionRequest }): React.JSX.Element {
  const t = useT()
  const servers = useMcpServers()
  const showPath = useShowPath()
  const d = describePermission(request, servers, showPath)
  const title = useRequestTitle(request, d.title)
  const { busy, error, answer, reject } = useReply(request)
  const [noting, setNoting] = useState(false)
  const canAlways = useCanAlways(request, d.danger)
  const Icon = d.icon
  const showDiff = !!d.diff && hasDiffChanges(d.diff)
  // Celular (decisiones-pwa #1): el orden y las variantes salen de `permActions`; la tarjeta solo recorre la lista.
  const actions = permActions({ danger: d.danger, canAlways, noting })
  return (
    <div
      id={`perm-${request.id}`}
      tabIndex={-1}
      className={`rounded-xl border p-4 outline-none ${d.danger ? 'border-danger/40 bg-danger/5' : 'border-warning/40 bg-warning/5'}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            d.danger ? 'bg-danger/15 text-danger' : 'bg-warning/15 text-warning'
          }`}
        >
          <Icon size={16} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[17px] leading-6 font-semibold">{title}</p>
          <p className="mt-0.5 text-sm leading-5 text-muted">{d.effect}</p>
          {d.detail && (
            <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-code px-2.5 py-1.5 font-mono text-xs leading-[18px] whitespace-pre-wrap">
              {d.detail}
            </pre>
          )}
          {d.diff && (
            <div className="mt-2 overflow-hidden rounded-md border border-border bg-code">
              {showDiff ? (
                <DiffView patch={d.diff} path={d.file} hideFileHeaders className="max-h-56" />
              ) : (
                <pre className="max-h-56 overflow-auto px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap">{d.diff}</pre>
              )}
            </div>
          )}
          {(d.diff ? hasHiddenChars(d.diff) : false) && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-danger">
              <ShieldAlert size={13} className="mt-0.5 shrink-0" />
              {t('tasksComputer.perm.hidden')}
            </p>
          )}
          {d.detail && hasHiddenChars(d.detail) && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-danger">
              <ShieldAlert size={13} className="mt-0.5 shrink-0" />
              {t('tasksComputer.perm.hidden')}
            </p>
          )}
          {d.sections?.map((sec) => (
            <div key={sec.label} className="mt-2">
              <p className="text-[11px] desk:text-meta font-medium text-subtle">{sec.label}</p>
              <pre className="mt-1 max-h-32 overflow-auto rounded-md border border-border bg-code px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap">
                {sec.text}
              </pre>
              {hasHiddenChars(sec.text) && (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-danger">
                  <ShieldAlert size={13} className="mt-0.5 shrink-0" />
                  {t('tasksComputer.perm.hidden')}
                </p>
              )}
            </div>
          ))}
          {d.aiDescription && (
            <div className="mt-2 rounded-md border border-border/70 bg-hover/40 px-2.5 py-1.5">
              <p className="text-[11px] desk:text-meta font-medium text-subtle">{t('tasksComputer.perm.aiDesc')}</p>
              <p className="mt-0.5 text-xs text-muted">{d.aiDescription}</p>
            </div>
          )}
          {isProtectedPermission(request.metadata) && (
            <p role="note" className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-warning">
              <ShieldAlert size={13} className="mt-0.5 shrink-0" />
              {t('tasksComputer.perm.protectedPath')}
            </p>
          )}
          {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button
            key={a.id}
            variant={BTN_VARIANT[a.variant]}
            className={`min-h-11 basis-full rounded-(--m-btn-radius)! ${BTN_EXTRA[a.variant]}`}
            disabled={busy}
            onClick={() => (a.id === 'note' ? setNoting(true) : answer(a.reply))}
            title={a.title === 'alwaysHint' ? alwaysHint(request) : undefined}
          >
            {t(a.labelKey)}
          </Button>
        ))}
      </div>
      {noting && <RejectWithNote busy={busy} onSend={reject} onCancel={() => setNoting(false)} />}
    </div>
  )
}

/**
 * ¿Se pinta la barra? Solo se oculta cuando la tarjeta grande equivalente (mismos botones, mismo orden) está
 * en pantalla. Cierre seguro: si la tarjeta no existe o no se puede observar, la barra se ve (F8-B91).
 */
export function shouldShowBar({ cardFound, cardVisible }: { cardFound: boolean; cardVisible: boolean }): boolean {
  return !(cardFound && cardVisible)
}

/** Ancestro con scroll vertical más cercano (la conversación), o `null` (ventana). */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY
    if (oy === 'auto' || oy === 'scroll') return p
  }
  return null
}

/** Ids de solicitudes cuya tarjeta de la conversación se ve (≥60 %). Sin tarjeta u observador: ninguna. */
function useVisibleCards(ids: string[]): Set<string> {
  const [visible, setVisible] = useState<Set<string>>(() => new Set())
  const key = ids.join('|')
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !key) {
      setVisible((v) => (v.size ? new Set() : v))
      return
    }
    const watched = new Map<string, { el: HTMLElement; io: IntersectionObserver }>()
    const set = (id: string, on: boolean): void =>
      setVisible((prev) => {
        if (prev.has(id) === on) return prev
        const next = new Set(prev)
        if (on) next.add(id)
        else next.delete(id)
        return next
      })
    const sync = (): void => {
      for (const id of key.split('|')) {
        const el = document.getElementById(`perm-${id}`)
        const cur = watched.get(id)
        if (cur && cur.el === el && el.isConnected) continue
        cur?.io.disconnect()
        watched.delete(id)
        if (!el) {
          set(id, false)
          continue
        }
        const io = new IntersectionObserver(
          (entries) =>
            set(
              id,
              entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.6)
            ),
          {
            root: scrollParent(el),
            threshold: [0, 0.6, 1]
          }
        )
        io.observe(el)
        watched.set(id, { el, io })
      }
    }
    sync()
    // La tarjeta puede montarse o desmontarse después (otra tarea, Modo auto): se vuelve a buscar.
    const timer = setInterval(sync, 800)
    return () => {
      clearInterval(timer)
      for (const { io } of watched.values()) io.disconnect()
    }
  }, [key])
  return visible
}

/** Barra fija sobre el compositor: la primera solicitud pendiente cuya tarjeta no se ve (sin contar las del Modo auto). */
export function ApprovalBar({ requests }: { requests: PermissionRequest[] }): React.JSX.Element | null {
  const autoPending = useTasks((s) => s.autoPending)
  const pending = requests.filter((r) => !autoPending[r.id])
  const seen = useVisibleCards(pending.map((r) => r.id))
  const hiddenOnes = pending.filter((r) => shouldShowBar({ cardFound: true, cardVisible: seen.has(r.id) }))
  const first = hiddenOnes[0]
  if (!first) return null
  return <ApprovalBarInner key={first.id} request={first} more={hiddenOnes.length - 1} />
}

function ApprovalBarInner({ request, more }: { request: PermissionRequest; more: number }): React.JSX.Element {
  // Celular/PWA: barra de siempre. Escritorio: barra compacta del rediseño ND (armada, sin atajos).
  if (isRemoteSurface()) return <RemoteApprovalBar request={request} more={more} />
  return <ApprovalBarDesk request={request} more={more} />
}

function RemoteApprovalBar({ request, more }: { request: PermissionRequest; more: number }): React.JSX.Element {
  const t = useT()
  const servers = useMcpServers()
  const showPath = useShowPath()
  const d = describePermission(request, servers, showPath)
  const title = useRequestTitle(request, d.title)
  const { busy, error, answer } = useReply(request)
  const canAlways = useCanAlways(request, d.danger)
  const Icon = d.icon
  const review = (): void => {
    const el = document.getElementById(`perm-${request.id}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el?.focus({ preventScroll: true })
  }
  return (
    <div className="mx-auto mb-2 w-full max-w-3xl px-6 animate-rise-in">
      <div
        className={`flex items-center gap-3 rounded-xl border px-3 py-2 shadow-sm ${
          d.danger ? 'border-danger/50 bg-danger/10' : 'border-warning/50 bg-warning/10'
        }`}
      >
        <Icon size={16} className={`shrink-0 ${d.danger ? 'text-danger' : 'text-warning'}`} />
        <button type="button" className="min-w-0 flex-1 text-left" title={t('tasksComputer.perm.details')} onClick={review}>
          <span className="block truncate text-sm font-medium">
            {title}
            {more > 0 && <span className="ml-1.5 text-xs font-normal text-muted">{t('tasksComputer.perm.more', { more })}</span>}
          </span>
          <span className="block truncate font-mono text-[11px] desk:text-meta text-muted">{error ?? d.detail}</span>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          {d.kind === 'folder' ? (
            // Otra carpeta: hay que elegir carpeta y modo en la tarjeta; no hay «Permitir una vez» rápido.
            <Button variant="primary" className="!px-2.5 !py-1 text-xs" onClick={review}>
              {t('tasksComputer.perm.review')}
            </Button>
          ) : (
            <>
              <Button variant="ghost" className="!px-2 !py-1 text-xs" disabled={busy} onClick={() => answer('reject')}>
                {t('tasksComputer.perm.reject')}
              </Button>
              {canAlways && (
                <Button className="!px-2 !py-1 text-xs" disabled={busy} onClick={() => answer('always')} title={alwaysHint(request)}>
                  {t('tasksComputer.perm.alwaysShort')}
                </Button>
              )}
              <Button
                variant={d.danger ? 'danger' : 'primary'}
                className="!px-2.5 !py-1 text-xs"
                disabled={busy}
                onClick={() => answer('once')}
              >
                {t('tasksComputer.perm.once')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
