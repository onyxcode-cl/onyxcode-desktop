/**
 * Contrato del helper de Control del PC (`resources/computer-use/protocol.json`) frente al helper de macOS
 * (`helper.swift`) por ANÁLISIS ESTÁTICO: si el helper cambia (comandos, argumentos, banderas, códigos de salida),
 * esta prueba falla hasta que se actualice el contrato, que es también el que debe cumplir `cu-helper.exe`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

interface Arg {
  name: string
  type: string
  required: boolean
  variadic?: boolean
}
interface Cmd {
  args: Arg[]
  output: Record<string, unknown>
  exits: number[]
  win32: 'same' | 'replaced' | 'none'
  replacedBy?: string
  flags?: Array<{ name: string; takesValue: boolean; required?: boolean }>
  stream?: Record<string, string>
}
interface Protocol {
  version: number
  globalFlags: Array<{ name: string }>
  exitCodes: Record<string, { meaning: string; platforms?: string[] }>
  commands: Record<string, Cmd>
  windowsExtensions: Record<string, Cmd>
}

const dir = join(__dirname, '..', '..', 'resources', 'computer-use')
const proto = JSON.parse(readFileSync(join(dir, 'protocol.json'), 'utf8')) as Protocol
const swift = readFileSync(join(dir, 'helper.swift'), 'utf8')

/** Cuerpos de cada `case "cmd":` del `switch cmd` principal (los `case` de banderas van indentados). */
function caseBodies(): Map<string, string> {
  const start = swift.indexOf('switch cmd {')
  expect(start).toBeGreaterThan(0)
  const main = swift.slice(start)
  const re = /^case "([^"]+)":/gm
  const marks: Array<{ name: string; at: number; end: number }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(main))) marks.push({ name: m[1], at: m.index, end: m.index + m[0].length })
  const def = main.search(/^default:/m)
  const out = new Map<string, string>()
  marks.forEach((c, i) => out.set(c.name, main.slice(c.end, i + 1 < marks.length ? marks[i + 1].at : def)))
  return out
}
const bodies = caseBodies()
const names = (o: object): string[] => Object.keys(o).sort()

describe('contrato de comandos', () => {
  it('versión y estructura básica', () => {
    expect(proto.version).toBe(1)
    expect(names(proto.commands).length).toBeGreaterThan(30)
  })
  it('los comandos del contrato son EXACTAMENTE los del switch del helper de macOS', () => {
    expect(names(proto.commands)).toEqual([...bodies.keys()].sort())
  })
  it('la línea de uso del helper lista los mismos comandos', () => {
    const usage = /Uso: cu-helper ([a-z|-]+) …/.exec(swift)
    expect(usage).not.toBeNull()
    expect(usage![1].split('|').sort()).toEqual(names(proto.commands))
  })
  it('banderas globales', () => {
    for (const f of proto.globalFlags) expect(swift).toContain(`"${f.name}"`)
    expect(names(proto.globalFlags.reduce((o, f) => ({ ...o, [f.name]: 1 }), {}))).toEqual(['--char-delay', '--instant'])
  })
})

