import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { selectors } from '../../../../test/css-selectors'

/**
 * Guardia de la capa visual de escritorio (plan UI «fundamentos»): `app/desktop/*.css` y la variante `desk:` no pueden llegar a la
 * interfaz móvil/PWA. Ver DESIGN.md «Fundamentos de escritorio».
 */
const SRC = resolve(__dirname, '../..')
const RENDERER = resolve(SRC, '..')
const REPO = resolve(RENDERER, '../..')
const DESKTOP = __dirname
const read = (p: string): string => readFileSync(p, 'utf8')

function walk(dir: string, ok: (f: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'out') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, ok, out)
    else if (ok(p)) out.push(p)
  }
  return out
}

const css = readdirSync(DESKTOP).filter((f) => f.endsWith('.css'))
const SCOPE = ":root[data-shell='desktop']"

describe('app/desktop: solo escritorio', () => {
  it('hay un CSS por dueño y el índice los importa todos', () => {
    expect(css.sort()).toEqual(['base.css', 'conversation.css', 'index.css', 'modes.css', 'shell.css', 'tokens.css'])
    const index = read(join(DESKTOP, 'index.css'))
    for (const f of css.filter((x) => x !== 'index.css')) expect(index).toContain(`@import './${f}';`)
  })

  it.each(css)('%s: todo selector empieza por :root[data-shell=desktop]', (f) => {
    const bad = selectors(read(join(DESKTOP, f))).filter((s) => !s.startsWith(SCOPE))
    expect(bad).toEqual([])
  })

  it('main.tsx importa la capa DESPUÉS de globals.css y marca el escritorio', () => {
    const main = read(join(SRC, 'main.tsx'))
    const g = main.indexOf("import './app/globals.css'")
    const d = main.indexOf("import './app/desktop/index.css'")
    expect(g).toBeGreaterThan(-1)
    expect(d).toBeGreaterThan(g)
    expect(main).toContain("document.documentElement.dataset.shell = 'desktop'")
  })

  it('ni la PWA ni el celular importan app/desktop', () => {
    const files = [
      ...walk(resolve(RENDERER, 'remote'), (f) => /\.(tsx?|css)$/.test(f)),
      ...walk(resolve(REPO, 'pwa'), (f) => /\.(tsx?|css|html)$/.test(f)),
      ...walk(resolve(REPO, 'scripts/shot-mobile'), () => true),
      ...walk(resolve(SRC, 'app/mobile'), (f) => /\.(tsx?|css)$/.test(f))
    ]
    expect(files.length).toBeGreaterThan(10)
    const bad = files.filter((f) => /app\/desktop|data-shell/.test(read(f)) && !/\.test\.tsx?$/.test(f)).map((f) => relative(REPO, f))
    expect(bad).toEqual([])
  })

  it('globals.css declara la variante desk: fuera del bloque «Superficie móvil»', () => {
    const g = read(join(SRC, 'app/globals.css'))
    const lit = "@custom-variant desk (&:where([data-shell='desktop'] *));"
    const at = g.indexOf(lit)
    expect(at).toBeGreaterThan(-1)
    expect(g.indexOf(lit, at + 1)).toBe(-1)
    expect(at).toBeLessThan(g.indexOf('Superficie móvil'))
  })

  it('ninguna cadena de clases empieza por desk: y desk: no aparece en código móvil', () => {
    const tsx = walk(SRC, (f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f))
    const first = /(["'`])desk:/
    expect(tsx.filter((f) => first.test(read(f))).map((f) => relative(SRC, f))).toEqual([])
    const mobile = tsx.filter((f) => {
      const rel = relative(SRC, f).split(sep).join('/')
      return /^(app\/mobile|components\/mobile)\//.test(rel) || /(^|\/)Mobile[^/]*\.tsx$/.test(rel)
    })
    mobile.push(...walk(resolve(RENDERER, 'remote'), (f) => /\.tsx?$/.test(f)))
    expect(mobile.length).toBeGreaterThan(5)
    expect(mobile.filter((f) => /\bdesk:/.test(read(f))).map((f) => relative(SRC, f))).toEqual([])
  })
})
