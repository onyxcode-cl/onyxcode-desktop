import { Code2 } from 'lucide-react'
import { t } from '@shared/i18n'
import { MODE_LABELS } from '@shared/labels'
import type { ModeDefinition } from '../../app/types'
import { CodeSidebar, CodeWorkspace, newCodeSession } from './impl/CodeWorkspace'

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
  newAction: {
    get label() {
      return t('app.mode.newSession')
    },
    run: newCodeSession
  }
}
