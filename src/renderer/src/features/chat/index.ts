import { MessageSquare } from 'lucide-react'
import type { ModeDefinition } from '../../app/types'
import { newChat } from './actions'
import { ChatSidebar } from './ChatSidebar'
import { ChatView } from './ChatView'

export const chatMode: ModeDefinition = {
  id: 'chat',
  label: 'Chat',
  icon: MessageSquare,
  View: ChatView,
  SidebarContent: ChatSidebar,
  newAction: { label: 'Nueva conversación', run: newChat }
}
