/**
 * Carrera real vista en la app: la persona sale de la vista del documento (cierre) mientras la vista web de ArtCraft aún carga (hasta 20 s).
 * Al terminar la espera, `open` abría el visor de respaldo con un token ya revocado y quedaba pegado a la derecha mostrando
 * «No se pudo mostrar el documento». Ahora un cierre (o una apertura nueva) invalida la apertura en curso.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  craft: [] as Array<(ok: boolean) => void>,
  calls: [] as string[]
}))

vi.mock('electron', () => ({ app: { getPath: () => '/nonexistent', isPackaged: false }, session: {}, protocol: {} }))
vi.mock('../viewer/scheme', () => ({ installViewerScheme: () => undefined, registerViewerPathValidator: () => undefined }))
vi.mock('../viewer/view', () => ({
  onViewerEvent: () => () => undefined,
  openDoc: (url: string) => state.calls.push(`openDoc:${url.slice(0, 30)}`),
  detach: () => undefined
}))
vi.mock('../office/craft/web-view', () => ({ onWebEvent: () => () => undefined }))
vi.mock('../office/craft/web-open', () => ({
  openInCraftWeb: () => new Promise<boolean>((resolve) => state.craft.push(resolve)),
  panelAttach: () => undefined,
  panelClose: () => state.calls.push('panelClose'),
  useClassicViewer: () => state.calls.push('useClassicViewer')
}))

import { registerTasksViewerHandlers } from './tasks-viewer-handlers'

let dir: string
let handlers: Record<string, (req: unknown, ev?: unknown) => Promise<any> | any>

beforeEach(() => {
  state.craft = []
  state.calls = []
  dir = mkdtempSync(join(tmpdir(), 'lzx-viewer-'))
  writeFileSync(join(dir, 'a.pdf'), Buffer.from('%PDF-1.4\n'))
  handlers = {}
  registerTasksViewerHandlers({
    handle: (channel: string, fn: (req: unknown) => unknown) => {
      handlers[channel] = fn as never
    },
    tasks: { assertInsideApproved: (p: string) => p },
    send: () => undefined,
    getWindow: () => null
  } as never)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const open = () => handlers['tasks:viewer:open']!({ path: join(dir, 'a.pdf'), lang: 'es', theme: 'dark' })

describe('tasks:viewer:open / close', () => {
  it('sin cierre en medio: si ArtCraft no abre, usa el visor de siempre', async () => {
    const p = open()
    await vi.waitFor(() => expect(state.craft.length).toBe(1))
    state.craft[0]!(false)
    expect((await p).ok).toBe(true)
    expect(state.calls.some((c) => c.startsWith('openDoc'))).toBe(true)
  })

  it('un cierre mientras ArtCraft carga: al terminar NO se abre el visor de respaldo', async () => {
    const p = open()
    await vi.waitFor(() => expect(state.craft.length).toBe(1))
    handlers['tasks:viewer:close']!(undefined)
    state.craft[0]!(false)
    expect((await p).ok).toBe(false)
    expect(state.calls.some((c) => c.startsWith('openDoc'))).toBe(false)
  })

  it('un cierre mientras ArtCraft carga y luego abre bien: se vuelve a cerrar', async () => {
    const p = open()
    await vi.waitFor(() => expect(state.craft.length).toBe(1))
    handlers['tasks:viewer:close']!(undefined)
    state.calls.length = 0
    state.craft[0]!(true)
    await p
    expect(state.calls).toEqual(['panelClose'])
  })

  it('una apertura nueva invalida la anterior (la vieja no abre nada)', async () => {
    const first = open()
    await vi.waitFor(() => expect(state.craft.length).toBe(1))
    const second = open()
    await vi.waitFor(() => expect(state.craft.length).toBe(2))
    state.craft[0]!(false)
    expect((await first).ok).toBe(false)
    state.craft[1]!(false)
    expect((await second).ok).toBe(true)
    expect(state.calls.filter((c) => c.startsWith('openDoc')).length).toBe(1)
  })
})
