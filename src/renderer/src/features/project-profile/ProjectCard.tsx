/** Tarjeta «Ficha del proyecto» del panel derecho: nombre, carpeta, rama (Code), nivel de acceso (barra y sello) y Bóveda. El engranaje abre el diálogo. */
import { useEffect, useState } from 'react'
import { ChevronDown, FolderOpen, GitBranch, Lock, Settings } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { baseName, tildify } from '../../lib/paths'
import { AccessBar, AccessSeal } from './AccessSeal'
import { ProjectDialog, type ProjectDialogProps } from './ProjectDialog'
import { effectiveLevel, useProjectProfile } from './store'

export function ProjectCard({
  folder,
  full,
  onPickFull,
  busy,
  branch
}: Omit<ProjectDialogProps, 'onClose'> & { branch?: string | null }): React.JSX.Element {
  const t = useT()
  const profile = useProjectProfile((s) => s.byFolder[folder])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    void useProjectProfile
      .getState()
      .load(folder)
      .catch(() => undefined)
  }, [folder])
  const level = effectiveLevel(profile, full)
  const n = profile?.vaultNames.length ?? 0
  return (
    <>
      <section
        aria-label={t('project.card.title')}
        className="mx-3 my-2 rounded-xl border border-border bg-elevated/60 p-3.5 text-sm text-fg"
        data-testid="project-card"
      >
        <h3 className="mb-2 flex items-center gap-1 text-[13px] font-semibold">
          {t('project.card.title')}
          <ChevronDown size={13} className="text-subtle" aria-hidden />
        </h3>
        <div className="flex items-center gap-2.5 py-1">
          <FolderOpen size={16} className="shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-medium">{profile?.name || baseName(folder)}</span>
          <button
            type="button"
            aria-label={t('project.card.edit')}
            title={t('project.card.edit')}
            onClick={() => setOpen(true)}
            className="no-drag grid size-7 shrink-0 place-items-center rounded-lg border border-border text-accent hover:bg-hover"
          >
            <Settings size={14} />
          </button>
        </div>
        <div className="flex items-center gap-2.5 py-1 text-muted">
          <span className="w-4 shrink-0" aria-hidden />
          <span className="truncate text-xs" title={folder}>
            {tildify(folder)}
          </span>
        </div>
        {branch && (
          <div className="flex items-center gap-2.5 py-1">
            <GitBranch size={16} className="shrink-0 text-muted" aria-hidden />
            <span className="truncate font-mono text-[13px]">{branch}</span>
          </div>
        )}
        <div className="mt-2 mb-1.5">
          <AccessBar level={level} />
        </div>
        <div className="mb-1.5">
          <AccessSeal level={level} />
        </div>
        <div className="flex items-center gap-2.5 py-1">
          <Lock size={16} className="shrink-0 text-muted" aria-hidden />
          <span>{t('project.vault')}</span>
          <span className="text-muted">
            · {n === 0 ? t('project.vault.none') : t(n === 1 ? 'project.vault.count.one' : 'project.vault.count.many', { n })}
          </span>
        </div>
      </section>
      {open && <ProjectDialog folder={folder} full={full} onPickFull={onPickFull} busy={busy} onClose={() => setOpen(false)} />}
    </>
  )
}
