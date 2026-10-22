/**
 * Utilidades de prueba compartidas (no es un test). Solo para los *.test.ts de esta carpeta.
 */
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CpuSample, ProcessPort, SpawnedChild } from './process-port'
import type { Timer } from './manager'

export function tmpBase(prefix = 'lzbg-'): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)))
}

export async function waitFor(pred: () => boolean | Promise<boolean>, ms = 4000, step = 20): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await pred()) return
    await new Promise((r) => setTimeout(r, step))
  }
  throw new Error('waitFor: se agotó el tiempo')
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Proceso falso controlable, para pruebas de supervisión con reloj falso (sin procesos reales). */
export class FakeChild implements SpawnedChild {
  data: ((b: Buffer) => void)[] = []
  exit: ((c: number | null, s: string | null) => void)[] = []
  close: (() => void)[] = []
  constructor(readonly pid: number) {}
  onData(cb: (b: Buffer) => void): void {
    this.data.push(cb)
  }
  onExit(cb: (c: number | null, s: string | null) => void): void {
    this.exit.push(cb)
  }
  onClose(cb: () => void): void {
    this.close.push(cb)
  }
  onError(): void {}
  emit(text: string): void {
    for (const cb of this.data) cb(Buffer.from(text))
  }
  finish(code: number | null, signal: string | null = null): void {
    for (const cb of this.exit) cb(code, signal)
    for (const cb of this.close) cb()
  }
}

export class FakePort implements ProcessPort {
  children: FakeChild[] = []
  alive = new Set<number>()
  sent: [number, string][] = []
  cpu: CpuSample | null = { cpuSeconds: 0, pids: [1] }
  /** Si es `true`, SIGTERM no mata (para forzar el SIGKILL). */
  ignoreTerm = false
  private next = 5000
  spawn(): SpawnedChild {
    const c = new FakeChild(this.next++)
    this.children.push(c)
    this.alive.add(c.pid)
    return c
  }
  killGroup(pgid: number, signal: 'SIGTERM' | 'SIGKILL'): boolean {
    this.sent.push([pgid, signal])
    if (!this.alive.has(pgid)) return false
    if (signal === 'SIGTERM' && this.ignoreTerm) return true
    this.alive.delete(pgid)
    this.children.find((c) => c.pid === pgid)?.finish(null, signal)
    return true
  }
  groupAlive(pgid: number): boolean {
    return this.alive.has(pgid)
  }
  async identity(pid: number): Promise<string | null> {
    return `fake-${pid}`
  }
  async sampleCpu(): Promise<CpuSample | null> {
    return this.cpu
  }
}

/** Temporizadores falsos: no disparan solos; `runAll()` ejecuta los pendientes. */
export class FakeTimers {
  pending: { fn: () => void; ms: number; cancelled: boolean }[] = []
  schedule = (fn: () => void, ms: number): Timer => {
    const t = { fn, ms, cancelled: false }
    this.pending.push(t)
    return {
      cancel: () => {
        t.cancelled = true
      }
    }
  }
  runAll(): void {
    const list = this.pending
    this.pending = []
    for (const t of list) if (!t.cancelled) t.fn()
  }
}
