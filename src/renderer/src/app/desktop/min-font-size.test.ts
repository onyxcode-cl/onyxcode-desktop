import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guardia de legibilidad de escritorio: ningún texto de la interfaz de escritorio baja de 12 px.
 *
 * Los componentes se comparten con la PWA del celular, así que la clase fija (`text-[11px]`…) NO se cambia: se le AÑADE la variante
 * de escritorio (`desk:text-meta` = 12 px, `desk:text-ui` = 13 px). Esta guardia falla si una cadena de clases lleva un tamaño fijo
 * < 12 px sin una variante `desk:` de ≥ 12 px en la MISMA cadena, salvo los archivos solo móviles / de desarrollo y las excepciones
 * justificadas de `EXCEPCIONES` (hoy ninguna).
 */
const SRC = resolve(__dirname, '../..')
const read = (p: string): string => readFileSync(p, 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/** Código solo móvil o de desarrollo: el celular conserva sus tamaños (globals.css los sube a 12 px con `[data-surface='mobile']`). */
const SOLO_MOVIL = (rel: string): boolean =>
  /^(app\/mobile|components\/mobile|app\/dev)\//.test(rel) || /(^|\/)Mobile[^/]*\.tsx$/.test(rel) || /\.mobile\./.test(rel)

/** Excepciones justificadas: `archivo` → cuántas apariciones se admiten sin variante `desk:`. Vacío: no hace falta ninguna. */
const EXCEPCIONES: Record<string, number> = {}

const FIJO = /(?<![\w:\-[])text-\[(9|9\.5|10|10\.5|11|11\.5)px\]/g
const VARIANTE_OK = /desk:text-(meta|ui|sm|base|\[1[2-9](\.\d+)?px\])/
const COMILLA = /['"`]/

/** Apariciones de un tamaño fijo < 12 px cuya cadena de clases (entre comillas, en la misma línea) no trae variante de escritorio ≥ 12 px. */
function sinVariante(source: string): { line: number; token: string }[] {
  const bad: { line: number; token: string }[] = []
  for (const m of source.matchAll(FIJO)) {
    const i = m.index ?? 0
    let a = i
    while (a > 0 && !COMILLA.test(source[a - 1]) && source[a - 1] !== '\n') a--
    let b = i
    while (b < source.length && !COMILLA.test(source[b]) && source[b] !== '\n') b++
    if (VARIANTE_OK.test(source.slice(a, b))) continue
    bad.push({ line: source.slice(0, i).split('\n').length, token: m[0] })
  }
  return bad
}

describe('app/desktop: tamaño mínimo de texto (12 px)', () => {
  const files = walk(SRC).filter((f) => {
    const rel = relative(SRC, f).split(sep).join('/')
    return /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel) && !SOLO_MOVIL(rel)
  })

  it('recorre el código de escritorio', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('el detector distingue cadenas con y sin variante desk:', () => {
    expect(sinVariante(`<p className="text-[11px] text-muted">x</p>`)).toHaveLength(1)
    expect(sinVariante(`<p className="text-[11px] desk:text-meta">x</p>`)).toHaveLength(0)
    expect(sinVariante(`<p className="text-[10.5px] desk:text-[12px]">x</p>`)).toHaveLength(0)
    expect(sinVariante(`<p className="text-[11px] desk:text-[10px]">x</p>`)).toHaveLength(1)
    expect(sinVariante(`a ? 'text-[11px]' : 'desk:text-meta'`)).toHaveLength(1)
    expect(sinVariante(`<p className="md:text-[11px] hover:text-[10px]">x</p>`)).toHaveLength(0)
  })

  it('ningún tamaño fijo < 12 px sin variante desk: ≥ 12 px', () => {
    const malos: string[] = []
    for (const f of files) {
      const rel = relative(SRC, f).split(sep).join('/')
      const bad = sinVariante(read(f))
      const permitidas = EXCEPCIONES[rel] ?? 0
      if (bad.length > permitidas) malos.push(...bad.map((b) => `${rel}:${b.line} ${b.token}`))
    }
    expect(malos).toEqual([])
  })

  it('las excepciones declaradas siguen existiendo', () => {
    for (const rel of Object.keys(EXCEPCIONES)) expect(existsSync(join(SRC, rel))).toBe(true)
  })

  it('el CSS de escritorio no fija font-size < 12 px', () => {
    const desktop = walk(__dirname).filter((f) => f.endsWith('.css'))
    const malos: string[] = []
    for (const f of desktop) {
      read(f)
        .split('\n')
        .forEach((l, n) => {
          const m = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(l)
          if (m && Number(m[1]) < 12) malos.push(`${relative(SRC, f)}:${n + 1} ${l.trim()}`)
        })
    }
    expect(malos).toEqual([])
  })
})
