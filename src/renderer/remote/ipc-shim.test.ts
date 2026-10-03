import { describe, expect, it } from 'vitest'
import { IPC_EVENT_CHANNELS, IPC_INVOKE_CHANNELS } from '@shared/ipc'
import { BROWSER_INVOKE_CHANNELS } from '@shared/ipc-browser'
import { IPC_EXTRAS_INVOKE_CHANNELS } from '@shared/ipc-extras'
import { REMOTE_INVOKE_CHANNELS } from '@shared/ipc-remote'
import { TASKS_INVOKE_CHANNELS } from '@shared/ipc-tasks'
import { MuxCallError } from '@shared/remote/mux'
import { abortError } from '@shared/remote/link'
import { EventsHub } from './events-hub'
import { FakeLink } from './fake-link'
import { REMOTE_PLATFORM, buildRemoteWindowApi } from './ipc-shim'

const text = (c: string): string => `err:${c}`

function rig(): { link: FakeLink; hub: EventsHub; api: ReturnType<typeof buildRemoteWindowApi>; errors: Error[] } {
  const link = new FakeLink()
  const hub = new EventsHub(link)
  const errors: Error[] = []
  return { link, hub, api: buildRemoteWindowApi({ link, events: hub, text, onError: (e) => errors.push(e) }), errors }
}

