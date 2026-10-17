/**
 * Ajustes > Memoria: ver, buscar, editar y borrar las notas aprobadas (para todo / de un proyecto), apagar la memoria y
 * «Olvidar todo». Las notas las propone la IA y las aprueba la persona (tarjeta en Chat, Code y Overdrive); aquí solo se
 * administran. Las de «para todo» las comparten Chat, Code y Overdrive.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '../../../components/Button'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { IconButton } from '../../../components/IconButton'
import { useT } from '../../../lib/i18n'
import { useSettings } from '../../../stores/settings'
import { MAX_ENTRIES, MAX_ENTRY_CHARS } from '@shared/memory-format'
import type { LearnedMemoryBundle, LearnedMemoryEntry, LearnedMemoryScope, LearnedMemoryType } from '@shared/ipc-tasks'
import { cw, hasTasksBridge } from '../../tasks/impl/bridge'
import { useCode } from '../../code/impl/store'
import { Card, ErrorText, Row, SectionHeader, Select, SubTitle, Toggle } from './ui'

const TYPES: LearnedMemoryType[] = ['preferencia', 'convencion', 'decision', 'solucion']

/** Sin tildes ni mayúsculas, para que «convencion» encuentre «Convención». */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** Filtra por texto y tipo. Pura, para probarla sin la pantalla. */
export function filterEntries(
  entries: readonly LearnedMemoryEntry[],
  query: string,
  typeLabel: (t: LearnedMemoryType) => string
): LearnedMemoryEntry[] {
  const q = fold(query.trim())
  if (!q) return [...entries]
  return entries.filter((e) => fold(e.texto).includes(q) || fold(typeLabel(e.tipo)).includes(q))
}

function EntryRow({
  entry,
  onSave,
  onDelete
}: {
  entry: LearnedMemoryEntry
  onSave: (id: string, tipo: LearnedMemoryType, texto: string) => Promise<string | null>
  onDelete: (id: string) => void
}): React.JSX.Element {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [texto, setTexto] = useState(entry.texto)
  const [tipo, setTipo] = useState<LearnedMemoryType>(entry.tipo)
  const [err, setErr] = useState<string | null>(null)

  const commit = async (): Promise<void> => {
    const e = await onSave(entry.id, tipo, texto)
    if (e) setErr(e)
    else {
      setErr(null)
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <li className="rounded-lg border border-border-strong bg-bg p-2.5" data-testid="memory-entry-editing">
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as LearnedMemoryType)}
          className="rounded-md border border-border bg-bg px-1.5 py-0.5 text-[11px] text-subtle desk:text-meta"
          aria-label={t('tasks.learn.type.preferencia')}
        >
          {TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {t(`tasks.learn.type.${ty}`)}
            </option>
          ))}
        </select>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value.slice(0, MAX_ENTRY_CHARS))}
          maxLength={MAX_ENTRY_CHARS}
          rows={2}
          aria-label={t('memory.editAria')}
          className="mt-1.5 w-full resize-y rounded-md border border-border bg-bg px-2 py-1 text-sm outline-none focus:border-border-strong"
        />
        {err && <ErrorText>{err}</ErrorText>}
        <div className="mt-2 flex gap-2">
          <Button variant="primary" onClick={() => void commit()} disabled={!texto.trim()}>
            {t('memory.save')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setEditing(false)
              setErr(null)
              setTexto(entry.texto)
              setTipo(entry.tipo)
            }}
          >
            {t('memory.cancel')}
          </Button>
        </div>
      </li>
    )
  }
  return (
    <li className="flex items-start gap-2 rounded-lg border border-border bg-bg px-3 py-2" data-testid="memory-entry">
      <div className="min-w-0 flex-1">
        <span className="text-[11px] font-medium text-subtle desk:text-meta">{t(`tasks.learn.type.${entry.tipo}`)}</span>
        <p className="mt-0.5 break-words text-sm">{entry.texto}</p>
      </div>
      <IconButton label={t('memory.edit')} size="sm" onClick={() => setEditing(true)}>
        <Pencil size={14} />
      </IconButton>
      <IconButton label={t('memory.delete')} size="sm" onClick={() => onDelete(entry.id)}>
        <Trash2 size={14} />
      </IconButton>
    </li>
  )
}

