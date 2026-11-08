// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { DEFAULT_SETTINGS, type EngineExperiments, type Settings } from '@shared/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// El archivo de ganchos que «lee» la pantalla (`settings:hooksRead`); el resto de canales no se usa aquí.
const hooksFile = vi.hoisted(() => ({ value: { text: '', exists: false } as { text: string; exists: boolean } }))
vi.mock('../../../lib/api', () => ({
  call: vi.fn(async (channel: string) => (channel === 'settings:hooksRead' ? hooksFile.value : { ok: true })),
  api: { on: () => () => undefined }
}))

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
  const full = {
    toolSearch: DEFAULT_SETTINGS.engineExperiments.toolSearch,
    mcpElicitation: DEFAULT_SETTINGS.engineExperiments.mcpElicitation,
    codeExtras: DEFAULT_SETTINGS.engineExperiments.codeExtras,
    ...engineExperiments
  }
  update = vi.fn(async () => undefined)
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, engineExperiments: full }, update })
  act(() => root.render(createElement(EngineExperimentsSection)))
}

beforeEach(() => {
  hooksFile.value = { text: '', exists: false }
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
        toolSearch: { chat: 'auto', code: 'auto', tasks: 'off' },
        mcpElicitation: { chat: true, code: true, tasks: false },
        codeExtras: DEFAULT_SETTINGS.engineExperiments.codeExtras
      }
    })
    act(() => switches()[5].click()) // Subagentes · Overdrive
    expect(update).toHaveBeenLastCalledWith({
      engineExperiments: {
        codeMode: { chat: false, code: true, tasks: false },
        backgroundSubagents: { chat: true, code: false, tasks: true },
        toolSearch: { chat: 'auto', code: 'auto', tasks: 'off' },
        mcpElicitation: { chat: true, code: true, tasks: false },
        codeExtras: DEFAULT_SETTINGS.engineExperiments.codeExtras
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
        toolSearch: { chat: 'auto', code: 'off', tasks: 'off' },
        mcpElicitation: { chat: true, code: true, tasks: false },
        codeExtras: DEFAULT_SETTINGS.engineExperiments.codeExtras
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

  describe('Formularios de conectores', () => {
    const formSwitches = (): HTMLButtonElement[] => {
      const sec = [...host.querySelectorAll('section')].find((x) => x.textContent?.includes('Formularios de conectores'))!
      return [...sec.querySelectorAll<HTMLButtonElement>('button[role="switch"]')]
    }
    it('hay un interruptor por modo SOLO para Chat y Code (Overdrive no), encendidos por defecto, con nombre accesible', () => {
      mount()
      const sw = formSwitches()
      expect(sw).toHaveLength(2)
      expect(sw.map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'true'])
      expect(sw[0].getAttribute('aria-label')).toBe('Formularios de conectores en Chat')
      expect(sw[1].getAttribute('aria-label')).toBe('Formularios de conectores en Code')
      expect(host.textContent).toContain('Overdrive no recibe formularios')
      expect(host.textContent).toContain('Lazunox nunca envía contraseñas ni claves')
    })
    it('apagar uno envía el objeto completo (con búsqueda de herramientas intacta), cambia solo esa bandera y deja Overdrive en falso', () => {
      mount()
      act(() => formSwitches()[1].click()) // Code
      expect(update).toHaveBeenLastCalledWith({
        engineExperiments: {
          codeMode: DEFAULT_SETTINGS.engineExperiments.codeMode,
          backgroundSubagents: DEFAULT_SETTINGS.engineExperiments.backgroundSubagents,
          toolSearch: DEFAULT_SETTINGS.engineExperiments.toolSearch,
          mcpElicitation: { chat: true, code: false, tasks: false },
          codeExtras: DEFAULT_SETTINGS.engineExperiments.codeExtras
        }
      })
    })
  })

  describe('Objetivo, presupuesto y revisión (Code)', () => {
    const extraSwitches = (): HTMLButtonElement[] => {
      const sec = [...host.querySelectorAll('section')].find((x) => x.textContent?.includes('Objetivo, presupuesto y revisión (Code)'))
      return [...(sec?.querySelectorAll<HTMLButtonElement>('button[role="switch"]') ?? [])]
    }
    it('hay tres interruptores APAGADOS por defecto, con nombre accesible, y avisa de que no reinicia el motor', () => {
      mount()
      const sw = extraSwitches()
      expect(sw.map((b) => b.getAttribute('aria-label'))).toEqual(['Objetivo en Code', 'Presupuesto en Code', 'Revisar cambios en Code'])
      expect(sw.map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false'])
      expect(host.textContent).toContain('no reinicia el motor')
      expect(host.textContent).toContain('No empieza sola')
    })
    it('encender uno envía el objeto completo y cambia solo esa función', () => {
      mount()
      act(() => extraSwitches()[2].click()) // Revisar cambios
      expect(update).toHaveBeenLastCalledWith({
        engineExperiments: {
          codeMode: DEFAULT_SETTINGS.engineExperiments.codeMode,
          backgroundSubagents: DEFAULT_SETTINGS.engineExperiments.backgroundSubagents,
          toolSearch: DEFAULT_SETTINGS.engineExperiments.toolSearch,
          mcpElicitation: DEFAULT_SETTINGS.engineExperiments.mcpElicitation,
          codeExtras: { goal: false, budget: false, review: true }
        }
      })
    })
  })
  describe('1.8.12: búsqueda web con cualquier IA y sugerencia en las tarjetas de permiso', () => {
    const own = (title: string): HTMLElement =>
      [...host.querySelectorAll('section')].find((x) => x.querySelector('h3')?.textContent === title)!
    const mountWith = (extra: Partial<Settings>): void => {
      update = vi.fn(async () => undefined)
      useSettings.setState({ settings: { ...DEFAULT_SETTINGS, ...extra }, update })
      act(() => root.render(createElement(EngineExperimentsSection)))
    }

    it('la búsqueda web está APAGADA por defecto, nombra a Exa y a «un tercero» en un aviso siempre visible', () => {
      mount()
      const sec = own('Búsqueda web con cualquier IA')
      const sw = sec.querySelector<HTMLButtonElement>('button[role="switch"]')!
      expect(sw.getAttribute('aria-checked')).toBe('false')
      expect(sw.getAttribute('aria-label')).toBe('Búsqueda web con cualquier IA')
      const note = sec.querySelector('[role="note"]')!.textContent!
      expect(note).toContain('Exa')
      expect(note).toContain('se envían')
      expect(note).toContain('tercero')
      expect(note).toContain('No afecta a Overdrive')
    })

    it('encender y apagar la búsqueda web envía solo ese ajuste', () => {
      mount()
      act(() => own('Búsqueda web con cualquier IA').querySelector<HTMLButtonElement>('button[role="switch"]')!.click())
      expect(update).toHaveBeenLastCalledWith({ webSearchAnyProvider: true })
      mountWith({ webSearchAnyProvider: true })
      const sw = own('Búsqueda web con cualquier IA').querySelector<HTMLButtonElement>('button[role="switch"]')!
      expect(sw.getAttribute('aria-checked')).toBe('true')
      act(() => sw.click())
      expect(update).toHaveBeenLastCalledWith({ webSearchAnyProvider: false })
    })

    it('la sugerencia está APAGADA por defecto y avisa: nunca aprueba, tarda más y puede costar', () => {
      mount()
      const sec = own('Sugerencia en las tarjetas de permiso')
      const sw = sec.querySelector<HTMLButtonElement>('button[role="switch"]')!
      expect(sw.getAttribute('aria-checked')).toBe('false')
      expect(sw.getAttribute('aria-label')).toBe('Sugerencia de una IA en las tarjetas de permiso')
      const note = sec.querySelector('[role="note"]')!.textContent!
      expect(note).toContain('Nunca aprueba por ti')
      expect(note).toContain('segundos más')
      expect(note).toContain('costo')
      act(() => sw.click())
      expect(update).toHaveBeenLastCalledWith({ permissionSuggestions: true })
    })

    it('los dos interruptores nuevos tienen nombre accesible distinto y no cambian el recuento de los grupos por modo', () => {
      mount()
      expect(host.querySelectorAll('section[role="group"]')).toHaveLength(3)
      expect(switches()).toHaveLength(8)
    })

    it('en inglés, textos propios y el aviso nombra a Exa', async () => {
      const { applyLangPref } = await import('../../../lib/i18n')
      applyLangPref('en')
      try {
        mount()
        const sec = own('Web search with any AI')
        expect(sec.querySelector('[role="note"]')!.textContent).toContain('sent to Exa')
        expect(own('Suggestion on permission cards').textContent).toContain('It never approves for you')
      } finally {
        applyLangPref('es')
      }
    })
  })

  describe('1.8.12: avisos de confianza de los ganchos', () => {
    const SHA = (t: string): string => createHash('sha256').update(Buffer.from(t, 'utf8')).digest('hex')
    const TXT = '{"hooks":{"Stop":[{"command":"echo hola"}]}}\n'
    const mountHooks = async (extra: Partial<Settings>): Promise<void> => {
      update = vi.fn(async () => undefined)
      useSettings.setState({ settings: { ...DEFAULT_SETTINGS, ...extra }, update })
      await act(async () => root.render(createElement(EngineExperimentsSection)))
      await act(async () => undefined)
    }
    const notice = (): string => host.querySelector('[role="status"]')?.textContent ?? ''

    it('con ganchos apagados no hay aviso, aunque la huella no coincida', async () => {
      hooksFile.value = { text: TXT, exists: true }
      await mountHooks({ userHooksEnabled: false, userHooksSha256: SHA('otra cosa') })
      expect(notice()).toBe('')
    })

    it('migrados al actualizar (decisión D11): «Revisa tus ganchos» mientras no se guarden de nuevo', async () => {
      hooksFile.value = { text: TXT, exists: true }
      await mountHooks({ userHooksEnabled: true, userHooksSha256: SHA(TXT), userHooksReview: true })
      expect(notice()).toContain('Revisa tus ganchos')
      expect(notice()).toContain('Guardar')
    })

    it('la huella coincide y nada que revisar: sin aviso', async () => {
      hooksFile.value = { text: TXT, exists: true }
      await mountHooks({ userHooksEnabled: true, userHooksSha256: SHA(TXT), userHooksReview: false })
      expect(notice()).toBe('')
    })

    it('editado a mano (no coincide con la huella): dice que los ganchos NO se están ejecutando', async () => {
      hooksFile.value = { text: TXT.replace('hola', 'otra cosa'), exists: true }
      await mountHooks({ userHooksEnabled: true, userHooksSha256: SHA(TXT), userHooksReview: false })
      expect(notice()).toContain('no se están ejecutando')
      expect(notice()).toContain('a mano')
    })

    it('el aviso de «no se ejecutan» manda sobre el de «revísalos»', async () => {
      hooksFile.value = { text: TXT.replace('hola', 'otra cosa'), exists: true }
      await mountHooks({ userHooksEnabled: true, userHooksSha256: SHA(TXT), userHooksReview: true })
      expect(notice()).toContain('no se están ejecutando')
      expect(notice()).not.toContain('Revisa tus ganchos')
    })

    it('archivo que existe y ninguna huella guardada: no se ejecuta, y lo dice', async () => {
      hooksFile.value = { text: TXT, exists: true }
      await mountHooks({ userHooksEnabled: true, userHooksSha256: null })
      expect(notice()).toContain('no se están ejecutando')
    })

    it('sin archivo no hay nada que ejecutar ni que avisar', async () => {
      hooksFile.value = { text: '', exists: false }
      await mountHooks({ userHooksEnabled: true, userHooksSha256: null })
      expect(notice()).toBe('')
    })

    it('la huella en mayúsculas cuenta como la misma', async () => {
      hooksFile.value = { text: TXT, exists: true }
      await mountHooks({ userHooksEnabled: true, userHooksSha256: SHA(TXT).toUpperCase() })
      expect(notice()).toBe('')
    })
  })
})
