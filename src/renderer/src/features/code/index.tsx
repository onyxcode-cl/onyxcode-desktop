import { Code2 } from 'lucide-react'
import type { ModeDefinition } from '../../app/types'
import { CodeSidebar, CodeWorkspace, newCodeSession } from './impl/CodeWorkspace'

function CodeView(): React.JSX.Element {
  return <CodeWorkspace showSessionList={false} />
}

export const codeMode: ModeDefinition = {
  id: 'code',
  label: 'Code',
  icon: Code2,
  View: CodeView,
  SidebarContent: CodeSidebar,
  newAction: { label: 'Nueva sesión', run: newCodeSession }
}
