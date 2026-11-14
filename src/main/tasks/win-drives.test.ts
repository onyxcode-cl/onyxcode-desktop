import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProblemLog } from '../diagnostics/problem-log'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  driveKindFromType,
  parseWinDrives,
  readWinDrives,
  readWinDrivesSnapshot,
  resetWinDrivesCache,
  WIN_DRIVES_TIMEOUT_MS,
  WIN_DRIVES_RETRY_TIMEOUT_MS,
  WIN_DRIVES_MAX_AGE_MS,
  WIN_DRIVES_TTL_MS,
  type ExecFileFn
} from './win-drives'

const OUT = JSON.stringify([
  { DeviceID: 'C:', DriveType: 3 },
  { DeviceID: 'D:', DriveType: 2 },
  { DeviceID: 'Z:', DriveType: 4 }
])

describe('driveKindFromType', () => {
  it('traduce DriveType y lo desconocido cierra', () => {
    expect([3, 2, 4, 5, 6, 0, 1, 99, '3', null, undefined].map(driveKindFromType)).toEqual([
      'fixed',
      'removable',
      'network',
      'optical',
      'ram',
      'unknown',
      'unknown',
      'unknown',
      'unknown',
      'unknown',
      'unknown'
    ])
  })
})

describe('parseWinDrives', () => {
  it('lista, objeto único (PowerShell no envuelve un solo elemento) y BOM', () => {
    expect(parseWinDrives(OUT)).toEqual([
      { letter: 'C', kind: 'fixed' },
      { letter: 'D', kind: 'removable' },
      { letter: 'Z', kind: 'network' }
    ])
    expect(parseWinDrives('{"DeviceID":"c:","DriveType":3}')).toEqual([{ letter: 'C', kind: 'fixed' }])
    expect(parseWinDrives('\uFEFF' + OUT)).toHaveLength(3)
  })
  it.each([
    '',
    'no es json',
    '[]',
    'null',
    '42',
    '[1]',
    '[{"DeviceID":"CC:","DriveType":3}]',
    '[{"DriveType":3}]',
    '[{"DeviceID":"\\\\\\\\srv","DriveType":4}]'
  ])('estricto: %s → null', (s) => expect(parseWinDrives(s)).toBeNull())
  it('más de 26 unidades es absurdo', () => {
    expect(parseWinDrives(JSON.stringify(Array.from({ length: 27 }, () => ({ DeviceID: 'C:', DriveType: 3 }))))).toBeNull()
  })
})

