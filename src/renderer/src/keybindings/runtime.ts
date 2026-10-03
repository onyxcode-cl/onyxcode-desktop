/**
 * Ejecución de las acciones con atajo (F8-B46). Los metadatos (id, categoría, atajo por defecto) viven en
 * `@shared/keybindings`; aquí está lo que necesita los stores del renderer: qué hace cada acción y cuándo está disponible.
 * Una acción puede registrarla además un componente (`registerAction`, p. ej. el buscador de sesiones de Code, que guarda
 * su estado abierto/cerrado), que tiene prioridad sobre la implementación integrada.
 */
import { capsFor, modeAvailable } from '@shared/platform-caps'
import type { ModeId } from '@shared/types'
import { useCode } from '../features/code/impl/store'
import type { RightPanel } from '../features/code/impl/types'
import { useUi } from '../stores/ui'
import { MODES, MODES_BY_ID } from '../app/modes'
import { currentPlatform } from '../lib/platform'
import { dynamicHandler, type ActionHandler } from './registry'

const inCodeProject = (): boolean => {
  const ui = useUi.getState()
  return ui.mode === 'code' && !ui.settingsOpen && !!useCode.getState().directory
}

function goMode(id: ModeId): ActionHandler {
  return {
    enabled: () => modeAvailable(id, currentPlatform()),
    run: () => {
      useUi.getState().setMode(id)
    }
  }
}

function togglePanel(panel: RightPanel): ActionHandler {
  return { enabled: inCodeProject, run: () => useCode.getState().togglePanel(panel) }
}

function cycleMode(step: 1 | -1): ActionHandler {
  return {
    run: () => {
      const ui = useUi.getState()
      const i = MODES.findIndex((m) => m.id === ui.mode)
      ui.setMode(MODES[(i + step + MODES.length) % MODES.length].id)
    }
  }
}

function focusComposer(): boolean {
  const els = Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea[data-kb-composer]'))
  const el = els.find((x) => x.offsetParent !== null && !x.disabled)
  if (!el) return false
  el.focus()
  return true
}

const BUILTIN: Record<string, ActionHandler> = {
  'palette.toggle': {
    run: () => {
      const ui = useUi.getState()
      // ⌘K en Code con proyecto lo usa el buscador de sesiones (`code.sessionSwitcher`); la paleta sigue en ⌘⇧P.
      if (!ui.paletteOpen && ui.mode === 'code' && useCode.getState().directory) return false
      ui.setPaletteOpen(!ui.paletteOpen)
      return true
    }
  },
  'palette.alt': {
    run: () => {
      const ui = useUi.getState()
      ui.setPaletteOpen(!ui.paletteOpen)
    }
  },
  'sidebar.toggle': { run: () => useUi.getState().toggleSidebar() },
  'settings.toggle': {
    run: () => {
      const ui = useUi.getState()
      ui.openSettings(!ui.settingsOpen)
    }
  },
  'remote.stopAll': {
    enabled: () => capsFor(currentPlatform()).remote,
    run: () => {
      void window.api.remote.invoke('remote:stop').catch(() => undefined)
    }
  },
  'mode.next': cycleMode(1),
  'mode.prev': cycleMode(-1),
  'mode.chat': goMode('chat'),
  'mode.code': goMode('code'),
  'mode.tasks': goMode('tasks'),
  'mode.routines': goMode('routines'),
  'conversation.new': {
    run: () => {
      const ui = useUi.getState()
      const action = MODES_BY_ID[ui.mode].newAction
      if (!action || ui.paletteOpen) return false
      ui.openSettings(false)
      action.run()
      return true
    }
  },
  'composer.focus': { run: focusComposer },
  'session.stop': {
    consume: false,
    enabled: () => {
      if (!inCodeProject()) return false
      const st = useCode.getState()
      const run = st.activeSessionID ? st.runState[st.activeSessionID] : undefined
      return run === 'busy' || run === 'retry'
    },
    run: () => {
      void useCode.getState().abort()
    }
  },
  'code.togglePlanBuild': {
    enabled: inCodeProject,
    run: () => {
      const st = useCode.getState()
      st.setAgent(st.agent === 'plan' ? 'build' : 'plan')
    }
  },
  'code.setPlan': { enabled: inCodeProject, run: () => useCode.getState().setAgent('plan') },
  'code.setBuild': { enabled: inCodeProject, run: () => useCode.getState().setAgent('build') },
  'code.panel.changes': togglePanel('changes'),
  'code.panel.terminal': togglePanel('terminal'),
  'code.panel.files': togglePanel('files'),
  'code.panel.browser': togglePanel('browser')
}

export function handlerFor(id: string): ActionHandler | undefined {
  return dynamicHandler(id) ?? BUILTIN[id]
}
