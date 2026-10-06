/**
 * `selectBackend` en Windows falla CERRADO (A18, hueco H1): solo devuelve el backend de la distro con la bandera, la constante
 * de compilación, el informe del PC en verde y un backend creable. Cualquier otra combinación lanza; jamás `none`.
 */
import { describe, expect, it } from 'vitest'
import { selectBackend, WinBackendUnavailable, type WinBackendProvider } from './index'
import type { SandboxBackend } from './types'

const wsl = { id: 'wsl', status: async () => ({ state: 'ready' }), launch: async () => ({}) } as unknown as SandboxBackend
const prov = (o: Partial<WinBackendProvider> = {}): WinBackendProvider => ({
  build: true,
  report: async () => true,
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
  it('sin informe en verde (o si comprobarlo falla) lanza', async () => {
    expect(await block(selectBackend('win32', { tasksWin: true, win: prov({ report: async () => false }) }))).toBe('report')
    expect(
      await block(
        selectBackend('win32', {
          tasksWin: true,
          win: prov({
            report: async () => {
              throw new Error('x')
            }
          })
        })
      )
    ).toBe('report')
    expect(await block(selectBackend('win32', { tasksWin: true, win: prov({ report: async () => 'yes' as unknown as boolean }) }))).toBe(
      'report'
    )
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
