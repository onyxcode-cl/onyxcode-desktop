/** Cableado de las aprobaciones de `equipo`: sin ventana visible, diálogo nativo con «No» en el índice 0 (por defecto y al cancelar). */
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

import { pendingHostApprovals, requestHostApproval } from '../host-exec/approvals'
import { registerTasksHostExecHandlers } from './tasks-host-exec-handlers'
import type { TasksIpcContext } from './tasks-handle'

function setup(win: { visible: boolean; minimized: boolean } | null) {
  const handlers = new Map<string, (req: unknown) => unknown>()
  const sent: Array<[string, unknown]> = []
  const ctx = {
    handle: (ch: string, fn: (req: unknown) => unknown) => handlers.set(ch, fn),
    send: (ch: string, p: unknown) => sent.push([ch, p]),
    getWindow: () =>
      win
        ? { isDestroyed: () => false, isVisible: () => win.visible, isMinimized: () => win.minimized, isFocused: () => win.visible }
        : null
  } as unknown as TasksIpcContext
  const mod = registerTasksHostExecHandlers(ctx)
  return { handlers, sent, mod }
}

const input = {
  folder: '/Users/ben/p',
  command: 'open "/Users/ben/a b.pdf"',
  reason: 'Abrir el PDF pedido',
  background: false,
  timeoutS: 60
}

let dispose: (() => void | Promise<void>) | undefined
afterEach(async () => {
  await dispose?.()
  asked.length = 0
})

describe('tasks-host-exec-handlers', () => {
  it('ventana minimizada: diálogo nativo con «No» por defecto; cerrarlo o elegir «No» deniega', async () => {
    const { sent, mod } = setup({ visible: true, minimized: true })
    dispose = mod.dispose
    answer = 0
    await expect(requestHostApproval(input)).resolves.toBe('deny')
    expect(asked[0]).toMatchObject({ buttons: ['merr.dialog.no', 'merr.hostExec.allowOnce'], defaultIndex: 0, cancelIndex: 0 })
    expect(asked[0]!.detail?.split('\n')[0]).toBe(input.command)
    expect(sent.map(([ch]) => ch)).toEqual(['tasks:hostExec:approval', 'tasks:hostExec:approvalDone'])
    answer = 1
    await expect(requestHostApproval(input)).resolves.toBe('allow')
  })

  it('ventana visible: tarjeta en el renderer (sin diálogo); responde por IPC y lista lo pendiente', async () => {
    const { handlers, sent, mod } = setup({ visible: true, minimized: false })
    dispose = mod.dispose
    const p = requestHostApproval(input)
    expect(asked).toEqual([])
    const req = sent[0]![1] as { id: string; command: string }
    expect(req.command).toBe(input.command)
    expect((handlers.get('tasks:hostExec:pending')!(undefined) as unknown[]).length).toBe(1)
    handlers.get('tasks:hostExec:respond')!({ id: req.id, decision: 'allow' })
    await expect(p).resolves.toBe('allow')
    expect(pendingHostApprovals()).toEqual([])
  })

  it('al cerrar el módulo, lo pendiente se cierra sin ejecutar', async () => {
    const { mod } = setup({ visible: true, minimized: false })
    const p = requestHostApproval(input)
    await mod.dispose?.()
    dispose = undefined
    await expect(p).resolves.toBe('no-answer')
  })
})
