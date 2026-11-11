/**
 * Seatbelt REAL + motor real (sin Electron ni red) sobre una carpeta SIN permiso de escritura (revisión 2, 1.8.18): `startTasksServer`
 * (prepare + launch con el lanzador real `lazunox-disclaim` y `sandbox-exec -p`) tiene que arrancar el motor sano, como en 1.8.17, y
 * no crear nada en la carpeta. Se salta sin macOS, sin binario del motor (`OPENCODE_BIN` o resources/opencode-bin/bin/opencode) o sin
 * el lanzador compilado (`npm run build:launcher`). Los permisos se restauran al terminar para poder borrar la carpeta temporal.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { macOnly } from '../../test/platform'

const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('./opencode-config', () => ({
  getOpencodeEnv: () => ({
    OPENCODE_CONFIG_DIR: join(state.userData, 'opencode-config'),
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    XDG_DATA_HOME: join(state.userData, 'opencode-data')
  })
}))
vi.mock('electron', () => ({
  app: { getPath: () => state.userData, getAppPath: () => process.cwd(), isPackaged: false, getVersion: () => '0.0.0' }
}))

import { sandboxKey, startTasksServer, type TasksServerHandle } from './sandbox'

const BIN = process.env.OPENCODE_BIN || resolve(process.cwd(), 'resources/opencode-bin/bin/opencode')
const LAUNCHER = resolve(process.cwd(), 'resources/launcher/bin/lazunox-disclaim')
const READY = macOnly && existsSync(BIN) && existsSync(LAUNCHER) && existsSync('/usr/bin/sandbox-exec')
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

describe.skipIf(!READY || isRoot)('motor real sobre una carpeta de solo lectura (chmod 555)', () => {
  let root: string
  let folder: string
  let handle: TasksServerHandle | null = null
  const prevBin = process.env.OPENCODE_BIN
  const prevDisclaim = process.env.LAZUNOX_NO_DISCLAIM

  beforeAll(() => {
    process.env.OPENCODE_BIN = BIN
    delete process.env.LAZUNOX_NO_DISCLAIM // lanzador real
    root = realpathSync(mkdtempSync(join(tmpdir(), 'lazunox-ro-real-')))
    state.userData = join(root, 'userData')
    mkdirSync(join(state.userData, 'opencode-config'), { recursive: true })
    writeFileSync(join(state.userData, 'opencode-config', '.gitignore'), 'node_modules\n')
    folder = join(root, 'solo-lectura')
    mkdirSync(folder)
    writeFileSync(join(folder, 'hola.txt'), 'hola')
    chmodSync(folder, 0o555)
  })

  afterAll(async () => {
    await handle?.stop().catch(() => undefined)
    try {
      chmodSync(folder, 0o755)
    } catch {
      /* no llegó a crearse */
    }
    if (prevDisclaim === undefined) delete process.env.LAZUNOX_NO_DISCLAIM
    else process.env.LAZUNOX_NO_DISCLAIM = prevDisclaim
    if (prevBin === undefined) delete process.env.OPENCODE_BIN
    else process.env.OPENCODE_BIN = prevBin
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('arranca sano, sin crear nada en la carpeta', async () => {
    handle = await startTasksServer(folder, {
      isolation: { privateDir: join(state.userData, 'tasks-sandbox', sandboxKey(folder)), userData: state.userData },
      networkAllowlist: () => []
    })
    const res = await fetch(`${handle.baseUrl}/global/health`, {
      headers: { authorization: handle.authorization },
      signal: AbortSignal.timeout(30_000)
    })
    expect(res.ok).toBe(true)
    expect(((await res.json()) as { healthy?: boolean }).healthy).toBe(true)
    expect(readdirSync(folder)).toEqual(['hola.txt'])
  }, 120_000)
})
