/**
 * Paridad del helper de Windows (Rust, compilado NATIVO en este sistema) con el helper FALSO (`e2e/fake-cu-helper/fake.mjs`,
 * la referencia del contrato): `version`, argumentos que faltan o sobran y banderas de captura. Solo la parte pura;
 * no toca el escritorio. Se omite si el binario no está compilado (`cargo build` en resources/computer-use/win).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const root = join(__dirname, '..', '..')
const exe = join(root, 'resources', 'computer-use', 'win', 'target', 'debug', process.platform === 'win32' ? 'cu-helper.exe' : 'cu-helper')
const fake = join(root, 'e2e', 'fake-cu-helper', 'fake.mjs')
const KEY = 'aumid:a.b!c'
// El helper falso escribe la imagen que se le pide: va al temporal del sistema y se borra al terminar.
const IMG = join(tmpdir(), `cu-parity-${process.pid}.jpg`)

const rust = (...a: string[]) => spawnSync(exe, a, { encoding: 'utf8', input: '', timeout: 10_000 })
const ref = (...a: string[]) =>
  spawnSync(process.execPath, [fake, ...a], { encoding: 'utf8', input: '', timeout: 10_000, env: { ...process.env, FAKE_CU_PLATFORM: 'win32' } })

describe.skipIf(!existsSync(exe))('cu-helper (Rust nativo) frente al helper falso', () => {
  afterAll(() => rmSync(IMG, { force: true }))

  it('version: mismo protocolo, mismas claves y plataforma', () => {
    const a = JSON.parse(rust('version').stdout) as Record<string, unknown>
    const b = JSON.parse(ref('version').stdout) as Record<string, unknown>
    expect(a.protocol).toBe(b.protocol)
    expect(a.platform).toBe(b.platform)
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort())
    expect(typeof a.helper).toBe('string')
  })

  // Donde el falso rechaza por argumentos (salida 1), el real también; donde acepta, el real no debe rechazar por sintaxis
  // (fuera de Windows responde 12: sintaxis válida, sin escritorio).
  const cases: string[][] = [
    ['move', '1'],
    ['move', '1.5', '2.25'],
    ['click', '10', '20'],
    ['click', '10', '20', 'right', '2'],
    ['drag', '1', '2', '3'],
    ['scroll', '1', '2', '3', '4'],
    ['key'],
    ['key', 'ctrl+c enter'],
    ['type'],
    ['app-at', '1'],
    ['windows-of'],
    ['activate'],
    ['resolve-app'],
    ['resolve-app', 'Bloc', 'de', 'notas'],
    ['ax-tree'],
    ['ax-tree', KEY],
    ['ax-find', KEY],
    ['ax-frame', KEY],
    ['ax-set-value', KEY, 'w0.1'],
    ['find-elements'],
    ['find-elements', '--app', KEY],
    ['screenshot'],
    ['screenshot', IMG, '--max-long', '800', '--quality', '70'],
    ['screenshot', IMG, '--max-long', '800', '--quality', '70', '--mask-keys', `${KEY},${KEY}`],
    ['window-shot', KEY],
    ['window-shot', KEY, IMG, '0', '--max-long', '800', '--quality', '70'],
    ['list-apps'],
    ['session'],
    ['release-input']
  ]
  for (const args of cases) {
    it(`argumentos de «${args.join(' ')}»`, () => {
      const expected = ref(...args).status === 1 ? 1 : 12
      // `release-input`/`list-apps`/`session` también acaban en 12 fuera de Windows.
      expect(rust(...args).status).toBe(expected)
    })
  }

  it('el comando desconocido sale con 1 en ambos', () => {
    expect(ref('nope').status).toBe(1)
    expect(rust('nope').status).toBe(1)
  })
})