describe.each(Object.entries(proto.commands))('comando %s', (name, cmd) => {
  const body = bodies.get(name) ?? ''

  it('argumentos posicionales obligatorios = los que exige el helper', () => {
    let required = 0
    for (const g of body.matchAll(/guard args\.count > (\d+)/g)) required = Math.max(required, Number(g[1]))
    for (const g of body.matchAll(/num\(args, (\d+)/g)) required = Math.max(required, Number(g[1]))
    expect(cmd.args.filter((a) => a.required).length).toBe(required)
  })
  it('los argumentos opcionales van después de los obligatorios y solo el último puede ser variádico', () => {
    const firstOpt = cmd.args.findIndex((a) => !a.required)
    if (firstOpt >= 0) expect(cmd.args.slice(firstOpt).every((a) => !a.required)).toBe(true)
    cmd.args.slice(0, -1).forEach((a) => expect(a.variadic).toBeUndefined())
  })
  it('códigos de salida declarados = los del cuerpo (+2 si exige Accesibilidad); 1 y 3 son globales', () => {
    const found = new Set<number>()
    for (const g of body.matchAll(/code: (\d+)/g)) found.add(Number(g[1]))
    for (const g of body.matchAll(/exit\((\d+)\)/g)) if (g[1] !== '0') found.add(Number(g[1]))
    if (body.includes('requireAccessibility()')) found.add(2)
    found.delete(1)
    found.delete(3)
    expect([...found].sort((a, b) => a - b)).toEqual([...cmd.exits].sort((a, b) => a - b))
    for (const c of cmd.exits) expect(proto.exitCodes[String(c)]).toBeDefined()
  })
  it('banderas propias = los `case "--x"` del cuerpo', () => {
    const found = [...body.matchAll(/case "(--[a-z-]+)"/g)].map((g) => g[1]).sort()
    expect((cmd.flags ?? []).map((f) => f.name).sort()).toEqual(found)
  })
  it('las claves de salida existen como literales en el helper', () => {
    const keys = (o: Record<string, unknown>): string[] =>
      Object.entries(o).flatMap(([k, v]) => (k === '_array' ? (typeof v === 'object' && v ? keys(v as Record<string, unknown>) : []) : [k]))
    for (const k of keys(cmd.output)) expect(swift, `${name}.${k}`).toContain(`"${k}"`)
  })
  it('paridad con Windows declarada y coherente', () => {
    expect(['same', 'replaced', 'none']).toContain(cmd.win32)
    if (cmd.win32 === 'replaced') expect(proto.windowsExtensions[cmd.replacedBy ?? '']).toBeDefined()
    else expect(cmd.replacedBy).toBeUndefined()
  })
})

describe('códigos de salida', () => {
  it('todo código que usa el helper está en el contrato y viceversa (salvo 0)', () => {
    const used = new Set<number>()
    for (const g of swift.matchAll(/code: (\d+)/g)) used.add(Number(g[1]))
    for (const g of swift.matchAll(/exit\((\d+)\)/g)) used.add(Number(g[1]))
    used.add(1) // `fail` por defecto
    used.delete(0)
    expect([...used].sort((a, b) => a - b)).toEqual(
      Object.keys(proto.exitCodes)
        .map(Number)
        .filter((c) => c !== 0)
        .sort((a, b) => a - b)
    )
  })
  it('significados fijados por el plan', () => {
    const m = (c: number): string => proto.exitCodes[String(c)].meaning
    expect(m(2)).toMatch(/Accesibilidad/)
    expect(m(3)).toMatch(/detenido/)
    expect(m(6)).toMatch(/voz/)
    expect(m(7)).toMatch(/no está en ejecución/)
    expect(m(8)).toMatch(/cambió/)
    expect(m(9)).toMatch(/seguro/)
    expect(m(10)).toMatch(/editable/)
    expect(m(11)).toMatch(/no permitida/)
    expect(m(12)).toMatch(/no disponible/)
    expect(proto.exitCodes['4'].platforms).toEqual(['darwin'])
  })
  it('la lista cerrada de ax-action coincide con la del helper', () => {
    const swiftList = /let allowedAXActions: Set<String> = \[([^\]]+)\]/
      .exec(swift)![1]
      .match(/"(AX\w+)"/g)!
      .map((s) => s.replace(/"/g, ''))
    const arg = proto.commands['ax-action'].args.find((a) => a.name === 'action') as Arg & { values: string[] }
    expect([...arg.values].sort()).toEqual([...swiftList].sort())
  })
})

describe('extensiones de Windows (sin equivalente en el helper de macOS)', () => {
  it('no chocan con comandos de macOS y declaran códigos conocidos', () => {
    for (const [name, cmd] of Object.entries(proto.windowsExtensions)) {
      expect(proto.commands[name]).toBeUndefined()
      expect(bodies.has(name)).toBe(false)
      for (const c of cmd.exits) expect(proto.exitCodes[String(c)]).toBeDefined()
    }
    expect(names(proto.windowsExtensions)).toEqual(['list-apps', 'release-input', 'screenshot', 'session'])
  })
  it('lo exclusivo de macOS no se espera en Windows: grabación, voz y permisos TCC', () => {
    for (const n of ['record', 'transcribe', 'mic-permission', 'mic-request', 'request-permissions'])
      expect(proto.commands[n].win32).toBe('none')
  })
})
