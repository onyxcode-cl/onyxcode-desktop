import { describe, expect, it, vi } from 'vitest'
import { waitForMacPerms, PERMS_POLL_TRIES, type PermsWaitDeps } from './perms-wait'

function deps(seq: Array<{ accessibility: boolean; screenRecording: boolean } | null>): PermsWaitDeps & { stages: string[] } {
  let i = 0
  const stages: string[] = []
  return {
    stages,
    status: vi.fn(async () => seq[Math.min(i++, seq.length - 1)]),
    request: vi.fn(async () => undefined),
    report: vi.fn(async () => undefined),
    sleep: vi.fn(async () => undefined),
    alive: () => true,
    onStage: (s) => stages.push(s)
  }
}

describe('waitForMacPerms', () => {
  it('termina en ready sin pedir nada más si ambos se conceden', async () => {
    const d = deps([
      { accessibility: false, screenRecording: false },
      { accessibility: true, screenRecording: true }
    ])
    expect(await waitForMacPerms(d)).toBe('ready')
    expect(d.stages).toEqual(['pending', 'ready'])
    expect(d.request).not.toHaveBeenCalled()
    expect(d.report).not.toHaveBeenCalled()
  })

  it('al conceder Accesibilidad avisa de inmediato (restart) y abre el panel de Pantalla una sola vez', async () => {
    const d = deps([
      { accessibility: false, screenRecording: false },
      { accessibility: true, screenRecording: false },
      { accessibility: true, screenRecording: false },
      { accessibility: true, screenRecording: true }
    ])
    expect(await waitForMacPerms(d)).toBe('ready')
    expect(d.stages).toEqual(['pending', 'restart', 'ready'])
    expect(d.request).toHaveBeenCalledTimes(1)
  })

  it('tras agotar la espera reporta y devuelve timeout', async () => {
    const d = deps([{ accessibility: true, screenRecording: false }])
    expect(await waitForMacPerms(d)).toBe('timeout')
    expect(d.status).toHaveBeenCalledTimes(PERMS_POLL_TRIES)
    expect(d.report).toHaveBeenCalledTimes(1)
  })

  it('si el componente se desmontó no reporta', async () => {
    const d = deps([{ accessibility: false, screenRecording: false }])
    let n = 0
    d.alive = () => n++ < 2
    expect(await waitForMacPerms(d)).toBe('timeout')
    expect(d.report).not.toHaveBeenCalled()
  })

  it('un estado nulo (fallo de IPC) no rompe la espera', async () => {
    const d = deps([null, { accessibility: true, screenRecording: true }])
    expect(await waitForMacPerms(d)).toBe('ready')
  })
})
