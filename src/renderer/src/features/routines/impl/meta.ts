import { MessageSquare, Terminal, Users, type LucideIcon } from 'lucide-react'
import type { RoutineMode } from '@shared/ipc-cowork'

export const MODE_META: Record<RoutineMode, { label: string; icon: LucideIcon; hint: string }> = {
  chat: { label: 'Chat', icon: MessageSquare, hint: 'Respuesta de texto (con búsqueda web), sin archivos' },
  cowork: { label: 'Cowork', icon: Users, hint: 'Trabaja con documentos de una carpeta (en sandbox o, con tu consentimiento, en Control total)' },
  code: { label: 'Code', icon: Terminal, hint: 'Agente de programación sobre un proyecto' }
}
