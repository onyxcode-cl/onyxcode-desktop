/**
 * El motor de Tareas (Seatbelt) y el lanzamiento sin aislamiento reciben el `rg` incluido al principio del PATH (1.8.17), y SOLO ese
 * cambio: el resto del entorno es el de siempre (`sandboxEnv`, proxies, `extraEnv`). `spawnOnHost` se sustituye para capturar el entorno.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ appPath: '/no-existe', env: null as Record<string, string> | null }))

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => state.appPath, getPath: () => '/tmp/ud' } }))
vi.mock('./spawn', () => ({
  spawnOnHost: (_c: string, _a: string[], _f: string, env: Record<string, string>) => {
    state.env = env
    return { pid: 1 }
  }
}))
vi.mock('../models-cache', () => ({ seedModelsCache: () => false }))

import { noneBackend } from './none'
import { seatbeltBackend } from './seatbelt'

const supported = (process.platform === 'darwin' && process.arch === 'arm64') || (process.platform === 'win32' && process.arch === 'x64')
const RG = process.platform === 'win32' ? 'rg.exe' : 'rg'

const spec = (folder: string) =>
  ({
    folder,
    bin: '/x/opencode',
    serveArgs: ['serve'],
    serverPort: 4999,
    // Carpeta privada donde la pone la app (`userData/tasks-sandbox/<clave>`): `launch` comprueba que cuelga de ahí (1.8.18).
    isolation: { privateDir: join(folder, '..', 'ud', 'tasks-sandbox', '0123456789abcdef'), userData: join(folder, '..', 'ud') },
    configDir: join(folder, '..', 'ud', 'opencode-config'),
    allowDelete: false,
    outboundPorts: [],
    baseEnv: { LAZUNOX_TASKS_FOLDER: folder },
    proxyEnv: { HTTP_PROXY: 'http://p:x@127.0.0.1:1' },
    extraEnv: { FOO: 'bar' }
  }) as never

describe('PATH de los motores de Tareas con el rg incluido', () => {
  let app: string
  beforeEach(() => {
    app = mkdtempSync(join(tmpdir(), 'lazunox-rgtasks-'))
    state.appPath = app
    state.env = null
  })
  afterEach(() => rmSync(app, { recursive: true, force: true }))

  const withRg = (): string => {
    const bin = join(app, 'resources', 'ripgrep-bin', 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, RG), '#!/bin/sh\n')
    chmodSync(join(bin, RG), 0o755)
    return bin
  }

  it.skipIf(!supported || process.platform !== 'darwin')(
    'Seatbelt: carpeta de rg primera en el PATH; el resto del entorno no cambia',
    async () => {
      const bin = withRg()
      const folder = join(app, 'tarea')
      mkdirSync(folder, { recursive: true })
      await seatbeltBackend.launch(spec(folder))
      const env = state.env as unknown as Record<string, string>
      expect(env.PATH.split(delimiter)[0]).toBe(bin)
      expect(env.LAZUNOX_SANDBOX).toBe('1')
      expect(env.HTTP_PROXY).toBe('http://p:x@127.0.0.1:1')
      expect(env.FOO).toBe('bar')
      expect(env.LAZUNOX_TASKS_FOLDER).toBe(folder)
    }
  )

  it('Seatbelt sin rg incluido: no se define PATH (lo arma `minimalEnv` como siempre)', async () => {
    if (process.platform !== 'darwin') return
    const folder = join(app, 'tarea')
    mkdirSync(folder, { recursive: true })
    await seatbeltBackend.launch(spec(folder))
    expect((state.env as unknown as Record<string, string>).PATH).toBeUndefined()
  })

  it.skipIf(!supported)('sin aislamiento: carpeta de rg primera en el PATH', async () => {
    const bin = withRg()
    await noneBackend.launch(spec(join(app, 'tarea')))
    expect((state.env as unknown as Record<string, string>).PATH.split(delimiter)[0]).toBe(bin)
  })

  it('sin aislamiento y sin rg incluido: no se define PATH', async () => {
    await noneBackend.launch(spec(join(app, 'tarea')))
    expect((state.env as unknown as Record<string, string>).PATH).toBeUndefined()
  })
})
