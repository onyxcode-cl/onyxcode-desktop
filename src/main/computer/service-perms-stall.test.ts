/** `reportPermsStall`: el registro de problemas recibe lo que dice el helper, sin rutas ni datos personales. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { macOnly } from '../../test/platform'

const h = vi.hoisted(() => ({ dir: '', ax: false, screen: 'denied', record: vi.fn() }))

vi.mock('electron', async () => {
  const { EventEmitter: EE } = await import('node:events')
  return {
    app: { getPath: (n: string) => (n === 'temp' ? join(h.dir, 'tmp') : h.dir), getAppPath: () => join(h.dir, 'app'), isPackaged: false },
    globalShortcut: { register: () => true, unregister: () => undefined },
    powerMonitor: new EE(),
    shell: { openExternal: async () => undefined },
    systemPreferences: { isTrustedAccessibilityClient: () => h.ax, getMediaAccessStatus: () => h.screen }
  }
})
vi.mock('../diagnostics/problem-log', () => ({ recordProblem: (...a: unknown[]) => h.record(...a) }))

import { ComputerService } from './service'

let svc: ComputerService | null = null
beforeEach(() => {
  h.dir = mkdtempSync(join(tmpdir(), 'svc-stall-'))
  h.record.mockReset()
})
afterEach(() => {
  svc?.dispose()
  svc = null
  rmSync(h.dir, { recursive: true, force: true })
})

// macOS: usa el estado de TCC de macOS (en Windows el control del PC va por consentimiento propio).
describe.skipIf(!macOnly)('ComputerService.reportPermsStall (macOS)', () => {
  it('anota helperOk/accessibility/screenRecording y la ubicación, como proceso', async () => {
    h.ax = true
    h.screen = 'denied'
    svc = new ComputerService()
    // Hermético: `helperPath()` también busca bajo `process.cwd()/resources/computer-use/bin`; en un checkout con el ayudante compilado
    // el test hablaba con el ayudante REAL (permisos reales del Mac de quien lo corre) en vez de los permisos simulados de arriba.
    vi.spyOn(svc, 'helperPath').mockReturnValue(null)
    await svc.reportPermsStall()
    expect(h.record).toHaveBeenCalledTimes(1)
    const p = h.record.mock.calls[0][0] as { source: string; detail: Record<string, string> }
    expect(p.source).toBe('process')
    expect(p.detail).toMatchObject({ accessibility: 'sí', screenRecording: 'no', ubicacion: 'normal' })
    expect(Object.keys(p.detail).sort()).toEqual(['accessibility', 'helperOk', 'screenRecording', 'ubicacion'])
  })
})
