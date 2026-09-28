/** Formulario de creación/edición de una rutina. */
import { useEffect, useState } from 'react'
import { AlertCircle, CalendarClock, FolderOpen, X } from 'lucide-react'
import {
  WEEKDAYS_ES,
  type CoworkFolder,
  type RoutineInput,
  type RoutineMode,
  type RoutineSchedule,
  type SchedulePreview
} from '@shared/ipc-cowork'
import { Button } from '../../../components/Button'
import { ModelPicker } from '../../../components/ModelPicker'
import { cw } from '../../cowork/impl/bridge'
import { saveRoutine, useRoutines } from './store'

type Preset = RoutineSchedule['kind']

const MODES: { id: RoutineMode; label: string; hint: string }[] = [
  { id: 'chat', label: 'Chat', hint: 'Respuesta de texto, sin archivos' },
  { id: 'cowork', label: 'Cowork', hint: 'Trabaja con documentos en una carpeta (sandbox)' },
  { id: 'code', label: 'Code', hint: 'Agente de programación sobre un proyecto' }
]

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'daily', label: 'Diario' },
  { id: 'weekly', label: 'Semanal' },
  { id: 'interval', label: 'Cada N horas' },
  { id: 'cron', label: 'Cron' }
]

function defaultSchedule(kind: Preset, prev: RoutineSchedule): RoutineSchedule {
  const time = 'time' in prev ? prev.time : '09:00'
  switch (kind) {
    case 'daily':
      return { kind, time }
    case 'weekly':
      return { kind, day: prev.kind === 'weekly' ? prev.day : 1, time }
    case 'interval':
      return { kind, hours: prev.kind === 'interval' ? prev.hours : 4 }
    case 'cron':
      return { kind, expr: prev.kind === 'cron' ? prev.expr : '0 9 * * 1-5' }
  }
}

const inputCls =
  'w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-border-strong placeholder:text-subtle'
const labelCls = 'mb-1 block text-xs font-medium text-muted'

