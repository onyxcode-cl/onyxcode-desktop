import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  driveKindFromType,
  parseWinDrives,
  readWinDrives,
  resetWinDrivesCache,
  WIN_DRIVES_TIMEOUT_MS,
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
    expect(args.join(' ')).toContain('Win32_LogicalDisk')
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
  it('falla cerrado: error, tiempo agotado o salida rara → null, y no reutiliza una lectura anterior caducada', async () => {
    let now = 0
    let mode: 'ok' | 'throw' | 'bad' = 'ok'
    const { fn } = mk(async () => {
      if (mode === 'throw') throw new Error('ETIMEDOUT')
      return { stdout: mode === 'bad' ? '<html>' : OUT }
    })
    const deps = { execFile: fn, systemRoot: 'C:\\Windows', now: () => now }
    expect(await readWinDrives(deps)).not.toBeNull()
    now += WIN_DRIVES_TTL_MS + 1
    mode = 'throw'
    expect(await readWinDrives(deps)).toBeNull()
    mode = 'bad'
    expect(await readWinDrives(deps)).toBeNull()
  })
})
