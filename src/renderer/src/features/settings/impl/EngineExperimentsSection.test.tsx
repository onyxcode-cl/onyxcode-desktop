// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import { EngineExperimentsSection } from './EngineExperimentsSection'
import { useSettings } from '../../../stores/settings'

let host: HTMLDivElement
let root: Root
let update: ReturnType<typeof vi.fn>

const switches = (): HTMLButtonElement[] => [...host.querySelectorAll<HTMLButtonElement>('button[role="switch"]')]

function mount(engineExperiments = DEFAULT_SETTINGS.engineExperiments): void {
  update = vi.fn(async () => undefined)
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, engineExperiments }, update })
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
  it('muestra dos grupos con nombre accesible y seis interruptores apagados por defecto', () => {
    mount()
    const groups = [...host.querySelectorAll('section[role="group"]')]
    expect(groups).toHaveLength(2)
    for (const g of groups) {
      const labelId = g.getAttribute('aria-labelledby')!
      expect(document.getElementById(labelId)?.textContent).toBeTruthy()
      expect(g.textContent).toContain('Experimental')
    }
    const sw = switches()
    expect(sw).toHaveLength(6)
    expect(sw.every((b) => b.getAttribute('aria-checked') === 'false' && !!b.getAttribute('aria-label'))).toBe(true)
    expect(new Set(sw.map((b) => b.getAttribute('aria-label'))).size).toBe(6)
  })

  it('refleja el estado guardado', () => {
    mount({ codeMode: { chat: false, code: true, tasks: false }, backgroundSubagents: { chat: true, code: false, tasks: true } })
    expect(switches().map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'true', 'false', 'true'])
  })

  it('al cambiar uno envía el objeto completo y solo cambia esa bandera', () => {
    mount({ codeMode: { chat: false, code: true, tasks: false }, backgroundSubagents: { chat: true, code: false, tasks: false } })
    act(() => switches()[0].click()) // Modo código · Chat
    expect(update).toHaveBeenLastCalledWith({
      engineExperiments: {
        codeMode: { chat: true, code: true, tasks: false },
        backgroundSubagents: { chat: true, code: false, tasks: false }
      }
    })
    act(() => switches()[5].click()) // Subagentes · Overdrive
    expect(update).toHaveBeenLastCalledWith({
      engineExperiments: {
        codeMode: { chat: false, code: true, tasks: false },
        backgroundSubagents: { chat: true, code: false, tasks: true }
      }
    })
  })

  it('explica el reinicio y que Chat y Code comparten motor', () => {
    mount()
    expect(host.textContent).toContain('se reinicia')
    expect(host.textContent).toContain('Chat y Code comparten el mismo motor')
    expect(host.textContent).toContain('Overdrive corre aislado')
  })
})
