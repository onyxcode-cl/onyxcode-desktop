import { describe, expect, it } from 'vitest'
import { appBundlePath, guideAppAccess, GUIDE_PANES } from './app-guide'

describe('appBundlePath', () => {
  it('saca el paquete .app del ejecutable', () => {
    expect(appBundlePath('/Applications/Lazunox.app/Contents/MacOS/Lazunox')).toBe('/Applications/Lazunox.app')
  })
  it('sin paquete (desarrollo) → null', () => {
    expect(appBundlePath('/x/node_modules/electron/dist/electron')).toBeNull()
  })
})

describe('guideAppAccess', () => {
  const mk = (execPath: string) => {
    const calls: string[] = []
    return {
      calls,
      d: {
        execPath,
        openPane: async (u: string) => void calls.push(`pane:${u}`),
        reveal: (p: string) => void calls.push(`reveal:${p}`),
        copy: (t: string) => void calls.push(`copy:${t}`)
      }
    }
  }
  it('Pantalla: copia la ruta, muestra la app y abre el panel de Grabación de pantalla', async () => {
    const { calls, d } = mk('/Applications/Lazunox.app/Contents/MacOS/Lazunox')
    expect(await guideAppAccess('screen', d)).toEqual({ path: '/Applications/Lazunox.app' })
    expect(calls).toEqual(['copy:/Applications/Lazunox.app', 'reveal:/Applications/Lazunox.app', `pane:${GUIDE_PANES.screen}`])
  })
  it('Disco: abre el panel de Acceso total al disco', async () => {
    const { calls, d } = mk('/Applications/Lazunox.app/Contents/MacOS/Lazunox')
    await guideAppAccess('allFiles', d)
    expect(calls.at(-1)).toBe(`pane:${GUIDE_PANES.allFiles}`)
  })
  it('sin paquete: solo abre el panel, no copia ni muestra nada', async () => {
    const { calls, d } = mk('/x/electron')
    expect(await guideAppAccess('screen', d)).toEqual({ path: null })
    expect(calls).toEqual([`pane:${GUIDE_PANES.screen}`])
  })
})
