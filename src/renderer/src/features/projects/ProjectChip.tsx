/**
 * Chip de proyecto de la caja de escribir del Chat (F8-B185). En una conversación ya creada cambia su proyecto (vale desde el
 * siguiente mensaje); en una nueva deja elegido el proyecto con que se creará. Solo escritorio.
 */
import { Folder, FolderPlus } from 'lucide-react'
import { useEffect } from 'react'
import { ChipMenu, type ChipMenuOption } from '../../components/ChipMenu'
import { getExtras } from '../../lib/extrasApi'
import { useT } from '../../lib/i18n'
import { isRemoteSurface } from '../../lib/platform'
import { useChat } from '../chat/store'
import { createProjectFlow } from './ProjectsSidebar'
import { projectOfSession, useProjects } from './store'

const NEW_ID = '__new__'
const NONE_ID = '__none__'

export function ProjectChip(): React.JSX.Element | null {
  const t = useT()
  const state = useProjects((s) => s.state)
  const pendingId = useProjects((s) => s.pendingId)
  const activeId = useChat((s) => s.activeSessionId)
  const remote = isRemoteSurface()

  useEffect(() => {
    if (!remote && !useProjects.getState().state) void useProjects.getState().load()
  }, [remote])

  if (remote || !getExtras() || !state) return null
  const current = activeId ? projectOfSession(state, activeId) : (state.projects.find((p) => p.id === pendingId) ?? null)
  const options: ChipMenuOption[] = [
    { id: NONE_ID, label: t('projects.chip.none'), hint: t('projects.chip.noneHint'), icon: <Folder size={14} aria-hidden="true" /> },
    ...state.projects.map((p) => ({
      id: p.id,
      label: p.name,
      hint: t('projects.chip.hint', { count: p.files.filter((f) => f.status === 'ready').length }),
      icon: <Folder size={14} aria-hidden="true" />
    })),
    { id: NEW_ID, label: t('projects.chip.new'), icon: <FolderPlus size={14} aria-hidden="true" />, action: true, separatorBefore: true }
  ]

  const onSelect = (id: string): void => {
    const st = useProjects.getState()
    if (id === NEW_ID) {
      void createProjectFlow(t)
      return
    }
    const projectId = id === NONE_ID ? null : id
    if (activeId) void st.assign(activeId, projectId)
    else st.setPending(projectId)
  }

  return (
    <ChipMenu
      name={t('projects.chip.name')}
      valueLabel={current ? current.name : t('projects.chip.none')}
      labelClass="max-w-40 truncate"
      icon={<Folder size={13} aria-hidden="true" />}
      options={options}
      value={current ? current.id : NONE_ID}
      onSelect={onSelect}
      tone={current ? 'accent' : undefined}
      note={t('projects.chip.note')}
      testId="project-chip"
    />
  )
}
