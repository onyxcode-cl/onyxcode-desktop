import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Lazunox no tiene cuentas ni inicio de sesión (retiradas en 0.4.x). Esta guardia falla si en `src/**` reaparece
 * cualquiera de sus rastros. La única mención permitida de `account.bin` es la limpieza de la sesión heredada
 * (`legacy-account-cleanup*.ts`), que la borra al arrancar.
 */
const SRC = resolve(__dirname, '..')
const SELF = resolve(__filename)
const EXT = /\.(?:[cm]?[jt]sx?|json|html|css)$/

const PROHIBIDO: readonly [string, RegExp][] = [
  ['canal account:', /['"`]account:[A-Za-z]/],
  ['ACCOUNT_API', /ACCOUNT_API/],
  ['api.onyxcode.cl / api.lazunox.cl', /api\.(?:onyxcode|lazunox)\.cl/], // el viejo dominio: EXTERNO-PENDIENTE: D3
  ['AccountGate', /AccountGate/],
  ['account.bin', /account\.bin/],
  ['LAZUNOX_ACCOUNT_URL', /LAZUNOX_ACCOUNT_URL/],
  ['LAZUNOX_ACCOUNT_DISABLED', /LAZUNOX_ACCOUNT_DISABLED/],
  ['LAZUNOX_TEST_PLAIN_STORE', /LAZUNOX_TEST_PLAIN_STORE/],
  ['emailStart', /emailStart/],
  ['emailVerify', /emailVerify/]
]

function archivos(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) archivos(p, out)
    else if (EXT.test(name)) out.push(p)
  }
  return out
}

describe('sin cuentas', () => {
  const todos = archivos(SRC).filter((p) => resolve(p) !== SELF)

  it('recorre el código fuente', () => {
    expect(todos.length).toBeGreaterThan(100)
  })

  it('no reaparece ningún rastro del sistema de cuentas en src/', () => {
    const hallazgos: string[] = []
    for (const p of todos) {
      const rel = relative(SRC, p).split(sep).join('/')
      const limpieza = /(^|\/)legacy-account-cleanup[^/]*\.ts$/.test(rel)
      const texto = readFileSync(p, 'utf8')
      for (const [nombre, re] of PROHIBIDO) {
        if (limpieza) continue
        if (re.test(texto)) hallazgos.push(`${rel}: ${nombre}`)
      }
    }
    expect(hallazgos).toEqual([])
  })

  it('la limpieza heredada sí menciona account.bin', () => {
    const limpieza = todos.filter((p) => /legacy-account-cleanup\.ts$/.test(p))
    expect(limpieza.length).toBe(1)
    expect(readFileSync(limpieza[0], 'utf8')).toContain('account.bin')
  })

  it('no quedan carpetas de cuenta', () => {
    const dirs = ['main/account', 'renderer/src/features/account']
    for (const d of dirs) expect(() => statSync(join(SRC, d)), d).toThrow()
  })
})