export function RoutineEditor({ initial }: { initial: RoutineInput }): React.JSX.Element {
  const [form, setForm] = useState<RoutineInput>(initial)
  const [preview, setPreview] = useState<SchedulePreview | null>(null)
  const [folders, setFolders] = useState<CoworkFolder[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const patch = (p: Partial<RoutineInput>): void => setForm((f) => ({ ...f, ...p }))

  useEffect(() => {
    void cw('cowork:listFolders').then(setFolders, () => setFolders([]))
  }, [])

  // Vista previa de la programación (debounce).
  useEffect(() => {
    const t = setTimeout(() => {
      void cw('routines:preview', { schedule: form.schedule }).then(setPreview, (err: unknown) =>
        setPreview({ valid: false, error: String(err), cron: null, next: [], label: '' })
      )
    }, 250)
    return () => clearTimeout(t)
  }, [form.schedule])

  const close = (): void => useRoutines.setState({ editing: null })

  const pickFolder = async (): Promise<void> => {
    const picked = await cw('cowork:pickFolder')
    if (!picked) return
    if (form.mode === 'cowork' && !folders.some((f) => f.path === picked)) {
      const name = picked.split('/').filter(Boolean).pop() ?? picked
      if (!window.confirm(`¿Permitir Cowork en «${name}»?\n\nEl agente podrá crear y modificar archivos dentro de esa carpeta (en sandbox).`)) return
      try {
        const approved = await cw('cowork:approveFolder', { folder: picked })
        setFolders(await cw('cowork:listFolders'))
        patch({ folder: approved.path })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
      return
    }
    patch({ folder: picked })
  }

  const submit = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await saveRoutine(form)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const s = form.schedule
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onMouseDown={close}>
      <div
        className="flex h-full w-full max-w-lg flex-col border-l border-border bg-elevated shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-5">
          <CalendarClock size={18} className="text-accent" />
          <h2 className="text-base font-semibold">{form.id ? 'Editar rutina' : 'Nueva rutina'}</h2>
          <button type="button" onClick={close} className="ml-auto rounded p-1 text-muted hover:bg-hover hover:text-fg" aria-label="Cerrar">
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div>
            <label className={labelCls} htmlFor="r-name">
              Nombre
            </label>
            <input
              id="r-name"
              className={inputCls}
              value={form.name}
              placeholder="Resumen diario de correos"
              onChange={(e) => patch({ name: e.target.value })}
              autoFocus
            />
          </div>

          <div>
            <span className={labelCls}>Modo</span>
            <div className="grid grid-cols-3 gap-2">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  title={m.hint}
                  onClick={() => patch({ mode: m.id, folder: m.id === 'chat' ? null : form.folder })}
                  className={`rounded-lg border px-3 py-2 text-sm transition ${form.mode === m.id ? 'border-accent bg-accent-soft font-medium text-fg' : 'border-border text-muted hover:bg-hover'}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-subtle">{MODES.find((m) => m.id === form.mode)?.hint}</p>
          </div>

          {form.mode !== 'chat' && (
            <div>
              <span className={labelCls}>Carpeta</span>
              {form.mode === 'cowork' && folders.length > 0 && (
                <select
                  className={`${inputCls} mb-2`}
                  value={form.folder ?? ''}
                  onChange={(e) => patch({ folder: e.target.value || null })}
                >
                  <option value="">Elige una carpeta autorizada…</option>
                  {folders.map((f) => (
                    <option key={f.path} value={f.path}>
                      {f.name} — {f.path}
                    </option>
                  ))}
                </select>
              )}
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-muted" title={form.folder ?? ''}>
                  {form.folder || 'Sin carpeta'}
                </div>
                <Button onClick={() => void pickFolder()}>
                  <FolderOpen size={14} /> Elegir…
                </Button>
              </div>
            </div>
          )}

          <div>
            <label className={labelCls} htmlFor="r-prompt">
              Instrucción
            </label>
            <textarea
              id="r-prompt"
              className={`${inputCls} min-h-32 resize-y`}
              value={form.prompt}
              placeholder="Revisa los documentos nuevos de la carpeta y actualiza informe.md con un resumen…"
              onChange={(e) => patch({ prompt: e.target.value })}
            />
            <p className="mt-1 text-xs text-subtle">
              Se ejecuta sin supervisión: los permisos que requieran confirmación se rechazan automáticamente.
            </p>
          </div>

          <div>
            <span className={labelCls}>Modelo</span>
            <ModelPicker value={form.model} onChange={(model) => patch({ model })} placement="bottom" />
          </div>

          <div>
            <span className={labelCls}>Programación</span>
            <div className="mb-2 grid grid-cols-4 gap-1 rounded-lg bg-bg p-1">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => patch({ schedule: defaultSchedule(p.id, s) })}
                  className={`rounded-md px-2 py-1 text-xs transition ${s.kind === p.id ? 'bg-elevated font-medium text-fg shadow-sm' : 'text-muted hover:text-fg'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {s.kind === 'daily' && (
              <input type="time" className={inputCls} value={s.time} onChange={(e) => patch({ schedule: { ...s, time: e.target.value } })} />
            )}
            {s.kind === 'weekly' && (
              <div className="flex gap-2">
                <select className={inputCls} value={s.day} onChange={(e) => patch({ schedule: { ...s, day: Number(e.target.value) } })}>
                  {WEEKDAYS_ES.map((d, i) => (
                    <option key={d} value={i}>
                      {d.charAt(0).toUpperCase() + d.slice(1)}
                    </option>
                  ))}
                </select>
                <input type="time" className={inputCls} value={s.time} onChange={(e) => patch({ schedule: { ...s, time: e.target.value } })} />
              </div>
            )}
            {s.kind === 'interval' && (
              <div className="flex items-center gap-2 text-sm">
                Cada
                <input
                  type="number"
                  min={1}
                  max={168}
                  className={`${inputCls} w-24`}
                  value={s.hours}
                  onChange={(e) => patch({ schedule: { ...s, hours: Number(e.target.value) } })}
                />
                horas
              </div>
            )}
            {s.kind === 'cron' && (
              <>
                <input
                  className={`${inputCls} font-mono`}
                  value={s.expr}
                  placeholder="min hora día mes díaSemana"
                  onChange={(e) => patch({ schedule: { ...s, expr: e.target.value } })}
                />
                <p className="mt-1 text-xs text-subtle">Ej.: «0 9 * * 1-5» = días hábiles a las 9:00.</p>
              </>
            )}

            {preview && (
              <div className={`mt-2 rounded-lg px-3 py-2 text-xs ${preview.valid ? 'bg-accent-soft/60 text-muted' : 'bg-danger/10 text-danger'}`}>
                {preview.valid ? (
                  <>
                    <div className="font-medium text-fg">{preview.label}</div>
                    <div className="mt-0.5">
                      Próximas:{' '}
                      {preview.next
                        .map((n) => new Date(n).toLocaleString('es-CL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))
                        .join(' · ')}
                    </div>
                  </>
                ) : (
                  preview.error
                )}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.enabled} onChange={(e) => patch({ enabled: e.target.checked })} className="accent-[var(--accent)]" />
            Activa
          </label>

          {error && (
            <p className="flex items-start gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
            </p>
          )}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={saving || (preview !== null && !preview.valid)}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </footer>
      </div>
    </div>
  )
}
