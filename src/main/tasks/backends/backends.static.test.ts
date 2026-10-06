/**
 * Guardias estáticas de `backends/*` (F8-B81): la clave real de un proveedor NUNCA entra en un backend
 * (ni en su entorno ni en una trama hacia la VM). Amplía a `backends/` lo que `provider-egress.test.ts`
 * comprueba para `sandbox.ts`. Y la selección de backend no activa WSL.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { selectBackend } from './index'

const dir = __dirname
const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

/** Quita comentarios para que la documentación pueda nombrar lo prohibido. */
function code(f: string): string {
  return readFileSync(join(dir, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

describe('backends/*: sin acceso a la clave real', () => {
  it('hay archivos que vigilar', () => {
    expect(files).toEqual(expect.arrayContaining(['index.ts', 'none.ts', 'seatbelt.ts', 'spawn.ts', 'types.ts']))
  })
  it.each(files)('%s no lee credenciales ni asigna OPENCODE_AUTH_CONTENT', (f) => {
    const src = code(f)
    expect(src).not.toMatch(/readProviderAuth|appAuthFile|placeholderAuthContent|auth\.json/)
    // `wsl-spec.ts` SOLO nombra OPENCODE_AUTH_CONTENT para exigir que sea un centinela (assertPlaceholderAuth).
    if (f !== 'wsl-spec.ts') expect(src).not.toMatch(/OPENCODE_AUTH_CONTENT/)
    if (f !== 'wsl-spec.ts') expect(src).not.toMatch(/\b(?:entry|e)\.key\b/)
    expect(src).not.toMatch(/Bearer/)
  })
})

describe('selectBackend', () => {
  it('Windows sin bandera ni proveedor: LANZA (nunca `none`); el resto sin aislamiento', async () => {
    await expect(selectBackend('win32')).rejects.toThrow()
    for (const p of ['linux', 'freebsd', 'remote']) expect((await selectBackend(p)).id).toBe('none')
  })
  it('macOS: Seatbelt si existe sandbox-exec, si no ninguno', async () => {
    expect(['seatbelt', 'none']).toContain((await selectBackend('darwin')).id)
  })
  it('index.ts no importa el backend WSL (lo trae el proveedor que inyecta main)', () => {
    expect(code('index.ts')).not.toMatch(/from '\.\/wsl|createWslBackend|import\('\.\/wsl/)
  })
})
