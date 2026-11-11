/** Prueba real acotada: solo mv de un archivo temporal; sin servicios ni cambios del sistema. */
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { macOnly } from '../../test/platform'
import { buildSandboxProfile } from './sandbox-profile'
import { SandboxDenialMonitor } from './sandbox-denials'
import type { SandboxDenial } from '@shared/ipc-tasks'

const canTry = macOnly && existsSync('/usr/bin/sandbox-exec')
const probe = canTry
  ? spawnSync(
      '/usr/bin/sandbox-exec',
      ['-p', '(version 1)(allow default)(deny file-write-unlink (with message "lzx-denial-probe"))', '/usr/bin/true'],
      { encoding: 'utf8', timeout: 5000 }
    )
  : null
const available = probe?.status === 0
if (canTry && !available) console.warn('Seatbelt real NO VERIFICADO: ' + probe?.stderr.trim())

describe.skipIf(!available)('negación real con sandbox-exec y log stream', () => {
  it('renombrado temporal bloqueado, etiquetado y clasificado sin guardar rutas', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-denial-')))
    const folder = join(root, 'tarea')
    const priv = join(root, 'priv')
    mkdirSync(folder)
    mkdirSync(priv)
    const src = join(folder, 'centinela.txt')
    const dst = join(folder, 'nuevo.txt')
    writeFileSync(src, 'centinela')
    const tag = 'lzx-denial-' + randomBytes(16).toString('hex')
    const events: SandboxDenial[] = []
    let unavailable = false
    const monitor = new SandboxDenialMonitor(
      tag,
      folder,
      (tail) => {
        events.splice(0, events.length, ...tail)
      },
      undefined,
      {},
      () => {
        unavailable = true
      }
    )
    try {
      monitor.start()
      // log stream no expone un acuse de suscripción; conceder tiempo antes de la única negación de esta prueba.
      await new Promise((r) => setTimeout(r, 1200))
      expect(unavailable, 'log stream no es accesible; no se ha comprobado recepción').toBe(false)
      const profile = buildSandboxProfile({ folder, privateDir: priv, home: join(root, 'home'), denialTag: tag })
      const result = spawnSync('/usr/bin/sandbox-exec', ['-p', profile, '/bin/mv', src, dst], { encoding: 'utf8', timeout: 5000 })
      expect(result.status).not.toBe(0)
      expect(result.stderr).not.toContain('sandbox_apply')
      expect(existsSync(src)).toBe(true)
      expect(existsSync(dst)).toBe(false)
      for (let i = 0; i < 100 && !events.some((e) => e.kind === 'delete'); i++) await new Promise((r) => setTimeout(r, 100))
      expect(events).toContainEqual({ kind: 'delete', at: expect.any(Number), canAllowDelete: true })
      expect(JSON.stringify(events)).not.toContain(root)
    } finally {
      await monitor.stop()
      rmSync(root, { recursive: true, force: true })
    }
  }, 20000)
})