describe('readWinDrives (execFile doble)', () => {
  beforeEach(() => resetWinDrivesCache())
  const mk = (impl: ExecFileFn): { fn: ReturnType<typeof vi.fn> & ExecFileFn } => ({ fn: vi.fn(impl) as never })

  it('llama a PowerShell por ruta absoluta, sin shell, con límite de 3 s', async () => {
    const { fn } = mk(async () => ({ stdout: OUT }))
    const d = await readWinDrives({ execFile: fn, systemRoot: 'C:\\Windows\\', now: () => 0 })
    expect(d).toHaveLength(3)
    const [exe, args, opts] = fn.mock.calls[0]!
    expect(exe).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(args).toContain('-NoProfile')
    expect(args.join(' ')).toContain('[System.IO.DriveInfo]::GetDrives()')
    expect(args.join(' ')).toContain('[int]$_.DriveType')
    expect(args.join(' ')).not.toMatch(/Get-CimInstance|IsReady|TotalSize/)
    expect(opts).toMatchObject({ timeout: WIN_DRIVES_TIMEOUT_MS, windowsHide: true })
  })
  it('caché de 30 s y después vuelve a leer', async () => {
    const { fn } = mk(async () => ({ stdout: OUT }))
    let now = 1000
    const deps = { execFile: fn, systemRoot: 'C:\\Windows', now: () => now }
    await readWinDrives(deps)
    now += WIN_DRIVES_TTL_MS - 1
    await readWinDrives(deps)
    expect(fn).toHaveBeenCalledTimes(1)
    now += 2
    await readWinDrives(deps)
    expect(fn).toHaveBeenCalledTimes(2)
  })
  it('un fallo aislado conserva la lista anterior sin extender su edad; a los 120 s cierra', async () => {
    let now = 0
    const fn = vi.fn(async () => ({ stdout: OUT }))
    const deps = { execFile: fn, systemRoot: 'C:\\Windows', now: () => now }
    const good = await readWinDrivesSnapshot(deps)
    now = WIN_DRIVES_TTL_MS + 1
    fn.mockRejectedValue(new Error('ETIMEDOUT'))
    expect(await readWinDrivesSnapshot(deps)).toBe(good)
    expect(fn).toHaveBeenCalledTimes(3)
    now = WIN_DRIVES_MAX_AGE_MS
    expect(await readWinDrives(deps)).toBeNull()
    now = -1
    expect(await readWinDrives(deps)).toBeNull()
  })
  it('el segundo intento dispone de 10 s y puede recuperar un arranque en frío', async () => {
    const fn = vi.fn<ExecFileFn>().mockRejectedValueOnce({ killed: true, signal: 'SIGTERM' }).mockResolvedValue({ stdout: OUT })
    const deps = { execFile: fn, systemRoot: 'C:\\Windows', now: () => 0 }
    expect(await readWinDrives(deps)).toHaveLength(3)
    expect(fn.mock.calls.map((call) => call[2].timeout)).toEqual([WIN_DRIVES_TIMEOUT_MS, WIN_DRIVES_RETRY_TIMEOUT_MS])
  })
  it.each(['error', 'bad'])('sin una lista buena, %s en ambos intentos sigue cerrando', async (mode) => {
    const fn = vi.fn<ExecFileFn>(async () => {
      if (mode === 'error') throw new Error('powershell')
      return { stdout: '<html>' }
    })
    expect(await readWinDrives({ execFile: fn, systemRoot: 'C:\\Windows' })).toBeNull()
    expect(fn).toHaveBeenCalledTimes(2)
  })
  it('registra cada intento fallido y su motivo en problemas.log sin mensajes, salidas ni rutas personales', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'win-drives-log-'))
    try {
      const log = new ProblemLog({ dir })
      const fn = vi
        .fn<ExecFileFn>()
        .mockRejectedValueOnce({ killed: true, signal: 'SIGTERM', message: 'C:\\Users\\Privado token-secreto' })
        .mockResolvedValueOnce({ stdout: 'C:\\Users\\Privado token-secreto' })
      await readWinDrives({ execFile: fn, systemRoot: 'C:\\Windows', record: (problem) => log.record(problem) })
      const raw = readFileSync(join(dir, 'problemas.log'), 'utf8')
      const entries = raw
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(entries.map((entry) => entry.detail)).toEqual([
        { motivo: 'tiempo agotado', intento: 1, limiteMs: 3000 },
        { motivo: 'salida inválida', intento: 2, limiteMs: 10000 }
      ])
      expect(raw).not.toMatch(/Privado|token-secreto|Users|C:/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('comparte una sola consulta concurrente y aísla ejecutores y SystemRoot', async () => {
    let finish!: (result: { stdout: string }) => void
    const fn = vi.fn(() => new Promise<{ stdout: string }>((resolve) => (finish = resolve)))
    const deps = { execFile: fn, systemRoot: 'C:\\Windows', now: () => 0 }
    const a = readWinDrives(deps)
    const b = readWinDrives(deps)
    expect(fn).toHaveBeenCalledTimes(1)
    finish({ stdout: OUT })
    expect(await a).toEqual(await b)
    const other = vi.fn(async () => ({ stdout: '{"DeviceID":"Q:","DriveType":4}' }))
    expect(await readWinDrives({ ...deps, execFile: other })).toEqual([{ letter: 'Q', kind: 'network' }])
    expect(other).toHaveBeenCalledTimes(1)
    const c = readWinDrives({ ...deps, systemRoot: 'D:\\Windows' })
    expect(fn).toHaveBeenCalledTimes(2)
    finish({ stdout: OUT })
    await c
  })
  it('renueva antes del TTL y retiene el éxito mientras falla el primer intento y el reintento', async () => {
    let finish!: (result: { stdout: string }) => void
    const fn = vi.fn(async () => ({ stdout: OUT }))
    let now = 0
    const deps = { execFile: fn, systemRoot: 'C:\\Windows', now: () => now }
    const previous = await readWinDrives(deps)
    now = 25_000
    fn.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    const renewal = readWinDrives(deps, true)
    expect(await readWinDrives(deps)).toBe(previous)
    expect(fn).toHaveBeenCalledTimes(2)
    finish({ stdout: '<bad>' })
    await Promise.resolve()
    expect(fn).toHaveBeenCalledTimes(3)
    finish({ stdout: '<bad>' })
    expect(await renewal).toBe(previous)
  })
  it('no prolonga el TTL por lo que tarde el proceso ni por un reloj que retrocede', async () => {
    let now = 0
    const fn = vi.fn(async () => {
      now += 1000
      return { stdout: OUT }
    })
    const deps = { execFile: fn, systemRoot: 'C:\\Windows', now: () => now }
    await readWinDrives(deps)
    now = WIN_DRIVES_TTL_MS
    await readWinDrives(deps)
    expect(fn).toHaveBeenCalledTimes(2)
    now = 0
    await readWinDrives(deps)
    expect(fn).toHaveBeenCalledTimes(3)
  })
})
