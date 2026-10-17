// @vitest-environment jsdom
/**
 * Pestañas de la terminal de Code: registro con VARIAS terminales reales de xterm y un «shell» simulado (eco + salida + prompt).
 * Cubre: un pty por pestaña, la entrada y la salida van solo a la suya, ▶ en la pestaña seleccionada o en una nueva cuando está
 * ocupada, la captura por pestaña sin mezclar salidas, el tope de pestañas y la limpieza (cerrar pestaña, reiniciar, cambiar de
 * proyecto).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakePty {
  id: string
  cwd: string
  written: string[]
  killed: boolean
}
const h = vi.hoisted(() => {
  const state = {
    ptys: [] as Array<{ id: string; cwd: string; written: string[]; killed: boolean }>,
    onData: new Set<(ev: { id: string; data: string }) => void>(),
    onExit: new Set<(ev: { id: string; exitCode: number }) => void>(),
    n: 0
  }
  const emit = (id: string, data: string): void => state.onData.forEach((f) => f({ id, data }))
  const api = {
    onPtyData: (f: (ev: { id: string; data: string }) => void) => {
      state.onData.add(f)
      return () => state.onData.delete(f)
    },
    onPtyExit: (f: (ev: { id: string; exitCode: number }) => void) => {
      state.onExit.add(f)
      return () => state.onExit.delete(f)
    },
    pty: {
      create: vi.fn(async (req: { cwd: string }) => {
        const id = `pty-${++state.n}`
        state.ptys.push({ id, cwd: req.cwd, written: [], killed: false })
        // El shell dice su prompt poco después de crearse.
        setTimeout(() => emit(id, `${id} % `), 1)
        return { id, pid: 100 + state.n, cwd: req.cwd }
      }),
      write: vi.fn(async (id: string, data: string) => {
        const p = state.ptys.find((x) => x.id === id)
        p?.written.push(data)
        // Shell simulado: eco del comando, su salida (marcada con el pty) y el prompt de regreso.
        const cmd = data.replace(/\r?\n$/, '')
        // `sleep` no responde nada: simula un comando que sigue en curso.
        if (cmd) {
          const silent = /^(sleep|cmd-)/.test(cmd)
          setTimeout(() => emit(id, silent ? `${cmd}\r\n` : `${cmd}\r\nsalida-de-${id}\r\n${id} % `), 1)
        }
      }),
      resize: vi.fn(async () => undefined),
      kill: vi.fn(async (id: string) => {
        const p = state.ptys.find((x) => x.id === id)
        if (p) p.killed = true
      })
    }
  }
  return { state, emit, api }
})
vi.mock('../client', () => ({ requireCode: () => h.api, errorMessage: (e: unknown) => String(e) }))

import { useCode } from '../store'
import {
  MAX_TABS,
  closeTab,
  cycleTab,
  disposeTerminal,
  disposeTerminalsExcept,
  getTabs,
  getTerminal,
  openTab,
  renameTab,
  restartTerminal,
  runInTerminal,
  selectTab
} from './terminalRegistry'

const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms))
const noShare = (): void => undefined
const live = (): FakePty[] => h.state.ptys.filter((p) => !p.killed)

beforeEach(() => {
  // Algún módulo importado deja un `document` falso con vi.stubGlobal: se restaura el de jsdom.
  vi.unstubAllGlobals()
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }))
})
afterEach(() => {
  disposeTerminalsExcept(null)
  h.state.ptys.length = 0
  h.state.n = 0
  vi.unstubAllGlobals()
})

/** Texto del búfer de la pestaña (lo que ve la persona). */
function screen(dir: string, tabId: string): string {
  const buf = getTerminal(dir, tabId).term.buffer.active
  const lines: string[] = []
  for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? '')
  return lines.join('\n')
}

