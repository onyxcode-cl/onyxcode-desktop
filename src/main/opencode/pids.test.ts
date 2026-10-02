/**
 * `killStaleServers` sigue reconociendo servidores huérfanos cuyo `pids.json` trae el `kind` de una
 * versión anterior (tipos antiguos de sandbox y acceso total) además de los actuales (`tasks`, `tasks-full`).
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, copyFileSync, linkSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LEGACY_FULL_ACCESS_PID_KIND, LEGACY_SANDBOX_PID_KIND } from '../migrations/legacy-names'
import { isWin } from '../../test/platform'

let userData = ''
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

import { killStaleServers, normalizePidKind } from './pids'

const children: ChildProcess[] = []
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'onyx-pids-'))
})
afterEach(() => {
  for (const c of children.splice(0)) {
    try {
      if (!c.pid) continue
      if (isWin) execFileSync('taskkill.exe', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 10_000 })
      else process.kill(-c.pid, 'SIGKILL')
    } catch {
      // ya muerto
    }
  }
  rmSync(userData, { recursive: true, force: true })
})

/** Falso `opencode serve`: un script llamado `opencode` que duerme, lanzado detached (líder de grupo). */
function fakeServer(): ChildProcess {
  if (isWin) return fakeServerWin()
  const bin = join(userData, 'opencode')
  // Sin `exec`: el proceso debe seguir llamándose `opencode serve` para pasar `isOpencodeServe`.
  writeFileSync(bin, '#!/bin/sh\nsleep 60\n')
  chmodSync(bin, 0o755)
  const c = spawn(bin, ['serve'], { detached: true, stdio: 'ignore' })
  children.push(c)
  return c
}

/**
 * Windows: `opencode.exe` es un enlace duro (o copia) de node.exe que duerme 60 s; la línea de comandos
 * queda `"…\\opencode.exe" -e "…" serve`, que es lo que reconoce `isOpencodeServe`.
 */
function fakeServerWin(script = 'setTimeout(() => {}, 60000)'): ChildProcess {
  const bin = join(userData, 'opencode.exe')
  try {
    linkSync(process.execPath, bin)
  } catch {
    copyFileSync(process.execPath, bin)
  }
  const c = spawn(bin, ['-e', script, 'serve'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
  children.push(c)
  return c
}

const isDead = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return false
  } catch {
    return true
  }
}
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('normalizePidKind', () => {
  it('traduce los kind heredados y respeta los actuales', () => {
    expect(normalizePidKind(LEGACY_SANDBOX_PID_KIND)).toBe('tasks')
    expect(normalizePidKind(LEGACY_FULL_ACCESS_PID_KIND)).toBe('tasks-full')
    expect(normalizePidKind('tasks')).toBe('tasks')
    expect(normalizePidKind(undefined)).toBe('desconocido')
  })
})

describe('killStaleServers con pids.json de una versión anterior', () => {
  it.each([LEGACY_SANDBOX_PID_KIND, LEGACY_FULL_ACCESS_PID_KIND, 'tasks', 'tasks-full'])('mata el servidor con kind %s', async (kind) => {
    const c = fakeServer()
    await wait(isWin ? 1500 : 300)
    expect(isDead(c.pid as number)).toBe(false)
    writeFileSync(join(userData, 'pids.json'), JSON.stringify([{ pid: c.pid, kind, startedAt: 1 }]))
    expect(killStaleServers()).toBe(1)
    await wait(isWin ? 1000 : 300)
    expect(isDead(c.pid as number)).toBe(true)
    expect(JSON.parse(readFileSync(join(userData, 'pids.json'), 'utf8'))).toEqual([])
  })
})

describe.skipIf(!isWin)('killStaleServers en Windows: mata el ÁRBOL (sin grupos POSIX)', () => {
  it('el nieto del servidor también muere (taskkill /T)', async () => {
    const script =
      "const c=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'ignore'});console.log(c.pid);setTimeout(()=>{},60000)"
    const server = fakeServerWin(script)
    const grandchild = await new Promise<number>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('sin pid del nieto')), 10_000)
      server.stdout?.once('data', (d: Buffer) => {
        clearTimeout(t)
        resolve(Number(d.toString().trim()))
      })
    })
    expect(isDead(grandchild)).toBe(false)
    writeFileSync(join(userData, 'pids.json'), JSON.stringify([{ pid: server.pid, kind: 'main', startedAt: 1 }]))
    expect(killStaleServers()).toBe(1)
    await wait(1500)
    expect(isDead(server.pid as number)).toBe(true)
    expect(isDead(grandchild)).toBe(true)
  })
})
