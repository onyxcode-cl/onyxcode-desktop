/** Estado e instalación del entorno aislado para la interfaz (`TasksSandboxService`), con backend doble y reloj manual. */
import { describe, expect, it, vi } from 'vitest'
import type { TasksSandboxStatus } from '@shared/ipc-tasks'
import { WinBackendUnavailable } from './backends'
import type { SandboxBackend, SandboxSetupOptions, SandboxState } from './backends/types'
import { SANDBOX_STATUS_TTL_MS, TasksSandboxService } from './sandbox-service'

function backend(initial: { state: SandboxState; detail?: string }, setup?: SandboxBackend['setup']) {
  const cur = { ...initial }
  let calls = 0
  const b: SandboxBackend = {
    id: 'wsl',
    status: async () => {
      calls++
      return { ...cur }
    },
    launch: async () => {
      throw new Error('no')
    },
    ...(setup ? { setup } : {})
  }
  return { b, cur, calls: () => calls }
}

function make(over: Partial<ConstructorParameters<typeof TasksSandboxService>[0]> = {}) {
  let now = 1_000
  const emitted: TasksSandboxStatus[] = []
  const svc = new TasksSandboxService({
    platform: 'win32',
    tasksWin: true,
    emit: (s) => emitted.push(s),
    now: () => now,
    ...over
  })
  return { svc, emitted, advance: (ms: number) => void (now += ms) }
}

describe('estado', () => {
  it('macOS: ready con sandbox-exec, unsupported sin él', async () => {
    expect(await make({ platform: 'darwin', seatbeltReady: () => true }).svc.status()).toEqual({
      backend: 'seatbelt',
      state: 'ready',
      setup: null
    })
    expect(await make({ platform: 'darwin', seatbeltReady: () => false }).svc.status()).toMatchObject({
      backend: 'none',
      state: 'unsupported'
    })
  })
  it('otras plataformas: ninguno', async () => {
    expect(await make({ platform: 'linux' }).svc.status()).toMatchObject({ backend: 'none', state: 'unsupported' })
  })
  it('Windows sin bandera: unsupported/flag, y NO pide el backend', async () => {
    const getBackend = vi.fn()
    const s = await make({ tasksWin: false, getBackend }).svc.status()
    expect(s).toMatchObject({ backend: 'wsl', state: 'unsupported', detail: 'flag' })
    expect(getBackend).not.toHaveBeenCalled()
  })
  it('Windows con las puertas cerradas (elevado, paquete, puerta…): unsupported con el motivo, nunca ready', async () => {
    for (const block of ['build', 'provider', 'elevated', 'bundle', 'gate', 'backend'] as const) {
      const s = await make({
        getBackend: async () => {
          throw new WinBackendUnavailable(block)
        }
      }).svc.status()
      expect(s).toMatchObject({ backend: 'wsl', state: 'unsupported', detail: block })
    }
  })
  it('refleja el estado de la distro, con su detalle', async () => {
    const { b, cur } = backend({ state: 'needsSetup' })
    const { svc } = make({ getBackend: async () => b })
    expect(await svc.status()).toMatchObject({ backend: 'wsl', state: 'needsSetup', setup: null })
    cur.state = 'broken'
    cur.detail = 'interop'
    expect(await svc.status({ force: true })).toMatchObject({ state: 'broken', detail: 'interop' })
  })
  it('si preguntar falla por otra causa: broken/status (cierra)', async () => {
    const b = { id: 'wsl', status: async () => Promise.reject(new Error('x')) } as unknown as SandboxBackend
    expect(await make({ getBackend: async () => b }).svc.status()).toMatchObject({ state: 'broken', detail: 'status' })
  })
  it('caché de 5 s (el sondeo arranca la distro) y `force` la salta', async () => {
    const { b, calls } = backend({ state: 'ready' })
    const { svc, advance } = make({ getBackend: async () => b })
    await svc.status()
    await svc.status()
    expect(calls()).toBe(1)
    advance(SANDBOX_STATUS_TTL_MS + 1)
    await svc.status()
    expect(calls()).toBe(2)
    await svc.status({ force: true })
    expect(calls()).toBe(3)
  })
  it('llamadas simultáneas comparten una sola pregunta', async () => {
    const { b, calls } = backend({ state: 'ready' })
    const { svc } = make({ getBackend: async () => b })
    await Promise.all([svc.status(), svc.status(), svc.status()])
    expect(calls()).toBe(1)
  })
  it('un cierre de hoy no se recuerda: si mañana el backend abre, se ve', async () => {
    let open = false
    const { b } = backend({ state: 'ready' })
    const { svc } = make({
      getBackend: async () => {
        if (!open) throw new WinBackendUnavailable('gate')
        return b
      }
    })
    expect((await svc.status()).state).toBe('unsupported')
    open = true
    expect((await svc.status({ force: true })).state).toBe('ready')
  })
})

