/**
 * Partición del diccionario español para la PWA del celular (F8-B65). Solo se usa en `pwa/vite.full.config.ts`.
 *
 * `main` llevaba los ~190 KB (54 KB gzip) del diccionario `es` entero; el celular solo necesita las claves que pide el código del
 * arranque (la lista, `src/renderer/remote/i18n-core-keys.json`, la genera y la vigila `src/renderer/remote/i18n-core.test.ts`).
 * Este plugin reescribe cada `src/shared/i18n/es/<área>.ts`:
 *   - importado normal: el mismo objeto pero solo con las claves de la lista;
 *   - importado con `?onyx-rest`: `export const rest` con TODAS las demás;
 *   - módulo virtual `virtual:onyx-es-rest`: `loadEsRest()` baja todos los `rest` (un trozo aparte) y los registra con
 *     `registerMessages`. Las pantallas perezosas (Ajustes, Tareas, Rutinas) lo esperan antes de pintarse, y un `t()` que falle
 *     en la interfaz del arranque lo pide también (`setMissingKeyHandler`, `boot.tsx`).
 * El escritorio no pasa por aquí. El inglés no se parte (ya va entero y aparte, `en-dict.ts`).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import type { Plugin } from 'vite'

const REST_QUERY = '?onyx-rest'
const VIRTUAL = 'virtual:onyx-es-rest'
const RESOLVED = '\0' + VIRTUAL

interface Parsed {
  name: string
  props: Array<{ key: string; text: string }>
}

/** Lee `export const nombre = { 'clave': valor, … } as const` y devuelve el texto de cada propiedad. */
export function parseDictionary(code: string, file = 'dict.ts'): Parsed {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true)
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st) || !st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue
    const decl = st.declarationList.declarations[0]
    let init = decl?.initializer
    while (init && (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init))) init = init.expression
    if (!decl || !init || !ts.isObjectLiteralExpression(init) || !ts.isIdentifier(decl.name)) continue
    const props = init.properties.map((p) => {
      if (
        !ts.isPropertyAssignment(p) ||
        !(ts.isStringLiteral(p.name) || ts.isIdentifier(p.name) || ts.isNoSubstitutionTemplateLiteral(p.name))
      )
        throw new Error(`${file}: propiedad no soportada por la partición del diccionario: ${p.getText(sf).slice(0, 60)}`)
      return { key: p.name.text, text: p.getText(sf) }
    })
    return { name: decl.name.text, props }
  }
  throw new Error(`${file}: no se encontró «export const x = { … }»`)
}

export function i18nSplit(opts: { esDir: string; coreKeys: readonly string[] }): Plugin {
  const core = new Set(opts.coreKeys)
  const esDir = resolve(opts.esDir)
  const areaFiles = (): string[] =>
    readdirSync(esDir)
      .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
      .sort()
  return {
    name: 'onyx-i18n-split',
    enforce: 'pre',
    resolveId(source) {
      return source === VIRTUAL ? RESOLVED : null
    },
    load(id) {
      if (id !== RESOLVED) return null
      const files = areaFiles()
      const loads = files.map((f) => `import(${JSON.stringify(resolve(esDir, f) + REST_QUERY)})`)
      return [
        "import { registerMessages } from '@shared/i18n'",
        'let done = null',
        'export function loadEsRest() {',
        `  done ??= Promise.all([${loads.join(', ')}]).then((ms) => { for (const m of ms) registerMessages('es', m.rest) })`,
        '  return done',
        '}'
      ].join('\n')
    },
    transform(code, id) {
      const [file, query] = id.split('?') as [string, string | undefined]
      if (!file.startsWith(esDir + '/') || !file.endsWith('.ts') || file.endsWith('/index.ts')) return null
      const wantsRest = query === REST_QUERY.slice(1)
      const { name, props } = parseDictionary(code, file)
      const pick = (keep: boolean): string =>
        props
          .filter((p) => core.has(p.key) === keep)
          .map((p) => '  ' + p.text)
          .join(',\n')
      return wantsRest
        ? { code: `export const rest = {\n${pick(false)}\n}\n`, map: null }
        : { code: `export const ${name} = {\n${pick(true)}\n}\n`, map: null }
    }
  }
}

export function readCoreKeys(file: string): string[] {
  return JSON.parse(readFileSync(file, 'utf8')) as string[]
}