describe('window.api del celular', () => {
  it('declara la superficie remote y tiene la misma forma que el preload de escritorio', () => {
    const { api } = rig()
    expect(api.platform).toBe(REMOTE_PLATFORM)
    expect(Object.keys(api).sort()).toEqual(['browser', 'code', 'extras', 'invoke', 'on', 'platform', 'remote', 'tasks'])
    expect(typeof api.code.git.status).toBe('function')
    expect(typeof api.code.onFilesChanged).toBe('function')
  })

  it('invoke → trama call{ch,p}; la respuesta vuelve envuelta como IpcResult', async () => {
    const { api, link } = rig()
    link.onCall = async () => ({ language: 'es' })
    expect(await api.invoke('settings:get')).toEqual({ ok: true, data: { language: 'es' } })
    expect(link.calls[0]).toMatchObject({ ch: 'settings:get', p: undefined })
    await api.invoke('settings:set', { theme: 'dark' })
    expect(link.calls[1]).toMatchObject({ ch: 'settings:set', p: { theme: 'dark' } })
  })

  it('cada canal de las listas de `src/shared/ipc*.ts` llega al puente con su mismo nombre', async () => {
    const { api, link } = rig()
    const seen = (): string[] => link.calls.map((c) => c.ch)
    for (const ch of IPC_INVOKE_CHANNELS) await (api.invoke as (c: string, r?: unknown) => Promise<unknown>)(ch, undefined)
    for (const ch of TASKS_INVOKE_CHANNELS) await (api.tasks.invoke as (c: string, r?: unknown) => Promise<unknown>)(ch, undefined)
    for (const ch of BROWSER_INVOKE_CHANNELS) await (api.browser.invoke as (c: string, r?: unknown) => Promise<unknown>)(ch, undefined)
    for (const ch of IPC_EXTRAS_INVOKE_CHANNELS) await (api.extras.invoke as (c: string, r?: unknown) => Promise<unknown>)(ch, undefined)
    for (const ch of REMOTE_INVOKE_CHANNELS) await (api.remote.invoke as (c: string, r?: unknown) => Promise<unknown>)(ch, undefined)
    const expected = [
      ...IPC_INVOKE_CHANNELS,
      ...TASKS_INVOKE_CHANNELS,
      ...BROWSER_INVOKE_CHANNELS,
      ...IPC_EXTRAS_INVOKE_CHANNELS,
      ...REMOTE_INVOKE_CHANNELS
    ]
    expect(seen()).toEqual(expected)
  })

  it('los wrappers de `api.code` mandan su canal con la forma del preload y desenvuelven', async () => {
    const { api, link } = rig()
    link.onCall = async (ch) => (ch === 'git:status' ? { isRepo: true } : undefined)
    expect(await api.code.git.status('/p')).toEqual({ isRepo: true })
    expect(link.calls[0]).toMatchObject({ ch: 'git:status', p: { cwd: '/p' } })
    await api.code.files.rename('/p', '/p/a', 'b')
    expect(link.calls[1]).toMatchObject({ ch: 'files:rename', p: { cwd: '/p', path: '/p/a', name: 'b' } })
  })

  it('un canal que no está en la lista nunca sale al puente', async () => {
    const { api, link } = rig()
    const r = await (api.invoke as unknown as (c: string) => Promise<{ ok: boolean; code?: string }>)('remote:confirmAction')
    expect(r).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(link.calls).toHaveLength(0)
  })

  const mapping: Array<[() => Error, string, string]> = [
    [() => new MuxCallError('forbidden'), 'FORBIDDEN', 'err:forbidden'],
    [() => new MuxCallError('forbidden', 'locked'), 'FORBIDDEN', 'err:locked'],
    [() => new MuxCallError('forbidden', 'rejected'), 'FORBIDDEN', 'err:denied'],
    [() => new MuxCallError('busy'), 'BUSY', 'err:busy'],
    [() => new MuxCallError('rate-limited'), 'BUSY', 'err:rate-limited'],
    [() => new MuxCallError('disconnected'), 'ERROR', 'err:disconnected'],
    [() => new MuxCallError('unavailable'), 'ERROR', 'err:unavailable'],
    [() => new MuxCallError('failed', 'No existe la carpeta'), 'ERROR', 'No existe la carpeta'],
    [() => new Error('offline'), 'ERROR', 'err:disconnected']
  ]
  it.each(mapping)('error del puente %# → IpcResult de error con código y texto legible', async (mk, code, message) => {
    const { api, link, errors } = rig()
    link.onCall = () => Promise.reject(mk())
    expect(await api.invoke('settings:get')).toEqual({ ok: false, code, error: message })
    expect(errors).toHaveLength(1)
  })

  it('los wrappers que desenvuelven (code/extras) lanzan Error con el texto legible', async () => {
    const { api, link } = rig()
    link.onCall = () => Promise.reject(new MuxCallError('disconnected'))
    await expect(api.code.git.status('/p')).rejects.toThrow('err:disconnected')
  })

  it('cancelar no cuenta como fallo del puente', async () => {
    const { api, link, errors } = rig()
    link.onCall = () => Promise.reject(abortError())
    expect(await api.invoke('settings:get')).toMatchObject({ ok: false, error: 'aborted' })
    expect(errors).toHaveLength(0)
  })

  it('on(evento) se suscribe al bus remoto y la baja cancela la suscripción', () => {
    const { api, link } = rig()
    const got: unknown[] = []
    const off = api.on('opencode:status', (p) => got.push(p))
    link.live('main')!.h.onReady?.(0)
    link.live('main')!.h.onEvent({ seq: 1, ch: 'opencode:status', p: { state: 'ready' } })
    link.live('main')!.h.onEvent({ seq: 2, ch: 'settings:changed', p: {} })
    expect(got).toEqual([{ state: 'ready' }])
    const sub = link.live('main')!
    off()
    expect(sub.cancelled).toBe(true)
  })

  it('on() con un evento fuera de la lista lanza (como el preload)', () => {
    const { api } = rig()
    expect(() => (api.on as unknown as (c: string, f: () => void) => void)('pty:data', () => undefined)).toThrow()
    expect(IPC_EVENT_CHANNELS).not.toContain('pty:data')
  })

  it('los eventos de Code (`files:changed`) llegan por api.code.onFilesChanged', () => {
    const { api, link } = rig()
    const got: unknown[] = []
    api.code.onFilesChanged((p) => got.push(p))
    link.live('main')!.h.onReady?.(0)
    link.live('main')!.h.onEvent({ seq: 1, ch: 'files:changed', p: { subId: 'a', paths: ['x'] } })
    expect(got).toEqual([{ subId: 'a', paths: ['x'] }])
  })
})
