/**
 * Integración REAL de `setup()`/`remove()` con `wsl.exe` (solo en el PC Windows de pruebas).
 * Se salta salvo en win32 con `LAZUNOX_WSL_IT=1`. No descarga nada: usa la imagen y el opencode locales de `C:\onyx\wsl\cache`
 * (`lazunox-rootfs-<YYYY.M.D>-x64.tar.gz` y `opencode-linux-x64.tar.gz`) y `LOCALAPPDATA=C:\onyx\wsl\lad`.
 * Se niega a correr si ya existe una distro llamada `Lazunox-Tareas` (nunca pisa datos del usuario) y nunca usa `--shutdown`.
 */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createWslBackend } from './wsl'
import { IT_ENABLED, IT_LAD, createItEnv } from './wsl-it-support'
import { readPayloadPyFiles } from './wsl-real-deps'
import { wslSetupPaths } from './wsl-setup'

const ENABLED = IT_ENABLED
const LAD = IT_LAD

describe.skipIf(!ENABLED)('setup()/remove() reales con wsl.exe (PC Windows, LAZUNOX_WSL_IT=1)', () => {
  it(
    'instala, actualiza la carga y quita, sin tocar otras distros',
    async () => {
      let extraComment = ''
      const env = await createItEnv({ real: false })
      const extras = env.deps.setup!
      extras.payloadFiles = async () => {
        const py = await readPayloadPyFiles(env.payloadDir)
        return py.map((f) => (f.path === 'protocol.py' ? { ...f, data: Buffer.concat([f.data, Buffer.from(extraComment)]) } : f))
      }
      const backend = createWslBackend(env.deps)
      const list = env.list
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