describe('pestañas: ciclo de vida', () => {
  it('una pestaña inicial; abrir otra crea otro pty y la selecciona', async () => {
    const first = getTerminal('/p')
    await tick()
    expect(getTabs('/p').tabs).toHaveLength(1)
    const second = openTab('/p')
    await tick()
    expect(second).not.toBeNull()
    expect(getTabs('/p').tabs.map((t) => t.n)).toEqual([1, 2])
    expect(getTabs('/p').activeId).toBe(second?.id)
    expect(getTerminal('/p').id).toBe(second?.id)
    expect(live()).toHaveLength(2)
    expect(first.ptyId).not.toBe(second?.ptyId)
  })

  it('cada pestaña recibe solo SU salida y SU entrada', async () => {
    const a = getTerminal('/p')
    const b = openTab('/p')!
    await tick()
    a.sendInput('echo uno\r')
    b.sendInput('echo dos\r')
    await tick(400)
    const pa = h.state.ptys.find((p) => p.id === a.ptyId)!
    const pb = h.state.ptys.find((p) => p.id === b.ptyId)!
    expect(pa.written.join('')).toBe('echo uno\r')
    expect(pb.written.join('')).toBe('echo dos\r')
    expect(screen('/p', a.id)).toContain(`salida-de-${pa.id}`)
    expect(screen('/p', a.id)).not.toContain(`salida-de-${pb.id}`)
    expect(screen('/p', b.id)).toContain(`salida-de-${pb.id}`)
    expect(screen('/p', b.id)).not.toContain(`salida-de-${pa.id}`)
  })

  it('cerrar una pestaña mata SU pty y elige la vecina; la última no se cierra', async () => {
    const a = getTerminal('/p')
    const b = openTab('/p')!
    const c = openTab('/p')!
    await tick()
    selectTab('/p', b.id)
    expect(closeTab('/p', b.id)).toBe(true)
    expect(h.state.ptys.find((p) => p.id === b.ptyId)?.killed).toBe(true)
    expect(live()).toHaveLength(2)
    expect(getTabs('/p').activeId).toBe(c.id)
    expect(closeTab('/p', c.id)).toBe(true)
    expect(getTabs('/p').activeId).toBe(a.id)
    expect(closeTab('/p', a.id)).toBe(false)
    expect(live()).toHaveLength(1)
  })

  it('cerrar una pestaña recién abierta, antes de que su pty exista, no deja huérfano', async () => {
    getTerminal('/p')
    const b = openTab('/p')!
    expect(b.ptyId).toBeNull()
    closeTab('/p', b.id)
    await tick()
    expect(live()).toHaveLength(1)
  })

  it('tope de pestañas: no pasa de MAX_TABS ptys', async () => {
    getTerminal('/p')
    for (let i = 1; i < MAX_TABS; i++) expect(openTab('/p')).not.toBeNull()
    expect(openTab('/p')).toBeNull()
    await tick()
    expect(live()).toHaveLength(MAX_TABS)
  })

  it('ciclar, renombrar (vacío = nombre por defecto) y reiniciar conservan sitio, número y nombre', async () => {
    const a = getTerminal('/p')
    const b = openTab('/p')!
    await tick()
    cycleTab('/p', 1)
    expect(getTabs('/p').activeId).toBe(a.id)
    cycleTab('/p', -1)
    expect(getTabs('/p').activeId).toBe(b.id)
    renameTab('/p', b.id, '  servidor  ')
    expect(getTabs('/p').tabs[1].title).toBe('servidor')
    const oldPty = b.ptyId
    const fresh = restartTerminal('/p', b.id)
    await tick()
    expect(fresh).not.toBe(b)
    expect(fresh.id).toBe(b.id)
    expect(getTabs('/p').tabs.map((t) => [t.id, t.n, t.title])).toEqual([
      [a.id, 1, null],
      [b.id, 2, 'servidor']
    ])
    expect(h.state.ptys.find((p) => p.id === oldPty)?.killed).toBe(true)
    expect(fresh.ptyId).not.toBe(oldPty)
    renameTab('/p', b.id, '   ')
    expect(getTabs('/p').tabs[1].title).toBeNull()
  })

  it('descartar el proyecto mata todos sus ptys y no toca los de otro', async () => {
    getTerminal('/p')
    openTab('/p')
    getTerminal('/q')
    await tick()
    expect(live()).toHaveLength(3)
    disposeTerminal('/p')
    expect(live().map((p) => p.cwd)).toEqual(['/q'])
    disposeTerminalsExcept('/otro')
    expect(live()).toHaveLength(0)
  })

  it('cambiar de proyecto en el almacén de Code descarta las pestañas del anterior', async () => {
    useCode.setState({ directory: '/p' } as never)
    getTerminal('/p')
    openTab('/p')
    await tick()
    useCode.setState({ directory: '/q' } as never)
    expect(live()).toHaveLength(0)
    useCode.setState({ directory: null } as never)
  })
})

