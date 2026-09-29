/** Formulario de creación/edición de una rutina (panel lateral). */
import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CalendarClock, Check, FolderOpen, Info, Loader2, Plus, ShieldAlert, X } from 'lucide-react'
import type { CoworkFolder, RoutineAllowRule, RoutineInput, RoutineSchedule, SchedulePreview } from '@shared/ipc-cowork'
import { COWORK_TERMS } from '@shared/cowork-glossary'
import { Button } from '../../../components/Button'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { ModelPicker } from '../../../components/ModelPicker'
import { useSettings } from '../../../stores/settings'
import { cw } from '../../cowork/impl/bridge'
import { MODE_META } from './meta'
import { SCHEDULE_PRESETS, describeCron, fromDaysSpec, fullDate, sameSchedule, scheduleText, toDaysSpec, untilText } from './schedule'
import { closeEditor, saveRoutine, useRoutines } from './store'
import { tildify } from '../../../lib/paths'
import { isSubmitKey } from '../../../lib/textarea'

type Builder = 'days' | 'interval' | 'cron'

/** L M X J V S D (0 = domingo). */
const DAY_CHIPS: { day: number; short: string; name: string }[] = [
  { day: 1, short: 'L', name: 'lunes' },
  { day: 2, short: 'M', name: 'martes' },
  { day: 3, short: 'X', name: 'miércoles' },
  { day: 4, short: 'J', name: 'jueves' },
  { day: 5, short: 'V', name: 'viernes' },
  { day: 6, short: 'S', name: 'sábado' },
  { day: 0, short: 'D', name: 'domingo' }
]

const INTERVALS = [1, 2, 3, 4, 6, 8, 12, 24]

function builderFor(s: RoutineSchedule): Builder {
  if (s.kind === 'interval') return 'interval'
  return toDaysSpec(s) ? 'days' : 'cron'
}

function toCron(s: RoutineSchedule): string {
  switch (s.kind) {
    case 'daily':
    case 'weekly': {
      const [h, m] = s.time.split(':').map(Number)
      return `${m || 0} ${h || 0} * * ${s.kind === 'daily' ? '*' : s.day}`
    }
    case 'interval':
      return s.hours === 1 ? '0 * * * *' : `0 */${s.hours} * * *`
    case 'cron':
      return s.expr
  }
}

/** Permisos de OpenCode más habituales (el campo admite cualquier otro, p. ej. `github_*` para un MCP). */
const PERMISSION_SUGGESTIONS = ['bash', 'edit', 'webfetch', 'websearch', 'skill']
const HOST_RE = /^[a-z0-9.-]{1,255}$/i

const inputCls =
  'w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none transition focus:border-border-strong focus:ring-2 focus:ring-accent/15 placeholder:text-subtle'
const labelCls = 'mb-1.5 block text-xs font-medium text-muted'

