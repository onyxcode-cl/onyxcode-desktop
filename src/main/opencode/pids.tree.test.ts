/**
 * Reiniciar el motor con un hijo en curso no deja procesos huérfanos: el sidecar es líder de su grupo, `killTree` alcanza a los
 * descendientes que tienen grupo propio (bash/MCP lanzados `detached`) y `killPids` remata, tras la muerte del líder, a los
 * que ignoraron SIGTERM y ya no cuelgan de él. Procesos reales e inofensivos (`sleep`), solo POSIX.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { posixOnly } from '../../test/platform'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

import { killPids, killTree } from './pids'

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => boolean, ms = 4000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (cond()) return true
    await wait(25)
  }
  return cond()
}

const spawned: ChildProcess[] = []
const extra: number[] = []
afterEach(() => {
  for (const c of spawned.splice(0)) {
    try {
      if (c.pid) process.kill(-c.pid, 'SIGKILL')
    } catch {
      // ya muerto
    }
  }
  for (const p of extra.splice(0)) {
    try {
      process.kill(p, 'SIGKILL')
    } catch {
      // ya muerto
    }
  }
})

/** «Sidecar» falso: líder de grupo que lanza un hijo `detached` (grupo propio) que ignora SIGTERM y duerme. Devuelve el PID del hijo. */
async function fakeSidecar(ignoreTerm: boolean): Promise<{ leader: ChildProcess; childPid: number }> {
  const sh = ignoreTerm ? `trap '' TERM; exec sleep 60` : 'exec sleep 60'
  const script = `
    const { spawn } = require('node:child_process')
    const c = spawn('/bin/sh', ['-c', ${JSON.stringify(sh)}], { detached: true, stdio: 'ignore' })
    console.log(c.pid)
    setInterval(() => {}, 1000)
  `
  const leader = spawn(process.execPath, ['-e', script], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] })
  spawned.push(leader)
  const childPid = await new Promise<number>((resolve, reject) => {
    leader.stdout?.once('data', (d: Buffer) => resolve(Number(d.toString().trim())))
    leader.once('error', reject)
  })
  extra.push(childPid)
  return { leader, childPid }
}

describe.skipIf(!posixOnly)('matar el árbol del motor (procesos reales)', () => {
  it('SIGTERM al árbol alcanza al hijo con grupo propio aunque el líder muera', async () => {
    const { leader, childPid } = await fakeSidecar(false)
    expect(alive(childPid)).toBe(true)
    const seen = killTree(leader.pid, 'SIGTERM')
    expect(seen).toContain(childPid)
    expect(await until(() => !alive(childPid))).toBe(true)
    expect(await until(() => leader.exitCode !== null || leader.signalCode !== null)).toBe(true)
  })

  it('un hijo que ignora SIGTERM sobrevive al líder, pero killPids lo remata (no queda huérfano)', async () => {
    const { leader, childPid } = await fakeSidecar(true)
    const seen = killTree(leader.pid, 'SIGTERM')
    expect(seen).toContain(childPid)
    expect(await until(() => leader.exitCode !== null || leader.signalCode !== null)).toBe(true)
    // Ya huérfano: `killTree` no lo encuentra por parentesco…
    expect(killTree(leader.pid, 'SIGKILL')).not.toContain(childPid)
    expect(alive(childPid)).toBe(true)
    // …pero los PID anotados antes de la muerte del líder sí.
    killPids(seen, 'SIGKILL')
    expect(await until(() => !alive(childPid))).toBe(true)
  })

  it('killPids ignora PID no válidos y el propio', () => {
    expect(() => killPids([0, 1, -5, process.pid, 2 ** 31])).not.toThrow()
    expect(alive(process.pid)).toBe(true)
  })
})
