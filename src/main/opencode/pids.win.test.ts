/**
 * Rama de Windows de `pids.ts` con `execFileSync` simulado y `process.platform` forzado a win32: sin
 * `/bin/ps` ni `process.kill(-pid)`. Corre igual en macOS y en Windows (no lanza procesos reales).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userData = ''
vi.mock('electron', () => ({ app: { getPath: () => userData } }))
const exec = vi.fn()
vi.mock('node:child_process', () => ({ execFileSync: (...a: unknown[]) => exec(...a) }))

import { collectDescendants, isOpencodeServe, killStaleServers, killTree, parseWinProcesses } from './pids'

const realPlatform = process.platform
const setPlatform = (p: string): void => {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'onyx-pids-win-'))
  exec.mockReset()
  setPlatform('win32')
})
afterEach(() => {
  setPlatform(realPlatform)
  rmSync(userData, { recursive: true, force: true })
})

describe('isOpencodeServe', () => {
  it.each([
    '/Users/x/.opencode/bin/opencode serve --port 4096',
    'opencode serve --hostname 127.0.0.1',
    '"C:\\Program Files\\OnyxCode\\resources\\opencode\\opencode.exe" serve --port 5000 --hostname 127.0.0.1',
    'C:\\onyx\\opencode.exe serve --port 5000',
    'sandbox-exec -f p.sb /a/opencode serve --port 1'
  ])('reconoce %s', (cmd) => expect(isOpencodeServe(cmd)).toBe(true))
  it.each(['/usr/bin/sleep 60', '"C:\\x\\opencode.exe" --version', 'C:\\opencode-helper.exe serve', 'node server.js serve'])(
    'rechaza %s',
    (cmd) => expect(isOpencodeServe(cmd)).toBe(false)
  )
})

describe('parseWinProcesses / collectDescendants', () => {
  it('acepta un objeto suelto o una lista y tolera basura', () => {
    expect(parseWinProcesses('{"ProcessId":5,"ParentProcessId":1,"CommandLine":"a b"}')).toEqual([{ pid: 5, ppid: 1, command: 'a b' }])
    expect(parseWinProcesses('[{"ProcessId":5,"ParentProcessId":1,"CommandLine":null},{"x":1}]')).toEqual([
      { pid: 5, ppid: 1, command: '' }
    ])
    expect(parseWinProcesses('')).toEqual([])
    expect(parseWinProcesses('no es json')).toEqual([])
  })
  it('recorre el árbol sin incluir la raíz ni el propio proceso', () => {
    const pairs: Array<[number, number]> = [
      [2, 1],
      [3, 2],
      [4, 3],
      [5, 9],
      [99, 2]
    ]
    expect(collectDescendants(pairs, 2, 99).sort()).toEqual([3, 4])
  })
})

describe('killTree en win32', () => {
  it('usa taskkill /T /F con timeout y sin ventana, y no lanza si falla', () => {
    killTree(1234, 'SIGTERM')
    expect(exec).toHaveBeenCalledTimes(1)
    const [cmd, args, opts] = exec.mock.calls[0]
    expect(cmd).toBe('taskkill.exe')
    expect(args).toEqual(['/PID', '1234', '/T', '/F'])
    expect(opts).toMatchObject({ windowsHide: true, timeout: 5000 })
    exec.mockImplementation(() => {
      throw new Error('no existe')
    })
    expect(() => killTree(1234)).not.toThrow()
  })
  it('no hace nada sin pid', () => {
    killTree(undefined)
    expect(exec).not.toHaveBeenCalled()
  })
})

describe('killStaleServers en win32', () => {
  it('inspecciona con CIM, mata solo un opencode serve y limpia pids.json', () => {
    writeFileSync(
      join(userData, 'pids.json'),
      JSON.stringify([
        { pid: 4001, kind: 'main', startedAt: 1 },
        { pid: 4002, kind: 'main', startedAt: 1 }
      ])
    )
    exec.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'powershell.exe') {
        const script = args[args.length - 1]
        if (script.includes('ProcessId=4001'))
          return '{"ProcessId":4001,"ParentProcessId":1,"CommandLine":"\\"C:\\\\a\\\\opencode.exe\\" serve --port 5000"}'
        if (script.includes('ProcessId=4002')) return '{"ProcessId":4002,"ParentProcessId":1,"CommandLine":"C:\\\\Windows\\\\notepad.exe"}'
      }
      return ''
    })
    expect(killStaleServers()).toBe(1)
    const killed = exec.mock.calls.filter((c) => c[0] === 'taskkill.exe').map((c) => c[1][1])
    expect(killed).toEqual(['4001'])
    const ps = exec.mock.calls.find((c) => c[0] === 'powershell.exe')
    expect(ps?.[1]).toEqual(expect.arrayContaining(['-NoProfile', '-NonInteractive']))
    expect(ps?.[2]).toMatchObject({ timeout: 5000, windowsHide: true })
    expect(JSON.parse(readFileSync(join(userData, 'pids.json'), 'utf8'))).toEqual([])
  })
  it('sin pids.json no consulta nada', () => {
    expect(killStaleServers()).toBe(0)
    expect(exec).not.toHaveBeenCalled()
  })
})
