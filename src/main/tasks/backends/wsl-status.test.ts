import { describe, expect, it } from 'vitest'
import { classifyWslStatus, parseDistroList, parseProbe, type RunResult } from './wsl-status'

const u16 = (s: string, bom = true): Buffer => Buffer.concat([bom ? Buffer.from([0xff, 0xfe]) : Buffer.alloc(0), Buffer.from(s, 'utf16le')])
const ok = (out: Buffer | string): RunResult => ({ code: 0, stdout: Buffer.from(out), stderr: Buffer.alloc(0) })
const fail = (code: number, out: string): RunResult => ({ code, stdout: u16(out), stderr: Buffer.alloc(0) })
const LIST_EN =
  '  NAME               STATE           VERSION\r\n* Ubuntu             Running         2\r\n  OnyxCode-Tareas    Stopped         2\r\n'
const LIST_ES =
  '  NOMBRE             ESTADO          VERSIÓN\r\n* Ubuntu             En ejecución    2\r\n  OnyxCode-Tareas    Detenido        2\r\n'
const probe = (o: Partial<{ interop: boolean; driveMounts: string[]; landlockAbi: number }> = {}): RunResult =>
  ok(JSON.stringify({ interop: false, driveMounts: [], landlockAbi: 4, kernel: '6.6.87.2-microsoft-standard-WSL2', uid: 0, ...o }) + '\n')
const version = ok(u16('Versión de WSL: 2.4.13.0\r\n'))

describe('parseDistroList', () => {
  it('inglés y español (estado con espacios), distro por defecto y cabecera ignorada', () => {
    for (const text of [LIST_EN, LIST_ES]) {
      const l = parseDistroList(text)
      expect(l.map((d) => [d.name, d.version, d.isDefault])).toEqual([
        ['Ubuntu', 2, true],
        ['OnyxCode-Tareas', 2, false]
      ])
    }
    expect(parseDistroList(LIST_ES)[0]!.state).toBe('En ejecución')
  })
  it('WSL1, vacío y basura', () => {
    expect(parseDistroList('  NAME STATE VERSION\n  Old Stopped 1\n')[0]!.version).toBe(1)
    expect(parseDistroList('')).toEqual([])
    expect(parseDistroList('no hay distribuciones instaladas\n')).toEqual([])
  })
})

describe('parseProbe', () => {
  it('acepta el JSON del lanzador y rechaza lo demás', () => {
    expect(parseProbe('{"interop":false,"driveMounts":[],"landlockAbi":4,"kernel":"6.6","uid":0}\n')?.landlockAbi).toBe(4)
    expect(parseProbe('aviso\n{"interop":false,"driveMounts":[],"landlockAbi":4,"kernel":"6.6","uid":0}')?.kernel).toBe('6.6')
    for (const bad of ['', 'x', '{}', '{"interop":"no"}']) expect(parseProbe(bad)).toBeNull()
  })
})

describe('classifyWslStatus', () => {
  const listOk = ok(u16(LIST_EN))
  it('política activa gana sobre todo', () => {
    expect(classifyWslStatus({ policyDisabled: true, version, list: listOk }).state).toBe('policyDisabled')
  })
  it('WSL ausente (ENOENT) → needsWsl', () => {
    const none: RunResult = { code: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: 'ENOENT' }
    expect(classifyWslStatus({ version: none, list: none }).state).toBe('needsWsl')
  })
  it('virtualización desactivada (código HCS) → needsVirtualization, en UTF-16LE', () => {
    const r = fail(
      4294967295,
      'WSL2 no se admite con la configuración actual del equipo.\r\nError: 0x80370102 HCS_E_HYPERV_NOT_INSTALLED\r\n'
    )
    expect(classifyWslStatus({ version, list: r }).state).toBe('needsVirtualization')
  })
  it('núcleo desactualizado → needsWsl2', () => {
    expect(
      classifyWslStatus({ version, list: fail(1, 'WSL 2 requires an update to its kernel component. Error code: Wsl/Service/0x800701bc') })
        .state
    ).toBe('needsWsl2')
  })
  it('wsl.exe sin servicio / sin distros → needsWsl (la guía es la misma)', () => {
    expect(classifyWslStatus({ version, list: fail(1, 'Windows Subsystem for Linux has no installed distributions.') }).state).toBe(
      'needsWsl'
    )
  })
  it('sin la distro dedicada → needsSetup (aunque haya otras)', () => {
    expect(classifyWslStatus({ version, list: ok(u16('  NAME STATE VERSION\r\n* Ubuntu Running 2\r\n')) }).state).toBe('needsSetup')
  })
  it('distro en WSL1 o sin probe → broken', () => {
    expect(classifyWslStatus({ version, list: ok(u16('  NAME STATE VERSION\r\n  OnyxCode-Tareas Stopped 1\r\n')) })).toEqual({
      state: 'broken',
      detail: 'wsl1'
    })
    expect(classifyWslStatus({ version, list: listOk, probe: null })).toEqual({ state: 'broken', detail: 'probe' })
    expect(classifyWslStatus({ version, list: listOk, probe: fail(1, 'boom') })).toEqual({ state: 'broken', detail: 'probe' })
    expect(classifyWslStatus({ version, list: listOk, probe: ok('no es json') })).toEqual({ state: 'broken', detail: 'probe' })
  })
  it('interop activo, unidades montadas o Landlock < 2 → broken (falla cerrado)', () => {
    expect(classifyWslStatus({ version, list: listOk, probe: probe({ interop: true }) })).toEqual({ state: 'broken', detail: 'interop' })
    expect(classifyWslStatus({ version, list: listOk, probe: probe({ driveMounts: ['/mnt/c'] }) })).toEqual({
      state: 'broken',
      detail: 'drives'
    })
    expect(classifyWslStatus({ version, list: listOk, probe: probe({ landlockAbi: 1 }) })).toEqual({
      state: 'broken',
      detail: 'landlock:1'
    })
    expect(classifyWslStatus({ version, list: listOk, probe: probe({ landlockAbi: 0 }) }).state).toBe('broken')
  })
  it('todo bien → ready con la versión del núcleo', () => {
    expect(classifyWslStatus({ version, list: ok(u16(LIST_ES)), probe: probe() })).toEqual({
      state: 'ready',
      detail: '6.6.87.2-microsoft-standard-WSL2'
    })
  })
})
