// @vitest-environment jsdom
// Tarjeta de carpeta que macOS no deja leer (F8-B210) y comprobación previa en `openProjectTrusted`.
import { vi } from 'vitest'

vi.hoisted(() => vi.unstubAllGlobals())
const native = vi.hoisted(() => ({
  dialog: {
    checkFolderAccess: vi.fn((_p: string) => Promise.resolve({ status: 'denied' as string, canReset: true })),
    resetFolderPermission: vi.fn((_p: string) => Promise.resolve({ result: 'reset' as string })),
    openFolderPrivacy: vi.fn(() => Promise.resolve()),
    openFolder: vi.fn(() => Promise.resolve(null))
  }
}))
vi.mock('./client', async (orig) => ({ ...(await orig<typeof import('./client')>()), nativeCode: () => native, requireCode: () => native }))
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useLang } from '../../../lib/i18n'
import { TrustGate } from './ProjectPicker'
import { openProjectTrusted } from './trust'
import { setBlockedFolder } from './folder-access'
import { useCode } from './store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const openProject = vi.fn((_d: string) => Promise.resolve())
const dir = '/Users/yo/Documents/proyecto'

beforeEach(async () => {
  useLang.setState({ lang: 'es' })
  native.dialog.checkFolderAccess.mockClear()
  native.dialog.openFolderPrivacy.mockClear()
  native.dialog.resetFolderPermission.mockClear()
  native.dialog.resetFolderPermission.mockResolvedValue({ result: 'reset' })
  openProject.mockClear()
  useCode.setState({ openProject, trustedFolders: [dir], isTrusted: () => true } as never)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(createElement(TrustGate)))
})
afterEach(async () => {
  await act(async () => setBlockedFolder(null))
  await act(async () => root.unmount())
  host.remove()
})

