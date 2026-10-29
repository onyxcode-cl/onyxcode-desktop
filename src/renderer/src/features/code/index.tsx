import { Code2 } from 'lucide-react'
import { t } from '@shared/i18n'
import { MODE_LABELS } from '@shared/labels'
import type { ModeDefinition } from '../../app/types'
import { CodeSidebar, CodeWorkspace, newCodeSession } from './impl/CodeWorkspace'
import { pickAndOpenFolder } from './impl/ProjectPicker'
import { useCode } from './impl/store'

function showCodeProjectPicker(): void {
  // Sin proyectos aún no hay nada que "agregar": el botón de la barra lateral abre el diálogo nativo directo.
  if (useCode.getState().directory) useCode.getState().showProjectPicker()
  else void pickAndOpenFolder()
}

function CodeView(): React.JSX.Element {
  return <CodeWorkspace showSessionList={false} />
}

export const codeMode: ModeDefinition = {
  id: 'code',
  get label() {
    return MODE_LABELS.code
  },
  icon: Code2,
  View: CodeView,
  SidebarContent: CodeSidebar,
  projectAction: () => void pickAndOpenFolder(),
  backToProjects: showCodeProjectPicker,
  newAction: {
    get label() {
      return t('app.mode.newSession')
    },
    run: newCodeSession
  },
  // El botón de arriba de la barra es «Nuevo proyecto»: pide la carpeta de una vez (la sesión nueva sigue en ⌘N y en el «+» de cada proyecto).
  sidebarNew: {
    get label() {
      return t('app.mode.newProject')
    },
    run: () => void pickAndOpenFolder()
  }
}
