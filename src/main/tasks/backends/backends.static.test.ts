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
    expect(src).not.toMatch(/readProviderAuth|appAuthFile|placeholderAuthContent|OPENCODE_AUTH_CONTENT|auth\.json/)
    expect(src).not.toMatch(/\b(?:entry|e)\.key\b/)
    expect(src).not.toMatch(/Bearer/)
  })
})

describe('selectBackend', () => {
  it('Windows y el resto: sin backend de aislamiento (WSL NO se activa en producción)', () => {
    for (const p of ['win32', 'linux', 'freebsd', 'remote']) expect(selectBackend(p).id).toBe('none')
  })
  it('macOS: Seatbelt si existe sandbox-exec, si no ninguno', () => {
    expect(['seatbelt', 'none']).toContain(selectBackend('darwin').id)
  })
  it('index.ts no importa el backend WSL', () => {
    expect(code('index.ts')).not.toMatch(/wsl/i)
  })
})
