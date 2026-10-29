/** Diálogo «Ficha del proyecto»: nombre, carpeta, nivel de acceso de la IA (tres bloques de color) y la Bóveda de variables (nombres; los valores no vuelven). */
import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Folder, KeyRound, Lock, Plus, X } from 'lucide-react'
import type { AccessLevel } from '@shared/project-profile'
import { DialogScrim } from '../../components/Dialog'
import { Button } from '../../components/Button'
import { useT } from '../../lib/i18n'
import { baseName, tildify } from '../../lib/paths'
import { LEVEL_ICON, LEVEL_TONE } from './AccessSeal'
import { effectiveLevel, useProjectProfile } from './store'

const LEVELS: AccessLevel[] = ['aislado', 'comandos', 'total']

export interface ProjectDialogProps {
  folder: string
  /** «Control total» activo (modo existente de Tareas). */
  full: boolean
  /** Cambiar el modo de Tareas (true = Control total). Ausente (Code) = el nivel «Total» no se ofrece. */
  onPickFull?: (full: boolean) => void
  /** Hay una tarea en curso: el acceso no se cambia ahora. */
  busy?: boolean
  onClose: () => void
}

export function ProjectDialog({ folder, full, onPickFull, busy, onClose }: ProjectDialogProps): React.JSX.Element {
  const t = useT()
  const profile = useProjectProfile((s) => s.byFolder[folder])
  const { load, setAccess, setName, vaultSet, vaultDelete } = useProjectProfile.getState()
  const [view, setView] = useState<'main' | 'vault'>('main')
  const [name, setNameDraft] = useState('')
  const [paste, setPaste] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void load(folder).catch(() => undefined)
  }, [folder, load])
  useEffect(() => setNameDraft(profile?.name ?? ''), [profile?.name])
  useEffect(() => ref.current?.focus(), [view])

  const level = effectiveLevel(profile, full)
  const names = profile?.vaultNames ?? []

  const pick = (l: AccessLevel): void => {
    if (busy || l === level) return
    if (l === 'total') return onPickFull?.(true)
    if (full) onPickFull?.(false)
    void setAccess(folder, l)
  }
  const saveName = (): void => {
    if ((profile?.name ?? '') !== name.trim()) void setName(folder, name)
  }
  const saveVars = async (): Promise<void> => {
    if (!paste.trim()) return
    const r = await vaultSet(folder, paste)
    if (r.ok) setPaste('')
    setNote(
      r.reason === 'no-encryption'
        ? t('project.vault.noEncryption')
        : r.reason === 'too-many'
          ? t('project.vault.tooMany')
          : (r.problems[0] ?? (r.saved.length ? t('project.vault.saved', { names: r.saved.join(', ') }) : null))
    )
  }

  return (
    <DialogScrim onDismiss={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={view === 'main' ? t('project.dialog.title') : t('project.vault.title')}
        tabIndex={-1}
        onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), view === 'vault' ? setView('main') : onClose())}
        className="w-full max-w-[28rem] rounded-2xl border border-border bg-elevated p-5 text-sm text-fg shadow-lg outline-none"
      >
        {view === 'main' ? (
          <>
            <div className="mb-3 flex items-center">
              <h2 className="text-base font-medium">{t('project.dialog.title')}</h2>
              <button
                type="button"
                aria-label={t('project.dialog.close')}
                onClick={onClose}
                className="no-drag ml-auto rounded p-1 text-muted hover:bg-hover"
              >
                <X size={16} />
              </button>
            </div>
            <label className="mb-1 block text-muted" htmlFor="pp-name">
              {t('project.dialog.name')}
            </label>
            <input
              id="pp-name"
              value={name}
              placeholder={t('project.dialog.namePh')}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={saveName}
              maxLength={80}
              className="mb-3 w-full rounded-lg border border-border bg-bg px-3 py-2 outline-none focus:border-accent"
            />
            <div className="mb-1 text-muted">{t('project.dialog.folder')}</div>
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-border px-3 py-2">
              <Folder size={15} className="shrink-0 text-muted" aria-hidden />
              <span className="truncate">{baseName(folder)}</span>
              <span className="ml-auto truncate text-xs text-muted" title={folder}>
                {tildify(folder)}
              </span>
            </div>
            <div className="mb-1 text-muted">{t('project.dialog.access')}</div>
            <div className="mb-1 flex gap-2" role="radiogroup" aria-label={t('project.dialog.access')}>
              {LEVELS.map((l) => {
                const Icon = LEVEL_ICON[l]
                const on = l === level
                const off = busy || (l === 'total' && !onPickFull)
                return (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={off}
                    onClick={() => pick(l)}
                    className={`no-drag flex flex-1 flex-col items-start gap-0.5 rounded-xl border p-2.5 text-left disabled:cursor-not-allowed disabled:opacity-45 ${
                      on ? LEVEL_TONE[l].chip : 'border-border hover:bg-hover'
                    }`}
                  >
                    <Icon size={16} className={LEVEL_TONE[l].icon} aria-hidden />
                    <span className="font-medium text-fg">{t(`project.level.short.${l}`)}</span>
                    <span className="text-meta text-muted">{t(`project.dialog.${l}.d`)}</span>
                  </button>
                )
              })}
            </div>
            {busy && <p className="mb-1 text-xs text-muted">{t('project.dialog.busy')}</p>}
            <button
              type="button"
              onClick={() => setView('vault')}
              className="no-drag mt-2 flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left hover:bg-hover"
            >
              <Lock size={16} className="shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t('project.dialog.vault')}</span>
                <span className="block text-xs text-muted">
                  {names.length ? t('project.dialog.vault.sub', { n: names.length }) : t('project.dialog.vault.empty')}
                </span>
              </span>
              <ChevronRight size={16} className="text-muted" aria-hidden />
            </button>
            <div className="mt-4 flex justify-end">
              <Button variant="primary" onClick={onClose}>
                {t('project.dialog.done')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <button
                type="button"
                aria-label={t('project.vault.back')}
                onClick={() => setView('main')}
                className="no-drag rounded p-1 text-muted hover:bg-hover"
              >
                <ChevronLeft size={16} />
              </button>
              <h2 className="text-base font-medium">{t('project.vault.title')}</h2>
              <button
                type="button"
                aria-label={t('project.dialog.close')}
                onClick={onClose}
                className="no-drag ml-auto rounded p-1 text-muted hover:bg-hover"
              >
                <X size={16} />
              </button>
            </div>
            <ul className="mb-2 space-y-1.5">
              {names.length === 0 && <li className="text-muted">{t('project.vault.empty')}</li>}
              {names.map((n) => (
                <li key={n} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 font-mono text-[12.5px]">
                  <KeyRound size={14} className="shrink-0 text-muted" aria-hidden />
                  <span className="truncate">{n}</span>
                  <span className="ml-auto text-muted" aria-hidden>
                    ••••••••
                  </span>
                  <button
                    type="button"
                    aria-label={t('project.vault.remove', { name: n })}
                    onClick={() => void vaultDelete(folder, n)}
                    className="no-drag rounded p-0.5 text-muted hover:bg-hover hover:text-danger"
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
            <label className="mb-1 flex items-center gap-1.5 text-accent" htmlFor="pp-paste">
              <Plus size={14} aria-hidden />
              {t('project.vault.add')}
            </label>
            <textarea
              id="pp-paste"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={t('project.vault.paste.ph')}
              spellCheck={false}
              autoComplete="off"
              rows={4}
              className="w-full resize-none rounded-lg border border-border bg-bg px-3 py-2 font-mono text-[12.5px] outline-none focus:border-accent"
            />
            {note && (
              <p className="mt-1 text-xs text-muted" role="status">
                {note}
              </p>
            )}
            <p className="mt-2 text-xs text-muted">{t('project.vault.note')}</p>
            <p className="mt-1 text-xs text-subtle">{t('project.vault.short')}</p>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setView('main')}>
                {t('project.vault.back')}
              </Button>
              <Button variant="primary" disabled={!paste.trim()} onClick={() => void saveVars()}>
                {t('project.vault.save')}
              </Button>
            </div>
          </>
        )}
      </div>
    </DialogScrim>
  )
}
