// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { fakeApi } from '../../../test/setup'
import { useSettings } from '../stores/settings'
import { ReorderableCards, type SummaryCard } from './ReorderableCards'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cards: SummaryCard[] = ['project', 'plan', 'background', 'context', 'changes'].map((id) => ({
  id,
  label: id,
  content: createElement('section', { 'data-content': id }, id)
}))
let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  useSettings.setState({ settings: DEFAULT_SETTINGS, loaded: false })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})
const mount = (mode: 'code' | 'tasks' = 'code', value: SummaryCard[] = cards): void =>
  act(() => root.render(createElement(ReorderableCards, { mode, cards: value })))
const ids = (): string[] => [...host.querySelectorAll('[data-summary-card]')].map((el) => el.getAttribute('data-summary-card')!)
const handle = (id: string): HTMLButtonElement => host.querySelector(`[data-summary-card="${id}"] button`)!
const key = (id: string, value: string): void =>
  act(() => {
    handle(id).focus()
    handle(id).dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))
  })

describe('ReorderableCards', () => {
  it('deja En segundo plano tras Plan y expone ayuda accesible en el asa', () => {
    mount()
    expect(ids()).toEqual(cards.map((card) => card.id))
    const button = handle('background')
    expect(button.draggable).toBe(true)
    expect(button.getAttribute('aria-label')).toContain('background')
    const help = document.getElementById(button.getAttribute('aria-describedby')!)
    expect(help?.textContent).toContain('flechas arriba y abajo')
  })

  it('las flechas mueven la tarjeta, conservan el foco y anuncian la posición', () => {
    mount()
    const button = handle('background')
    key('background', 'ArrowUp')
    expect(ids()).toEqual(['project', 'background', 'plan', 'context', 'changes'])
    expect(document.activeElement).toBe(button)
    expect(host.querySelector('[role="status"]')?.textContent).toContain('posición 2 de 5')
    key('background', 'ArrowDown')
    expect(ids()).toEqual(cards.map((card) => card.id))
    key('background', 'Home')
    expect(ids()[0]).toBe('background')
    key('background', 'End')
    expect(ids()[4]).toBe('background')
    key('background', 'ArrowDown')
    expect(ids()[4]).toBe('background')
  })

  it('arrastra desde el asa a otra tarjeta y guarda el resultado', () => {
    mount()
    const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    const drag = (element: Element, type: string): Event => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'dataTransfer', { value: transfer })
      act(() => element.dispatchEvent(event))
      return event
    }
    drag(handle('background'), 'dragstart')
    const target = host.querySelector('[data-summary-card="project"]')!
    expect(drag(target, 'dragover').defaultPrevented).toBe(true)
    drag(target, 'drop')
    expect(ids()).toEqual(['background', 'project', 'plan', 'context', 'changes'])
    expect(JSON.parse(localStorage.getItem('lazunox.summary-order.v1.code')!)).toEqual(ids())
    expect(transfer.setData).toHaveBeenCalledWith('text/plain', 'background')
  })

  it('recuerda el orden al remontar y mantiene independientes Código y Overdrive', () => {
    mount('code')
    key('changes', 'Home')
    const codeOrder = ids()
    mount('tasks')
    expect(ids()).toEqual(cards.map((card) => card.id))
    key('background', 'Home')
    const tasksOrder = ids()
    mount('code')
    expect(ids()).toEqual(codeOrder)
    act(() => root.unmount())
    root = createRoot(host)
    mount('tasks')
    expect(ids()).toEqual(tasksOrder)
  })

  it('tolera preferencias corruptas, descarta ids extra y duplicados, e incorpora tarjetas nuevas', () => {
    localStorage.setItem('lazunox.summary-order.v1.code', '{broken')
    mount('code')
    expect(ids()).toEqual(cards.map((card) => card.id))
    localStorage.setItem('lazunox.summary-order.v1.tasks', JSON.stringify(['changes', 7, 'gone', 'changes', 'plan']))
    mount('tasks')
    expect(ids()).toEqual(['changes', 'plan', 'project', 'background', 'context'])
  })

  it('permite ordenar cuando el almacenamiento no está disponible', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    mount()
    key('background', 'Home')
    expect(ids()[0]).toBe('background')
  })

  it.each(['code', 'tasks'] as const)('%s guarda en disco en el drop, sin cierre ni caché de Chromium', async (mode) => {
    const dir = mkdtempSync(join(tmpdir(), 'lazunox-card-order-'))
    try {
      vi.resetModules()
      vi.doMock('electron', () => ({ app: { getPath: () => dir } }))
      // El puente cruza dos proyectos TS separados (web/main): las rutas dinámicas dejan el código
      // main fuera del grafo de compilación web, pero ejecutan sus módulos reales en esta prueba.
      const storePath = '../../../main/store'
      const schemasPath = '../../../main/ipc/schemas'
      const { settingsStore } = (await import(storePath)) as {
        settingsStore: { set: (patch: Partial<Settings>) => Settings }
      }
      const { IPC_SCHEMAS } = (await import(schemasPath)) as {
        IPC_SCHEMAS: { 'settings:set': (value: unknown) => Partial<Settings> }
      }
      vi.spyOn(fakeApi, 'invoke').mockImplementation(async (...args: unknown[]) => {
        const [channel, patch] = args
        expect(channel).toBe('settings:set')
        const validated = IPC_SCHEMAS['settings:set'](patch)
        return { ok: true, data: settingsStore.set(validated) } as never
      })
      mount(mode)
      const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
      for (const [element, type] of [
        [handle('context'), 'dragstart'],
        [host.querySelector('[data-summary-card="project"]')!, 'drop']
      ] as const) {
        const event = new Event(type, { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'dataTransfer', { value: transfer })
        act(() => element.dispatchEvent(event))
      }
      const expected = ['context', 'project', 'plan', 'background', 'changes']
      expect(ids()).toEqual(expected)
      // La escritura ocurrió ya durante drop: no hay beforeunload, cierre de ventana ni timers.
      expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).summaryCardOrder[mode]).toEqual(expected)
      localStorage.clear()
      vi.resetModules()
      const reopened = ((await import(storePath)) as { settingsStore: { get: () => Settings } }).settingsStore.get()
      act(() => {
        root.unmount()
        useSettings.setState({ settings: reopened, loaded: true })
      })
      root = createRoot(host)
      mount(mode)
      expect(ids()).toEqual(expected)
    } finally {
      vi.doUnmock('electron')
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('una hidratación tardía no revierte el último movimiento', () => {
    mount('code')
    key('changes', 'Home')
    act(() => useSettings.setState({ settings: { ...DEFAULT_SETTINGS, summaryCardOrder: { code: ['plan'] } }, loaded: true }))
    expect(ids()).toEqual(['changes', 'project', 'plan', 'background', 'context'])
  })
})
