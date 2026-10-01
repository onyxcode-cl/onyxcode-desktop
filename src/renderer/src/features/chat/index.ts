import { MessageSquare } from 'lucide-react'
import { t } from '@shared/i18n'
import { MODE_LABELS } from '@shared/labels'
import type { ModeDefinition } from '../../app/types'
import { newChat } from './actions'
import { ChatSidebar } from './ChatSidebar'
import { ChatView } from './ChatView'

export const chatMode: ModeDefinition = {
  id: 'chat',
  get label() {
    return MODE_LABELS.chat
  },
  icon: MessageSquare,
  View: ChatView,
  SidebarContent: ChatSidebar,
  newAction: {
    get label() {
      return t('app.mode.newChat')
    },
    run: newChat
  }
}
