/** Sello de acceso de la caja de escribir: el nivel actual de la IA en ese proyecto; al pulsarlo abre la Ficha. */
import { useEffect, useState } from 'react'
import { AccessSeal } from './AccessSeal'
import { ProjectDialog, type ProjectDialogProps } from './ProjectDialog'
import { effectiveLevel, useProjectProfile } from './store'

export function ProjectSeal({ folder, full, onPickFull, busy }: Omit<ProjectDialogProps, 'onClose'>): React.JSX.Element {
  const profile = useProjectProfile((s) => s.byFolder[folder])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    void useProjectProfile
      .getState()
      .load(folder)
      .catch(() => undefined)
  }, [folder])
  return (
    <>
      <AccessSeal level={effectiveLevel(profile, full)} short onClick={() => setOpen(true)} />
      {open && <ProjectDialog folder={folder} full={full} onPickFull={onPickFull} busy={busy} onClose={() => setOpen(false)} />}
    </>
  )
}