describe('carpeta denegada por macOS', () => {
  it('causa «motor»: texto propio que nombra «Lazunox Motor», con «Volver a preguntar a macOS» y sin abrir; «Volver a comprobar» re-ejecuta la sonda', async () => {
    native.dialog.checkFolderAccess.mockResolvedValue({ status: 'denied', canReset: true, cause: 'engine' } as never)
    let ok = true
    await act(async () => {
      ok = await openProjectTrusted(dir)
    })
    expect(ok).toBe(false)
    expect(openProject).not.toHaveBeenCalled()
    const card = host.querySelector('[role="alertdialog"]')!
    expect(card.textContent).toContain('macOS no dejó al motor de Lazunox leer esta carpeta')
    expect(card.textContent).toContain('Archivos y carpetas')
    expect(card.textContent).toContain('«Lazunox Motor»')
    expect(card.textContent).not.toContain('opencode')
    expect(card.textContent).toContain('Volver a preguntar a macOS')
    expect(card.textContent).not.toMatch(/tccutil|sudo|Terminal/)
    expect(card.textContent).toContain('Elegir otra carpeta')
    expect(document.activeElement?.textContent).toBe('Volver a preguntar a macOS')
    const btn = (label: string): HTMLElement => [...host.querySelectorAll('button')].find((b) => b.textContent === label)!
    native.dialog.checkFolderAccess.mockResolvedValue({ status: 'ok', canReset: false, cause: 'app' } as never)
    await act(async () => btn('Volver a comprobar').click())
    expect(native.dialog.checkFolderAccess).toHaveBeenCalledTimes(3)
    expect(openProject).toHaveBeenCalledWith(dir)
  })
  it('al volver a elegir una carpeta con «No permitir» guardado: borra la decisión y vuelve a comprobar (macOS vuelve a preguntar) sin pasar por Ajustes', async () => {
    native.dialog.checkFolderAccess.mockResolvedValueOnce({ status: 'denied', canReset: true, cause: 'engine' } as never)
    native.dialog.checkFolderAccess.mockResolvedValueOnce({ status: 'ok', canReset: false, cause: 'app' } as never)
    let ok = false
    await act(async () => {
      ok = await openProjectTrusted(dir)
    })
    expect(native.dialog.resetFolderPermission).toHaveBeenCalledExactlyOnceWith(dir)
    expect(native.dialog.checkFolderAccess).toHaveBeenCalledTimes(2)
    expect(ok).toBe(true)
    expect(openProject).toHaveBeenCalledWith(dir)
    expect(host.querySelector('[role="alertdialog"]')).toBeNull()
  })
  it('si la persona vuelve a decir «No permitir»: una sola vez, sin bucle, y queda la tarjeta', async () => {
    native.dialog.checkFolderAccess.mockResolvedValue({ status: 'denied', canReset: true, cause: 'engine' } as never)
    let ok = true
    await act(async () => {
      ok = await openProjectTrusted(dir)
    })
    expect(ok).toBe(false)
    expect(native.dialog.resetFolderPermission).toHaveBeenCalledTimes(1)
    expect(native.dialog.checkFolderAccess).toHaveBeenCalledTimes(2)
    expect(openProject).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alertdialog"]')).not.toBeNull()
  })
  it('restauración pasiva (al arrancar): nunca borra la decisión ni insiste', async () => {
    native.dialog.checkFolderAccess.mockResolvedValue({ status: 'denied', canReset: true, cause: 'engine' } as never)
    await act(async () => void (await openProjectTrusted(dir, { passive: true })))
    expect(native.dialog.resetFolderPermission).not.toHaveBeenCalled()
    expect(native.dialog.checkFolderAccess).toHaveBeenCalledTimes(1)
  })
  it('no se reinicia ante un timeout (el aviso aún puede estar esperando respuesta) ni si la carpeta no es restablecible', async () => {
    native.dialog.checkFolderAccess.mockResolvedValue({ status: 'timeout', canReset: true } as never)
    await act(async () => void (await openProjectTrusted(dir)))
    native.dialog.checkFolderAccess.mockResolvedValue({ status: 'denied', canReset: false } as never)
    await act(async () => void (await openProjectTrusted(dir)))
    expect(native.dialog.resetFolderPermission).not.toHaveBeenCalled()
  })
  it('no abre el proyecto ni arranca el motor y muestra la tarjeta accesible', async () => {
    native.dialog.checkFolderAccess.mockResolvedValue({ status: 'denied', canReset: true })
    let ok = true
    await act(async () => {
      ok = await openProjectTrusted(dir)
    })
    expect(ok).toBe(false)
    expect(openProject).not.toHaveBeenCalled()
    const card = host.querySelector('[role="alertdialog"]')!
    expect(card.getAttribute('aria-modal')).toBe('true')
    expect(card.textContent).toContain('macOS no dejó a Lazunox leer esta carpeta')
    expect(card.textContent).toContain('Archivos y carpetas')
    expect(card.textContent).toContain('Abrir Ajustes del Sistema')
    expect(card.textContent).toContain('Elegir otra carpeta')
    expect(document.activeElement?.textContent).toBe('Volver a preguntar a macOS')
    const btn = (label: string): HTMLElement => [...host.querySelectorAll('button')].find((b) => b.textContent === label)!
    await act(async () => btn('Abrir Ajustes del Sistema').click())
    expect(native.dialog.openFolderPrivacy).toHaveBeenLastCalledWith('files')
    await act(async () => btn('Acceso total al disco').click())
    expect(native.dialog.openFolderPrivacy).toHaveBeenLastCalledWith('allFiles')
  })
  it('timeout: otra tarjeta, tampoco abre', async () => {
    native.dialog.checkFolderAccess.mockResolvedValue({ status: 'timeout', canReset: true })
    await act(async () => void (await openProjectTrusted(dir)))
    expect(openProject).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Esta carpeta no responde')
  })
  it('Volver a comprobar re-comprueba sin caché y abre al estar permitido; Escape cierra', async () => {
    native.dialog.checkFolderAccess.mockResolvedValue({ status: 'denied', canReset: true })
    await act(async () => void (await openProjectTrusted(dir)))
    native.dialog.checkFolderAccess.mockResolvedValue({ status: 'ok', canReset: false })
    const retry = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Volver a comprobar')!
    await act(async () => retry.click())
    expect(native.dialog.checkFolderAccess).toHaveBeenCalledTimes(3)
    expect(openProject).toHaveBeenCalledWith(dir)
    expect(host.querySelector('[role="alertdialog"]')).toBeNull()

    native.dialog.checkFolderAccess.mockResolvedValue({ status: 'denied', canReset: true })
    await act(async () => void (await openProjectTrusted(dir)))
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(host.querySelector('[role="alertdialog"]')).toBeNull()
  })
  it('carpeta legible: abre normal y sin tarjeta; si la comprobación falla, sigue (falla abierto)', async () => {
    native.dialog.checkFolderAccess.mockResolvedValue({ status: 'ok', canReset: false })
    await act(async () => void (await openProjectTrusted(dir)))
    expect(openProject).toHaveBeenCalledTimes(1)
    native.dialog.checkFolderAccess.mockRejectedValue(new Error('boom'))
    await act(async () => void (await openProjectTrusted(dir)))
    expect(openProject).toHaveBeenCalledTimes(2)
    expect(host.querySelector('[role="alertdialog"]')).toBeNull()
  })
  it('«Volver a preguntar a macOS»: pide el reset de esa ruta y re-comprueba (sin caché) y abre si ya se puede', async () => {
    native.dialog.checkFolderAccess.mockResolvedValue({ status: 'denied', canReset: true })
    await act(async () => void (await openProjectTrusted(dir)))
    native.dialog.checkFolderAccess.mockResolvedValue({ status: 'ok', canReset: false })
    const ask = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Volver a preguntar a macOS')!
    await act(async () => ask.click())
    expect(native.dialog.resetFolderPermission).toHaveBeenCalledTimes(2)
    expect(native.dialog.checkFolderAccess).toHaveBeenCalledTimes(3)
    expect(openProject).toHaveBeenCalledWith(dir)
  })
  it('si el reset falla: la tarjeta vuelve con el aviso y sigue ofreciendo Ajustes', async () => {
    native.dialog.checkFolderAccess.mockResolvedValue({ status: 'denied', canReset: true })
    await act(async () => void (await openProjectTrusted(dir)))
    native.dialog.resetFolderPermission.mockResolvedValue({ result: 'failed' })
    const ask = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Volver a preguntar a macOS')!
    await act(async () => ask.click())
    expect(openProject).not.toHaveBeenCalled()
    expect(host.textContent).toContain('No se pudo pedir a macOS que vuelva a preguntar')
    expect(host.textContent).toContain('Abrir Ajustes del Sistema')
  })
  it('carpeta no restablecible (sin zona TCC): no ofrece «Volver a preguntar» y Ajustes es el botón principal', async () => {
    native.dialog.checkFolderAccess.mockResolvedValue({ status: 'denied', canReset: false })
    await act(async () => void (await openProjectTrusted(dir)))
    expect(host.textContent).not.toContain('Volver a preguntar a macOS')
    expect(document.activeElement?.textContent).toBe('Abrir Ajustes del Sistema')
  })
})
