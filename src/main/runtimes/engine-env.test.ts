import { describe, expect, it, vi } from 'vitest'
import type { AppRuntimeBins, RuntimesStatus } from './runtime-install'
const state = vi.hoisted(() => ({
  bins: { node: null, uv: null, npmCli: null } as AppRuntimeBins,
  status: { node: { state: 'missing' }, uv: { state: 'broken' } } as RuntimesStatus
}))
vi.mock('./service', () => ({ runtimesService: () => ({ bins: () => state.bins, check: () => state.status }) }))
import { appRuntimePathEnv, appRuntimeReadOnlyDirs, runtimePathEnv } from './engine-env'

const none: AppRuntimeBins = { node: null, uv: null, npmCli: null }
describe('PATH de los runtimes para la IA', () => {
  it('Mac: conserva primero el Node de la persona y agrega bin de Node/npm/npx y uv al final', () => {
    const bins = { node: '/app/runtimes/node-1/bin/node', uv: '/app/runtimes/uv-1/bin/uv', npmCli: '/app/runtimes/node-1/lib/npm-cli.js' }
    expect(runtimePathEnv(bins, { PATH: '/mi-node/bin:/usr/bin' }, 'darwin')).toEqual({
      PATH: '/mi-node/bin:/usr/bin:/app/runtimes/node-1/bin:/app/runtimes/uv-1/bin'
    })
  })
  it('Windows: conserva Path y usa las carpetas de node.exe/npm.cmd/npx.cmd y uv.exe', () => {
    const bins = { node: 'C:\\app\\runtimes\\node-1\\node.exe', uv: 'C:\\app\\runtimes\\uv-1\\bin\\uv.exe', npmCli: null }
    expect(runtimePathEnv(bins, { Path: 'C:\\mi-node;C:\\Windows' }, 'win32')).toEqual({
      Path: 'C:\\mi-node;C:\\Windows;C:\\app\\runtimes\\node-1;C:\\app\\runtimes\\uv-1\\bin'
    })
  })
  it('sin runtimes no toca el PATH; cada runtime puede estar listo por separado', () => {
    expect(runtimePathEnv(none, { PATH: '/user' }, 'darwin')).toEqual({})
    expect(runtimePathEnv({ ...none, uv: '/uv/bin/uv' }, {}, 'darwin')).toEqual({ PATH: '/uv/bin' })
    expect(runtimePathEnv({ ...none, node: '/node/bin/node' }, { PATH: '/node/bin:/usr/bin' }, 'darwin')).toEqual({
      PATH: '/node/bin:/usr/bin'
    })
  })
  it('consulta de nuevo en el siguiente arranque, sin recordar un estado ausente', () => {
    state.bins = none
    expect(appRuntimePathEnv({ PATH: '/user' })).toEqual({})
    state.bins = { ...none, node: '/node/bin/node' }
    expect(Object.values(appRuntimePathEnv({ PATH: '/user' }))[0]).toContain('node')
    state.bins = none
  })
  it('Seatbelt solo abre las carpetas de las versiones verificadas, incluido lib de npm', () => {
    expect(appRuntimeReadOnlyDirs()).toEqual([])
    state.status.node = { state: 'installed', version: '1', dir: '/app/runtimes/node-1', bin: '/app/runtimes/node-1/bin/node' }
    expect(appRuntimeReadOnlyDirs()).toEqual(['/app/runtimes/node-1'])
    state.status.node = { state: 'missing', version: '1', sizeBytes: 10 }
  })
})
