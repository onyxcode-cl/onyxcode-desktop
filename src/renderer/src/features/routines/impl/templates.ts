/** Plantillas de rutinas para el estado vacío. Los textos visibles (y el prompt inicial) son getters: leen el idioma activo. */
import { t } from '@shared/i18n'
import type { RoutineInput } from '@shared/ipc-tasks'

export interface RoutineTemplate {
  id: string
  readonly title: string
  readonly description: string
  /** Aviso a mostrar al abrir el editor (p. ej. elegir carpeta). */
  readonly needs?: string
  input: Omit<RoutineInput, 'model' | 'enabled'>
}

/**
 * Patrón de las plantillas desatendidas: primero revisa y resume, luego propone, y solo al final
 * actúa (únicamente en lo seguro y reversible). Nadie puede responder preguntas durante la
 * ejecución, así que las propuestas quedan escritas en un archivo para revisarlas después.
 */
export const ROUTINE_TEMPLATES: RoutineTemplate[] = [
  {
    id: 'news',
    get title() {
      return t('routines.tpl.news.title')
    },
    get description() {
      return t('routines.tpl.news.desc')
    },
    input: {
      get name() {
        return t('routines.tpl.news.name')
      },
      mode: 'chat',
      folder: null,
      schedule: { kind: 'daily', time: '08:00' },
      get prompt() {
        return t('routines.tpl.news.prompt')
      }
    }
  },
  {
    id: 'downloads',
    get title() {
      return t('routines.tpl.downloads.title')
    },
    get description() {
      return t('routines.tpl.downloads.desc')
    },
    get needs() {
      return t('routines.tpl.downloads.needs')
    },
    input: {
      get name() {
        return t('routines.tpl.downloads.name')
      },
      mode: 'tasks',
      folder: null,
      schedule: { kind: 'weekly', day: 5, time: '17:00' },
      sessionMode: 'fresh',
      onAsk: 'reject',
      allow: [
        { permission: 'bash', pattern: 'ls*' },
        { permission: 'bash', pattern: 'mkdir *' }
      ],
      get prompt() {
        return t('routines.tpl.downloads.prompt')
      }
    }
  },
  {
    id: 'inbox',
    get title() {
      return t('routines.tpl.inbox.title')
    },
    get description() {
      return t('routines.tpl.inbox.desc')
    },
    get needs() {
      return t('routines.tpl.inbox.needs')
    },
    input: {
      get name() {
        return t('routines.tpl.inbox.name')
      },
      mode: 'tasks',
      folder: null,
      schedule: { kind: 'cron', expr: '0 9 * * 1-5' },
      sessionMode: 'continue',
      onAsk: 'wait',
      allow: [],
      get prompt() {
        return t('routines.tpl.inbox.prompt')
      }
    }
  },
  {
    id: 'repo',
    get title() {
      return t('routines.tpl.repo.title')
    },
    get description() {
      return t('routines.tpl.repo.desc')
    },
    get needs() {
      return t('routines.tpl.repo.needs')
    },
    input: {
      get name() {
        return t('routines.tpl.repo.name')
      },
      mode: 'code',
      folder: null,
      schedule: { kind: 'weekly', day: 1, time: '09:00' },
      get prompt() {
        return t('routines.tpl.repo.prompt')
      }
    }
  }
]