describe('instalación', () => {
  it('needsSetup: instala una vez, emite el avance y termina en ready', async () => {
    const seen: Array<{ kind?: string; aborted: boolean | undefined }> = []
    const bk = backend({ state: 'needsSetup' }, async (onProgress, opts?: SandboxSetupOptions) => {
      seen.push({ kind: opts?.kind, aborted: opts?.signal?.aborted })
      onProgress(10, 'download')
      onProgress(150, 'import')
      bk.cur.state = 'ready'
    })
    const { svc, emitted } = make({ getBackend: async () => bk.b })
    const first = await svc.setup()
    expect(first.setup).toMatchObject({ running: true })
    await svc.idle()
    expect(seen).toEqual([{ kind: 'install', aborted: false }])
    expect(emitted.some((e) => e.setup?.running && e.setup.pct === 10 && e.setup.phase === 'download')).toBe(true)
    expect(emitted.some((e) => e.setup?.running && e.setup.pct === 100)).toBe(true) // acotado a 0–100
    expect(emitted.at(-1)).toMatchObject({ state: 'ready', setup: null })
  })
  it('una segunda petición mientras corre NO lanza otra instalación', async () => {
    let release!: () => void
    let runs = 0
    const bk = backend({ state: 'needsSetup' }, async () => {
      runs++
      await new Promise<void>((r) => (release = r))
      bk.cur.state = 'ready'
    })
    const { svc } = make({ getBackend: async () => bk.b })
    await svc.setup()
    const again = await svc.setup()
    expect(again.setup?.running).toBe(true)
    release()
    await svc.idle()
    expect(runs).toBe(1)
  })
  it('actualización de imagen y reparación de la carga usan su `kind`', async () => {
    const kinds: string[] = []
    const mk = (state: SandboxState, detail: string) =>
      backend({ state, detail }, async (_p, o) => {
        kinds.push(o?.kind ?? '?')
      })
    for (const [state, detail] of [
      ['needsSetup', 'update:rootfs'],
      ['broken', 'payload']
    ] as const) {
      const bk = mk(state, detail)
      const { svc } = make({ getBackend: async () => bk.b })
      await svc.setup()
      await svc.idle()
    }
    expect(kinds).toEqual(['update', 'repair'])
  })
  it('solo instala cuando hace falta: ready, WSL ausente, política, roto por otra causa o sin bandera no lanzan nada', async () => {
    for (const [state, detail] of [
      ['ready', undefined],
      ['needsWsl', undefined],
      ['needsWsl2', 'kernel'],
      ['needsVirtualization', undefined],
      ['policyDisabled', undefined],
      ['unsupported', undefined],
      ['broken', 'interop'],
      ['broken', 'landlock:1'],
      ['broken', 'foreign']
    ] as const) {
      const setup = vi.fn(async () => undefined)
      const bk = backend({ state, ...(detail ? { detail } : {}) }, setup)
      const { svc } = make({ getBackend: async () => bk.b })
      const s = await svc.setup()
      await svc.idle()
      expect(setup, `${state}/${detail}`).not.toHaveBeenCalled()
      expect(s.setup).toBeNull()
    }
    const setup = vi.fn(async () => undefined)
    const closed = make({ tasksWin: false, getBackend: async () => backend({ state: 'needsSetup' }, setup).b })
    await closed.svc.setup()
    expect(setup).not.toHaveBeenCalled()
  })
  it('un fallo sale como CÓDIGO (sin texto técnico) y se puede reintentar', async () => {
    let n = 0
    const bk = backend({ state: 'needsSetup' }, async () => {
      if (n++ === 0) throw Object.assign(new Error('offline: C:\\Users\\Ben\\secreto'), { code: 'offline' })
      bk.cur.state = 'ready'
    })
    const { svc, emitted } = make({ getBackend: async () => bk.b })
    await svc.setup()
    await svc.idle()
    const failed = await svc.status()
    expect(failed).toMatchObject({ state: 'needsSetup', setup: { running: false, error: 'offline' } })
    expect(JSON.stringify(emitted)).not.toContain('secreto')
    await svc.setup()
    await svc.idle()
    expect(await svc.status({ force: true })).toMatchObject({ state: 'ready', setup: null })
  })
  it('un error sin código conocido sale como `unknown`', async () => {
    const bk = backend({ state: 'needsSetup' }, async () => {
      throw new Error('x')
    })
    const { svc } = make({ getBackend: async () => bk.b })
    await svc.setup()
    await svc.idle()
    expect((await svc.status()).setup?.error).toBe('unknown')
  })
  it('cancelar aborta la señal y no deja un error pegado', async () => {
    let signal: AbortSignal | undefined
    const bk = backend({ state: 'needsSetup' }, async (_p, o) => {
      signal = o?.signal
      await new Promise<void>((_r, rej) =>
        o?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('cancelled'), { code: 'cancelled' })))
      )
    })
    const { svc } = make({ getBackend: async () => bk.b })
    await svc.setup()
    await svc.cancel()
    await svc.idle()
    expect(signal?.aborted).toBe(true)
    expect((await svc.status()).setup).toBeNull()
  })
  it('cancel() sin nada en marcha no hace nada', async () => {
    const bk = backend({ state: 'ready' })
    const { svc } = make({ getBackend: async () => bk.b })
    expect((await svc.cancel()).state).toBe('ready')
  })
})
