// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HelpersBoard } from './HelpersBoard'
import type { HelperBoard, HelperRow } from './helpers-board'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const row = (over: Partial<HelperRow> = {}): HelperRow => ({
  id: 'c1',
  title: 'Revisar pruebas',
  agent: 'explore',
  state: 'working',
  live: true,
  background: true,
  model: 'p/m1',
  tokens: { total: 1500, input: 1000, output: 500 },
  cost: null,
  startedAt: 0,
  endedAt: null,
  elapsedMs: 65_000,
  ...over
})
const board = (rows: HelperRow[], over: Partial<HelperBoard> = {}): HelperBoard => ({
  rows,
  liveCount: rows.filter((r) => r.live).length,
  totalTokens: 1500,
  unknownTokens: 0,
  totalCost: null,
  ...over
})

let host: HTMLDivElement
let root: Root
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
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
const mount = (b: HelperBoard, p: Partial<Parameters<typeof HelpersBoard>[0]> = {}): void =>
  act(() =>
    root.render(
      createElement(HelpersBoard, {
        board: b,
        canAct: true,
        onStop: () => undefined,
        onStopAll: () => undefined,
        onLoadConversation: async () => [],
        ...p
      })
    )
  )
const byLabel = (re: RegExp): HTMLButtonElement | undefined =>
  [...host.querySelectorAll('button')].find((b) => re.test(b.getAttribute('aria-label') ?? b.textContent ?? ''))

describe('HelpersBoard', () => {
  it('sin ayudantes no pinta nada', () => {
    mount(board([]))
    expect(host.innerHTML).toBe('')
  })

  it('muestra estado, modelo, tokens y tiempo de cada ayudante', () => {
    mount(
      board([row(), row({ id: 'c2', title: 'Buscar usos', state: 'waiting', model: null, tokens: null, elapsedMs: 9000 })], {
        totalTokens: 1500,
        unknownTokens: 1
      })
    )
    const t = host.textContent ?? ''
    expect(host.querySelector('section')?.getAttribute('aria-label')).toBe('Ayudantes')
    expect(t).toContain('Revisar pruebas')
    expect(t).toContain('Trabajando')
    expect(t).toContain('Espera tu permiso')
    expect(t).toContain('Modelo: p/m1')
    expect(t).toContain('Modelo: sin dato')
    expect(t).toContain('Tokens: sin dato')
    expect(t).toContain('1 min 05 s')
    expect(host.querySelector('[data-testid=helpers-totals]')?.textContent).toContain('1 ayudante sin dato')
  })

  it('sin ninguna cifra de tokens dice «sin dato» y no inventa una suma', () => {
    mount(board([row({ tokens: null })], { totalTokens: null, unknownTokens: 1 }))
    expect(host.querySelector('[data-testid=helpers-totals]')?.textContent).toBe('Tokens: sin dato')
  })

  it('muestra el costo solo cuando existe', () => {
    mount(board([row({ cost: 0.1234 })]))
    expect(host.textContent).toMatch(/Costo/)
    mount(board([row({ cost: null })]))
    expect(host.textContent).not.toMatch(/Costo/)
  })

  it('Detener llama a onStop con el id; si rechaza avisa en la fila', async () => {
    const onStop = vi.fn().mockRejectedValue(new Error('x'))
    mount(board([row()]), { onStop })
    await act(async () => byLabel(/Detener «Revisar pruebas»/)!.click())
    await flush()
    expect(onStop).toHaveBeenCalledWith('c1')
    expect(host.querySelector('[role=alert]')?.textContent).toBe('No se pudo detener.')
  })

  it('Detener todos solo aparece con ayudantes vivos y avisa si falla', async () => {
    const onStopAll = vi.fn().mockRejectedValue(new Error('x'))
    mount(board([row({ state: 'done', live: false })]), { onStopAll })
    expect(byLabel(/Detener todos/)).toBeUndefined()
    mount(board([row()]), { onStopAll })
    await act(async () => byLabel(/Detener todos/)!.click())
    await flush()
    expect(onStopAll).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('No se pudieron detener todos.')
  })

  it('un ayudante terminado no tiene Detener pero sí Ver', () => {
    mount(board([row({ state: 'done', live: false })]))
    expect(byLabel(/Detener «/)).toBeUndefined()
    expect(byLabel(/Ver la conversación/)).toBeDefined()
  })

  it('Ver abre su conversación en solo lectura (sin campo para escribir)', async () => {
    const load = vi.fn().mockResolvedValue([
      { id: 'u', role: 'user', text: 'Busca X', tools: [] },
      { id: 'a', role: 'assistant', text: 'Encontré X', tools: ['grep'] }
    ])
    mount(board([row()]), { onLoadConversation: load })
    await act(async () => byLabel(/Ver la conversación/)!.click())
    await flush()
    expect(load).toHaveBeenCalledWith('c1')
    const t = host.textContent ?? ''
    expect(t).toContain('(solo lectura)')
    expect(t).toContain('Encontré X')
    expect(t).toContain('Herramienta grep')
    expect(host.querySelector('textarea, input')).toBeNull()
  })

  it('si no se puede cargar la conversación lo dice', async () => {
    mount(board([row()]), { onLoadConversation: () => Promise.reject(new Error('x')) })
    await act(async () => byLabel(/Ver la conversación/)!.click())
    await flush()
    expect(host.textContent).toContain('No se pudo cargar la conversación.')
  })

  it('sin permiso para pedir al motor (carpeta sin foco o sin confianza) no ofrece Ver, Detener ni Detener todos', () => {
    mount(board([row()]), { canAct: false })
    expect(byLabel(/Ver la conversación/)).toBeUndefined()
    expect(byLabel(/Detener/)).toBeUndefined()
    expect(host.textContent).toContain('Abre esta carpeta con confianza')
  })

  it('se puede plegar', () => {
    mount(board([row()]))
    act(() => byLabel(/Ocultar el tablero/)!.click())
    expect(host.textContent).not.toContain('Revisar pruebas')
    expect(host.textContent).toContain('Ayudantes')
  })
})
