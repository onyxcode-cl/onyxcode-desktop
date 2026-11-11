/** Cableado de las aprobaciones de conectores: diálogo nativo con «No» en el índice 0; datos largos ⇒ solo «No» o abrir la app. */
import { afterEach, describe, expect, it, vi } from 'vitest'

const asked: Array<{ message: string; detail?: string; buttons: string[]; defaultIndex?: number; cancelIndex?: number }> = []
let answer = 0
vi.mock('electron', () => ({
  Notification: class {
    static isSupported(): boolean {
      return false
    }
    on(): void {}
    show(): void {}
  }
}))
vi.mock('@shared/i18n', () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k} ${JSON.stringify(p)}` : k) }))
vi.mock('../util/native-dialog', () => ({
  askButtons: vi.fn(async (d: (typeof asked)[number]) => {
    asked.push(d)
    return answer
  })
}))

import { pendingConnectorApprovals, requestConnectorApproval } from '../tasks/connector-approvals'
import { registerTasksConnectorHandlers } from './tasks-connector-handlers'
import type { TasksIpcContext } from './tasks-handle'

function setup(visible: boolean) {
  const handlers = new Map<string, (req: unknown) => unknown>()
  const sent: Array<[string, unknown]> = []
  const win = {
    isDestroyed: () => false,
    isVisible: () => visible,
    isMinimized: () => false,
    isFocused: () => visible,
    restore: () => undefined,
    show: () => undefined,
    focus: () => undefined
  }
  const ctx = {
    handle: (ch: string, fn: (req: unknown) => unknown) => handlers.set(ch, fn),
    send: (ch: string, p: unknown) => sent.push([ch, p]),
    getWindow: () => win
  } as unknown as TasksIpcContext
  return { handlers, sent, mod: registerTasksConnectorHandlers(ctx) }
}
const input = { folder: '/Users/ana/p', server: 'gmail', tool: 'send', args: '{\n  "to": "a"\n}' }

let dispose: (() => void | Promise<void>) | undefined
afterEach(async () => {
  await dispose?.()
  asked.length = 0
})

describe('tasks-connector-handlers', () => {
  it('sin ventana: «No» por defecto; con datos cortos se puede permitir una vez', async () => {
    const { mod } = setup(false)
    dispose = mod.dispose
    answer = 0
    await expect(requestConnectorApproval(input)).resolves.toBe('deny')
    expect(asked[0]).toMatchObject({ buttons: ['merr.dialog.no', 'merr.hostExec.allowOnce'], defaultIndex: 0, cancelIndex: 0 })
    answer = 1
    await expect(requestConnectorApproval(input)).resolves.toBe('allow')
  })

  it('datos largos: el diálogo no ofrece permitir; «abrir la app» deja la tarjeta pendiente', async () => {
    const { handlers, sent, mod } = setup(false)
    dispose = mod.dispose
    answer = 1
    const p = requestConnectorApproval({ ...input, args: 'x'.repeat(400) })
    await new Promise((r) => setTimeout(r, 0))
    expect(asked[0]!.buttons).toEqual(['merr.dialog.no', 'merr.hostExec.openApp'])
    expect(pendingConnectorApprovals()).toHaveLength(1)
    const req = sent[0]![1] as { id: string }
    handlers.get('tasks:connector:respond')!({ id: req.id, decision: 'task' })
    await expect(p).resolves.toBe('task')
  })
})
