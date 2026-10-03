import { describe, expect, it, vi } from 'vitest'
import { createRemoteSender, getRemoteSender, isRemoteSender } from './sender'

describe('RemoteSender', () => {
  it('ids negativos y únicos; reenvía por el canal inyectable', () => {
    const sent: unknown[][] = []
    const a = createRemoteSender((ch, ...args) => sent.push([ch, ...args]))
    const b = createRemoteSender(() => undefined)
    expect(a.id).toBeLessThan(0)
    expect(b.id).toBeLessThan(0)
    expect(a.id).not.toBe(b.id)
    a.send('pty:data', { id: 'x' })
    expect(sent).toEqual([['pty:data', { id: 'x' }]])
    expect(isRemoteSender(a)).toBe(true)
    expect(isRemoteSender({ id: 1 })).toBe(false)
    expect(getRemoteSender(a.id)).toBe(a)
  })

  it('destroy: dispara once(destroyed) una vez, deja de enviar y sale del registro', () => {
    const send = vi.fn()
    const s = createRemoteSender(send)
    const l = vi.fn()
    s.once('destroyed', l)
    s.on('did-start-navigation', l)
    s.on('render-process-gone', l)
    expect(s.isDestroyed()).toBe(false)
    s.destroy()
    s.destroy()
    expect(l).toHaveBeenCalledTimes(1)
    expect(s.isDestroyed()).toBe(true)
    s.send('x')
    expect(send).not.toHaveBeenCalled()
    expect(getRemoteSender(s.id)).toBeUndefined()
    const late = vi.fn()
    s.once('destroyed', late)
    expect(late).toHaveBeenCalledTimes(1)
  })

  it('un canal que lanza o un liberador que lanza no rompen al remitente', () => {
    const s = createRemoteSender(() => {
      throw new Error('canal caído')
    })
    expect(() => s.send('x')).not.toThrow()
    const ok = vi.fn()
    s.once('destroyed', () => {
      throw new Error('x')
    })
    s.once('destroyed', ok)
    expect(() => s.destroy()).not.toThrow()
    expect(ok).toHaveBeenCalled()
  })
})
