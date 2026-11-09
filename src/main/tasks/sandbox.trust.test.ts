/**
 * Motor `lazunox.16` en Tareas/Overdrive: cada servidor aislado lleva las dos banderas (también el que corre dentro de WSL) y, en cuanto
 * responde, la app le declara SU carpeta como de confianza (la ruta tal como la ve el motor: dentro de la distro en Windows).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rec = vi.hoisted(() => ({
  userData: '',
  declared: [] as Array<{ baseUrl: string; authorization: string; directory: string }>,
  declareResult: 'ok' as 'ok' | 'failed',
  wslEnv: null as Record<string, string> | null,
  hostEnv: null as Record<string, string> | null
}))

vi.mock('electron', () => ({ app: { getPath: () => rec.userData, getAppPath: () => '/fixture/app' } }))
vi.mock('../opencode/server', () => ({ resolveOpencodeAsync: async () => ({ path: '/fixture/bin/opencode' }) }))
vi.mock('../opencode/engine-trust', () => ({
  engineTrust: {
    declareOn: async (conn: { baseUrl: string; authorization: string }, directory: string) => {
      rec.declared.push({ ...conn, directory })
      return rec.declareResult
    }
  }
}))
vi.mock('../util/net', () => ({ getFreePort: async () => 51000, waitForHealth: async () => '9.9.9' }))
vi.mock('../opencode/pids', () => ({ killTree: () => undefined, trackPid: () => undefined, untrackPid: () => undefined }))
vi.mock('./opencode-config', () => ({ getOpencodeEnv: () => ({ OPENCODE_CONFIG_DIR: 'C:\\cfg' }) }))
vi.mock('./backends/spawn', () => ({
  spawnOnHost: (_cmd: string, _args: string[], _cwd: string, env: Record<string, string>) => {
    rec.hostEnv = env
    return Object.assign(new EventEmitter(), { pid: 78, exitCode: null, signalCode: null, stdout: new EventEmitter(), stderr: new EventEmitter() })
  }
}))
vi.mock('./proxy', () => {
  class P {
    port = 1
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
    baseUrl(): string {
      return 'http://127.0.0.1:1'
    }
  }
  return { EgressProxy: P, CredentialProxy: P, randomToken: () => 'tok' }
})

import { startTasksServer } from './sandbox'
import type { SandboxBackend } from './backends/types'
import type { WinBackendProvider } from './backends'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lzx-sandbox-trust-'))
  rec.userData = dir
  rec.declared = []
  rec.declareResult = 'ok'
  rec.wslEnv = null
  rec.hostEnv = null
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const wsl: SandboxBackend = {
  id: 'wsl',
  status: async () => ({ state: 'ready' }),
  launch: async (spec) => {
    rec.wslEnv = { ...spec.baseEnv, ...spec.extraEnv }
    return {
      child: Object.assign(new EventEmitter(), { pid: 77, exitCode: null, signalCode: null, stdout: new EventEmitter(), stderr: new EventEmitter() }) as never,
      mounts: [{ win: 'C:\\lzx\\a', linux: '/win/c/lzx/a' }],
      toHostPath: (p) => p,
      toSandboxPath: () => '/win/c/lzx/a',
      dispose: async () => undefined
    }
  }
}
const provider: WinBackendProvider = { build: true, gate: async () => ({ ok: true }), create: () => wsl }

describe('servidores de Tareas con la confianza obligatoria del motor', () => {
  it('WSL: lleva las dos banderas y declara la carpeta DENTRO de la distro, con la conexión del servidor', async () => {
    const h = await startTasksServer(dir, {
      platform: 'win32',
      tasksWin: true,
      winBackend: provider,
      isolation: { privateDir: join(dir, 'p'), userData: dir }
    })
    expect(rec.wslEnv?.LAZUNOX_TRUST_REQUIRED).toBe('1')
    expect(rec.wslEnv?.LAZUNOX_PERMISOS_CAPAS).toBe('1')
    expect(rec.declared).toHaveLength(1)
    expect(rec.declared[0]).toMatchObject({ baseUrl: 'http://127.0.0.1:51000', directory: '/win/c/lzx/a' })
    expect(rec.declared[0]!.authorization).toMatch(/^Basic /)
    expect(h.paths.directory).toBe('/win/c/lzx/a')
  })

  it('Control total en Windows (sin WSL): lleva las dos banderas y declara la carpeta tal cual', async () => {
    await startTasksServer(dir, {
      platform: 'win32',
      noSandbox: true,
      winFullAccess: true,
      tasksWin: true,
      isElevated: async () => false
    })
    expect(rec.hostEnv?.LAZUNOX_TRUST_REQUIRED).toBe('1')
    expect(rec.hostEnv?.LAZUNOX_PERMISOS_CAPAS).toBe('1')
    expect(rec.declared.map((d) => d.directory)).toEqual([dir])
  })

  it('si no se pudo declarar, el servidor arranca igual (la pantalla verá «sin confianza», no un fallo de arranque)', async () => {
    rec.declareResult = 'failed'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const h = await startTasksServer(dir, { platform: 'win32', noSandbox: true, winFullAccess: true, tasksWin: true, isElevated: async () => false })
    expect(h.baseUrl).toBe('http://127.0.0.1:51000')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('las banderas no las pisa extraEnv de quien llama (van en la base) y extraEnv sigue ganando en lo suyo', async () => {
    await startTasksServer(dir, {
      platform: 'win32',
      tasksWin: true,
      winBackend: provider,
      isolation: { privateDir: join(dir, 'p'), userData: dir },
      extraEnv: { OPENCODE_CONFIG_CONTENT: '{}' }
    })
    expect(rec.wslEnv?.OPENCODE_CONFIG_CONTENT).toBe('{}')
    expect(rec.wslEnv?.LAZUNOX_TRUST_REQUIRED).toBe('1')
  })
})
