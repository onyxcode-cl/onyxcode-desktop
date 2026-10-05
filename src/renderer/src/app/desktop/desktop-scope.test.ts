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

/** Compilación de la PWA (el plugin y su configuración; no se empaquetan): nombra `data-shell` para quitarlo. */
const BUILD_HELPER = /strip-desktop-(css|js)|vite\.full\.config/

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
    const bad = files
      .filter((f) => /app\/desktop|data-shell/.test(read(f)) && !/\.test\.tsx?$/.test(f) && !BUILD_HELPER.test(f))
      .map((f) => relative(REPO, f))
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
    mobile.push(...walk(resolve(RENDERER, 'remote'), (f) => /\.tsx?$/.test(f) && !BUILD_HELPER.test(f)))
    expect(mobile.length).toBeGreaterThan(5)
    expect(mobile.filter((f) => /\bdesk:/.test(read(f))).map((f) => relative(SRC, f))).toEqual([])
  })

  /** Valores exactos de los tokens de fundamentos: los demás planes los usan y no pueden moverlos sin querer. */
  const TOKENS: Record<string, string> = {
    '--text-caption': '11px',
    '--text-meta': '12px',
    '--text-ui': '13px',
    '--text-ui--line-height': '18px',
    '--text-prose': '15px',
    '--text-title-sm': '15px',
    '--text-title': '20px',
    '--text-display': '28px',
    '--space-1': '4px',
    '--space-2': '8px',
    '--space-4': '16px',
    '--space-16': '64px',
    '--ctl-h-md': '32px',
    '--row-h': '32px',
    '--measure-prose': '720px',
    '--radius-2xs': '4px',
    '--radius-ctl-sm': '6px',
    '--radius-ctl': '8px',
    '--radius-card': '12px',
    '--radius-modal': '16px',
    '--shadow-focus': '0 0 0 3px var(--accent-ring)',
    '--scrim': 'hsl(var(--shadow-color) / 0.32)',
    '--dur-instant': '80ms',
    '--dur-enter': '200ms',
    '--dur-exit': '140ms',
    '--ease-exit': 'cubic-bezier(0.4, 0, 1, 1)',
    '--ease-move': 'cubic-bezier(0.65, 0, 0.35, 1)',
    '--z-pop': '50',
    '--z-modal': '300',
    '--z-modal-top': '320',
    '--z-tooltip': '500',
    '--icon-stroke': '1.75'
  }

  it('tokens.css: valores exactos y solo bajo :root[data-shell=desktop]', () => {
    const t = read(join(DESKTOP, 'tokens.css'))
    for (const [k, v] of Object.entries(TOKENS)) expect(t).toContain(`${k}: ${v};`)
    expect(t).toContain('--scrim: hsl(var(--shadow-color) / 0.62);') // oscuro
    expect(t).toContain('--elev-edge: inset 0 1px 0 0 color-mix(in srgb, var(--fg) 6%, transparent);')
  })

  it('tokens.css no redefine ningún token de color ni de globals.css', () => {
    const t = read(join(DESKTOP, 'tokens.css'))
    const g = read(join(SRC, 'app/globals.css'))
    const declared = (css: string): string[] => [...css.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1] as string)
    const existing = new Set(declared(g.slice(0, g.indexOf('@theme reference'))))
    // `--shadow-color` etc. se USAN en tokens.css, pero no se declaran; nada de lo declarado aquí puede existir ya allí.
    expect(declared(t).filter((n) => existing.has(n))).toEqual([])
  })

  it('globals.css registra los nombres de utilidades con @theme reference inline (sin emitir valores en la PWA)', () => {
    const g = read(join(SRC, 'app/globals.css'))
    expect(g).toContain('@theme reference inline {')
    for (const n of [
      '--radius-ctl: var(--radius-ctl);',
      '--shadow-pop: var(--shadow-pop);',
      '--text-ui--line-height: var(--text-ui--line-height);'
    ])
      expect(g).toContain(n)
  })
})
