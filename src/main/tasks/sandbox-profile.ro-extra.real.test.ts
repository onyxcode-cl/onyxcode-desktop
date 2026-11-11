/**
 * Seatbelt REAL (`sandbox-exec`): una carpeta adicional de SOLO LECTURA que cuelga de la carpeta de la tarea no se puede vaciar ni
 * renombrar desde dentro (1.8.19). En SBPL una regla de operación concreta gana a una con comodín sin importar el orden: el
 * `allow file-write-unlink` de la principal («Permitir borrar» con una carpeta `rw` que la contiene) y el de `.lazunox/trabajo` ganaban
 * al `deny file-write*` de la `ro`, y `mv ro/archivo fuera` funcionaba. Ahora la regla de la `ro` nombra también `file-write-unlink`.
 * Archivos centinela propios en una carpeta temporal; nada fuera. Solo macOS.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { macOnly } from '../../test/platform'
import { buildSandboxProfile, sandboxDirs, sandboxEnv, type SandboxProfileOptions } from './sandbox-profile'

const HAS_SBX = macOnly && existsSync('/usr/bin/sandbox-exec')
const BUILDERS: Array<[string, (o: SandboxProfileOptions) => string]> = [['V1', buildSandboxProfile]]

describe.skipIf(!HAS_SBX).each(BUILDERS)('Seatbelt real (%s): carpeta adicional de solo lectura dentro de la tarea', (_j, build) => {
  let dir: string
  let padre: string
  let folder: string
  let ro: string
  let roScratch: string
  let privateDir: string

  beforeAll(() => {
    // Fuera del temporal del usuario (la jaula V2 no deja leerlo).
    dir = realpathSync(mkdtempSync('/private/tmp/lazunox-roextra-'))
    padre = join(dir, 'padre')
    folder = join(padre, 'tarea')
    ro = join(folder, 'referencia')
    roScratch = join(folder, '.lazunox', 'trabajo', 'ref')
    privateDir = join(dir, 'ud', 'tasks-sandbox', 'abc')
    for (const d of [ro, roScratch, ...Object.values(sandboxDirs(privateDir))]) mkdirSync(d, { recursive: true })
  })
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  const inside = (allowDelete: boolean, withParent: boolean, script: string): void => {
    const profile = build({
      folder,
      privateDir,
      userData: join(dir, 'ud'),
      home: join(dir, 'home'),
      allowDelete,
      extraFolders: [
        ...(withParent ? [{ path: padre, mode: 'rw' as const }] : []),
        { path: ro, mode: 'ro' },
        { path: roScratch, mode: 'ro' }
      ]
    })
    const env = { PATH: '/usr/bin:/bin', HOME: join(dir, 'home'), ...sandboxEnv(sandboxDirs(privateDir)) }
    spawnSync('/usr/bin/sandbox-exec', ['-p', profile, '/bin/sh', '-c', script], { cwd: folder, env, encoding: 'utf8', timeout: 60000 })
  }

  const reset = (): void => {
    for (const p of ['sacado.txt', 'sacado2.txt', 'ref-movida', 'movido.txt', join('.lazunox', 'trabajo', 't2.txt')])
      rmSync(join(folder, p), { recursive: true, force: true })
    if (!existsSync(ro)) mkdirSync(ro)
    writeFileSync(join(ro, 'r.txt'), 'CENTINELA-RO')
    writeFileSync(join(roScratch, 'r.txt'), 'CENTINELA-RO2')
    writeFileSync(join(folder, 'borrable.txt'), 'x')
    writeFileSync(join(folder, '.lazunox', 'trabajo', 't.txt'), 'x')
  }

  it.each([
    ['«Permitir borrar» y una rw que contiene a la principal', true, true],
    ['sin «Permitir borrar»', false, false],
    ['«Permitir borrar» sin rw que la contenga', true, false]
  ])('%s: los archivos de la ro no se sacan y la ro no se renombra; lo normal sigue', (_n, allowDelete, withParent) => {
    reset()
    inside(
      allowDelete,
      withParent,
      `mv referencia/r.txt sacado.txt; mv .lazunox/trabajo/ref/r.txt sacado2.txt; mv referencia ref-movida; echo X > referencia/nuevo
mv borrable.txt movido.txt; mv .lazunox/trabajo/t.txt .lazunox/trabajo/t2.txt; exit 0`
    )
    expect(existsSync(join(ro, 'r.txt'))).toBe(true)
    expect(existsSync(join(roScratch, 'r.txt'))).toBe(true)
    expect(existsSync(join(folder, 'sacado.txt'))).toBe(false)
    expect(existsSync(join(folder, 'sacado2.txt'))).toBe(false)
    expect(existsSync(join(folder, 'ref-movida'))).toBe(false)
    expect(existsSync(join(ro, 'nuevo'))).toBe(false)
    // Lo normal: borrar/renombrar en la principal solo con el permiso; en `.lazunox/trabajo`, siempre.
    expect(existsSync(join(folder, 'movido.txt'))).toBe(allowDelete)
    expect(existsSync(join(folder, '.lazunox', 'trabajo', 't2.txt'))).toBe(true)
  })
})
