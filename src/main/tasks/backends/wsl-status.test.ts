import { describe, expect, it } from 'vitest'
import { classifyWslStatus, compareDotted, isDriveFsType, parseDistroList, parseProbe, parseWslVersion, type RunResult } from './wsl-status'

const u16 = (s: string, bom = true): Buffer => Buffer.concat([bom ? Buffer.from([0xff, 0xfe]) : Buffer.alloc(0), Buffer.from(s, 'utf16le')])
const ok = (out: Buffer | string): RunResult => ({ code: 0, stdout: Buffer.from(out), stderr: Buffer.alloc(0) })
const fail = (code: number, out: string): RunResult => ({ code, stdout: u16(out), stderr: Buffer.alloc(0) })
const LIST_EN =
  '  NAME               STATE           VERSION\r\n* Ubuntu             Running         2\r\n  Lazunox-Tareas    Stopped         2\r\n'
const LIST_ES =
  '  NOMBRE             ESTADO          VERSIÓN\r\n* Ubuntu             En ejecución    2\r\n  Lazunox-Tareas    Detenido        2\r\n'
const probe = (o: Record<string, unknown> = {}): RunResult =>
  ok(JSON.stringify({ interop: false, driveMounts: [], landlockAbi: 4, kernel: '6.6.87.2-microsoft-standard-WSL2', uid: 0, ...o }) + '\n')
const VERSION_ES =
  'Versión de WSL: 2.4.13.0\r\nVersión del kernel: 6.6.87.2-1\r\nVersión de WSLg: 1.0.65\r\nVersión de MSRDC: 1.2.5716\r\nVersión de Direct3D: 1.611.1-81528511\r\nVersión de DXCore: 10.0.26100.1-240331-1435.ge-release\r\nVersión de Windows: 10.0.22631.4460\r\n'
const VERSION_EN = 'WSL version: 2.4.13.0\r\nKernel version: 6.6.87.2-1\r\nWSLg version: 1.0.65\r\nWindows version: 10.0.22631.4460\r\n'
const version = ok(u16(VERSION_ES))
const versionKernel = (k: string): RunResult => ok(u16(`WSL version: 2.0.9.0\r\nKernel version: ${k}\r\nWSLg version: 1.0.51\r\n`))
const ENOT_FOUND = 'There is no distribution with the supplied name.\r\nError code: Wsl/Service/WSL_E_DEFAULT_DISTRO_NOT_FOUND\r\n'

