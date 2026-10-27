/** keepVisibleBundleIds: las apps con permiso «solo esta sesión» no se ocultan mientras el agente las usa. */
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ own: false }))

vi.mock('electron', () => ({
  BrowserWindow: class {},
  Notification: class {},
  app: { getPath: () => '/tmp/x' },
  screen: { screenToDipPoint: (p: unknown) => p }
}))
vi.mock('../computer/service', () => ({
  ComputerService: class {
    ownConsent = h.own
    instant = false
    prefs = { get: () => ({ hideOtherApps: false, unhideOnFinish: false, mode: 'background' }) }
    grants = { snapshot: () => ({ grants: [{ bundleId: 'com.saved' }] }) }
    allSessionGrantedApps = (): string[] => ['com.session']
    helperPath = (): string => ''
  }
}))
vi.mock('../computer/overlay', () => ({ ComputerOverlay: class {} }))
vi.mock('../computer/assist-window', () => ({ AssistWindow: class {} }))
vi.mock('../computer/recorder', () => ({ SkillRecorder: class { purgeOld(): void {} } }))
vi.mock('../computer/app-visibility', () => ({ AppVisibility: class { recoverAtStartup = async (): Promise<void> => undefined } }))
vi.mock('../computer/abort', () => ({ abortFullAccessSessions: vi.fn() }))
vi.mock('../tasks/auto-approver', () => ({ getAutoApprover: () => null }))
vi.mock('../extras/prefs', () => ({ extrasPrefs: () => ({}) }))

import { createComputerParts } from './tasks-computer-wiring'

describe('keepVisibleBundleIds', () => {
  it('incluye las apps con permiso de sesión además de las guardadas', () => {
    h.own = false
    const ids = createComputerParts().keepVisibleBundleIds()
    expect(ids).toContain('com.saved')
    expect(ids).toContain('com.session')
    expect(ids).toContain('com.apple.finder')
  })
  it('también en Windows (consentimiento propio)', () => {
    h.own = true
    const ids = createComputerParts().keepVisibleBundleIds()
    expect(ids).toEqual(['com.saved', 'com.session'])
  })
})
