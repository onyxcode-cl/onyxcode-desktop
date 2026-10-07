/**
 * A18 en `startTasksServer` con la plataforma inyectada (macOS, sin Electron real): en win32 no se lanza NINGÚN proceso sin
 * aislamiento. `noSandbox` lanza, sin bandera o sin proveedor lanza, con la distro no lista lanza `TasksSandboxNotReady`, y
 * el backend `none` jamás llega a `launch`. Con todo listo, `paths` lleva los montajes de la distro.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rec = vi.hoisted(() => ({ launches: 0, proxies: 0, userData: '' }))

vi.mock('electron', () => ({ app: { getPath: () => rec.userData, getAppPath: () => '/fixture/app' } }))
vi.mock('../opencode/server', () => ({ resolveOpencodeAsync: async () => ({ path: '/fixture/bin/opencode' }) }))
vi.mock('../util/net', () => ({ getFreePort: async () => 51000, waitForHealth: async () => '9.9.9' }))
vi.mock('../opencode/pids', () => ({ killTree: () => undefined, trackPid: () => undefined, untrackPid: () => undefined }))
vi.mock('./opencode-config', () => ({ getOpencodeEnv: () => ({ OPENCODE_CONFIG_DIR: 'C:\\cfg' }) }))
vi.mock('./proxy', () => {
  class P {
    port = 1
    constructor() {
      rec.proxies++
    }
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
    baseUrl(): string {
      return 'http://127.0.0.1:1'
    }
  }
  return { EgressProxy: P, CredentialProxy: P, randomToken: () => 'tok' }
})

import { startTasksServer } from './sandbox'
import { TasksSandboxNotReady, WinBackendUnavailable, type WinBackendProvider } from './backends'
import type { SandboxBackend, SandboxState } from './backends/types'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lzx-sandbox-win-'))
  rec.userData = dir
  rec.launches = 0
  rec.proxies = 0
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function wslBackend(state: SandboxState): SandboxBackend {
  return {
    id: 'wsl',
    status: async () => ({ state }),
    launch: async () => {
      rec.launches++
      const child = Object.assign(new EventEmitter(), {
        pid: 77,
        exitCode: null,
        signalCode: null,
        stdout: new EventEmitter(),
        stderr: new EventEmitter()
      })
      return {
        child: child as never,
        mounts: [{ win: 'C:\\lzx\\a', linux: '/win/c/lzx/a' }],
        toHostPath: (p) => p,
        toSandboxPath: () => '/win/c/lzx/a',
        dispose: async () => undefined
      }
    }
  }
}
const provider = (b: SandboxBackend, over: Partial<WinBackendProvider> = {}): WinBackendProvider => ({
  build: true,
  gate: async () => ({ ok: true }),
  create: () => b,
  ...over
})
const iso = () => ({ privateDir: join(dir, 'p'), userData: dir })

describe('startTasksServer en win32 (A18)', () => {
  it('noSandbox lanza antes de resolver nada ni lanzar procesos', async () => {
    await expect(
      startTasksServer(dir, {
        platform: 'win32',
        noSandbox: true,
        tasksWin: true,
        winBackend: provider(wslBackend('ready')),
        isolation: iso()
      })
    ).rejects.toThrow()
    expect(rec.launches).toBe(0)
  })
  it('sin la bandera o sin proveedor lanza WinBackendUnavailable y no abre proxies ni procesos', async () => {
    await expect(startTasksServer(dir, { platform: 'win32', isolation: iso() })).rejects.toBeInstanceOf(WinBackendUnavailable)
    await expect(
      startTasksServer(dir, { platform: 'win32', tasksWin: false, winBackend: provider(wslBackend('ready')), isolation: iso() })
    ).rejects.toBeInstanceOf(WinBackendUnavailable)
    await expect(startTasksServer(dir, { platform: 'win32', tasksWin: true, isolation: iso() })).rejects.toBeInstanceOf(
      WinBackendUnavailable
    )
    expect(rec.launches).toBe(0)
    expect(rec.proxies).toBe(0)
  })
  it.each<SandboxState>(['needsSetup', 'needsWsl', 'needsWsl2', 'needsVirtualization', 'policyDisabled', 'unsupported', 'broken'])(
    'distro en estado %s: TasksSandboxNotReady, sin proxies ni procesos',
    async (state) => {
      const err = await startTasksServer(dir, {
        platform: 'win32',
        tasksWin: true,
        winBackend: provider(wslBackend(state)),
        isolation: iso()
      }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(TasksSandboxNotReady)
      expect((err as TasksSandboxNotReady).state).toBe(state)
      expect(rec.launches).toBe(0)
      expect(rec.proxies).toBe(0)
    }
  )
  it('con la puerta de integridad cerrada (p. ej. elevado) no arranca nada; reabierta, sí (se consulta en cada arranque)', async () => {
    let open = true
    const win = provider(wslBackend('ready'), {
      gate: async () => (open ? { ok: true } : { ok: false, reason: 'elevated' })
    })
    const run = (): Promise<unknown> => startTasksServer(dir, { platform: 'win32', tasksWin: true, winBackend: win, isolation: iso() })
    await run()
    expect(rec.launches).toBe(1)
    open = false
    const err = await run().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(WinBackendUnavailable)
    expect((err as WinBackendUnavailable).block).toBe('elevated')
    expect(rec.launches).toBe(1)
    open = true
    await run()
    expect(rec.launches).toBe(2)
  })
  it('con la puerta abierta pero la distro sin `ready` NO arranca (la puerta no sustituye al estado)', async () => {
    const win = provider(wslBackend('needsSetup'), { gate: async () => ({ ok: true }) })
    await expect(startTasksServer(dir, { platform: 'win32', tasksWin: true, winBackend: win, isolation: iso() })).rejects.toBeInstanceOf(
      TasksSandboxNotReady
    )
    expect(rec.launches).toBe(0)
  })
  it('un backend `none` en win32 nunca llega a launch', async () => {
    let launched = false
    const none = {
      id: 'none',
      status: async () => ({ state: 'unsupported' }),
      launch: async () => ((launched = true), {})
    } as unknown as SandboxBackend
    await expect(
      startTasksServer(dir, { platform: 'win32', tasksWin: true, winBackend: provider(none), isolation: iso() })
    ).rejects.toBeInstanceOf(WinBackendUnavailable)
    expect(launched).toBe(false)
  })
  it('con todo listo arranca sandboxeado y `paths` lleva los montajes y la carpeta dentro de la distro', async () => {
    const h = await startTasksServer(dir, {
      platform: 'win32',
      tasksWin: true,
      winBackend: provider(wslBackend('ready')),
      isolation: iso()
    })
    expect(existsSync(dir)).toBe(true)
    expect(h.sandboxed).toBe(true)
    expect(h.paths).toEqual({ map: { kind: 'wsl', mounts: [{ win: 'C:\\lzx\\a', linux: '/win/c/lzx/a' }] }, directory: '/win/c/lzx/a' })
    expect(rec.launches).toBe(1)
  })
})
