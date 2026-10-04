import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { AREAS } from '@shared/i18n/es/index'
import { i18nSplit, parseDictionary } from './i18n-split'
import { keysIn, rel, walk } from './pwa-graph'

/**
 * P2-9 (obligatoria): el diccionario `es` de la PWA se parte en «núcleo» (lo que pide el código del arranque, en `main`) y
 * «resto» (trozo aparte que bajan las pantallas perezosas). Un `t()` sin clave en el núcleo mostraría la clave cruda, así
 * que esta prueba recorre el MISMO grafo que la build (con los SWAPS) y exige que el núcleo cubra toda clave que ese código
 * pueda pedir. Regenerar la lista tras añadir textos al arranque:
 *   UPDATE_PWA_I18N=1 npx vitest run src/renderer/remote/i18n-core.test.ts
 */
const CORE_FILE = resolve(__dirname, 'i18n-core-keys.json')
const ES_DIR = resolve(__dirname, '../../shared/i18n/es')

const owner = new Map<string, string>()
for (const [area, dict] of Object.entries(AREAS)) for (const k of Object.keys(dict)) owner.set(k, area)
const ALL = new Set(owner.keys())

/** Pantallas perezosas que esperan al resto del diccionario (`lazy/with-es-rest.ts`): su código NO cuenta como arranque. */
const REST_SCREENS = [
  'src/renderer/src/features/settings/impl/SettingsView.tsx',
  'src/renderer/src/features/tasks/impl/TasksWorkspace.tsx',
  'src/renderer/src/features/tasks/impl/TasksSidebar.tsx',
  'src/renderer/src/features/routines/impl/RoutinesView.tsx'
]

/** Archivos que se ejecutan sin haber bajado el resto: el arranque y todo trozo perezoso que no espera al resto. */
function startupFiles(): Set<string> {
  const roots = [resolve(__dirname, 'main.tsx'), resolve(__dirname, 'boot.tsx')]
  const seen = new Set<string>()
  const files = new Set<string>()
  while (roots.length) {
    const r = roots.pop()!
    if (seen.has(r) || REST_SCREENS.includes(rel(r))) continue
    seen.add(r)
    const g = walk([r])
    for (const f of g.files) files.add(f)
    for (const d of g.dynamic) if (!seen.has(d) && !REST_SCREENS.includes(rel(d))) roots.push(d)
  }
  return files
}

function neededKeys(): string[] {
  const keys = new Set<string>()
  for (const f of startupFiles()) {
    if (f.includes('/i18n/es/') || f.includes('/i18n/en/')) continue
    for (const k of keysIn(readFileSync(f, 'utf8'), ALL)) keys.add(k)
  }
  return [...keys].sort()
}

const needed = neededKeys()
if (process.env.UPDATE_PWA_I18N === '1') writeFileSync(CORE_FILE, JSON.stringify(needed, null, 1) + '\n')
const core = JSON.parse(readFileSync(CORE_FILE, 'utf8')) as string[]

describe('diccionario es partido de la PWA (P2-9)', () => {
  it('el núcleo cubre TODA clave que pide el código del arranque', () => {
    const missing = needed.filter((k) => !core.includes(k))
    expect(
      missing,
      `faltan en i18n-core-keys.json (UPDATE_PWA_I18N=1 npx vitest run src/renderer/remote/i18n-core.test.ts): ${missing.join(', ')}`
    ).toEqual([])
  })

  it('la lista no lleva claves sobrantes ni inexistentes (se mantiene al día)', () => {
    expect(
      core.filter((k) => !ALL.has(k)),
      'claves que ya no existen'
    ).toEqual([])
    const extra = core.filter((k) => !needed.includes(k))
    expect(extra, `sobran en el núcleo (regenerar la lista): ${extra.join(', ')}`).toEqual([])
  })

  it('el arranque no importa ningún área del diccionario por su cuenta (solo el índice)', () => {
    // Si algún módulo del arranque importara `es/<área>` directamente (como hacía ai-errors) quedaría el diccionario completo.
    for (const f of startupFiles()) {
      if (f.includes('/i18n/')) continue
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/from\s*'([^']*i18n\/es\/[^']+)'/g)) {
        expect.soft(m[1], `${rel(f)} importa un área suelta del diccionario`).toMatch(/\/es\/index$/)
      }
    }
  })

  it('las 4 pantallas perezosas esperan al resto del diccionario', () => {
    for (const f of ['SettingsView', 'TasksWorkspace', 'TasksSidebar', 'RoutinesView']) {
      expect(readFileSync(resolve(__dirname, 'lazy', `${f}.tsx`), 'utf8'), f).toContain('withEsRest(')
    }
  })

  it('núcleo + resto == el área original, sin pérdidas ni duplicados (todas las áreas)', () => {
    const plugin = i18nSplit({ esDir: ES_DIR, coreKeys: core })
    const transform = plugin.transform as (this: unknown, code: string, id: string) => { code: string } | null
    const run = (code: string): Record<string, unknown> => {
      const js = ts.transpileModule(code, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
      }).outputText
      const mod = { exports: {} as Record<string, Record<string, unknown>> }
      new Function('exports', 'module', js)(mod.exports, mod)
      return Object.values(mod.exports)[0]
    }
    for (const [area, dict] of Object.entries(AREAS)) {
      const file = resolve(ES_DIR, `${area}.ts`)
      const src = readFileSync(file, 'utf8')
      const parsed = parseDictionary(src, file)
      expect(parsed.props.length, `${area}: propiedades leídas`).toBe(Object.keys(dict).length)
      const coreMod = run(transform.call({}, src, file)!.code)
      const restMod = run(transform.call({}, src, file + '?onyx-rest')!.code)
      expect(
        Object.keys(coreMod).filter((k) => k in restMod),
        `${area}: claves duplicadas`
      ).toEqual([])
      expect({ ...coreMod, ...restMod }, `${area}: contenido`).toEqual(dict)
      expect(
        Object.keys(coreMod).every((k) => core.includes(k)),
        `${area}: solo claves del núcleo`
      ).toBe(true)
    }
  })
})
