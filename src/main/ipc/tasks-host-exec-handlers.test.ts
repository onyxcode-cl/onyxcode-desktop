/** Cableado de las aprobaciones de `equipo`: sin ventana visible, diálogo nativo con «No» en el índice 0 (por defecto y al cancelar). */
import { afterEach, describe, expect, it, vi } from 'vitest'

const asked: Array<{
  message: string
  detail?: string
  buttons: string[]
  defaultIndex?: number
  cancelIndex?: number
  giveUpSeconds?: number
  signal?: AbortSignal
}> = []
let answer = 0
/** Si es true, el diálogo simulado no responde hasta que lo cierren (señal). */
let hang = false
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
    if (hang)
      return new Promise<number>((resolve) => d.signal?.addEventListener('abort', () => resolve(d.cancelIndex ?? 0), { once: true }))
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
        ? {
            isDestroyed: () => false,
            isVisible: () => win.visible,
            isMinimized: () => win.minimized,
            isFocused: () => win.visible,
            restore: () => undefined,
            show: () => undefined,
            focus: () => undefined
          }
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
  hang = false
})

describe('tasks-host-exec-handlers', () => {
  it('ventana minimizada: el diálogo nativo NUNCA aprueba; «No» deniega y «abrir la app» deja la tarjeta pendiente', async () => {
    const { sent, handlers, mod } = setup({ visible: true, minimized: true })
    dispose = mod.dispose
    answer = 0
    await expect(requestHostApproval(input)).resolves.toBe('deny')
    expect(asked[0]).toMatchObject({ buttons: ['merr.dialog.no', 'merr.hostExec.openApp'], defaultIndex: 0, cancelIndex: 0 })
    expect(asked[0]!.buttons).not.toContain('merr.hostExec.allowOnce')
    expect(asked[0]!.detail?.split('\n')[0]).toBe(input.command)
    expect(sent.map(([ch]) => ch)).toEqual(['tasks:hostExec:approval', 'tasks:hostExec:approvalDone'])
    // Elegir el segundo botón (un clic reflejo para quitar el diálogo) no ejecuta nada: solo abre la app; decide la tarjeta.
    answer = 1
    const p = requestHostApproval(input)
    await new Promise((r) => setTimeout(r, 0))
    const req = sent.filter(([ch]) => ch === 'tasks:hostExec:approval').at(-1)![1] as { id: string }
    expect(pendingHostApprovals().map((r) => r.id)).toContain(req.id)
    handlers.get('tasks:hostExec:respond')!({ id: req.id, decision: 'deny' })
    await expect(p).resolves.toBe('deny')
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

  it('(C2) el diálogo nativo usa el tiempo que queda y se cierra solo al resolverse la petición desde la tarjeta', async () => {
    const { handlers, sent, mod } = setup({ visible: false, minimized: false })
    dispose = mod.dispose
    hang = true
    const p = requestHostApproval(input, { timeoutMs: 120_000 })
    await new Promise((r) => setTimeout(r, 0))
    expect(asked[0]!.giveUpSeconds).toBeGreaterThan(100)
    expect(asked[0]!.giveUpSeconds).toBeLessThanOrEqual(120)
    expect(asked[0]!.signal?.aborted).toBe(false)
    const req = sent[0]![1] as { id: string }
    handlers.get('tasks:hostExec:respond')!({ id: req.id, decision: 'deny' })
    await expect(p).resolves.toBe('deny')
    expect(asked[0]!.signal?.aborted).toBe(true)
  })

  it('(C2) también se cierra al vencer', async () => {
    const { mod } = setup({ visible: false, minimized: false })
    dispose = mod.dispose
    hang = true
    await expect(requestHostApproval(input, { timeoutMs: 30 })).resolves.toBe('no-answer')
    expect(asked[0]!.signal?.aborted).toBe(true)
  })

  it('(C2) un comando de más de 3 líneas o 300 caracteres NO se puede permitir en el diálogo: solo «No» o abrir la app', async () => {
    const { sent, handlers, mod } = setup({ visible: false, minimized: false })
    dispose = mod.dispose
    for (const command of ['a\nb\nc\nd', `echo ${'x'.repeat(300)}`]) {
      answer = 1 // «Abrir Lazunox»: no decide, sigue pendiente
      asked.length = 0
      const p = requestHostApproval({ ...input, command })
      await new Promise((r) => setTimeout(r, 0))
      expect(asked[0]!.buttons).toEqual(['merr.dialog.no', 'merr.hostExec.openApp'])
      expect(asked[0]!.detail).not.toContain(command)
      expect(asked[0]!.message).toBe('merr.hostExec.dialogLong')
      const req = sent.filter(([ch]) => ch === 'tasks:hostExec:approval').at(-1)![1] as { id: string }
      expect(pendingHostApprovals().map((r) => r.id)).toContain(req.id)
      handlers.get('tasks:hostExec:respond')!({ id: req.id, decision: 'deny' })
      await expect(p).resolves.toBe('deny')
    }
    answer = 0
    asked.length = 0
    await expect(requestHostApproval({ ...input, command: 'a\nb\nc\nd' })).resolves.toBe('deny')
  })

  it('al cerrar el módulo, lo pendiente se cierra sin ejecutar', async () => {
    const { mod } = setup({ visible: true, minimized: false })
    const p = requestHostApproval(input)
    await mod.dispose?.()
    dispose = undefined
    await expect(p).resolves.toBe('no-answer')
  })
})