export function RoutineEditor({ initial }: { initial: RoutineInput }): React.JSX.Element {
  const hint = useRoutines((s) => s.editingHint)
  const recentFolders = useSettings((s) => s.settings.recentFolders)
  const [form, setForm] = useState<RoutineInput>(initial)
  const [builder, setBuilder] = useState<Builder>(() => builderFor(initial.schedule))
  const [preview, setPreview] = useState<SchedulePreview | null>(null)
  const [folders, setFolders] = useState<CoworkFolder[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  const [hostDraft, setHostDraft] = useState('')

  const patch = (p: Partial<RoutineInput>): void => setForm((f) => ({ ...f, ...p }))
  /** Cambiar de carpeta invalida el consentimiento de Control total (es por carpeta). */
  const setFolder = (folder: string | null): void =>
    setForm((f) => (f.folder === folder ? f : { ...f, folder, fullAccess: false, fullAccessConsentAt: null }))
  const setSchedule = (schedule: RoutineSchedule): void => patch({ schedule })

  useEffect(() => {
    void cw('tasks:listFolders').then(setFolders, () => setFolders([]))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeEditor()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Vista previa de la programación (debounce).
  useEffect(() => {
    const t = setTimeout(() => {
      void cw('routines:preview', { schedule: form.schedule }).then(setPreview, (err: unknown) =>
        setPreview({ valid: false, error: String(err), cron: null, next: [], label: '' })
      )
    }, 200)
    return () => clearTimeout(t)
  }, [form.schedule])

  const pickFolder = async (): Promise<void> => {
    const picked = await cw('tasks:pickFolder')
    if (!picked) return
    if (form.mode === 'cowork' && !folders.some((f) => f.path === picked)) {
      const name = picked.split('/').filter(Boolean).pop() ?? picked
      const ok = await confirmDialog({
        title: `¿Permitir trabajar en «${name}»?`,
        message: 'El agente podrá crear y modificar archivos dentro de esa carpeta (en sandbox).',
        confirmLabel: 'Permitir'
      })
      if (!ok) return
      try {
        const approved = await cw('tasks:approveFolder', { folder: picked })
        setFolders(await cw('tasks:listFolders'))
        setFolder(approved.path)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
      return
    }
    setFolder(picked)
  }

  const allowRows: RoutineAllowRule[] = form.allow ?? []
  const hosts: string[] = form.allowHosts ?? []
  const setAllow = (rows: RoutineAllowRule[]): void => patch({ allow: rows })
  const isCowork = form.mode === 'cowork'
  const selectedFolder = folders.find((f) => f.path === form.folder)
  const canFullControl = isCowork && !!selectedFolder?.fullAccess
  const fullControl = isCowork && form.fullAccess === true

  const addHost = (): void => {
    const h = hostDraft.trim().toLowerCase()
    if (!h) return
    if (!HOST_RE.test(h)) {
      setError(`Sitio inválido: ${h} (usa solo el dominio, p. ej. api.ejemplo.com)`)
      return
    }
    setError(null)
    if (!hosts.includes(h)) patch({ allowHosts: [...hosts, h] })
    setHostDraft('')
  }

  const toggleFullControl = async (on: boolean): Promise<void> => {
    if (!on) {
      patch({ fullAccess: false, fullAccessConsentAt: null })
      return
    }
    const ok = await confirmDialog({
      title: `¿Ejecutar esta rutina con ${COWORK_TERMS.fullControl}?`,
      message: (
        <div className="space-y-2 text-sm">
          <p>
            La rutina saldrá del sandbox: podrá controlar aplicaciones de tu Mac, ver la pantalla y usar tus sesiones abiertas, no solo los
            archivos de la carpeta.
          </p>
          <p>
            En cada ejecución tendrás que <b>aprobar el plan en persona</b> (te llegará una notificación); si no lo apruebas, la ejecución
            falla por tiempo. Cada ejecución empieza una tarea nueva.
          </p>
          <p>Solo actívalo si la instrucción es de tu confianza y aceptas estas condiciones.</p>
        </div>
      ),
      confirmLabel: 'Acepto, activar',
      danger: true
    })
    if (ok) patch({ fullAccess: true, fullAccessConsentAt: Date.now(), sessionMode: 'fresh', allowHosts: [] })
  }

  const s = form.schedule
  const days = toDaysSpec(s)
  const human = s.kind === 'cron' ? describeCron(s.expr) : scheduleText(s)
  const needsFolder = form.mode !== 'chat' && !form.folder
  const missing = [!form.name.trim() && 'un nombre', !form.prompt.trim() && 'la instrucción', needsFolder && 'una carpeta'].filter(
    Boolean
  ) as string[]
  const canSave = !saving && missing.length === 0 && !(preview && !preview.valid)

  const submit = async (): Promise<void> => {
    setTouched(true)
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const cowork = form.mode === 'cowork'
      await saveRoutine({
        ...form,
        name: form.name.trim(),
        prompt: form.prompt.trim(),
        allow: cowork
          ? allowRows
              .filter((r) => r.permission.trim() || r.pattern.trim())
              .map((r) => ({ permission: r.permission.trim(), pattern: r.pattern.trim() }))
          : [],
        allowHosts: cowork && !form.fullAccess ? hosts : []
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const folderOptions = useMemo(() => {
    if (form.mode === 'cowork') return folders.map((f) => ({ path: f.path, name: f.name }))
    return recentFolders.slice(0, 6).map((p) => ({ path: p, name: p.split('/').filter(Boolean).pop() ?? p }))
  }, [form.mode, folders, recentFolders])

  const tabCls = (on: boolean): string =>
    `rounded-md px-2.5 py-1 text-xs font-medium transition ${on ? 'bg-elevated text-fg shadow-sm ring-1 ring-border' : 'text-muted hover:text-fg'}`

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/25 backdrop-blur-[1px]" onMouseDown={closeEditor}>
      <div
        className="flex h-full w-full max-w-xl flex-col border-l border-border bg-elevated shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="routine-editor-title"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void submit()
          }
        }}
      >
        <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <CalendarClock size={15} />
          </span>
          <h2 id="routine-editor-title" className="text-base font-semibold">
            {form.id ? 'Editar rutina' : 'Nueva rutina'}
          </h2>
          <button
            type="button"
            onClick={closeEditor}
            className="ml-auto rounded-md p-1 text-muted hover:bg-hover hover:text-fg"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {hint && (
            <div className="flex items-start gap-2 rounded-lg bg-accent-soft/60 px-3 py-2 text-xs text-fg">
              <Info size={14} className="mt-0.5 shrink-0 text-accent" /> {hint}
            </div>
          )}

          <div>
            <label className={labelCls} htmlFor="r-name">
              Nombre
            </label>
            <input
              id="r-name"
              className={`${inputCls} ${touched && !form.name.trim() ? 'border-danger/60' : ''}`}
              value={form.name}
              placeholder="Resumen diario de correos"
              onChange={(e) => patch({ name: e.target.value })}
              autoFocus
            />
          </div>

          <div>
            <label className={labelCls} htmlFor="r-prompt">
              Instrucción
            </label>
            <textarea
              id="r-prompt"
              className={`${inputCls} min-h-32 resize-y leading-relaxed ${touched && !form.prompt.trim() ? 'border-danger/60' : ''}`}
              value={form.prompt}
              placeholder="Revisa los documentos nuevos de la carpeta y actualiza informe.md con un resumen…"
              onChange={(e) => patch({ prompt: e.target.value })}
            />
            <p className="mt-1.5 text-xs text-subtle">
              {isCowork
                ? 'Se ejecuta sin supervisión: los permisos que no estén en «Permitir sin preguntar» se rechazan o esperan tu aprobación, según lo que elijas abajo.'
                : 'Se ejecuta sin supervisión: los permisos que requieran confirmación se rechazan automáticamente.'}
            </p>
          </div>

          {/* ── Programación ── */}
          <section>
            <span className={labelCls}>Cuándo</span>
            <div className="flex flex-wrap gap-1.5">
              {SCHEDULE_PRESETS.map((p) => {
                const on = sameSchedule(p.schedule, s)
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setSchedule(p.schedule)
                      setBuilder(builderFor(p.schedule))
                    }}
                    className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition ${on ? 'border-accent bg-accent-soft text-accent' : 'border-border text-muted hover:border-border-strong hover:text-fg'}`}
                  >
                    {on && <Check size={12} />} {p.label}
                  </button>
                )
              })}
            </div>

            <div className="mt-3 rounded-xl border border-border bg-bg/50 p-3">
              <div className="mb-3 inline-flex rounded-lg bg-hover/70 p-0.5">
                <button
                  type="button"
                  className={tabCls(builder === 'days')}
                  onClick={() => {
                    setBuilder('days')
                    if (!days) setSchedule({ kind: 'daily', time: '09:00' })
                  }}
                >
                  Días y hora
                </button>
                <button
                  type="button"
                  className={tabCls(builder === 'interval')}
                  onClick={() => {
                    setBuilder('interval')
                    if (s.kind !== 'interval') setSchedule({ kind: 'interval', hours: 4 })
                  }}
                >
                  Intervalo
                </button>
                <button
                  type="button"
                  className={tabCls(builder === 'cron')}
                  onClick={() => {
                    setBuilder('cron')
                    if (s.kind !== 'cron') setSchedule({ kind: 'cron', expr: toCron(s) })
                  }}
                >
                  Cron avanzado
                </button>
              </div>

              {builder === 'days' && days && (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex gap-1" role="group" aria-label="Días de la semana">
                    {DAY_CHIPS.map((d) => {
                      const on = days.days.includes(d.day)
                      return (
                        <button
                          key={d.day}
                          type="button"
                          title={d.name}
                          aria-pressed={on}
                          onClick={() => {
                            const next = on ? days.days.filter((x) => x !== d.day) : [...days.days, d.day]
                            if (next.length === 0) return
                            setSchedule(fromDaysSpec({ days: next, time: days.time }))
                          }}
                          className={`h-8 w-8 rounded-full text-xs font-semibold transition ${on ? 'bg-accent text-accent-fg' : 'border border-border text-muted hover:border-border-strong hover:text-fg'}`}
                        >
                          {d.short}
                        </button>
                      )
                    })}
                  </div>
                  <label className="flex items-center gap-2 text-sm text-muted">
                    a las
                    <input
                      type="time"
                      className={`${inputCls} w-28 py-1.5`}
                      value={days.time}
                      onChange={(e) => e.target.value && setSchedule(fromDaysSpec({ days: days.days, time: e.target.value }))}
                    />
                  </label>
                </div>
              )}

              {builder === 'interval' && s.kind === 'interval' && (
                <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
                  Cada
                  {INTERVALS.map((h) => (
                    <button
                      key={h}
                      type="button"
                      aria-pressed={s.hours === h}
                      onClick={() => setSchedule({ kind: 'interval', hours: h })}
                      className={`h-8 min-w-8 rounded-full px-2 text-xs font-semibold transition ${s.hours === h ? 'bg-accent text-accent-fg' : 'border border-border text-muted hover:border-border-strong hover:text-fg'}`}
                    >
                      {h}
                    </button>
                  ))}
                  horas
                </div>
              )}

              {builder === 'cron' && s.kind === 'cron' && (
                <div>
                  <input
                    className={`${inputCls} font-mono tracking-wide`}
                    value={s.expr}
                    spellCheck={false}
                    placeholder="0 9 * * 1-5"
                    aria-label="Expresión cron"
                    onChange={(e) => setSchedule({ kind: 'cron', expr: e.target.value })}
                  />
                  <div className="mt-1.5 grid grid-cols-5 gap-1 text-center font-mono text-[10px] text-subtle">
                    <span>minuto</span>
                    <span>hora</span>
                    <span>día mes</span>
                    <span>mes</span>
                    <span>día sem.</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {['0 9 * * 1-5', '*/30 9-18 * * 1-5', '0 8,20 * * *', '0 10 1 * *'].map((ex) => (
                      <button
                        key={ex}
                        type="button"
                        onClick={() => setSchedule({ kind: 'cron', expr: ex })}
                        title={describeCron(ex) ?? ex}
                        className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted hover:border-border-strong hover:text-fg"
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div
                className={`mt-3 flex items-start gap-2 border-t border-border pt-3 text-xs ${preview && !preview.valid ? 'text-danger' : 'text-muted'}`}
              >
                {preview && !preview.valid ? (
                  <>
                    <AlertCircle size={14} className="mt-0.5 shrink-0" /> {preview.error}
                  </>
                ) : (
                  <>
                    <CalendarClock size={14} className="mt-0.5 shrink-0 text-accent" />
                    <div className="min-w-0">
                      <div className="font-medium text-fg">{human ?? 'Expresión cron personalizada'}</div>
                      {preview && preview.next.length > 0 && (
                        <div className="mt-0.5">
                          Próxima {untilText(preview.next[0])} · luego{' '}
                          {preview.next
                            .slice(1)
                            .map((n) => fullDate(n))
                            .join(' · ')}
                        </div>
                      )}
                      {!preview && <Loader2 size={12} className="mt-1 animate-spin" />}
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>

          {/* ── Dónde ── */}
          <section>
            <span className={labelCls}>Modo</span>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(MODE_META) as RoutineInput['mode'][]).map((m) => {
                const meta = MODE_META[m]
                const Icon = meta.icon
                const on = form.mode === m
                return (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      patch({
                        mode: m,
                        folder: m === 'chat' ? null : m === form.mode ? form.folder : null,
                        ...(m === form.mode ? {} : { fullAccess: false, fullAccessConsentAt: null })
                      })
                    }
                    className={`flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition ${on ? 'border-accent bg-accent-soft/50 ring-2 ring-accent/15' : 'border-border hover:border-border-strong hover:bg-hover'}`}
                  >
                    <Icon size={17} className={on ? 'text-accent' : 'text-muted'} />
                    <span className="text-sm font-medium">{meta.label}</span>
                    <span className="text-[11px] leading-snug text-muted">{meta.hint}</span>
                  </button>
                )
              })}
            </div>
          </section>

          {form.mode !== 'chat' && (
            <section>
              <span className={labelCls}>{form.mode === 'code' ? 'Proyecto' : 'Carpeta'}</span>
              <button
                type="button"
                onClick={() => void pickFolder()}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition hover:bg-hover ${touched && needsFolder ? 'border-danger/60' : 'border-border'}`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-hover text-muted">
                  <FolderOpen size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  {form.folder ? (
                    <>
                      <span className="block truncate text-sm font-medium">{form.folder.split('/').filter(Boolean).pop()}</span>
                      <span className="block truncate font-mono text-[11px] text-subtle">{tildify(form.folder)}</span>
                    </>
                  ) : (
                    <span className="text-sm text-muted">Elegir carpeta…</span>
                  )}
                </span>
                <span className="shrink-0 text-xs font-medium text-accent">{form.folder ? 'Cambiar' : 'Elegir'}</span>
              </button>
              {folderOptions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="py-0.5 text-[11px] text-subtle">{form.mode === 'cowork' ? 'Autorizadas:' : 'Recientes:'}</span>
                  {folderOptions.map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      title={f.path}
                      onClick={() => setFolder(f.path)}
                      className={`rounded-full border px-2 py-0.5 text-[11px] transition ${form.folder === f.path ? 'border-accent bg-accent-soft text-accent' : 'border-border text-muted hover:border-border-strong hover:text-fg'}`}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {isCowork && (
            <section className="space-y-5 rounded-xl border border-border bg-bg/50 p-4">
              <div>
                <span className={labelCls}>Cada ejecución</span>
                <div className="inline-flex rounded-lg bg-hover/70 p-0.5" role="group" aria-label="Sesión de cada ejecución">
                  <button
                    type="button"
                    aria-pressed={form.sessionMode !== 'continue' || fullControl}
                    className={tabCls(form.sessionMode !== 'continue' || fullControl)}
                    onClick={() => patch({ sessionMode: 'fresh' })}
                  >
                    Empezar de cero
                  </button>
                  <button
                    type="button"
                    disabled={fullControl}
                    aria-pressed={form.sessionMode === 'continue' && !fullControl}
                    className={`${tabCls(form.sessionMode === 'continue' && !fullControl)} disabled:cursor-not-allowed disabled:opacity-50`}
                    onClick={() => patch({ sessionMode: 'continue' })}
                  >
                    Continuar la misma tarea
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-subtle">
                  {fullControl
                    ? `Con ${COWORK_TERMS.fullControlShort} cada ejecución empieza una tarea nueva, para que ninguna aprobación se arrastre.`
                    : form.sessionMode === 'continue'
                      ? 'Conserva el contexto de la ejecución anterior en la misma tarea.'
                      : 'Cada ejecución crea una tarea nueva, sin recordar las anteriores.'}
                </p>
              </div>

              <div>
                <span className={labelCls}>Si pide permiso</span>
                <div className="inline-flex rounded-lg bg-hover/70 p-0.5" role="group" aria-label="Qué hacer si pide permiso">
                  <button
                    type="button"
                    aria-pressed={form.onAsk !== 'wait'}
                    className={tabCls(form.onAsk !== 'wait')}
                    onClick={() => patch({ onAsk: 'reject' })}
                  >
                    Rechazar y seguir
                  </button>
                  <button
                    type="button"
                    aria-pressed={form.onAsk === 'wait'}
                    className={tabCls(form.onAsk === 'wait')}
                    onClick={() => patch({ onAsk: 'wait' })}
                  >
                    Esperar mi aprobación (te avisará)
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-subtle">
                  {form.onAsk === 'wait'
                    ? 'La ejecución se detiene, te llega una notificación y la tarea sigue cuando apruebes o rechaces. Si no respondes en 45 min, falla.'
                    : 'Lo que no esté permitido abajo se rechaza y queda anotado en el historial de la rutina.'}
                </p>
              </div>

              <div>
                <span className={labelCls}>Permitir sin preguntar</span>
                {allowRows.length === 0 && (
                  <p className="mb-2 text-xs text-subtle">Ninguna regla: todo lo que pida permiso se tratará como indicaste arriba.</p>
                )}
                <datalist id="r-perm-suggestions">
                  {PERMISSION_SUGGESTIONS.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
                <div className="space-y-2">
                  {allowRows.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        className={`${inputCls} w-32 shrink-0 py-1.5 font-mono text-xs`}
                        list="r-perm-suggestions"
                        value={row.permission}
                        placeholder="bash"
                        spellCheck={false}
                        aria-label="Permiso"
                        onChange={(e) => setAllow(allowRows.map((r, j) => (j === i ? { ...r, permission: e.target.value } : r)))}
                      />
                      <input
                        className={`${inputCls} min-w-0 flex-1 py-1.5 font-mono text-xs`}
                        value={row.pattern}
                        placeholder="git status*"
                        spellCheck={false}
                        aria-label="Patrón"
                        onChange={(e) => setAllow(allowRows.map((r, j) => (j === i ? { ...r, pattern: e.target.value } : r)))}
                      />
                      <button
                        type="button"
                        aria-label="Quitar regla"
                        title="Quitar regla"
                        onClick={() => setAllow(allowRows.filter((_, j) => j !== i))}
                        className="rounded-md p-1 text-muted hover:bg-hover hover:text-danger"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setAllow([...allowRows, { permission: '', pattern: '' }])}
                  className="mt-2 flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                >
                  <Plus size={13} /> Añadir regla
                </button>
                <p className="mt-1.5 text-xs text-subtle">
                  El patrón admite <span className="font-mono">*</span> (cualquier cosa) y <span className="font-mono">?</span> (un
                  carácter). Un permiso puede acabar en <span className="font-mono">*</span> para las herramientas de un MCP (p. ej.{' '}
                  <span className="font-mono">github_*</span>).
                </p>
              </div>

              {!fullControl && (
                <div>
                  <span className={labelCls}>Sitios permitidos</span>
                  {hosts.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {hosts.map((h) => (
                        <span
                          key={h}
                          className="flex items-center gap-1 rounded-full border border-border bg-elevated px-2 py-0.5 font-mono text-[11px]"
                        >
                          {h}
                          <button
                            type="button"
                            aria-label={`Quitar ${h}`}
                            onClick={() => patch({ allowHosts: hosts.filter((x) => x !== h) })}
                            className="text-muted hover:text-danger"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      className={`${inputCls} py-1.5 font-mono text-xs`}
                      value={hostDraft}
                      placeholder="api.ejemplo.com"
                      spellCheck={false}
                      aria-label="Sitio permitido"
                      onChange={(e) => setHostDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (isSubmitKey(e, { allowShift: true })) {
                          e.preventDefault()
                          e.stopPropagation()
                          addHost()
                        }
                      }}
                    />
                    <Button variant="secondary" onClick={addHost} disabled={!hostDraft.trim()}>
                      Añadir
                    </Button>
                  </div>
                  <p className="mt-1.5 text-xs text-subtle">
                    Solo valen mientras dura cada ejecución; el resto de la red sigue bloqueada. Los bloqueos quedan en el historial.
                  </p>
                </div>
              )}

              {(canFullControl || fullControl) && (
                <div className={`rounded-lg border p-3 ${fullControl ? 'border-warning/40 bg-warning/10' : 'border-border bg-elevated'}`}>
                  <div className="flex items-start gap-3">
                    <ShieldAlert size={16} className={`mt-0.5 shrink-0 ${fullControl ? 'text-warning' : 'text-muted'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{COWORK_TERMS.fullControl}</div>
                      <p className="mt-0.5 text-xs text-muted">
                        Sin sandbox y con control de aplicaciones. Exige tu consentimiento ahora y que apruebes el plan en persona en cada
                        ejecución.
                      </p>
                      {fullControl && form.fullAccessConsentAt ? (
                        <p className="mt-1 text-[11px] text-warning">
                          Consentimiento dado el {new Date(form.fullAccessConsentAt).toLocaleString('es-CL')}.
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={fullControl}
                      aria-label={COWORK_TERMS.fullControl}
                      onClick={() => void toggleFullControl(!fullControl)}
                      className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${fullControl ? 'bg-accent' : 'bg-border-strong'}`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${fullControl ? 'translate-x-4' : ''}`}
                      />
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <span className={labelCls}>Modelo</span>
              <div className="inline-flex rounded-lg border border-border">
                <ModelPicker value={form.model} onChange={(model) => patch({ model })} placement="top" />
              </div>
            </div>
            <label className="flex shrink-0 cursor-pointer items-center gap-2 self-end pb-1.5 text-sm">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => patch({ enabled: e.target.checked })}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              Activa
            </label>
          </section>

          {error && (
            <p className="flex items-start gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
            </p>
          )}
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
          <span className="min-w-0 truncate text-xs text-subtle">
            {touched && missing.length > 0 ? <span className="text-danger">Falta {missing.join(', ')}.</span> : '⌘↵ para guardar'}
          </span>
          <Button variant="ghost" className="ml-auto" onClick={closeEditor}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={saving || (preview !== null && !preview.valid)}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Guardando…' : form.id ? 'Guardar cambios' : 'Crear rutina'}
          </Button>
        </footer>
      </div>
    </div>
  )
}
