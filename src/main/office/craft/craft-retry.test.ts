import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CraftStatus } from './craft-install'
import { RETRY_INTERVAL_MS, readAttempt, retryIncompleteInstall, writeAttempt, type CraftAttemptState } from './craft-retry'

let dir: string
let statePath: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lzx-craft-retry-'))
  statePath = join(dir, 'bin', 'craft-intento.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const missing: CraftStatus = { state: 'missing', version: '1.0.0', sizeBytes: 1 }
const installed: CraftStatus = { state: 'installed', version: '1.0.0', bin: 'x', bins: {} }

const make = (status: CraftStatus, now = 1_000_000_000) => {
  const install = vi.fn(async () => ({ ok: true as const }))
  return { install, run: () => retryIncompleteInstall({ statePath, now: () => now, status: () => status, install }) }
}
const seed = (s: CraftAttemptState): void => writeAttempt(statePath, s)

describe('retryIncompleteInstall', () => {
  it('sin ningún intento previo NO descarga nada (no hay consentimiento)', async () => {
    const { run, install } = make(missing)
    expect(await run()).toBe('not-attempted')
    expect(install).not.toHaveBeenCalled()
  })

  it('si ya está instalado no hace nada', async () => {
    seed({ last: 'failed' })
    const { run, install } = make(installed)
    expect(await run()).toBe('not-needed')
    expect(install).not.toHaveBeenCalled()
  })

  it('un intento fallido o cortado a medias se reintenta y se sella la hora', async () => {
    seed({ last: 'failed' })
    const a = make(missing)
    expect(await a.run()).toBe('ok')
    expect(a.install).toHaveBeenCalledTimes(1)
    expect(readAttempt(statePath).autoAt).toBe(1_000_000_000)

    seed({ last: 'started' })
    const b = make(missing)
    expect(await b.run()).toBe('ok')
  })

  it('como máximo una vez cada 24 h', async () => {
    seed({ last: 'failed', autoAt: 1_000_000_000 })
    const soon = make(missing, 1_000_000_000 + RETRY_INTERVAL_MS - 1)
    expect(await soon.run()).toBe('too-soon')
    expect(soon.install).not.toHaveBeenCalled()
    const later = make(missing, 1_000_000_000 + RETRY_INTERVAL_MS)
    expect(await later.run()).toBe('ok')
  })

  it('si la persona canceló a propósito, no se reintenta', async () => {
    seed({ last: 'cancelled' })
    const { run, install } = make(missing)
    expect(await run()).toBe('cancelled')
    expect(install).not.toHaveBeenCalled()
  })

  it('devuelve «failed» si el reintento falla (el sello ya quedó escrito)', async () => {
    seed({ last: 'failed' })
    const install = vi.fn(async () => ({ ok: false as const, error: 'download', message: 'x' }))
    const r = await retryIncompleteInstall({ statePath, now: () => 5, status: () => missing, install })
    expect(r).toBe('failed')
    expect(readAttempt(statePath).autoAt).toBe(5)
  })

  it('un archivo de estado ilegible cuenta como «sin intento»', () => {
    expect(readAttempt(join(dir, 'no-existe.json'))).toEqual({})
  })
})
