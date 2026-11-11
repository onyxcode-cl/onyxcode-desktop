import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { PrPushRequest } from '@shared/ipc-pr'
import { beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  settings: {} as { gitHooksEnabled?: boolean },
  handlers: new Map<string, (req: PrPushRequest, event: IpcMainInvokeEvent) => unknown>(),
  push: vi.fn()
}))
vi.mock('../ipc/handle', () => ({
  makeInvokeHandler: () => (_ipc: unknown, channel: string, fn: (req: PrPushRequest, event: IpcMainInvokeEvent) => unknown) =>
    state.handlers.set(channel, fn)
}))
vi.mock('../store', () => ({ settingsStore: { get: () => state.settings } }))
vi.mock('./git', () => ({ push: state.push }))
vi.mock('./gh', () => ({}))

import { registerPrHandlers } from './handlers'

beforeEach(() => {
  state.settings = {}
  state.handlers.clear()
  state.push.mockReset()
})

it('la subida lee el ajuste de ganchos en main en cada llamada, sin aceptarlo del cliente', async () => {
  const assertProject = vi.fn()
  registerPrHandlers({} as IpcMain, { assertProject })
  const event = {} as IpcMainInvokeEvent
  const req = { cwd: '/proyecto', remote: 'origin', branch: 'feat/a', expectHead: 'a'.repeat(40), allowHooks: true }
  const handler = state.handlers.get('pr:push')!
  await handler(req, event)
  expect(state.push).toHaveBeenLastCalledWith(req, false)
  state.settings.gitHooksEnabled = true
  await handler(req, event)
  expect(state.push).toHaveBeenLastCalledWith(req, true)
  state.settings.gitHooksEnabled = false
  await handler(req, event)
  expect(state.push).toHaveBeenLastCalledWith(req, false)
  expect(assertProject.mock.calls).toEqual(Array(3).fill(['/proyecto', event]))
})
