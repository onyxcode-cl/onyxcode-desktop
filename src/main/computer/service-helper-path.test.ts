import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ app: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => h.app, getAppPath: () => h.app, isPackaged: false },
  globalShortcut: { register: () => true, unregister: () => undefined },
  powerMonitor: { on: () => undefined },
  shell: { openExternal: async () => undefined },
  systemPreferences: { isTrustedAccessibilityClient: () => true, getMediaAccessStatus: () => 'granted' }
}))

import { ComputerService } from './service'

describe('ComputerService.helperPath en pruebas', () => {
  const dirs: string[] = []
  afterEach(() => {
    delete process.env.COMPUTER_TEST_NO_REPO_HELPER
    process.env.COMPUTER_TEST_NO_REPO_HELPER = '1'
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('con la guarda de pruebas nunca devuelve un helper que viva bajo el directorio de trabajo (el real compilado del repo)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'lzx-hp-'))
    dirs.push(tmp)
    h.app = tmp
    const svc = new ComputerService()
    const p = svc.helperPath()
    expect(p === null || !p.startsWith(process.cwd())).toBe(true)
  })

  it('un helper falso fuera del repo (en una carpeta temporal) sí se resuelve', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'lzx-hp-'))
    dirs.push(tmp)
    h.app = tmp
    const bin = join(tmp, 'resources', 'computer-use', 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'cu-helper'), '#!/bin/sh\n', { mode: 0o755 })
    const svc = new ComputerService()
    expect(svc.helperPath()).toBe(join(bin, 'cu-helper'))
  })
})
