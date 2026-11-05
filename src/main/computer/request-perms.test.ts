import { describe, expect, it } from 'vitest'
import { requestMacPermissions, type RequestPermsDeps } from './request-perms'

function deps(o: { acc: boolean; scr: boolean; scrAfter?: boolean; throws?: boolean }) {
  const calls: string[] = []
  let triggered = false
  const d: RequestPermsDeps = {
    askAccessibility: () => (calls.push('acc'), o.acc),
    screenGranted: () => (triggered ? (o.scrAfter ?? o.scr) : o.scr),
    triggerScreen: async () => {
      calls.push('trigger')
      triggered = true
      if (o.throws) throw new Error('x')
    },
    openPane: async (p) => void calls.push(`open:${p}`)
  }
  return { d, calls }
}

describe('requestMacPermissions', () => {
  it('falta todo: pide ambos desde la app y abre Accesibilidad primero', async () => {
    const { d, calls } = deps({ acc: false, scr: false })
    expect(await requestMacPermissions(d)).toEqual({ accessibility: false, screenRecording: false })
    expect(calls).toEqual(['acc', 'trigger', 'open:accessibility'])
  })
  it('Accesibilidad dada y falta Pantalla: dispara el aviso de Pantalla y abre su panel', async () => {
    const { d, calls } = deps({ acc: true, scr: false })
    expect(await requestMacPermissions(d)).toEqual({ accessibility: true, screenRecording: false })
    expect(calls).toEqual(['acc', 'trigger', 'open:screen'])
  })
  it('Pantalla ya concedida: no vuelve a pedirla', async () => {
    const { d, calls } = deps({ acc: false, scr: true })
    await requestMacPermissions(d)
    expect(calls).toEqual(['acc', 'open:accessibility'])
  })
  it('todo concedido: no abre nada', async () => {
    const { d, calls } = deps({ acc: true, scr: true })
    expect(await requestMacPermissions(d)).toEqual({ accessibility: true, screenRecording: true })
    expect(calls).toEqual(['acc'])
  })
  it('si el aviso de Pantalla falla, sigue y abre el panel', async () => {
    const { d, calls } = deps({ acc: true, scr: false, throws: true })
    await requestMacPermissions(d)
    expect(calls).toEqual(['acc', 'trigger', 'open:screen'])
  })
  it('si macOS concede Pantalla al instante, no abre su panel', async () => {
    const { d, calls } = deps({ acc: true, scr: false, scrAfter: true })
    expect((await requestMacPermissions(d)).screenRecording).toBe(true)
    expect(calls).toEqual(['acc', 'trigger'])
  })
})
