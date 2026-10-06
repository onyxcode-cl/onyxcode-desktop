/**
 * Integración REAL de `setup()`/`remove()` con `wsl.exe` (solo en el PC Windows de pruebas).
 * Se salta salvo en win32 con `LAZUNOX_WSL_IT=1`. No descarga nada: usa la imagen y el opencode locales de `C:\onyx\wsl\cache`
 * (`lazunox-rootfs-<YYYY.M.D>-x64.tar.gz` y `opencode-linux-x64.tar.gz`) y `LOCALAPPDATA=C:\onyx\wsl\lad`.
 * Se niega a correr si ya existe una distro llamada `Lazunox-Tareas` (nunca pisa datos del usuario) y nunca usa `--shutdown`.
 */
import { createHash } from 'node:crypto'
import { copyFile, readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { winOnly } from '../../../test/platform'
import { decodeWslOutput } from './bridge-protocol'
import { createWslBackend, type WslDeps } from './wsl'
import { WSL_ROOTFS_MAX_SIZE, parseWslPin, wslRootfsUrl } from './wsl-pin'
import { createRealSetupExtras, readPayloadPyFiles, realRun } from './wsl-real-deps'
import { wslSetupPaths, type SetupPin } from './wsl-setup'
import { buildWslSpawn } from './wsl-spec'
import { parseDistroList } from './wsl-status'

const ENABLED = winOnly && process.env.LAZUNOX_WSL_IT === '1'
const CACHE_SRC = 'C:\\onyx\\wsl\\cache'
const LAD = 'C:\\onyx\\wsl\\lad'
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

describe.skipIf(!ENABLED)('setup()/remove() reales con wsl.exe (PC Windows, LAZUNOX_WSL_IT=1)', () => {
  it(
    'instala, actualiza la carga y quita, sin tocar otras distros',
    async () => {
      const files = await readdir(CACHE_SRC)
      const rootfsName = files.find((f) => /^lazunox-rootfs-\d{4}\.\d{1,2}\.\d{1,2}-x64\.tar\.gz$/.test(f))
      expect(rootfsName, 'falta lazunox-rootfs-<ver>-x64.tar.gz en C:\\onyx\\wsl\\cache').toBeTruthy()
      const version = /rootfs-(.+)-x64/.exec(rootfsName!)![1]!
      const rootfsBytes = await readFile(join(CACHE_SRC, rootfsName!))
      const opencodeBytes = await readFile(join(CACHE_SRC, 'opencode-linux-x64.tar.gz'))
      const rootfs = parseWslPin({
        version,
        minVersion: version,
        builtAt: '2026-10-06',
        url: wslRootfsUrl(version),
        sha256: sha(rootfsBytes),
        size: rootfsBytes.length,
        unpackedMax: WSL_ROOTFS_MAX_SIZE * 2
      })
      expect(rootfs).toBeTruthy()
      const pin: SetupPin = {
        rootfs: rootfs!,
        opencode: {
          version: '1.0.0',
          url: 'https://github.com/anomalyco/opencode/releases/download/v1.0.0/opencode-linux-x64.tar.gz',
          sha256: sha(opencodeBytes),
          size: opencodeBytes.length
        }
      }
      const payloadDir = join(process.cwd(), 'resources', 'wsl')
      let extraComment = ''
      const hostEnv = { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows', LOCALAPPDATA: LAD }
      const extras = createRealSetupExtras({
        fetch: async () => Promise.reject(new Error('sin red en la prueba')),
        localAppData: LAD,
        pin,
        payloadDir
      })
      // «Descarga» local: copia de la caché del PC (la huella se comprueba igual que con red).
      extras.download = async (url, dest) => {
        const src = url === pin.rootfs.url ? join(CACHE_SRC, rootfsName!) : join(CACHE_SRC, 'opencode-linux-x64.tar.gz')
        await copyFile(src, dest)
        return { cached: false }
      }
      extras.payloadFiles = async () => {
        const py = await readPayloadPyFiles(payloadDir)
        return py.map((f) => (f.path === 'protocol.py' ? { ...f, data: Buffer.concat([f.data, Buffer.from(extraComment)]) } : f))
      }
      const deps: WslDeps = {
        platform: 'win32',
        hostEnv,
        spawn: () => {
          throw new Error('no se lanza nada en esta prueba')
        },
        run: realRun,
        connect: async () => Promise.reject(new Error('n/a')),
        listen: async () => Promise.reject(new Error('n/a')),
        setup: extras
      }
      const backend = createWslBackend(deps)
      const list = async (): Promise<string[]> =>
        parseDistroList(decodeWslOutput((await realRun(buildWslSpawn({ kind: 'list' }, hostEnv), 30_000)).stdout)).map((d) => d.name)
      const before = await list()
      expect(before.includes('Lazunox-Tareas'), 'ya existe Lazunox-Tareas: no se pisa').toBe(false)

      try {
        const progress: number[] = []
        await backend.setup!((p) => progress.push(p))
        expect((await backend.status()).state).toBe('ready')
        expect(progress.at(-1)).toBe(100)
        const P = wslSetupPaths(LAD)
        expect((await stat(join(P.installDir, 'ext4.vhdx'))).size).toBeGreaterThan(0)

        // Reparar/actualizar la carga: cambia un `.py`, el estado pasa a update:payload y setup no reimporta.
        extraComment = '\n# actualización de prueba\n'
        expect(await backend.status()).toEqual({ state: 'needsSetup', detail: 'update:payload' })
        await backend.setup!(() => undefined, { kind: 'update' })
        expect((await backend.status()).state).toBe('ready')
      } finally {
        await backend.remove!()
      }
      expect(await list()).toEqual(before)
      expect((await readdir(wslSetupPaths(LAD).root).catch(() => [] as string[])).includes('Lazunox-Tareas')).toBe(false)
    },
    15 * 60_000
  )
})
