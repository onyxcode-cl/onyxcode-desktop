/**
 * Diálogo «Ficha del proyecto»: nombre, carpetas (la principal y las vinculadas, con «Añadir»), nivel de acceso de la IA y Bóveda de variables
 * (nombres; los valores no vuelven). Las carpetas extra solo existen en Overdrive: quien lo monta pasa `folders`; sin él (Code) se muestra solo la principal.
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Folder, FolderPlus, Info, KeyRound, Lock, Plus, X } from 'lucide-react'
import type { AccessLevel } from '@shared/project-profile'
import { DialogScrim } from '../../components/Dialog'
import { Button } from '../../components/Button'
import { useT } from '../../lib/i18n'
import { baseName, tildify } from '../../lib/paths'
import { LEVEL_ICON, LEVEL_TONE } from './AccessSeal'
import { effectiveLevel, useProjectProfile } from './store'

const LEVELS: AccessLevel[] = ['aislado', 'comandos', 'total']

export interface LinkedFolderRow {
  path: string
  name: string
  mode: 'rw' | 'ro'
}

/** Carpetas adicionales del proyecto (Overdrive). `pick` devuelve la ruta ya validada, o un texto de error, o null si se canceló. */
export interface ProjectFolders {
  linked: LinkedFolderRow[]
  applied: boolean
  pick: () => Promise<{ path: string } | { error: string } | null>
  link: (path: string, mode: 'rw' | 'ro') => Promise<boolean>
  unlink: (path: string) => Promise<void>
}

export interface ProjectDialogProps {
  folder: string
  /** «Control total» activo (modo existente de Tareas). */
  full: boolean
  /** Cambiar el modo de Tareas (true = Control total). Ausente (Code) = el nivel «Total» no se ofrece. */
  onPickFull?: (full: boolean) => void
  /** Hay una tarea en curso: el acceso no se cambia ahora. */
  busy?: boolean
  folders?: ProjectFolders
  /** Se llama tras guardar un cambio de nivel (Overdrive relanza el servidor ocioso para que valga ya). */
  onAccessSaved?: () => void
  onClose: () => void
}

