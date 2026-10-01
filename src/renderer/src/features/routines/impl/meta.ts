import { MessageSquare, Terminal, Users, type LucideIcon } from 'lucide-react'
import { t } from '@shared/i18n'
import { MODE_LABELS } from '@shared/labels'
import type { RoutineMode } from '@shared/ipc-tasks'

/** Etiquetas y ayudas por modo; son getters para leer el idioma activo en cada uso. */
export const MODE_META: Record<RoutineMode, { label: string; icon: LucideIcon; hint: string }> = {
  chat: {
    get label() {
      return MODE_LABELS.chat
    },
    icon: MessageSquare,
    get hint() {
      return t('routines.mode.chat.hint')
    }
  },
  tasks: {
    get label() {
      return MODE_LABELS.tasks
    },
    icon: Users,
    get hint() {
      return t('routines.mode.tasks.hint')
    }
  },
  code: {
    get label() {
      return MODE_LABELS.code
    },
    icon: Terminal,
    get hint() {
      return t('routines.mode.code.hint')
    }
  }
}
