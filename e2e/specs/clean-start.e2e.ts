// Primer arranque «desde cero» tras el renombre total a Lazunox: userData temporal VACÍO (solo `settings.json` con
// `onboarded:false`, que el harness necesita para que `migrateLegacyUserData` no mire datos reales) y HOME propio.
// Comprueba que la app muestra el asistente con «Lazunox», que no deja ninguna clave de localStorage ni ruta de userData
// con el nombre viejo y que las particiones nuevas se llaman `lazunox-*`.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApp } from '../lib/launch'
import { expectVisible } from '../lib/wait'
import { isolatedHomeEnv } from '../lib/proc'

/** Rutas relativas (con separador `/`) de todo lo que hay bajo `root`. */
function walkRel(root: string, rel = ''): string[] {
  const out: string[] = []
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name
    out.push(r)
    if (e.isDirectory()) out.push(...walkRel(root, r))
  }
  return out
}

describe('primer arranque limpio con el nombre Lazunox', () => {
  let userData = ''
  let home = ''

  beforeAll(() => {
    userData = realpathSync(mkdtempSync(join(tmpdir(), 'lazunox-e2e-cs-')))
    home = realpathSync(mkdtempSync(join(tmpdir(), 'lazunox-e2e-cs-home-')))
    mkdirSync(join(home, '.opencode', 'bin'), { recursive: true })
  })

  afterAll(() => {
    for (const d of [userData, home]) if (d) rmSync(d, { recursive: true, force: true })
  })

  it('muestra el asistente, sin claves ni rutas con el nombre viejo', async () => {
    const env = { OPENCODE_BIN: join(home, 'no-existe', 'opencode'), ...isolatedHomeEnv(home) }
    const app = await startApp({ userData, keepUserData: true, noServer: true, env, settings: { onboarded: false } })
    try {
      await expectVisible(app.page.getByText(/Bienvenido a Lazunox/))
      const keys = await app.page.evaluate(() => Object.keys(localStorage))
      expect(keys.filter((k) => /onyx/i.test(k))).toEqual([])
    } finally {
      await app.stop()
    }
    const paths = walkRel(userData)
    expect(paths.filter((p) => /onyx/i.test(p))).toEqual([])
    if (existsSync(join(userData, 'Partitions'))) {
      const parts = readdirSync(join(userData, 'Partitions'))
      expect(parts.filter((p) => !/^lazunox-/.test(p))).toEqual([])
    }
  })
})
