import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ adhoc: true }))
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getAppPath: () => '/tmp', isPackaged: true },
  globalShortcut: { register: () => true, unregister: () => undefined },
  powerMonitor: { on: () => undefined },
  shell: { openExternal: async () => undefined },
  systemPreferences: { isTrustedAccessibilityClient: () => false, getMediaAccessStatus: () => 'denied' }
}))
vi.mock('./adhoc', () => ({ isAdhocSigned: async () => h.adhoc }))

import { ComputerService } from './service'

describe('ComputerService.status con la app empaquetada', () => {
  it.skipIf(process.platform !== 'darwin')('marca adhoc cuando la firma es ad-hoc (sin ayudante también)', async () => {
    const svc = new ComputerService()
    vi.spyOn(svc, 'helperPath').mockReturnValue(null)
    h.adhoc = true
    expect(await svc.status()).toMatchObject({ helperOk: false, accessibility: false, adhoc: true })
    h.adhoc = false
    expect((await svc.status()).adhoc).toBeUndefined()
  })
})