export function MemorySection(): React.JSX.Element {
  const t = useT()
  const learningEnabled = useSettings((s) => s.settings.learningEnabled)
  const update = useSettings((s) => s.update)
  const openDirs = useCode((s) => s.openDirectories)
  const current = useCode((s) => s.directory)
  const dirs = useMemo(() => (current && !openDirs.includes(current) ? [...openDirs, current] : openDirs), [openDirs, current])
  const [scope, setScope] = useState<LearnedMemoryScope>('usuario')
  const [folder, setFolder] = useState<string | null>(current ?? dirs[0] ?? null)
  const [bundle, setBundle] = useState<LearnedMemoryBundle>({ usuario: [], proyecto: [] })
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    if (!hasTasksBridge()) return
    try {
      setBundle(await cw('tasks:mem:get', scope === 'proyecto' && folder ? { folder } : {}))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [scope, folder])

  useEffect(() => {
    void load()
  }, [load])

  const folderArg = scope === 'proyecto' && folder ? { folder } : {}
  const entries = scope === 'usuario' ? bundle.usuario : bundle.proyecto
  const shown = useMemo(() => filterEntries(entries, query, (ty) => t(`tasks.learn.type.${ty}`)), [entries, query, t])

  const save = async (id: string, tipo: LearnedMemoryType, texto: string): Promise<string | null> => {
    try {
      const r = await cw('tasks:mem:update', { alcance: scope, id, tipo, texto, ...folderArg })
      if (r.ok) {
        setBundle(r.bundle)
        return null
      }
      return r.reason === 'secreto'
        ? t('memory.err.secreto')
        : r.reason === 'duplicado'
          ? t('memory.err.duplicado')
          : t('memory.err.generic')
    } catch {
      return t('memory.err.generic')
    }
  }
  const remove = async (id: string): Promise<void> => {
    try {
      setBundle(await cw('tasks:mem:remove', { alcance: scope, id, ...folderArg }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const forgetAll = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: t('memory.forgetAllTitle'),
      message: t('memory.forgetAllMsg'),
      confirmLabel: t('memory.forgetAllConfirm'),
      danger: true
    })
    if (!ok) return
    try {
      await cw('tasks:mem:forgetAll')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div>
      <SectionHeader title={t('memory.title')} description={t('memory.intro')} />
      <Card>
        <Row label={t('memory.toggle')} description={t('memory.toggleDesc')}>
          <Toggle checked={learningEnabled} onChange={(v) => void update({ learningEnabled: v })} label={t('memory.toggle')} />
        </Row>
        <div className="px-4 py-3 text-xs leading-relaxed text-muted desk:px-5" data-testid="memory-privacy">
          {t('memory.privacy')}
        </div>
      </Card>

      <SubTitle>{t('memory.title')}</SubTitle>
      <Card>
        <div className="flex flex-col gap-3 px-4 py-3 desk:px-5 desk:py-4" data-testid="memory-list">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg bg-hover/60 p-0.5" role="tablist">
              {(['usuario', 'proyecto'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={scope === s}
                  onClick={() => setScope(s)}
                  className={`rounded-md px-3 py-1 text-xs font-medium ${scope === s ? 'bg-elevated text-fg shadow-xs' : 'text-muted hover:text-fg'}`}
                >
                  {t(`memory.scope.${s}`)}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('memory.search')}
              aria-label={t('memory.search')}
              className="min-w-40 flex-1 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm outline-none focus:border-border-strong placeholder:text-subtle"
            />
          </div>

          {scope === 'proyecto' &&
            (dirs.length === 0 || !folder ? (
              <p className="text-sm text-muted">{t('memory.project.none')}</p>
            ) : (
              <label className="flex flex-col gap-1 text-xs text-muted">
                {t('memory.project.label')}
                <Select value={folder} onChange={(e) => setFolder(e.target.value)} aria-label={t('memory.project.label')}>
                  {dirs.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </label>
            ))}

          {error && <ErrorText>{error}</ErrorText>}

          {scope === 'proyecto' && (!folder || dirs.length === 0) ? null : shown.length === 0 ? (
            <p className="text-sm text-muted">{entries.length === 0 ? t(`memory.empty.${scope}`) : t('memory.noMatch')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {shown.map((e) => (
                <EntryRow key={e.id} entry={e} onSave={save} onDelete={(id) => void remove(id)} />
              ))}
            </ul>
          )}

          <p className="text-xs text-subtle">{t('memory.count', { count: entries.length, max: MAX_ENTRIES[scope] })}</p>
        </div>
      </Card>

      <div className="mt-4">
        <Button onClick={() => void forgetAll()}>{t('memory.forgetAll')}</Button>
      </div>
    </div>
  )
}
