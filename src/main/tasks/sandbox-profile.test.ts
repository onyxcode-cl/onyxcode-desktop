/**
 * Caracterización del perfil Seatbelt (SBPL) ANTES del renombre `cowork` → `tasks`: el snapshot
 * fija el texto exacto. El scratch por defecto es `.onyxcode/trabajo` (antes `.cowork`):
 * solo pueden cambiar las líneas de esa ruta y sus comentarios. No cambies el snapshot para
 * que pase: revisa el diff.
 */
import { describe, expect, it, vi } from 'vitest'

// `defaultWritablePaths()` incluye `realpath(tmpdir())`, que depende de la máquina: se fija.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, tmpdir: () => '/private/var/folders/zz/fixed/T' }
})

import { NEW_FOLDER_SCRATCH } from '../migrations/legacy-names'
import { buildSandboxProfile, type SandboxProfileOptions } from './sandbox-profile'

const HOME = '/Users/fixture'
const base: SandboxProfileOptions = {
  folder: '/fixture/work/proyecto',
  privateDir: '/fixture/userData/tasks-sandbox/0123456789abcdef',
  userData: '/fixture/userData',
  readOnly: ['/fixture/userData/opencode-config'],
  home: HOME
}

describe('buildSandboxProfile (caracterización Seatbelt)', () => {
  it('carpeta de trabajo rw, sin red y con scratchDirs POR DEFECTO', () => {
    const out = buildSandboxProfile(base)
    expect(out).toMatchSnapshot()
    // El scratch por defecto es la única ruta que cambiará en el renombre.
    expect(out).toContain('(allow file-write-unlink (subpath "/fixture/work/proyecto/.onyxcode/trabajo"))')
    expect(out).toContain('(deny file-write-unlink (subpath "/fixture/work/proyecto"))')
    expect(out).toContain('(deny network*)')
    expect(out).not.toContain('(allow network-outbound')
  })

  it('scratchDirs explícito sustituye al valor por defecto', () => {
    const out = buildSandboxProfile({ ...base, scratchDirs: ['/fixture/work/proyecto/scratch-a', '/fixture/work/proyecto/scratch-b'] })
    expect(out).toMatchSnapshot()
    expect(out).not.toContain('/.onyxcode/trabajo"')
  })

  it('carpetas adicionales: rw (sin borrado) y solo lectura', () => {
    const out = buildSandboxProfile({
      ...base,
      extraFolders: [
        { path: '/fixture/otra/escribible', mode: 'rw' },
        { path: '/fixture/otra/lectura', mode: 'ro' }
      ]
    })
    expect(out).toMatchSnapshot()
    expect(out).toContain('(deny file-write-unlink (subpath "/fixture/otra/escribible"))')
    expect(out).toContain('(deny file-write* (subpath "/fixture/otra/lectura"))')
  })

  it('red: solo los proxies locales y el puerto del servidor', () => {
    const out = buildSandboxProfile({ ...base, allowedOutboundPorts: [40001, 40002, 40001], serverPort: 40555 })
    expect(out).toMatchSnapshot()
    expect(out).toContain('(remote ip "localhost:40001")')
    expect(out).toContain('(allow network-bind (local ip "localhost:40555"))')
  })

  it('"Permitir borrar" concedido: sin deny de unlink en la principal, scratch sin regla extra', () => {
    const out = buildSandboxProfile({ ...base, allowDelete: true })
    expect(out).toMatchSnapshot()
    expect(out).not.toContain('(deny file-write-unlink (subpath "/fixture/work/proyecto"))')
  })

  it('rw que contiene a la principal con allowDelete', () => {
    const out = buildSandboxProfile({ ...base, allowDelete: true, extraFolders: [{ path: '/fixture/work', mode: 'rw' }] })
    expect(out).toMatchSnapshot()
  })

  it('sin userData: no hay bloque de userData', () => {
    const out = buildSandboxProfile({ folder: base.folder, privateDir: base.privateDir, home: HOME })
    expect(out).toMatchSnapshot()
  })

  it('`.onyxcode/memoria.md` queda FUERA del scratch: no se puede borrar', () => {
    const out = buildSandboxProfile(base)
    const memoria = '/fixture/work/proyecto/.onyxcode/memoria.md'
    const unlinkAllowed = [...out.matchAll(/\(allow file-write-unlink \(subpath "([^"]+)"\)\)/g)].map((m) => m[1])
    expect(unlinkAllowed).toContain('/fixture/work/proyecto/.onyxcode/trabajo')
    // Ninguna regla de borrado permitido cubre la memoria (ni `.onyxcode/` entera ni la carpeta).
    for (const p of unlinkAllowed) expect(memoria.startsWith(p + '/')).toBe(false)
    expect(unlinkAllowed).not.toContain('/fixture/work/proyecto/.onyxcode')
    // Y la carpeta de trabajo sigue con el borrado denegado (memoria.md cae bajo ese deny).
    expect(out).toContain('(deny file-write-unlink (subpath "/fixture/work/proyecto"))')
  })

  it('el scratch por defecto coincide con el destino de la migración de carpetas', () => {
    const scratch = ['/fixture/work/proyecto', ...NEW_FOLDER_SCRATCH].join('/')
    expect(buildSandboxProfile(base)).toContain(`(allow file-write-unlink (subpath "${scratch}"))`)
  })
})