export function ProjectDialog({ folder, full, onPickFull, busy, folders, onAccessSaved, onClose }: ProjectDialogProps): React.JSX.Element {
  const t = useT()
  const profile = useProjectProfile((s) => s.byFolder[folder])
  const { load, setAccess, setName, vaultSet, vaultDelete } = useProjectProfile.getState()
  const [view, setView] = useState<'main' | 'vault'>('main')
  const [name, setNameDraft] = useState('')
  const [paste, setPaste] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [pending, setPending] = useState<{ path: string; mode: 'rw' | 'ro' } | null>(null)
  const [folderNote, setFolderNote] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
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
    void setAccess(folder, l).then(() => onAccessSaved?.())
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
  const startAdd = async (): Promise<void> => {
    if (!folders || working) return
    setFolderNote(null)
    setWorking(true)
    try {
      const r = await folders.pick()
      if (!r) return
      if ('error' in r) setFolderNote(r.error)
      else setPending({ path: r.path, mode: 'rw' })
    } finally {
      setWorking(false)
    }
  }
  const confirmAdd = async (): Promise<void> => {
    if (!folders || !pending || working) return
    setWorking(true)
    try {
      if (await folders.link(pending.path, pending.mode)) setPending(null)
    } finally {
      setWorking(false)
    }
  }

  const row = 'flex items-center gap-2.5 rounded-xl border border-border px-3 py-2.5'
  return (
    <DialogScrim onDismiss={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={view === 'main' ? t('project.dialog.title') : t('project.vault.title')}
        tabIndex={-1}
        onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), view === 'vault' ? setView('main') : onClose())}
        className="max-h-[90vh] w-full max-w-[30rem] overflow-y-auto rounded-2xl border border-border bg-elevated p-6 text-sm text-fg shadow-lg outline-none"
      >
        {view === 'main' ? (
          <>
            <div className="mb-4 flex items-center">
              <h2 className="text-lg font-semibold">{t('project.dialog.title')}</h2>
              <button
                type="button"
                aria-label={t('project.dialog.close')}
                onClick={onClose}
                className="no-drag ml-auto rounded-md p-1 text-muted hover:bg-hover"
              >
                <X size={18} />
              </button>
            </div>

            <label className="mb-1.5 block font-medium" htmlFor="pp-name">
              {t('project.dialog.name')}
            </label>
            <input
              id="pp-name"
              value={name}
              placeholder={baseName(folder) || t('project.dialog.namePh')}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={saveName}
              maxLength={80}
              className="mb-5 w-full rounded-xl border border-border bg-bg px-3.5 py-2.5 outline-none focus:border-accent"
            />

            <div className="mb-1.5 flex items-center">
              <span className="font-medium">{t('project.dialog.folders')}</span>
              {folders && (
                <button
                  type="button"
                  disabled={working || !!pending}
                  onClick={() => void startAdd()}
                  className="no-drag ml-auto flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[13px] hover:bg-hover disabled:opacity-50"
                >
                  <Plus size={14} aria-hidden />
                  {t('project.dialog.add')}
                </button>
              )}
            </div>
            <ul className="mb-1 space-y-1.5">
              <li className={row}>
                <Folder size={16} className="shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{baseName(folder)}</span>
                  <span className="block truncate text-xs text-muted" title={folder}>
                    {tildify(folder)}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-active px-2 py-0.5 text-meta text-muted">{t('project.dialog.primary')}</span>
              </li>
              {folders?.linked.map((l) => (
                <li key={l.path} className={`group ${row}`}>
                  <Folder size={16} className="shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{l.name}</span>
                    <span className="block truncate text-xs text-muted" title={l.path}>
                      {tildify(l.path)}
                    </span>
                  </span>
                  {l.mode === 'ro' && (
                    <span className="flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-meta text-muted">
                      <Lock size={10} aria-hidden /> {t('project.dialog.readOnly')}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={t('project.dialog.remove', { name: l.name })}
                    onClick={() => void folders.unlink(l.path)}
                    className="no-drag rounded-md p-1 text-muted hover:bg-hover hover:text-danger"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
            {pending && (
              <div className="mb-1 rounded-xl border border-accent/50 bg-accent-soft/40 p-3">
                <div className="truncate font-medium" title={pending.path}>
                  {t('project.dialog.addNamed', { name: baseName(pending.path) })}
                </div>
                <div role="radiogroup" className="mt-2 flex gap-2">
                  {(['rw', 'ro'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={pending.mode === m}
                      onClick={() => setPending({ ...pending, mode: m })}
                      className={`no-drag flex-1 rounded-lg border px-2.5 py-1.5 text-[13px] ${pending.mode === m ? 'border-accent bg-accent-soft text-accent' : 'border-border hover:bg-hover'}`}
                    >
                      {t(`project.dialog.mode.${m}`)}
                    </button>
                  ))}
                </div>
                <div className="mt-2.5 flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setPending(null)}>
                    {t('project.dialog.cancel')}
                  </Button>
                  <Button variant="primary" size="sm" disabled={working} onClick={() => void confirmAdd()}>
                    <FolderPlus size={14} aria-hidden />
                    {t('project.dialog.addConfirm')}
                  </Button>
                </div>
              </div>
            )}
            {folderNote && (
              <p className="mb-1 text-xs text-danger" role="status">
                {folderNote}
              </p>
            )}
            {folders && !folders.applied && <p className="mb-1 text-xs text-subtle">{t('project.dialog.appliedOnRestart')}</p>}
            {!folders && <p className="mb-1 text-xs text-subtle">{t('project.dialog.codeOneFolder')}</p>}

            <div className="mt-5 mb-2 font-medium">{t('project.dialog.access')}</div>
            <div role="radiogroup" aria-label={t('project.dialog.access')} className="flex gap-1 rounded-xl border border-border bg-bg p-1">
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
                    aria-label={t(`project.level.${l}`)}
                    disabled={off}
                    onClick={() => pick(l)}
                    className={`no-drag flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-40 ${
                      on ? LEVEL_TONE[l].chip : 'text-muted hover:bg-hover hover:text-fg'
                    }`}
                  >
                    <Icon size={14} aria-hidden />
                    {t(`project.level.short.${l}`)}
                  </button>
                )
              })}
            </div>
            <p className={`mt-2.5 flex items-start gap-2 rounded-lg px-3 py-2.5 text-[13px] leading-snug ${LEVEL_TONE[level].chip}`}>
              <Info size={15} className="mt-px shrink-0" aria-hidden />
              <span>
                {!onPickFull && level !== 'total'
                  ? `${t(`project.dialog.${level}.d`)} ${t('project.dialog.totalOnlyNote')}`
                  : t(`project.dialog.${level}.d`)}
              </span>
            </p>
            {busy && <p className="mt-1.5 text-xs text-muted">{t('project.dialog.busy')}</p>}

            <button
              type="button"
              onClick={() => setView('vault')}
              className="no-drag mt-4 flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left hover:bg-hover"
            >
              <Lock size={18} className="shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t('project.dialog.vault')}</span>
                <span className="block text-xs text-muted">
                  {names.length ? t('project.dialog.vault.sub', { n: names.length }) : t('project.dialog.vault.empty')}
                </span>
              </span>
              <ChevronRight size={16} className="text-muted" aria-hidden />
            </button>
            <div className="mt-5 flex justify-end">
              <Button variant="primary" onClick={onClose}>
                {t('project.dialog.done')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-2">
              <button
                type="button"
                aria-label={t('project.vault.back')}
                onClick={() => setView('main')}
                className="no-drag rounded-md p-1 text-muted hover:bg-hover"
              >
                <ChevronLeft size={18} />
              </button>
              <h2 className="text-lg font-semibold">{t('project.vault.title')}</h2>
              <button
                type="button"
                aria-label={t('project.dialog.close')}
                onClick={onClose}
                className="no-drag ml-auto rounded-md p-1 text-muted hover:bg-hover"
              >
                <X size={18} />
              </button>
            </div>
            <ul className="mb-3 space-y-1.5">
              {names.length === 0 && <li className="text-muted">{t('project.vault.empty')}</li>}
              {names.map((n) => (
                <li key={n} className={`${row} font-mono text-[12.5px]`}>
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
            <label className="mb-1.5 flex items-center gap-1.5 font-medium text-accent" htmlFor="pp-paste">
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
              className="w-full resize-none rounded-xl border border-border bg-bg px-3.5 py-2.5 font-mono text-[12.5px] outline-none focus:border-accent"
            />
            {note && (
              <p className="mt-1.5 text-xs text-muted" role="status">
                {note}
              </p>
            )}
            <p className="mt-2 text-xs text-muted">{t('project.vault.note')}</p>
            <p className="mt-1 text-xs text-subtle">{t('project.vault.short')}</p>
            <div className="mt-4 flex justify-end gap-2">
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
