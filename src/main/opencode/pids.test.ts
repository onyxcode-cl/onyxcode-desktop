/**
 * `killStaleServers` sigue reconociendo servidores huérfanos cuyo `pids.json` trae el `kind` de una
 * versión anterior (tipos antiguos de sandbox y acceso total) además de los actuales (`tasks`, `tasks-full`).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LEGACY_FULL_ACCESS_PID_KIND, LEGACY_SANDBOX_PID_KIND } from '../migrations/legacy-names'

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
      if (c.pid) process.kill(-c.pid, 'SIGKILL')
    } catch {
      // ya muerto
    }
  }
  rmSync(userData, { recursive: true, force: true })
})

/** Falso `opencode serve`: un script llamado `opencode` que duerme, lanzado detached (líder de grupo). */
function fakeServer(): ChildProcess {
  const bin = join(userData, 'opencode')
  // Sin `exec`: el proceso debe seguir llamándose `opencode serve` para pasar `isOpencodeServe`.
  writeFileSync(bin, '#!/bin/sh\nsleep 60\n')
  chmodSync(bin, 0o755)
  const c = spawn(bin, ['serve'], { detached: true, stdio: 'ignore' })
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
    await wait(300)
    expect(isDead(c.pid as number)).toBe(false)
    writeFileSync(join(userData, 'pids.json'), JSON.stringify([{ pid: c.pid, kind, startedAt: 1 }]))
    expect(killStaleServers()).toBe(1)
    await wait(300)
    expect(isDead(c.pid as number)).toBe(true)
    expect(JSON.parse(readFileSync(join(userData, 'pids.json'), 'utf8'))).toEqual([])
  })
})