describe('▶ Ejecutar con pestañas', () => {
  it('corre en la pestaña seleccionada y devuelve su id', async () => {
    const a = getTerminal('/p')
    openTab('/p')
    selectTab('/p', a.id)
    await tick(100)
    const r = runInTerminal('/p', 'echo hola\r', 'echo hola', noShare)
    expect(r?.tabId).toBe(a.id)
    await tick(400)
    expect(h.state.ptys.find((p) => p.id === a.ptyId)?.written.join('')).toContain('echo hola')
    const other = getTabs('/p').tabs.find((t) => t.id !== a.id)!
    expect(h.state.ptys.find((p) => p.id === getTerminal('/p', other.id).ptyId)?.written.join('')).toBe('')
  })

  it('ocupada: devuelve null y no escribe; con newTab corre en una pestaña nueva sin mezclar la salida', async () => {
    const a = getTerminal('/p')
    await tick(100)
    const first = runInTerminal('/p', 'sleep 1\r', 'sleep 1', noShare)!
    expect(first.tabId).toBe(a.id)
    // Mientras la primera sigue en curso (sin prompt de regreso aún), otra ejecución en la misma pestaña se rechaza.
    expect(a.isBusy()).toBe(true)
    const rejected = runInTerminal('/p', 'echo x\r', 'echo x', noShare)
    expect(rejected).toBeNull()
    expect(h.state.ptys.find((p) => p.id === a.ptyId)?.written.join('')).toBe('sleep 1\r')

    const second = runInTerminal('/p', 'echo dos\r', 'echo dos', noShare, { newTab: true })!
    expect(second.tabId).not.toBe(a.id)
    expect(getTabs('/p').activeId).toBe(second.tabId)
    await tick(500)
    const pa = h.state.ptys.find((p) => p.id === a.ptyId)!
    const pb = h.state.ptys.find((p) => p.id === getTerminal('/p', second.tabId).ptyId)!
    // Cada captura ve solo la salida de SU pestaña.
    h.emit(pa.id, 'sigue-en-A\r\n')
    await tick(100)
    const t1 = first.capture.getSnapshot().view.text
    const t2 = second.capture.getSnapshot().view.text
    expect(t1).toContain('sigue-en-A')
    expect(t1).not.toContain(`salida-de-${pb.id}`)
    expect(t2).toContain(`salida-de-${pb.id}`)
    expect(t2).not.toContain('sigue-en-A')
  })

  it('dos comandos a la vez en dos pestañas no se mezclan (salida intercalada)', async () => {
    const a = getTerminal('/p')
    await tick(100)
    const first = runInTerminal('/p', 'cmd-a\r', 'cmd-a', noShare)!
    const second = runInTerminal('/p', 'cmd-b\r', 'cmd-b', noShare, { newTab: true })!
    const b = getTerminal('/p', second.tabId)
    // Se espera a que la pestaña nueva suelte su entrada (su shell dio el primer aviso) y se vea el eco de cada comando.
    await tick(300)
    // Salida llegando a trozos y alternada entre los dos ptys.
    for (let i = 0; i < 5; i++) {
      h.emit(a.ptyId!, `A${i}\r\n`)
      h.emit(b.ptyId!, `B${i}\r\n`)
      await tick(5)
    }
    await tick(300)
    const t1 = first.capture.getSnapshot().view.text
    const t2 = second.capture.getSnapshot().view.text
    expect(t1).toMatch(/A0[\s\S]*A4/)
    expect(t1).not.toMatch(/B\d/)
    expect(t2).toMatch(/B0[\s\S]*B4/)
    expect(t2).not.toMatch(/A\d/)
  })

  it('sin pestaña libre y sin cupo (MAX_TABS) con newTab: null y sin ptys de más', async () => {
    getTerminal('/p')
    for (let i = 1; i < MAX_TABS; i++) openTab('/p')
    await tick()
    expect(runInTerminal('/p', 'echo x\r', 'echo x', noShare, { newTab: true })).toBeNull()
    expect(live()).toHaveLength(MAX_TABS)
  })

  it('si el shell de la pestaña seleccionada terminó, la reinicia en su sitio (mismo id) y corre ahí', async () => {
    const a = getTerminal('/p')
    openTab('/p')
    selectTab('/p', a.id)
    await tick(100)
    h.state.onExit.forEach((f) => f({ id: a.ptyId!, exitCode: 0 }))
    expect(a.getSnapshot().exited).toBe(0)
    const r = runInTerminal('/p', 'echo otra-vez\r', 'echo otra-vez', noShare)!
    expect(r.tabId).toBe(a.id)
    expect(getTabs('/p').tabs).toHaveLength(2)
    expect(getTerminal('/p', a.id)).not.toBe(a)
  })
})
