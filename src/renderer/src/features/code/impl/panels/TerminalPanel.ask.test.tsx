// @vitest-environment jsdom
/**
 * «Preguntar a la IA sobre esto» (cabecera de la terminal de Code), la pastilla del compositor y el reparto de la salida de los
 * comandos con ▶ (`deliverCommandOutput`): con la terminal y el almacén simulados. Nada se envía sin que se cumplan las reglas.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  snap: { error: null, exited: null },
  entry: {
    selection: '',
    tail: '',
    getSelectionText: () => h.entry.selection,
    getTailText: vi.fn((n: number) => (void n, h.entry.tail)),
    getSnapshot: () => h.snap,
    subscribe: () => () => undefined,
    attach: vi.fn(),
    refit: vi.fn(),
    term: { focus: vi.fn() }
  },
  run: vi.fn()
}))
vi.mock('./terminalRegistry', () => {
  const snapshot = { tabs: [{ id: 't1', n: 1, title: null }], activeId: 't1' }
  return {
    MAX_TABS: 8,
    getTerminal: () => h.entry,
    getTabs: () => snapshot,
    subscribeTabs: () => () => undefined,
    openTab: vi.fn(),
    closeTab: vi.fn(),
    cycleTab: vi.fn(),
    selectTab: vi.fn(),
    renameTab: vi.fn(),
    restartTerminal: vi.fn(),
    runInTerminal: h.run
  }
})
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import { TerminalPanel } from './TerminalPanel'
import { deliverCommandOutput } from '../ShellRunProvider'
import { TerminalOutputPill } from '../TerminalOutputPill'
import { useCode } from '../store'
import { usePendingTerminalOutput } from '../terminal-output'
import { outputView } from '@shared/terminal-capture'

let host: HTMLDivElement
let root: Root
const pending = (): ReturnType<typeof usePendingTerminalOutput.getState>['byDir'][string] =>
  usePendingTerminalOutput.getState().byDir['/proj']
beforeEach(() => {
  vi.unstubAllGlobals()
  h.entry.selection = ''
  h.entry.tail = ''
  h.entry.getTailText.mockClear()
  usePendingTerminalOutput.getState().clear('/proj')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    disconnect(): void {}
  }
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const askBtn = (): HTMLButtonElement | null => host.querySelector('[data-testid="terminal-ask"]')
function mountPanel(): void {
  act(() => root.render(createElement(TerminalPanel, { directory: '/proj', visible: true })))
}

describe('Preguntar a la IA sobre esto (cabecera de la terminal)', () => {
  it('el botón existe con nombre accesible', () => {
    mountPanel()
    expect(askBtn()?.getAttribute('aria-label')).toBe('Preguntar a la IA sobre esto')
  })

  it('sin selección toma las últimas 60 líneas, quita ANSI y claves, y deja la pastilla SIN enviar', () => {
    h.entry.tail = '\u001b[31mError: fallo\u001b[0m\nexport OPENAI_API_KEY=sk-abcdefghijklmnop1234\nlisto'
    mountPanel()
    act(() => askBtn()?.click())
    expect(h.entry.getTailText).toHaveBeenCalledWith(60)
    const p = pending()
    expect(p?.source).toBe('terminal')
    expect(p?.text.startsWith('Esto salió en la terminal, ¿me ayudas a arreglarlo?\n\n```text\n')).toBe(true)
    expect(p?.text).toContain('OPENAI_API_KEY=…')
    expect(p?.text).not.toContain('sk-abcdefghijklmnop1234')
    expect(p?.text).not.toContain('\u001b')
  })

  it('con selección usa la selección y no el búfer', () => {
    h.entry.selection = 'npm ERR! code E404'
    h.entry.tail = 'otra cosa'
    mountPanel()
    act(() => askBtn()?.click())
    expect(pending()?.text).toContain('npm ERR! code E404')
    expect(pending()?.text).not.toContain('otra cosa')
    expect(h.entry.getTailText).not.toHaveBeenCalled()
  })

  it('terminal vacía: avisa y no adjunta nada', () => {
    mountPanel()
    act(() => askBtn()?.click())
    expect(pending()).toBeUndefined()
    expect(host.textContent).toContain('No hay nada en la terminal para citar todavía.')
  })
})

describe('pastilla del compositor', () => {
  it('muestra «Salida del comando · N líneas · sin claves» y la ✕ la quita', () => {
    const onRemove = vi.fn()
    act(() => root.render(createElement(TerminalOutputPill, { item: { text: 'x', lineCount: 7, source: 'command' }, onRemove })))
    expect(host.textContent).toContain('Salida del comando · 7 líneas · sin claves')
    act(() => (host.querySelector('button[aria-label="Quitar la salida adjunta"]') as HTMLButtonElement).click())
    expect(onRemove).toHaveBeenCalledTimes(1)
  })
})

describe('deliverCommandOutput: envío automático de la salida de un comando con ▶', () => {
  const send = vi.fn(() => Promise.resolve(true))
  const enqueue = vi.fn(() => true)
  const setStore = (over: { active?: string | null; run?: Record<string, string> } = {}): void => {
    send.mockClear()
    enqueue.mockClear()
    useCode.setState({ activeSessionID: over.active === undefined ? 's1' : over.active, runState: over.run ?? {}, send, enqueue } as never)
  }
  const base = (view = outputView('npm test\r\n3 passed')) => ({
    directory: '/proj',
    sessionID: 's1',
    view,
    status: 'done' as const,
    shareOn: true
  })
  const sent = (i = 0): string => (send.mock.calls[i] as unknown as [string])[0]

  it('terminó: un solo mensaje a la MISMA sesión, con la salida en ```text```', () => {
    setStore()
    expect(deliverCommandOutput(base())).toBe('sent')
    expect(send).toHaveBeenCalledTimes(1)
    expect(sent()).toBe('Ejecuté el comando y esto salió:\n\n```text\nnpm test\n3 passed\n```\n')
    expect(pending()).toBeUndefined()
  })

  it('sigue corriendo (servidor): una nota; pide contraseña: solo lo previo con su nota', () => {
    setStore()
    deliverCommandOutput({ ...base(outputView('npm run dev\r\nlisto')), status: 'running' })
    expect(sent()).toContain('sigue en ejecución')
    setStore()
    deliverCommandOutput({ ...base(outputView('sudo ls\r\n[sudo] contraseña para ben:')), status: 'waiting' })
    expect(sent()).toContain('[sudo] contraseña para ben:')
    expect(sent()).toContain('espera que escriba la contraseña')
  })

  it('sesión ocupada: encola UN mensaje (no envía ya)', () => {
    setStore({ run: { s1: 'busy' } })
    expect(deliverCommandOutput(base())).toBe('queued')
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
  })

  it('interruptor apagado: no se envía; queda la pastilla adjunta', () => {
    setStore()
    expect(deliverCommandOutput({ ...base(), shareOn: false })).toBe('attached')
    expect(send).not.toHaveBeenCalled()
    expect(pending()?.source).toBe('command')
    expect(pending()?.text).toContain('3 passed')
  })

  it('la persona cambió de sesión: no se manda a otra; queda adjunta', () => {
    setStore({ active: 's2' })
    expect(deliverCommandOutput(base())).toBe('attached')
    expect(send).not.toHaveBeenCalled()
  })

  it('casi todo era un secreto: no se comparte ni se adjunta', () => {
    setStore()
    const key = 'sk-' + 'a1b2c3d4e5f6g7h8i9j0k1l2m3'
    expect(deliverCommandOutput(base(outputView(key)))).toBe('blocked-secret')
    expect(send).not.toHaveBeenCalled()
    expect(pending()).toBeUndefined()
  })

  it('«Enviar ahora» (force) con el interruptor apagado sí envía; salida vacía = nada', () => {
    setStore()
    expect(deliverCommandOutput({ ...base(), shareOn: false, force: true })).toBe('sent')
    expect(deliverCommandOutput(base(outputView('')))).toBe('empty')
  })

  it('no toca el estado de ejecución de la sesión: tras enviar, runState sigue como lo dejó el almacén', () => {
    setStore({ run: { s1: 'idle' } })
    deliverCommandOutput(base())
    expect(useCode.getState().runState.s1).toBe('idle')
  })
})