describe('parseDistroList', () => {
  it('inglés y español (estado con espacios), distro por defecto y cabecera ignorada', () => {
    for (const text of [LIST_EN, LIST_ES]) {
      const l = parseDistroList(text)
      expect(l.map((d) => [d.name, d.version, d.isDefault])).toEqual([
        ['Ubuntu', 2, true],
        ['Lazunox-Tareas', 2, false]
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
  it('núcleo desactualizado (0x800701bc) → needsWsl2/kernel', () => {
    expect(
      classifyWslStatus({ version, list: fail(1, 'WSL 2 requires an update to its kernel component. Error code: Wsl/Service/0x800701bc') })
    ).toEqual({ state: 'needsWsl2', detail: 'kernel' })
  })
  it('WSL instalado SIN distros (--version bien, -l falla) → needsSetup, no needsWsl (corrige el error real)', () => {
    expect(classifyWslStatus({ version, list: fail(4294967295, ENOT_FOUND) })).toEqual({ state: 'needsSetup', detail: 'no-distros' })
    expect(
      classifyWslStatus({ version, list: fail(1, 'El subsistema de Windows para Linux no tiene distribuciones instaladas.') }).state
    ).toBe('needsSetup')
  })
  it('--version falla y -l responde (WSL integrado antiguo) → needsWsl2/old-wsl', () => {
    expect(classifyWslStatus({ version: fail(1, 'Invalid command line option: --version'), list: listOk })).toEqual({
      state: 'needsWsl2',
      detail: 'old-wsl'
    })
  })
  it('--version y -l fallan sin pista (característica apagada) → needsWsl', () => {
    expect(classifyWslStatus({ version: fail(1, 'Error: 0x8007019e'), list: fail(1, 'Error: 0x8007019e') }).state).toBe('needsWsl')
  })
  it('núcleo < 5.19 en --version → needsWsl2/kernel, incluso con la lista bien o sin distros', () => {
    expect(classifyWslStatus({ version: versionKernel('5.15.153.1-2'), list: listOk })).toEqual({ state: 'needsWsl2', detail: 'kernel' })
    expect(classifyWslStatus({ version: versionKernel('5.15.153.1-2'), list: fail(1, ENOT_FOUND) }).detail).toBe('kernel')
    expect(classifyWslStatus({ version: versionKernel('5.19.0-1'), list: fail(1, ENOT_FOUND) }).state).toBe('needsSetup')
  })
  it('WSL desactivado por la organización → needsWsl/org (texto provisional)', () => {
    expect(classifyWslStatus({ version: fail(1, 'Blocked by your organization (Group Policy)'), list: fail(1, '') })).toEqual({
      state: 'needsWsl',
      detail: 'org'
    })
  })
  it('sin la distro dedicada → needsSetup (aunque haya otras)', () => {
    expect(classifyWslStatus({ version, list: ok(u16('  NAME STATE VERSION\r\n* Ubuntu Running 2\r\n')) }).state).toBe('needsSetup')
  })
  it('distro en WSL1 o sin probe → broken', () => {
    expect(classifyWslStatus({ version, list: ok(u16('  NAME STATE VERSION\r\n  Lazunox-Tareas Stopped 1\r\n')) })).toEqual({
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
  it('virtiofs/9p fuera de los montajes de sistema de WSL cuentan como unidades; los de sistema se toleran', () => {
    expect(classifyWslStatus({ version, list: listOk, probe: probe({ driveMounts: ['/mnt/share'] }) }).detail).toBe('drives')
    expect(
      classifyWslStatus({ version, list: listOk, probe: probe({ wslSystemMounts: ['/usr/lib/wsl/drivers', '/mnt/wslg/distro'] }) }).state
    ).toBe('ready')
    expect(classifyWslStatus({ version, list: listOk, probe: probe({ wslSystemMounts: ['/usr/lib/wsl/drivers', '/mnt/c'] }) })).toEqual({
      state: 'broken',
      detail: 'drives'
    })
  })
  it('distro ajena con nuestro nombre (rootfs null) → broken/foreign, antes que el resto', () => {
    expect(classifyWslStatus({ version, list: listOk, probe: probe({ rootfs: null, interop: true }) })).toEqual({
      state: 'broken',
      detail: 'foreign'
    })
  })
  it('sin carga (probe no ejecutable o payloadSha null) → broken/payload', () => {
    const noExec = fail(1, 'execvpe(/opt/lazunox/launcher.py) failed: No such file or directory\r\n')
    expect(classifyWslStatus({ version, list: listOk, probe: noExec })).toEqual({ state: 'broken', detail: 'payload' })
    expect(classifyWslStatus({ version, list: listOk, probe: probe({ payloadSha: null }) })).toEqual({ state: 'broken', detail: 'payload' })
  })
  it('imagen más antigua que el pin → needsSetup/update:rootfs (required por debajo de minVersion)', () => {
    const p = probe({ rootfs: { id: 'lazunox-rootfs', version: '2026.9.1' }, payloadSha: 'x' })
    expect(classifyWslStatus({ version, list: listOk, probe: p, expectedRootfsVersion: '2026.10.1' })).toEqual({
      state: 'needsSetup',
      detail: 'update:rootfs'
    })
    expect(
      classifyWslStatus({ version, list: listOk, probe: p, expectedRootfsVersion: '2026.10.1', minRootfsVersion: '2026.10.1' }).detail
    ).toBe('update:rootfs:required')
    expect(classifyWslStatus({ version, list: listOk, probe: p, expectedRootfsVersion: '2026.9.1' }).state).toBe('ready')
  })
  it('carga distinta de la de la app → needsSetup/update:payload', () => {
    const p = probe({ rootfs: { id: 'lazunox-rootfs', version: '2026.10.1' }, payloadSha: 'old' })
    expect(classifyWslStatus({ version, list: listOk, probe: p, expectedRootfsVersion: '2026.10.1', expectedPayloadSha: 'new' })).toEqual({
      state: 'needsSetup',
      detail: 'update:payload'
    })
    expect(classifyWslStatus({ version, list: listOk, probe: p, expectedPayloadSha: 'old' }).state).toBe('ready')
  })
  it('lanzador antiguo (sin campos nuevos) no se juzga: ready aunque haya esperados', () => {
    expect(
      classifyWslStatus({ version, list: listOk, probe: probe(), expectedRootfsVersion: '2026.10.1', expectedPayloadSha: 'n' }).state
    ).toBe('ready')
  })
})

describe('parseWslVersion', () => {
  it('lee WSL y núcleo por posición, en español e inglés', () => {
    for (const t of [VERSION_ES, VERSION_EN]) expect(parseWslVersion(t)).toEqual({ wsl: '2.4.13.0', kernel: '6.6.87.2' })
  })
  it('tolera NUL/UTF-16 mal decodificado, texto vacío y basura', () => {
    expect(parseWslVersion('W\u0000S\u0000L 2.1.5.0\nkernel 5.15.90.1-1\n')).toEqual({ wsl: '2.1.5.0', kernel: '5.15.90.1' })
    expect(parseWslVersion('')).toEqual({ wsl: undefined, kernel: undefined })
    expect(parseWslVersion('Invalid command line option: --version')).toEqual({ wsl: undefined, kernel: undefined })
  })
  it('compareDotted compara numéricamente', () => {
    expect(compareDotted('5.15.153.1', '5.19')).toBeLessThan(0)
    expect(compareDotted('6.6.87.2', '5.19')).toBeGreaterThan(0)
    expect(compareDotted('5.19', '5.19.0')).toBe(0)
  })
})

describe('isDriveFsType y parseProbe ampliado', () => {
  it('9p, drvfs, virtiofs y fuse* son unidades; ext4/tmpfs no', () => {
    for (const t of ['9p', 'drvfs', 'virtiofs', 'fuse', 'fuseblk', 'fuse.sshfs']) expect(isDriveFsType(t)).toBe(true)
    for (const t of ['ext4', 'tmpfs', 'overlay']) expect(isDriveFsType(t)).toBe(false)
  })
  it('acepta campos opcionales válidos y rechaza los mal formados', () => {
    const base = { interop: false, driveMounts: [], landlockAbi: 4, kernel: '6', uid: 0 }
    const j = (o: object): string => JSON.stringify({ ...base, ...o })
    expect(parseProbe(j({ rootfs: { id: 'a', version: '2026.10.1' }, payloadSha: 'x', wslSystemMounts: ['/mnt/wslg'] }))?.payloadSha).toBe(
      'x'
    )
    expect(parseProbe(j({ rootfs: null, payloadSha: null }))?.rootfs).toBeNull()
    for (const bad of [
      { rootfs: 'x' },
      { rootfs: { id: 1 } },
      { payloadSha: 5 },
      { wslSystemMounts: 'x' },
      { wslSystemMounts: [1] },
      { driveMounts: [1] }
    ]) {
      expect(parseProbe(j(bad))).toBeNull()
    }
  })
})
