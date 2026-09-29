import { describe, expect, it, vi } from 'vitest'
import type { IpcRenderer } from 'electron'
import { makeBridge } from './bridge'

function fakeIpc(result: unknown = { ok: true, data: 42 }): {
  ipc: IpcRenderer
  invoke: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  removeListener: ReturnType<typeof vi.fn>
} {
  const invoke = vi.fn(async () => result)
  const on = vi.fn()
  const removeListener = vi.fn()
  return {
    ipc: { invoke, on, removeListener } as unknown as IpcRenderer,
    invoke,
    on,
    removeListener
  }
}

const opts = { invoke: ['a:ok'] as const, events: ['e:ok'] as const }

describe('makeBridge', () => {
  it('invokeRaw con canal prohibido resuelve {ok:false, code:FORBIDDEN} sin llamar a ipc', async () => {
    const f = fakeIpc()
    const b = makeBridge<string, string>(f.ipc, opts)
    expect(await b.invokeRaw('x:no')).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      error: 'Canal IPC no permitido: x:no'
    })
    expect(f.invoke).not.toHaveBeenCalled()
  })

  it('invokeRaw devuelve el resultado envuelto tal cual', async () => {
    const f = fakeIpc({ ok: false, code: 'X', error: 'boom' })
    const b = makeBridge<string, string>(f.ipc, opts)
    expect(await b.invokeRaw('a:ok', 1)).toEqual({
      ok: false,
      code: 'X',
      error: 'boom'
    })
    expect(f.invoke).toHaveBeenCalledWith('a:ok', 1)
  })

  it('invokeUnwrap ok devuelve data', async () => {
    const b = makeBridge<string, string>(fakeIpc().ipc, opts)
    expect(await b.invokeUnwrap('a:ok')).toBe(42)
  })

  it('invokeUnwrap con error rechaza con el mensaje', async () => {
    const b = makeBridge<string, string>(fakeIpc({ ok: false, error: 'fallo' }).ipc, opts)
    await expect(b.invokeUnwrap('a:ok')).rejects.toThrow('fallo')
  })

  it('invokeUnwrap con canal prohibido rechaza', async () => {
    const b = makeBridge<string, string>(fakeIpc().ipc, opts)
    await expect(b.invokeUnwrap('x:no')).rejects.toThrow('Canal IPC no permitido: x:no')
  })

  it('on con evento prohibido lanza', () => {
    const b = makeBridge<string, string>(fakeIpc().ipc, opts)
    expect(() => b.on('x:no', () => undefined)).toThrow('Evento IPC no permitido: x:no')
  })

  it('on entrega el payload y la des-suscripción quita el mismo listener', () => {
    const f = fakeIpc()
    const b = makeBridge<string, string>(f.ipc, opts)
    const l = vi.fn()
    const off = b.on('e:ok', l)
    const wrapped = f.on.mock.calls[0][1] as (e: unknown, p: unknown) => void
    wrapped({}, 'p')
    expect(l).toHaveBeenCalledWith('p')
    off()
    expect(f.removeListener).toHaveBeenCalledWith('e:ok', wrapped)
  })
})
