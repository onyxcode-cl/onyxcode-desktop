// Guardia de `e2e/win-skip.json` (specs E2E que NO corren en Windows): cada entrada lleva motivo, el archivo existe y no
// puede ser una spec de la v1 de Windows (Chat, Code, Rutinas en modo Code, Ajustes, cuentas, idioma, Diagnóstico, catálogo
// MCP, puntos de restauración/Git de Code, accesibilidad). Si una spec de la lista necesita saltarse, se parte o se usa
// `describe.skipIf(IS_WIN)` solo en los bloques de Tareas/Control/actualizador, con comentario.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..', '..')
const list = JSON.parse(readFileSync(join(root, 'e2e', 'win-skip.json'), 'utf8')) as { spec: string; reason: string }[]

/** Specs que cubren la v1: no se pueden excluir enteras en Windows. */
const V1_SPECS = [
  'account',
  'boot',
  'calidad-r2b',
  'calidad-r3a',
  'calidad-r3b-discard',
  'calidad-r3b',
  'calidad-ra',
  'calidad-rc',
  'calidad-t1',
  'calidad-t2',
  'calidad-t3',
  'calidad-t4',
  'calidad-t5',
  'chat',
  'diagnostics',
  'fase6',
  'harness',
  'i18n-main',
  'i18n',
  'instance',
  'key-test',
  'lotes',
  'lru',
  'mcp-catalog',
  'no-ai',
  'onboarding',
  'own-auth',
  'perf',
  'routines-terms'
]

describe('e2e/win-skip.json', () => {
  it('cada entrada tiene motivo, existe y no es una spec de la v1', () => {
    const files = new Set(readdirSync(join(root, 'e2e', 'specs')))
    for (const e of list) {
      expect(e.reason.length, e.spec).toBeGreaterThan(40)
      expect(files.has(e.spec), `${e.spec} no existe`).toBe(true)
      expect(existsSync(join(root, 'e2e', 'specs', e.spec))).toBe(true)
      expect(V1_SPECS, `${e.spec} es de la v1`).not.toContain(e.spec.replace(/\.e2e\.(ts|mjs)$/, ''))
    }
    expect(new Set(list.map((e) => e.spec)).size).toBe(list.length)
  })
})
