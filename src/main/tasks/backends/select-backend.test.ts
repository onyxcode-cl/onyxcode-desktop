/**
 * `selectBackend` en Windows falla CERRADO (A18, hueco H1): solo devuelve el backend de la distro con la bandera, la constante
 * de compilación, la puerta de integridad (`gate()`: no elevado, paquete, carga, estado) y un backend creable.
 * Cualquier otra combinación lanza; jamás `none`.
 */
import { describe, expect, it } from 'vitest'
import { selectBackend, WinBackendUnavailable, type WinBackendProvider } from './index'
import type { SandboxBackend } from './types'

const wsl = { id: 'wsl', status: async () => ({ state: 'ready' }), launch: async () => ({}) } as unknown as SandboxBackend
const prov = (o: Partial<WinBackendProvider> = {}): WinBackendProvider => ({
  build: true,
  gate: async () => ({ ok: true }),
  create: () => wsl,
  ...o
})

async function block(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof WinBackendUnavailable ? e.block : `otro:${String(e)}`
  }
  return 'no lanzó'
}

describe('selectBackend(win32)', () => {
  it('con todo en orden devuelve el backend de la distro', async () => {
    expect(await selectBackend('win32', { tasksWin: true, win: prov() })).toBe(wsl)
  })
  it('sin la bandera tasksWin lanza (aunque haya proveedor)', async () => {
    expect(await block(selectBackend('win32', { tasksWin: false, win: prov() }))).toBe('flag')
    expect(await block(selectBackend('win32', { win: prov() }))).toBe('flag')
    expect(await block(selectBackend('win32', { tasksWin: 'true' as unknown as boolean, win: prov() }))).toBe('flag')
    expect(await block(selectBackend('win32'))).toBe('flag')
  })
  it('sin proveedor lanza', async () => {
    expect(await block(selectBackend('win32', { tasksWin: true }))).toBe('provider')
  })
  it('con la constante de compilación apagada lanza aunque la bandera llegue encendida', async () => {
    expect(await block(selectBackend('win32', { tasksWin: true, win: prov({ build: false }) }))).toBe('build')
    expect(await block(selectBackend('win32', { tasksWin: true, win: prov({ build: 1 as unknown as boolean }) }))).toBe('build')
  })
  it('la puerta cerrada lanza con el bloque de su motivo (elevado, paquete; el resto es `gate`)', async () => {
    const closed = (reason: string): WinBackendProvider => prov({ gate: async () => ({ ok: false, reason: reason as never }) })
    expect(await block(selectBackend('win32', { tasksWin: true, win: closed('elevated') }))).toBe('elevated')
    expect(await block(selectBackend('win32', { tasksWin: true, win: closed('elevated') }))).toBe('elevated')
    expect(await block(selectBackend('win32', { tasksWin: true, win: closed('bundle') }))).toBe('bundle')
    for (const r of ['pin', 'payload', 'state', 'policy', 'otra-cosa']) {
      expect(await block(selectBackend('win32', { tasksWin: true, win: closed(r) }))).toBe('gate')
    }
    expect(await block(selectBackend('win32', { tasksWin: true, win: prov({ gate: async () => ({ ok: false }) }) }))).toBe('gate')
  })
  it('si la puerta falla al comprobar o responde algo raro, cierra (`gate`)', async () => {
    const boom = prov({
      gate: async () => {
        throw new Error('x')
      }
    })
    expect(await block(selectBackend('win32', { tasksWin: true, win: boom }))).toBe('gate')
    for (const odd of [undefined, null, true, 'yes', { ok: 'true' }, { ok: 1 }]) {
      expect(await block(selectBackend('win32', { tasksWin: true, win: prov({ gate: (async () => odd) as never }) }))).toBe('gate')
    }
  })
  it('la puerta se consulta en CADA llamada (un cambio de estado cierra el siguiente arranque)', async () => {
    let open = true
    const win = prov({ gate: async () => (open ? { ok: true } : { ok: false, reason: 'elevated' }) })
    expect(await selectBackend('win32', { tasksWin: true, win })).toBe(wsl)
    open = false
    expect(await block(selectBackend('win32', { tasksWin: true, win }))).toBe('elevated')
  })
  it('el propósito llega a la puerta: por defecto `run` (estricto); `setup` solo lo pide quien prepara la distro', async () => {
    const seen: unknown[] = []
    const win = prov({
      gate: async (purpose) => {
        seen.push(purpose)
        return { ok: true }
      }
    })
    await selectBackend('win32', { tasksWin: true, win })
    await selectBackend('win32', { tasksWin: true, win, purpose: 'setup' })
    expect(seen).toEqual(['run', 'setup'])
  })
  it('no queda `report` en el proveedor: un proveedor antiguo sin `gate` cierra', async () => {
    const old = { build: true, report: async () => true, create: () => wsl } as unknown as WinBackendProvider
    expect(await block(selectBackend('win32', { tasksWin: true, win: old }))).toBe('gate')
  })
  it('sin backend creable (falta pin, carga o %LOCALAPPDATA%) lanza', async () => {
    expect(await block(selectBackend('win32', { tasksWin: true, win: prov({ create: () => null }) }))).toBe('backend')
    expect(
      await block(
        selectBackend('win32', {
          tasksWin: true,
          win: prov({
            create: () => {
              throw new Error('x')
            }
          })
        })
      )
    ).toBe('backend')
  })
  it('un backend que no es el de la distro (p. ej. `none`) se rechaza', async () => {
    const none = { id: 'none' } as unknown as SandboxBackend
    expect(await block(selectBackend('win32', { tasksWin: true, win: prov({ create: () => none }) }))).toBe('backend')
  })
})

describe('selectBackend(otras plataformas)', () => {
  it('ignora la bandera y el proveedor: Windows no se cuela en otras plataformas', async () => {
    for (const p of ['linux', 'freebsd', 'remote']) {
      expect((await selectBackend(p, { tasksWin: true, win: prov() })).id).toBe('none')
    }
    expect((await selectBackend('darwin', { tasksWin: true, win: prov() })).id).not.toBe('wsl')
  })
})
