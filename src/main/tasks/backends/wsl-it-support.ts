/**
 * Apoyo COMÚN de las pruebas de integración REAL de Tareas en Windows (`wsl-setup.win.test.ts` y `wsl-session.win.test.ts`).
 * Solo corren en el PC Windows de pruebas con `LAZUNOX_WSL_IT=1`; este módulo no se importa desde producción.
 * No descarga nada: usa la imagen y el opencode locales de `C:\onyx\wsl\cache` y `LOCALAPPDATA=C:\onyx\wsl\lad`.
 * Con `LAZUNOX_WSL_IT_LOCAL=1` (o `local: true`) usa el camino de ORIGEN LOCAL de `setup()` (`localSource`, como el archivo incluido en el
 * instalador); sin él, la «descarga» falsa de siempre.
 * Nunca usa `wsl --shutdown` ni toca otras distros.
 */
import { createHash } from 'node:crypto'
import { copyFile, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from 'vitest'
import { winOnly } from '../../../test/platform'
import { decodeWslOutput } from './bridge-protocol'
import type { WslDeps } from './wsl'
import { WSL_ROOTFS_MAX_SIZE, parseWslPin, wslRootfsUrl } from './wsl-pin'
import { createRealSetupExtras, realConnect, realListen, realRun, realSpawn } from './wsl-real-deps'
import type { SetupPin } from './wsl-setup'
import { buildWslSpawn } from './wsl-spec'
import { parseDistroList } from './wsl-status'

export const IT_ENABLED = winOnly && process.env.LAZUNOX_WSL_IT === '1'
export const IT_CACHE_SRC = 'C:\\onyx\\wsl\\cache'
export const IT_LAD = 'C:\\onyx\\wsl\\lad'
/** Carpeta de trabajo de las pruebas con sesión (carpetas aprobadas de prueba). */
export const IT_TMP = 'C:\\onyx\\tmp'
export const sha256Hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

/** Versión de OpenCode fijada por la app (`resources/opencode-bin/pin.json`): la que baja `scripts/win/wsl-it.ps1`. */
export async function pinnedOpencodeVersion(): Promise<string> {
  const pin = JSON.parse(await readFile(join(process.cwd(), 'resources', 'opencode-bin', 'pin.json'), 'utf8')) as { version: string }
  return pin.version
}

export interface ItEnv {
  hostEnv: Record<string, string | undefined>
  pin: SetupPin
  payloadDir: string
  /** `WslDeps` con la «descarga» local ya cableada (`setup.download` copia de la caché del PC). */
  deps: WslDeps
  /** Nombres de las distros de WSL ahora mismo. */
  list(): Promise<string[]>
}

/**
 * Arma las dependencias para una prueba real. `real: true` añade `spawn`/`connect`/`listen` reales (sesión); con `false` el
 * lanzamiento queda prohibido (solo setup/remove).
 */
export async function createItEnv(opts: {
  real: boolean
  local?: boolean
  localOverride?: (kind: 'rootfs' | 'opencode') => string | null
}): Promise<ItEnv> {
  const files = await readdir(IT_CACHE_SRC)
  const rootfsName = files.find((f) => /^lazunox-rootfs-\d{4}\.\d{1,2}\.\d{1,2}-x64\.tar\.gz$/.test(f))
  expect(rootfsName, 'falta lazunox-rootfs-<ver>-x64.tar.gz en C:\\onyx\\wsl\\cache').toBeTruthy()
  const version = /rootfs-(.+)-x64/.exec(rootfsName!)![1]!
  const rootfsBytes = await readFile(join(IT_CACHE_SRC, rootfsName!))
  const opencodeBytes = await readFile(join(IT_CACHE_SRC, 'opencode-linux-x64.tar.gz'))
  const rootfs = parseWslPin({
    version,
    minVersion: version,
    builtAt: '2026-10-06',
    url: wslRootfsUrl(version),
    sha256: sha256Hex(rootfsBytes),
    size: rootfsBytes.length,
    unpackedMax: WSL_ROOTFS_MAX_SIZE * 2
  })
  expect(rootfs).toBeTruthy()
  const ocVersion = await pinnedOpencodeVersion()
  const pin: SetupPin = {
    rootfs: rootfs!,
    opencode: {
      version: ocVersion,
      url: `https://github.com/anomalyco/opencode/releases/download/v${ocVersion}/opencode-linux-x64.tar.gz`,
      sha256: sha256Hex(opencodeBytes),
      size: opencodeBytes.length
    }
  }
  const payloadDir = join(process.cwd(), 'resources', 'wsl')
  const hostEnv = { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows', LOCALAPPDATA: IT_LAD }
  const extras = createRealSetupExtras({
    fetch: async () => Promise.reject(new Error('sin red en la prueba')),
    localAppData: IT_LAD,
    pin,
    payloadDir
  })
  // «Descarga» local: copia de la caché del PC (la huella se comprueba igual que con red).
  const local = opts.local ?? process.env.LAZUNOX_WSL_IT_LOCAL === '1'
  if (local) {
    const own = (kind: 'rootfs' | 'opencode'): string => join(IT_CACHE_SRC, kind === 'rootfs' ? rootfsName! : 'opencode-linux-x64.tar.gz')
    extras.localSource = opts.localOverride ?? own
    extras.download = async () => Promise.reject(new Error('con origen local no se descarga nada'))
  } else
    extras.download = async (url, dest) => {
      const src = url === pin.rootfs.url ? join(IT_CACHE_SRC, rootfsName!) : join(IT_CACHE_SRC, 'opencode-linux-x64.tar.gz')
      await copyFile(src, dest)
      return { cached: false }
    }
  const deps: WslDeps = {
    platform: 'win32',
    hostEnv,
    spawn: opts.real
      ? realSpawn
      : () => {
          throw new Error('no se lanza nada en esta prueba')
        },
    run: realRun,
    connect: opts.real ? realConnect : async () => Promise.reject(new Error('n/a')),
    listen: opts.real ? realListen : async () => Promise.reject(new Error('n/a')),
    setup: extras
  }
  const list = async (): Promise<string[]> =>
    parseDistroList(decodeWslOutput((await realRun(buildWslSpawn({ kind: 'list' }, hostEnv), 30_000)).stdout)).map((d) => d.name)
  return { hostEnv, pin, payloadDir, deps, list }
}
