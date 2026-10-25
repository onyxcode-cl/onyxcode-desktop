// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type EngineExperiments } from '@shared/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import { EngineExperimentsSection } from './EngineExperimentsSection'
import { useSettings } from '../../../stores/settings'

let host: HTMLDivElement
let root: Root
let update: ReturnType<typeof vi.fn>

const switches = (): HTMLButtonElement[] => [...host.querySelectorAll<HTMLButtonElement>('section[role="group"] button[role="switch"]')]

function mount(
  engineExperiments: Pick<EngineExperiments, 'codeMode' | 'backgroundSubagents'> &
    Partial<EngineExperiments> = DEFAULT_SETTINGS.engineExperiments
): void {
  const full = { toolSearch: DEFAULT_SETTINGS.engineExperiments.toolSearch, ...engineExperiments }
  update = vi.fn(async () => undefined)
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, engineExperiments: full }, update })
  act(() => root.render(createElement(EngineExperimentsSection)))
}

beforeEach(() => {
  vi.unstubAllGlobals()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('EngineExperimentsSection', () => {
  it('muestra tres grupos con nombre accesible y ocho interruptores (Modo código apagado; subagentes en segundo plano y búsqueda de herramientas encendidos)', () => {
    mount()
    const groups = [...host.querySelectorAll('section[role="group"]')]
    expect(groups).toHaveLength(3)
    for (const g of groups) {
      const labelId = g.getAttribute('aria-labelledby')!
      expect(document.getElementById(labelId)?.textContent).toBeTruthy()
      expect(g.textContent).toContain('Experimental')
    }
    const sw = switches()
    expect(sw).toHaveLength(8)
    expect(sw.every((b) => !!b.getAttribute('aria-label'))).toBe(true)
    expect(sw.filter((b) => b.getAttribute('aria-checked') === 'true')).toHaveLength(5)
    expect(new Set(sw.map((b) => b.getAttribute('aria-label'))).size).toBe(8)
  })

  it('refleja el estado guardado', () => {
    mount({ codeMode: { chat: false, code: true, tasks: false }, backgroundSubagents: { chat: true, code: false, tasks: true } })
    expect(switches().map((b) => b.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
      'true',
      'false',
      'true',
      'true',
      'true'
    ])
  })

  it('al cambiar uno envía el objeto completo y solo cambia esa bandera', () => {
    mount({ codeMode: { chat: false, code: true, tasks: false }, backgroundSubagents: { chat: true, code: false, tasks: false } })
    act(() => switches()[0].click()) // Modo código · Chat
    expect(update).toHaveBeenLastCalledWith({
      engineExperiments: {
        codeMode: { chat: true, code: true, tasks: false },
        backgroundSubagents: { chat: true, code: false, tasks: false },
        toolSearch: { chat: 'auto', code: 'auto', tasks: 'off' }
      }
    })
    act(() => switches()[5].click()) // Subagentes · Overdrive
    expect(update).toHaveBeenLastCalledWith({
      engineExperiments: {
        codeMode: { chat: false, code: true, tasks: false },
        backgroundSubagents: { chat: true, code: false, tasks: true },
        toolSearch: { chat: 'auto', code: 'auto', tasks: 'off' }
      }
    })
  })

  it('búsqueda de herramientas: solo Chat y Code tienen interruptor; apagar uno guarda «off» y deja Overdrive en «off»', () => {
    mount()
    const g = [...host.querySelectorAll('section[role="group"]')][2]!
    expect(g.textContent).toContain('Búsqueda de herramientas de conectores')
    expect(g.textContent).toContain('Overdrive no usa esta función')
    const sw = [...g.querySelectorAll<HTMLButtonElement>('button[role="switch"]')]
    expect(sw).toHaveLength(2)
    act(() => sw[1].click()) // Code
    expect(update).toHaveBeenLastCalledWith({
      engineExperiments: {
        codeMode: { chat: false, code: false, tasks: false },
        backgroundSubagents: { chat: true, code: true, tasks: true },
        toolSearch: { chat: 'auto', code: 'off', tasks: 'off' }
      }
    })
  })

  it('explica el reinicio y que Chat y Code comparten motor', () => {
    mount()
    expect(host.textContent).toContain('se reinicia')
    expect(host.textContent).toContain('Chat y Code comparten el mismo motor')
    expect(host.textContent).toContain('Overdrive corre aislado')
  })

  it('explica qué significa cada función en el Chat (F8-B206: Modo código no aplica; subagentes = ayudante web)', () => {
    mount()
    const groups = [...host.querySelectorAll('section[role="group"]')]
    expect(groups[0]!.textContent).toContain('En el Chat no aplica')
    expect(groups[1]!.textContent).toContain('ayudante que busca y lee en la web')
  })
})
