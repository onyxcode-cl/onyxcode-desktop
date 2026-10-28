import { afterEach, describe, expect, it, vi } from 'vitest'

const pol = vi.hoisted(() => ({ value: null as { disableComputerUse?: boolean } | null }))
vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0', getPath: () => '/ud' },
  shell: {}
}))
vi.mock('./guard', () => ({
  guardInvoke: (_e: unknown, _c: string, a: unknown[]) => a[0],
  validatePayload: (_c: string, a: unknown[]) => a[0],
  IpcGuardError: class extends Error {}
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('../tasks/policy', () => ({
  loadManagedPolicy: () => pol.value,
  isComputerUseDisabled: (p: { disableComputerUse?: boolean } | null) => p?.disableComputerUse === true
}))

import { UNIFIED_APPS_ENV } from '@shared/unified-bridge'
import { registerAppHandlers } from './app'

async function info(): Promise<{ unifiedApps?: boolean }> {
  const handlers = new Map<string, (...a: unknown[]) => unknown>()
  const ipc = { removeHandler: () => undefined, handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn) }
  registerAppHandlers(ipc as never, { chatDirectory: '/chat' })
  const res = (await handlers.get('app:info')!({ sender: {} })) as { data: { unifiedApps?: boolean } }
  return res.data
}

const realPlatform = process.platform
const prevFlag = process.env[UNIFIED_APPS_ENV]
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform })
  if (prevFlag === undefined) delete process.env[UNIFIED_APPS_ENV]
  else process.env[UNIFIED_APPS_ENV] = prevFlag
  pol.value = null
})

describe('app:info.unifiedApps', () => {
  it('bandera apagada: false', async () => {
    delete process.env[UNIFIED_APPS_ENV]
    expect((await info()).unifiedApps).toBe(false)
  })
  it('con bandera: true (en macOS)', async () => {
    process.env[UNIFIED_APPS_ENV] = '1'
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    expect((await info()).unifiedApps).toBe(true)
  })
  it('con la política disableComputerUse: false', async () => {
    process.env[UNIFIED_APPS_ENV] = '1'
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    pol.value = { disableComputerUse: true }
    expect((await info()).unifiedApps).toBe(false)
  })
  it('en Windows: false', async () => {
    process.env[UNIFIED_APPS_ENV] = '1'
    Object.defineProperty(process, 'platform', { value: 'win32' })
    expect((await info()).unifiedApps).toBe(false)
  })
})
