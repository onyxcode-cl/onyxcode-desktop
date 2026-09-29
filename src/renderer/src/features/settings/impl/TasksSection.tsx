/**
 * Ajustes › Tareas: carpetas de confianza, carpetas de trabajo (Control total), permisos recordados,
 * notificaciones por tipo, archivado automático, servidores y almacenamiento. Si hay una política
 * gestionada (`managed.json`), se muestra un aviso y se desactivan los controles que restringe.
 * Todo el estado vive en main (`tasks:*`); el renderer solo lo muestra y lo edita.
 */
import { useCallback, useEffect, useState } from 'react'
import { FolderPlus, Loader2, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import {
  FOLDER_MODE_LABEL_ES,
  type TasksFolder,
  type TasksNotifyPrefs,
  type TasksPermissionRule,
  type TasksStorageReport,
  type FolderAccessMode,
  type ManagedPolicy,
  type TrustedFolder
} from '@shared/ipc-tasks'
import { TASKS_TERMS } from '@shared/tasks-glossary'
import { Button } from '../../../components/Button'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { MODE_LABELS } from '@shared/labels'
import { cw, hasTasksBridge } from '../../tasks/impl/bridge'
import {
  connectFolder,
  loadTasksPrefs,
  loadPolicy,
  rememberFullAccess,
  saveTasksPrefs,
  syncActivity,
  useTasks
} from '../../tasks/impl/store'
import { Badge, Card, Row, Select, SectionHeader, TextInput, Toggle } from './ui'
import { errText } from '../../../lib/format'
import { isSubmitKey } from '../../../lib/textarea'

// ───────────────────────────── Helpers puros ─────────────────────────────

/** Tamaño legible en español (base 1024): "0 B", "512 KB", "1,4 GB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  const digits = i === 0 || v >= 100 ? 0 : 1
  return `${v.toLocaleString('es-CL', { maximumFractionDigits: digits })} ${units[i]}`
}

/** Estado de un servidor vivo: `idleSince` null = con tareas en curso. */
export function formatIdle(idleSince: number | null, now: number): string {
  if (idleSince === null) return 'En uso'
  const min = Math.floor(Math.max(0, now - idleSince) / 60_000)
  if (min < 1) return 'Inactivo hace menos de 1 min'
  if (min < 60) return `Inactivo hace ${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `Inactivo hace ${h} h` : `Inactivo hace ${h} h ${m} min`
}

/** Acota a un entero en [min, max]; si no es un número, devuelve `fallback`. */
export function clampInt(raw: string | number, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** Última parte de una ruta (nombre de la carpeta). */
export function folderLabel(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

/** Qué restringe la política gestionada, listo para desactivar/explicar controles. */
export interface PolicyLocks {
  managed: boolean
  fullAccess: boolean
  customHosts: boolean
  alwaysAllow: boolean
  routines: boolean
  /** Tope de días del archivado automático (null = sin tope). */
  maxArchiveDays: number | null
  /** Raíces permitidas para carpetas (vacío = sin restricción). */
  allowedRoots: string[]
}

export function policyLocks(policy: ManagedPolicy | null | undefined): PolicyLocks {
  const max = policy?.maxAutoArchiveDays
  return {
    managed: !!policy,
    fullAccess: policy?.disableFullAccess === true,
    customHosts: policy?.disableCustomHosts === true,
    alwaysAllow: policy?.disableAlwaysAllow === true,
    routines: policy?.disableRoutines === true,
    maxArchiveDays: typeof max === 'number' && max > 0 ? max : null,
    allowedRoots: policy?.allowedFolderRoots ?? []
  }
}

/** Frases que resumen las restricciones activas de la política (para el aviso). */
export function policySummary(locks: PolicyLocks): string[] {
  const out: string[] = []
  if (locks.fullAccess) out.push(`${TASKS_TERMS.fullControl} está desactivado.`)
  if (locks.allowedRoots.length > 0) out.push(`Las carpetas solo pueden estar dentro de: ${locks.allowedRoots.join(', ')}.`)
  if (locks.customHosts) out.push('No se pueden añadir sitios a la red del sandbox.')
  if (locks.alwaysAllow) out.push('No se pueden recordar permisos con «Siempre permitir».')
  if (locks.routines) out.push('Las rutinas están desactivadas.')
  if (locks.maxArchiveDays !== null) out.push(`El archivado automático no puede superar ${locks.maxArchiveDays} días.`)
  return out
}

export interface ArchiveOption {
  value: number
  label: string
  disabled: boolean
}

const ARCHIVE_DAYS = [0, 7, 14, 30, 90]

/** Opciones del archivado automático; con tope de política, se desactivan «Nunca» y lo que lo supere. */
export function archiveOptions(maxDays: number | null): ArchiveOption[] {
  return ARCHIVE_DAYS.map((value) => ({
    value,
    label: value === 0 ? 'Nunca' : `${value} días`,
    disabled: maxDays !== null && (value === 0 || value > maxDays)
  }))
}

/** Agrupa reglas por carpeta conservando el orden de primera aparición. */
export function groupRulesByFolder(rules: TasksPermissionRule[]): Array<{ folder: string; rules: TasksPermissionRule[] }> {
  const map = new Map<string, TasksPermissionRule[]>()
  for (const r of rules) {
    const list = map.get(r.folder)
    if (list) list.push(r)
    else map.set(r.folder, [r])
  }
  return [...map].map(([folder, list]) => ({ folder, rules: list }))
}

// ───────────────────────────── UI ─────────────────────────────

/** Grupo con título (sin mayúsculas forzadas) y descripción opcional. */
function Group({
  title,
  description,
  children
}: {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="mt-9 first:mt-0">
      <h3 className="text-[13.5px] font-semibold text-fg">{title}</h3>
      {description && <p className="mt-0.5 mb-3 text-xs leading-relaxed text-muted">{description}</p>}
      {!description && <div className="mb-3" />}
      {children}
    </section>
  )
}

function EmptyRow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="px-4 py-3 text-xs text-muted">{children}</div>
}

function RemoveButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-danger hover:bg-danger/10 disabled:pointer-events-none disabled:opacity-40"
    >
      <Trash2 size={13} /> Quitar
    </button>
  )
}

/** Campo numérico que confirma al salir o con Enter (evita guardar en cada tecla). */
function NumberField({
  value,
  min,
  max,
  label,
  onCommit,
  disabled
}: {
  value: number
  min: number
  max: number
  label: string
  onCommit: (v: number) => void
  disabled?: boolean
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = (): void => {
    const v = clampInt(draft, min, max, value)
    setDraft(String(v))
    if (v !== value) onCommit(v)
  }
  return (
    <TextInput
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={draft}
      aria-label={label}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => isSubmitKey(e, { allowShift: true }) && commit()}
      className="w-24 text-right"
    />
  )
}

const NOTIFY_ROWS: Array<{ key: keyof TasksNotifyPrefs; label: string; description: string }> = [
  { key: 'done', label: 'Tarea terminada', description: 'Cuando una tarea en segundo plano termina.' },
  { key: 'approval', label: 'Necesita tu aprobación', description: 'Cuando una tarea espera un permiso o la aprobación de un plan.' },
  { key: 'question', label: 'Tiene una pregunta', description: 'Cuando el agente te hace una pregunta y espera tu respuesta.' },
  { key: 'error', label: 'Falló', description: 'Cuando una tarea termina con un error.' }
]

export function TasksSection(): React.JSX.Element {
  const bridge = hasTasksBridge()
  const prefs = useTasks((s) => s.prefs)
  const policy = useTasks((s) => s.policy)
  const activity = useTasks((s) => s.activity)
  const locks = policyLocks(policy)

  const [trusted, setTrusted] = useState<TrustedFolder[] | null>(null)
  const [folders, setFolders] = useState<TasksFolder[] | null>(null)
  const [rules, setRules] = useState<TasksPermissionRule[] | null>(null)
  const [report, setReport] = useState<TasksStorageReport | null>(null)
  const [storageBusy, setStorageBusy] = useState<string | null>(null)
  const [newMode, setNewMode] = useState<FolderAccessMode>('ro')
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const [now, setNow] = useState(() => Date.now())

  const fail = useCallback((area: string, err: unknown): void => setErrors((e) => ({ ...e, [area]: errText(err) })), [])
  const clear = useCallback((area: string): void => setErrors((e) => ({ ...e, [area]: null })), [])

  const loadStorage = useCallback((): void => {
    setStorageBusy('report')
    cw('tasks:storage:report')
      .then((r) => {
        setReport(r)
        clear('storage')
      })
      .catch((err: unknown) => fail('storage', err))
      .finally(() => setStorageBusy(null))
  }, [clear, fail])

  useEffect(() => {
    if (!bridge) return
    syncActivity()
    void loadTasksPrefs()
    void loadPolicy()
    cw('tasks:trusted:list')
      .then(setTrusted)
      .catch((err: unknown) => fail('trusted', err))
    cw('tasks:listFolders')
      .then(setFolders)
      .catch((err: unknown) => fail('folders', err))
    cw('tasks:rules:list', {})
      .then(setRules)
      .catch((err: unknown) => fail('rules', err))
    loadStorage()
  }, [bridge, fail, loadStorage])

  // Reloj para el tiempo de inactividad de los servidores.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  if (!bridge) {
    return <SectionHeader title={MODE_LABELS.tasks} description="Solo disponible en la app de escritorio." />
  }

  // ── Carpetas de confianza ──
  const addTrusted = async (): Promise<void> => {
    clear('trusted')
    try {
      const picked = await cw('tasks:pickFolder')
      if (!picked) return
      const check = await cw('tasks:folders:check', { path: picked })
      if (!check.ok) {
        fail('trusted', new Error(check.reason ?? 'Esa carpeta no se puede usar.'))
        return
      }
      const name = folderLabel(check.normalized)
      if (newMode === 'rw') {
        const ok = await confirmDialog({
          title: `¿Confiar en «${name}» con escritura?`,
          message: `Cualquier tarea podrá leer y modificar archivos de ${check.normalized} sin volver a preguntarte. Puedes quitarla de esta lista cuando quieras.`,
          confirmLabel: 'Confiar'
        })
        if (!ok) return
      }
      setTrusted(await cw('tasks:trusted:set', { path: check.normalized, mode: newMode }))
    } catch (err) {
      fail('trusted', err)
    }
  }

  const setTrustedMode = (path: string, mode: FolderAccessMode): void => {
    clear('trusted')
    cw('tasks:trusted:set', { path, mode })
      .then(setTrusted)
      .catch((err: unknown) => fail('trusted', err))
  }

  const removeTrusted = (t: TrustedFolder): void => {
    clear('trusted')
    cw('tasks:trusted:remove', { path: t.path })
      .then(setTrusted)
      .catch((err: unknown) => fail('trusted', err))
  }

  // ── Carpetas de trabajo / Control total ──
  const revokeFullControl = async (f: TasksFolder): Promise<void> => {
    const ok = await confirmDialog({
      title: `¿Revocar ${TASKS_TERMS.fullControl} en «${f.name}»?`,
      message:
        'Se detendrá el servidor de Control total de esta carpeta y se perderán las tareas en curso allí. Para volver a usarlo tendrás que concederlo de nuevo.',
      confirmLabel: 'Revocar',
      danger: true
    })
    if (!ok) return
    clear('folders')
    try {
      await cw('tasks:revokeFullAccess', { folder: f.path })
      rememberFullAccess(f.path, false)
      const conn = useTasks.getState().conn
      if (conn?.folder === f.path && conn.fullAccess) await connectFolder(f.path, false)
      const list = await cw('tasks:listFolders')
      setFolders(list)
      useTasks.setState({ folders: list })
    } catch (err) {
      fail('folders', err)
    }
  }

  // ── Permisos recordados ──
  const removeRule = (r: TasksPermissionRule): void => {
    clear('rules')
    cw('tasks:rules:remove', { id: r.id })
      .then(setRules)
      .catch((err: unknown) => fail('rules', err))
  }

  // ── Almacenamiento ──
  const runClean = async (key: string, name: string, scope: 'cache' | 'all'): Promise<void> => {
    if (scope === 'all') {
      const ok = await confirmDialog({
        title: `¿Borrar todo el almacenamiento de «${name}»?`,
        message:
          'Se borrará el espacio privado de esta carpeta en el sandbox: se pierde el historial de tareas del sandbox, la caché y los archivos temporales. Los archivos de la carpeta en sí no se tocan. No se puede deshacer.',
        confirmLabel: 'Borrar todo',
        danger: true
      })
      if (!ok) return
    }
    setStorageBusy(`${scope}:${key}`)
    try {
      setReport(await cw('tasks:storage:clean', { key, scope }))
      clear('storage')
    } catch (err) {
      fail('storage', err)
    } finally {
      setStorageBusy(null)
    }
  }

  const cleanScreenshots = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: '¿Borrar las capturas temporales?',
      message: `Se borran las copias temporales de pantalla del ${TASKS_TERMS.fullControl}. No afecta al historial de las tareas.`,
      confirmLabel: 'Borrar',
      danger: true
    })
    if (!ok) return
    setStorageBusy('screenshots')
    try {
      setReport(await cw('tasks:storage:cleanScreenshots'))
      clear('storage')
    } catch (err) {
      fail('storage', err)
    } finally {
      setStorageBusy(null)
    }
  }

  const savePrefs = (patch: Parameters<typeof saveTasksPrefs>[0], area: string): void => {
    clear(area)
    saveTasksPrefs(patch).catch((err: unknown) => fail(area, err))
  }

  const archiveValue = prefs?.autoArchiveDays ?? 0
  const archiveOpts = archiveOptions(locks.maxArchiveDays)
  const archiveOverMax = locks.maxArchiveDays !== null && (archiveValue === 0 || archiveValue > locks.maxArchiveDays)
  const summary = policySummary(locks)
  const rulesGrouped = groupRulesByFolder(rules ?? [])
  const servers = activity?.servers ?? []

  return (
    <div>
      <SectionHeader
        title={MODE_LABELS.tasks}
        description="Carpetas, permisos, notificaciones, servidores y almacenamiento de las tareas."
      />

      {locks.managed && (
        <div role="status" className="mb-8 flex items-start gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
          <ShieldCheck size={17} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0">
            <div className="font-medium text-fg">Gestionado por tu organización</div>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              Algunos ajustes de las tareas los define tu organización y no se pueden cambiar aquí.
              {policy?.source && (
                <>
                  {' '}
                  Origen: <code className="font-mono">{policy.source}</code>.
                </>
              )}
            </p>
            {summary.length > 0 && (
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-muted">
                {summary.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* 1 · Carpetas de confianza */}
      <Group
        title={TASKS_TERMS.trustedFolders}
        description="Todas las tareas pueden usar estas carpetas sin volver a preguntarte. Añade solo carpetas en las que confíes."
      >
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <div className="w-48">
              <Select
                value={newMode}
                onChange={(e) => setNewMode(e.target.value as FolderAccessMode)}
                aria-label="Modo de acceso de la nueva carpeta de confianza"
              >
                <option value="ro">{FOLDER_MODE_LABEL_ES.ro}</option>
                <option value="rw">{FOLDER_MODE_LABEL_ES.rw}</option>
              </Select>
            </div>
            <Button size="sm" onClick={() => void addTrusted()}>
              <FolderPlus size={14} /> Añadir carpeta…
            </Button>
            {locks.allowedRoots.length > 0 && (
              <span className="text-[11px] text-subtle">Solo dentro de: {locks.allowedRoots.join(', ')}</span>
            )}
          </div>
          {trusted === null ? (
            <EmptyRow>Cargando…</EmptyRow>
          ) : trusted.length === 0 ? (
            <EmptyRow>No hay carpetas de confianza. Cuando el agente pida una carpeta nueva, podrás marcarla desde su tarjeta.</EmptyRow>
          ) : (
            trusted.map((t) => (
              <Row key={t.path} label={t.name || folderLabel(t.path)} description={<span className="font-mono break-all">{t.path}</span>}>
                <div className="flex items-center gap-2">
                  <div className="w-44">
                    <Select
                      value={t.mode}
                      onChange={(e) => setTrustedMode(t.path, e.target.value as FolderAccessMode)}
                      aria-label={`Modo de acceso de ${t.name || folderLabel(t.path)}`}
                    >
                      <option value="ro">{FOLDER_MODE_LABEL_ES.ro}</option>
                      <option value="rw">{FOLDER_MODE_LABEL_ES.rw}</option>
                    </Select>
                  </div>
                  <RemoveButton
                    label={`Quitar ${t.name || folderLabel(t.path)} de las carpetas de confianza`}
                    onClick={() => removeTrusted(t)}
                  />
                </div>
              </Row>
            ))
          )}
        </Card>
        {errors.trusted && <p className="mt-2 text-xs text-danger">{errors.trusted}</p>}
      </Group>

      {/* 2 · Carpetas de trabajo */}
      <Group
        title={TASKS_TERMS.workFolders}
        description={`Las carpetas donde trabajan las tareas. Aquí puedes revocar el ${TASKS_TERMS.fullControl} concedido a una carpeta.`}
      >
        <Card>
          {folders === null ? (
            <EmptyRow>Cargando…</EmptyRow>
          ) : folders.length === 0 ? (
            <EmptyRow>Todavía no hay carpetas de trabajo. Añade una desde el selector de carpetas de trabajo.</EmptyRow>
          ) : (
            folders.map((f) => (
              <Row key={f.path} label={f.name || folderLabel(f.path)} description={<span className="font-mono break-all">{f.path}</span>}>
                {f.fullAccess ? (
                  <div className="flex items-center gap-2">
                    <Badge tone="warn">{TASKS_TERMS.fullControlShort} concedido</Badge>
                    <Button size="sm" onClick={() => void revokeFullControl(f)}>
                      Revocar
                    </Button>
                  </div>
                ) : (
                  <Badge>{TASKS_TERMS.sandbox}</Badge>
                )}
              </Row>
            ))
          )}
        </Card>
        {locks.fullAccess && (
          <p className="mt-2 text-xs text-muted">
            Tu organización ha desactivado el {TASKS_TERMS.fullControl}: no se puede conceder en ninguna carpeta.
          </p>
        )}
        {errors.folders && <p className="mt-2 text-xs text-danger">{errors.folders}</p>}
      </Group>

      {/* 3 · Permisos recordados */}
      <Group
        title="Permisos recordados"
        description="Permisos que marcaste con «Siempre permitir», de todas las carpetas. Quitarlos se aplica al reabrir la carpeta."
      >
        <Card>
          {rules === null ? (
            <EmptyRow>Cargando…</EmptyRow>
          ) : rulesGrouped.length === 0 ? (
            <EmptyRow>No hay permisos recordados.</EmptyRow>
          ) : (
            rulesGrouped.map((g) => (
              <div key={g.folder} className="border-b border-border last:border-b-0">
                <div className="px-4 pt-3 pb-1 text-xs font-medium text-muted" title={g.folder}>
                  {folderLabel(g.folder)}
                </div>
                {g.rules.map((r) => (
                  <Row
                    key={r.id}
                    label={<code className="font-mono text-[12.5px]">{r.permission}</code>}
                    description={<span className="font-mono break-all">{r.pattern}</span>}
                  >
                    <RemoveButton label={`Quitar el permiso ${r.permission} ${r.pattern}`} onClick={() => removeRule(r)} />
                  </Row>
                ))}
              </div>
            ))
          )}
        </Card>
        {locks.alwaysAllow && (
          <p className="mt-2 text-xs text-muted">Tu organización no permite recordar permisos nuevos; los existentes se pueden quitar.</p>
        )}
        {errors.rules && <p className="mt-2 text-xs text-danger">{errors.rules}</p>}
      </Group>

      {/* 4 · Notificaciones por tipo */}
      <Group
        title="Notificaciones por tipo"
        description="Aplica a las tareas que ocurren en segundo plano. El interruptor general está en General."
      >
        <Card>
          {NOTIFY_ROWS.map((n) => (
            <Row key={n.key} label={n.label} description={n.description}>
              <Toggle
                checked={prefs?.notify[n.key] ?? true}
                disabled={!prefs}
                onChange={(v) => prefs && savePrefs({ notify: { ...prefs.notify, [n.key]: v } }, 'notify')}
                label={`Notificar: ${n.label}`}
              />
            </Row>
          ))}
        </Card>
        {errors.notify && <p className="mt-2 text-xs text-danger">{errors.notify}</p>}
      </Group>

      {/* 5 · Archivado automático */}
      <Group
        title="Archivado automático"
        description="Archiva las tareas sin actividad. Las tareas fijadas o que esperan tu respuesta no se archivan."
      >
        <Card>
          <Row
            label="Archivar tareas tras"
            description={
              archiveOverMax ? `Tu organización limita este ajuste a ${locks.maxArchiveDays} días como máximo.` : 'Por defecto: Nunca.'
            }
          >
            <div className="w-36">
              <Select
                value={archiveValue}
                disabled={!prefs}
                onChange={(e) => savePrefs({ autoArchiveDays: Number(e.target.value) }, 'archive')}
                aria-label="Archivar tareas tras"
              >
                {archiveOpts.map((o) => (
                  <option key={o.value} value={o.value} disabled={o.disabled}>
                    {o.label}
                  </option>
                ))}
                {!ARCHIVE_DAYS.includes(archiveValue) && <option value={archiveValue}>{archiveValue} días</option>}
              </Select>
            </div>
          </Row>
        </Card>
        {errors.archive && <p className="mt-2 text-xs text-danger">{errors.archive}</p>}
      </Group>

      {/* 6 · Servidores */}
      <Group
        title="Servidores"
        description="Cada carpeta abierta usa un servidor. Los servidores sin tareas se detienen solos; nunca se interrumpe una tarea en curso."
      >
        <Card>
          <Row label="Máximo de servidores a la vez" description="Entre 1 y 12. Al superarlo se detiene el servidor ocioso menos usado.">
            <NumberField
              value={prefs?.maxServers ?? 4}
              min={1}
              max={12}
              disabled={!prefs}
              label="Máximo de servidores a la vez"
              onCommit={(v) => savePrefs({ maxServers: v }, 'servers')}
            />
          </Row>
          <Row label="Detener tras minutos de inactividad" description="0 = no detener nunca. Máximo 1440 (24 h).">
            <NumberField
              value={prefs?.idleStopMinutes ?? 15}
              min={0}
              max={1440}
              disabled={!prefs}
              label="Minutos de inactividad antes de detener un servidor"
              onCommit={(v) => savePrefs({ idleStopMinutes: v }, 'servers')}
            />
          </Row>
        </Card>
        {errors.servers && <p className="mt-2 text-xs text-danger">{errors.servers}</p>}
        <div className="mt-3 mb-1.5 text-xs font-medium text-muted">Servidores en marcha</div>
        <Card>
          {activity === null ? (
            <EmptyRow>Cargando…</EmptyRow>
          ) : servers.length === 0 ? (
            <EmptyRow>No hay servidores en marcha.</EmptyRow>
          ) : (
            servers.map((s) => (
              <Row
                key={`${s.folder}:${s.fullAccess ? 'full' : 'sandbox'}`}
                label={folderLabel(s.folder)}
                description={<span className="font-mono break-all">{s.folder}</span>}
              >
                <div className="flex items-center gap-2">
                  <Badge tone={s.fullAccess ? 'warn' : 'muted'}>{s.fullAccess ? TASKS_TERMS.fullControlShort : TASKS_TERMS.sandbox}</Badge>
                  <span className="text-xs text-muted">{formatIdle(s.idleSince, now)}</span>
                </div>
              </Row>
            ))
          )}
        </Card>
      </Group>

      {/* 7 · Almacenamiento */}
      <Group
        title="Almacenamiento"
        description={`Espacio privado que usa cada carpeta en el ${TASKS_TERMS.sandbox.toLowerCase()} (historial de tareas, caché y temporales). Solo se puede limpiar si su servidor está detenido.`}
      >
        <Card>
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="text-sm">
              <span className="font-medium">Total</span> <span className="text-muted">{report ? formatBytes(report.totalBytes) : '…'}</span>
            </div>
            <Button size="sm" variant="ghost" onClick={loadStorage} disabled={storageBusy !== null}>
              {storageBusy === 'report' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Actualizar
            </Button>
          </div>
          {report === null ? (
            <EmptyRow>{storageBusy === 'report' ? 'Calculando…' : 'No se pudo calcular el almacenamiento.'}</EmptyRow>
          ) : report.entries.length === 0 ? (
            <EmptyRow>Aún no hay datos guardados por las tareas.</EmptyRow>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-sidebar/60 text-xs text-muted">
                    <th scope="col" className="px-4 py-2 font-medium">
                      Carpeta
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Total
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Caché
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.entries.map((e) => {
                    const name = e.folder ? folderLabel(e.folder) : 'Carpeta desconocida'
                    const busy = storageBusy === `cache:${e.key}` || storageBusy === `all:${e.key}`
                    return (
                      <tr key={e.key} className="border-b border-border last:border-b-0">
                        <td className="max-w-[16rem] min-w-0 px-4 py-2.5">
                          <div className="truncate font-medium" title={e.folder ?? e.key}>
                            {name}
                          </div>
                          {e.running && <Badge tone="ok">En marcha</Badge>}
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">{formatBytes(e.bytes)}</td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap text-muted tabular-nums">{formatBytes(e.cacheBytes)}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm"
                              disabled={e.running || busy || e.cacheBytes === 0}
                              title={e.running ? 'Detén el servidor para limpiar' : undefined}
                              onClick={() => void runClean(e.key, name, 'cache')}
                            >
                              Limpiar caché
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={e.running || busy}
                              title={e.running ? 'Detén el servidor para borrar' : undefined}
                              onClick={() => void runClean(e.key, name, 'all')}
                            >
                              Borrar todo
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Row
            label="Capturas temporales"
            description={`Copias de pantalla del ${TASKS_TERMS.fullControl}${report ? ` (${formatBytes(report.screenshotsBytes)})` : ''}. Se borran solas al terminar y al cerrar la app.`}
          >
            <Button
              size="sm"
              disabled={storageBusy !== null || (report?.screenshotsBytes ?? 0) === 0}
              onClick={() => void cleanScreenshots()}
            >
              Borrar capturas temporales
            </Button>
          </Row>
        </Card>
        {errors.storage && <p className="mt-2 text-xs text-danger">{errors.storage}</p>}
      </Group>
    </div>
  )
}
