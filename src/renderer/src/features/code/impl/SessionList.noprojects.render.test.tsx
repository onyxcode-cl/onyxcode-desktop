/** Code sin ningún proyecto abierto: la barra lateral muestra las carpetas recientes y SIEMPRE «Agregar carpeta» (como Overdrive). */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const o = vi.hoisted(() => ({ recent: [] as string[] }))
vi.mock('../../../stores/settings', async (orig) => {
  const mod = await orig<typeof import('../../../stores/settings')>()
  const useSettings = Object.assign(
    (sel: (s: unknown) => unknown) =>
      sel({ ...mod.useSettings.getState(), settings: { ...mod.useSettings.getState().settings, recentFolders: o.recent } }),
    mod.useSettings
  )
  return { ...mod, useSettings }
})

import { SidebarTree } from '../../../components/SidebarTreeRoot'
import { useCode } from './store'
import { SessionList } from './SessionList'

afterEach(() => {
  o.recent = []
  useCode.setState({ directory: null, openDirectories: [] })
})

const render = (): string => renderToStaticMarkup(createElement(SidebarTree, null, createElement(SessionList)))

describe('SessionList sin proyectos abiertos (escritorio)', () => {
  it('muestra «Agregar carpeta» aunque no haya recientes', () => {
    useCode.setState({ directory: null, openDirectories: [] })
    const html = render()
    expect(html).toContain('data-testid="code-no-projects"')
    expect(html).toContain('Agregar carpeta')
    expect(html).toContain('Aún no hay proyectos')
  })

  it('lista las carpetas recientes con su nombre (no la ruta entera) y deja «Agregar carpeta» al final', () => {
    useCode.setState({ directory: null, openDirectories: [] })
    o.recent = ['/Users/ben/Documents/Yogui Tv', '/Users/ben/Documents/Andes Re']
    const html = render()
    expect(html).toContain('>Yogui Tv<')
    expect(html).toContain('>Andes Re<')
    expect(html).toContain('title="/Users/ben/Documents/Yogui Tv"')
    expect(html.indexOf('Agregar carpeta')).toBeGreaterThan(html.indexOf('Andes Re'))
  })

  it('con más de 8 recientes muestra solo 8', () => {
    useCode.setState({ directory: null, openDirectories: [] })
    o.recent = Array.from({ length: 12 }, (_, i) => `/x/carpeta${i}`)
    const html = render()
    expect(html).toContain('>carpeta7<')
    expect(html).not.toContain('>carpeta8<')
  })
})
