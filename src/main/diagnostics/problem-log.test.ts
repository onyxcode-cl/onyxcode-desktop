import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProblemLog, describeError, formatEntry, getProblemLog, initProblemLog, recordProblem } from './problem-log'

let dir: string
let clock: number
const now = (): number => clock

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lzx-problems-'))
  clock = new Date(2026, 9, 14, 12, 0, 0).getTime()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const make = (o: Partial<ConstructorParameters<typeof ProblemLog>[0]> = {}): ProblemLog => new ProblemLog({ dir, now, home: '/Users/ben', ...o })

describe('ProblemLog', () => {
  it('guarda un problema y lo devuelve legible, con fecha, nivel y origen', () => {
    const log = make()
    log.record({ source: 'engine', message: 'el motor se cerró', detail: { codigo: 1 } })
    const lines = log.readLines()
    expect(lines[0]).toBe('2026-10-14 12:00:00 [error] [motor] el motor se cerró')
    expect(lines[1]).toBe('    codigo=1')
  })

  it('escribe REDACTADO: la carpeta del usuario sale como ~ también en el archivo', () => {
    const log = make()
    log.record({ source: 'main', message: 'no se pudo abrir /Users/ben/Documents/secreto.txt', stack: 'at f (/Users/ben/app/x.js:1:1)' })
    const raw = readFileSync(join(dir, 'problemas.log'), 'utf8')
    expect(raw).not.toContain('/Users/ben')
    expect(raw).toContain('~/Documents/secreto.txt')
  })

  it('agrupa los repetidos seguidos en una sola línea con el número de veces', () => {
    const log = make()
    for (let i = 0; i < 5; i++) {
      clock += 1000
      log.record({ source: 'renderer', message: 'mismo error' })
    }
    clock += 1000
    log.record({ source: 'renderer', message: 'otro error' })
    const text = log.readLines().join('\n')
    expect(text.match(/mismo error/g)).toHaveLength(1)
    expect(text).toContain('se repitió 5 veces')
    expect(text).toContain('otro error')
  })

  it('pone tope por minuto y avisa de cuántos omitió', () => {
    const log = make({ maxPerMinute: 3 })
    for (let i = 0; i < 10; i++) log.record({ source: 'main', message: `error distinto ${i}` })
    clock += 61_000
    log.record({ source: 'main', message: 'ya en el minuto siguiente' })
    const text = log.readLines().join('\n')
    expect(text).toContain('error distinto 2')
    expect(text).not.toContain('error distinto 3')
    expect(text).toContain('Se omitieron 7 problemas')
    expect(text).toContain('ya en el minuto siguiente')
  })

  it('rota al pasar el tamaño y conserva solo `keep` archivos, sin perder el orden', () => {
    const log = make({ maxBytes: 300, keep: 3 })
    for (let i = 0; i < 40; i++) {
      clock += 60_000
      log.record({ source: 'main', message: `problema número ${i} con texto de relleno` })
    }
    const files = readdirSync(dir).sort()
    expect(files).toEqual(['problemas.1.log', 'problemas.2.log', 'problemas.log'])
    const lines = log.readLines()
    expect(lines[lines.length - 1]).toContain('problema número 39')
    const nums = lines.map((l) => /número (\d+)/.exec(l)?.[1]).filter(Boolean).map(Number)
    expect(nums).toEqual([...nums].sort((a, b) => a - b))
  })

  it('recorta mensajes y pilas enormes', () => {
    const log = make()
    log.record({ source: 'main', message: 'x'.repeat(10_000), stack: 'y'.repeat(20_000) })
    const raw = readFileSync(join(dir, 'problemas.log'), 'utf8')
    expect(raw.length).toBeLessThan(7000)
  })

  it('devuelve solo las últimas `maxLines`', () => {
    const log = make()
    for (let i = 0; i < 20; i++) {
      clock += 60_000
      log.record({ source: 'main', message: `m${i}` })
    }
    const lines = log.readLines(5)
    expect(lines).toHaveLength(5)
    expect(lines[4]).toContain('m19')
  })

  it('nunca lanza aunque no se pueda escribir (la ruta es un archivo)', () => {
    const blocker = join(dir, 'bloqueo')
    writeFileSync(blocker, 'no soy una carpeta')
    const log = new ProblemLog({ dir: join(blocker, 'dentro'), now })
    expect(() => log.record({ source: 'main', message: 'x' })).not.toThrow()
    expect(log.readLines()).toEqual([])
  })

  it('ignora líneas corruptas del archivo al leer', () => {
    writeFileSync(join(dir, 'problemas.log'), 'esto no es json\n')
    const lines = make().readLines()
    expect(lines).toEqual(['esto no es json'])
  })
})

describe('registro compartido y utilidades', () => {
  it('recordProblem no hace nada ni lanza si aún no hay registro', () => {
    expect(() => recordProblem({ source: 'main', message: 'x' })).not.toThrow()
  })

  it('initProblemLog crea el compartido y recordProblem escribe en él', () => {
    initProblemLog({ dir, now })
    recordProblem({ source: 'update', level: 'warn', message: 'sin conexión' })
    expect(getProblemLog()?.readLines()[0]).toContain('[aviso] [actualización] sin conexión')
  })

  it('describeError entiende Error, texto y objetos', () => {
    expect(describeError(new Error('boom')).message).toBe('boom')
    expect(describeError('texto')).toEqual({ message: 'texto' })
    expect(describeError({ a: 1 }).message).toBe('{"a":1}')
  })

  it('formatEntry muestra la pila con sangría', () => {
    const out = formatEntry(JSON.stringify({ t: clock, source: 'main', level: 'error', message: 'm', stack: 'a\nb' }))
    expect(out.slice(1)).toEqual(['    a', '    b'])
  })
})
