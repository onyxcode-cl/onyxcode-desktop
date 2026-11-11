/**
 * Lanzamiento Seatbelt (corrección tras la revisión 1, 1.8.18), con `spawnOnHost` sustituido para capturar el entorno:
 * - el catálogo de modelos va a la config de la app (`OPENCODE_MODELS_PATH`) y el motor no lo refresca (`OPENCODE_DISABLE_MODELS_FETCH`);
 *   nada se escribe en la caché privada de la tarea (ni `models.json` ni `bin/rg`);
 * - las carpetas de la app en la carpeta de la tarea (`TASK_APP_DIRS`) se crean como carpetas reales antes de lanzar; si una es un
 *   enlace, no se arranca y no se toca nada.
 */
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { t } from '@shared/i18n'

const state = vi.hoisted(() => ({ env: null as Record<string, string> | null, spawns: 0, args: [] as string[] }))

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/no-existe', getPath: () => '/tmp/ud' } }))
vi.mock('./spawn', () => ({
  spawnOnHost: (_c: string, a: string[], _f: string, env: Record<string, string>) => {
    state.env = env
    state.args = a
    state.spawns++
    return { pid: 1 }
  }
}))

import { TASK_APP_DIRS } from '../sandbox-profile'
import { seatbeltBackend } from './seatbelt'

const isMac = process.platform === 'darwin'

describe.skipIf(!isMac)('Seatbelt: catálogo y carpetas de la app al lanzar', () => {
  let root: string
  let prevXdg: string | undefined
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-sb-dirs-')))
    prevXdg = process.env.XDG_CACHE_HOME
    process.env.XDG_CACHE_HOME = join(root, 'cache-principal')
    state.env = null
    state.spawns = 0
  })
  afterEach(() => {
    if (prevXdg === undefined) delete process.env.XDG_CACHE_HOME
    else process.env.XDG_CACHE_HOME = prevXdg
    rmSync(root, { recursive: true, force: true })
  })

  const spec = () => {
    const folder = join(root, 'tarea')
    mkdirSync(folder, { recursive: true })
    const userData = join(root, 'ud')
    return {
      folder,
      bin: '/x/opencode',
      serveArgs: ['serve'],
      serverPort: 4999,
      isolation: { privateDir: join(userData, 'tasks-sandbox', '0123456789abcdef'), userData },
      configDir: join(userData, 'opencode-config'),
      allowDelete: false,
      outboundPorts: [],
      baseEnv: {},
      proxyEnv: {},
      extraEnv: {}
    }
  }

  it('con catálogo principal: OPENCODE_MODELS_PATH en la config, sin descarga, y nada en la caché privada', async () => {
    mkdirSync(join(root, 'cache-principal', 'opencode', 'bin'), { recursive: true })
    writeFileSync(join(root, 'cache-principal', 'opencode', 'models.json'), '{"catalogo":1}')
    writeFileSync(join(root, 'cache-principal', 'opencode', 'bin', 'rg'), 'rg')
    const s = spec()
    seatbeltBackend.prepare!(s.isolation)
    await seatbeltBackend.launch(s as never)
    const env = state.env!
    expect(env.OPENCODE_DISABLE_MODELS_FETCH).toBe('1')
    expect(env.OPENCODE_MODELS_PATH).toBe(join(s.configDir, 'catalogo', 'models.json'))
    expect(readFileSync(env.OPENCODE_MODELS_PATH!, 'utf8')).toBe('{"catalogo":1}')
    expect(readdirSync(join(s.isolation.privateDir, 'cache'))).toEqual([])
  })

  it('sin catálogo principal: igual sin descarga y sin OPENCODE_MODELS_PATH', async () => {
    await seatbeltBackend.launch(spec() as never)
    expect(state.env!.OPENCODE_DISABLE_MODELS_FETCH).toBe('1')
    expect(state.env!.OPENCODE_MODELS_PATH).toBeUndefined()
  })

  it('crea las carpetas de la app de la tarea como carpetas reales (y respeta las que ya existen)', async () => {
    const s = spec()
    mkdirSync(join(s.folder, '.lazunox', 'trabajo'), { recursive: true })
    writeFileSync(join(s.folder, '.lazunox', 'trabajo', 'nota.txt'), 'mía')
    await seatbeltBackend.launch(s as never)
    for (const d of TASK_APP_DIRS) {
      const st = lstatSync(join(s.folder, d))
      expect(st.isDirectory() && !st.isSymbolicLink()).toBe(true)
    }
    expect(readFileSync(join(s.folder, '.lazunox', 'trabajo', 'nota.txt'), 'utf8')).toBe('mía')
  })

  it('si `.lazunox` o `descargas` es un enlace: no se arranca, error claro, y el destino no se toca', async () => {
    const outside = join(root, 'fuera')
    mkdirSync(outside)
    const s = spec()
    symlinkSync(outside, join(s.folder, '.lazunox'))
    await expect(seatbeltBackend.launch(s as never)).rejects.toThrow(t('merr.task.appDirUnsafe', { path: '.lazunox' }))
    expect(readdirSync(outside)).toEqual([])
    expect(lstatSync(join(s.folder, '.lazunox')).isSymbolicLink()).toBe(true)
    rmSync(join(s.folder, '.lazunox'))
    mkdirSync(join(s.folder, '.lazunox', 'trabajo'), { recursive: true })
    symlinkSync(outside, join(s.folder, '.lazunox', 'trabajo', 'descargas'))
    await expect(seatbeltBackend.launch(s as never)).rejects.toThrow(
      t('merr.task.appDirUnsafe', { path: join('.lazunox', 'trabajo', 'descargas') })
    )
    expect(readdirSync(outside)).toEqual([])
    expect(state.spawns).toBe(0)
    expect(existsSync(join(outside, 'grabaciones'))).toBe(false)
  })

  it.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
    'carpeta SIN permiso de escritura (chmod 555): el lanzamiento no falla y el perfil se arma (revisión 2)',
    async () => {
      const s = spec()
      chmodSync(s.folder, 0o555)
      try {
        seatbeltBackend.prepare!(s.isolation)
        await expect(seatbeltBackend.launch(s as never)).resolves.toBeTruthy()
        expect(state.spawns).toBe(1)
        const profile = state.args[1]
        expect(profile).toContain(`(literal "${join(s.folder, '.lazunox')}")`)
        expect(existsSync(join(s.folder, '.lazunox'))).toBe(false)
      } finally {
        chmodSync(s.folder, 0o755)
      }
    }
  )
})
