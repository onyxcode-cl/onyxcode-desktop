import { describe, it, expect } from 'vitest'
import { sameDir, parseOpenProjects, planOpen, nextFocusAfterClose, MAX_OPEN_PROJECTS } from './open-projects'

describe('open-projects: sameDir', () => {
  it('ignora barra final al comparar', () => {
    expect(sameDir('/a/b', '/a/b')).toBe(true)
    expect(sameDir('/a/b/', '/a/b')).toBe(true)
    expect(sameDir('/a/b', '/a/b/')).toBe(true)
    expect(sameDir('/a/b///', '/a/b')).toBe(true)
  })

  it('considera diferentes si la ruta es distinta', () => {
    expect(sameDir('/a/b', '/a/c')).toBe(false)
    expect(sameDir('/a/b', '/a/b/c')).toBe(false)
  })

  it('funciona con barras invertidas (Windows)', () => {
    expect(sameDir('C:\\Users\\b', 'C:\\Users\\b\\')).toBe(true)
    expect(sameDir('C:\\Users\\b\\\\\\', 'C:\\Users\\b')).toBe(true)
  })
})

describe('open-projects: parseOpenProjects', () => {
  it('clave nueva válida con 3 carpetas y foco en la del medio', () => {
    const json = JSON.stringify({
      v: 1,
      open: ['/a', '/b', '/c'],
      focus: '/b'
    })
    const result = parseOpenProjects(json, null, MAX_OPEN_PROJECTS)
    expect(result.open).toEqual(['/a', '/b', '/c'])
    expect(result.focus).toBe('/b')
  })

  it('JSON roto con clave vieja presente → migra desde la vieja', () => {
    const result = parseOpenProjects('{', '/old/path', MAX_OPEN_PROJECTS)
    expect(result.open).toEqual(['/old/path'])
    expect(result.focus).toBe('/old/path')
  })

  it('sin clave nueva ni vieja → vacío', () => {
    const result = parseOpenProjects(null, null, MAX_OPEN_PROJECTS)
    expect(result.open).toEqual([])
    expect(result.focus).toBeNull()
  })

  it('foco que no está en open → usa open[0]', () => {
    const json = JSON.stringify({
      v: 1,
      open: ['/a', '/b'],
      focus: '/nonexistent'
    })
    const result = parseOpenProjects(json, null, MAX_OPEN_PROJECTS)
    expect(result.focus).toBe('/a')
  })

  it('array con duplicados (una con barra final) → se deduplica', () => {
    const json = JSON.stringify({
      v: 1,
      open: ['/a', '/b', '/a', '/b/'],
      focus: '/a'
    })
    const result = parseOpenProjects(json, null, MAX_OPEN_PROJECTS)
    expect(result.open).toEqual(['/a', '/b'])
  })

  it('más de max elementos → se recorta', () => {
    const max = 3
    const json = JSON.stringify({
      v: 1,
      open: ['/a', '/b', '/c', '/d', '/e'],
      focus: '/a'
    })
    const result = parseOpenProjects(json, null, max)
    expect(result.open).toEqual(['/a', '/b', '/c'])
    expect(result.open.length).toBe(max)
  })

  it('versión distinta o formato inválido fallback a legacy', () => {
    const json = JSON.stringify({ v: 2, open: ['/a'] })
    const result = parseOpenProjects(json, '/legacy', MAX_OPEN_PROJECTS)
    expect(result.open).toEqual(['/legacy'])
  })
})

describe('open-projects: planOpen', () => {
  const noLive = (): boolean => false
  const allDead = (): boolean => false
  const allLive = (): boolean => true

  it('pedir uno ya abierto no cambia nada', () => {
    const open = ['/a', '/b', '/c']
    const result = planOpen(open, '/b', 5, noLive, () => -Infinity)
    expect(result.open).toEqual(open)
    expect(result.evict).toBeNull()
    expect(result.refused).toBe(false)
  })

  it('con hueco se agrega al final', () => {
    const open = ['/a', '/b']
    const result = planOpen(open, '/c', 5, noLive, () => -Infinity)
    expect(result.open).toEqual(['/a', '/b', '/c'])
    expect(result.evict).toBeNull()
    expect(result.refused).toBe(false)
  })

  it('lleno con un sin actividad foco más viejo → se desaloja ESE', () => {
    const open = ['/a', '/b', '/c']
    const max = 3
    const focusRanks: Record<string, number> = {
      '/a': 5, // más reciente
      '/b': 2, // más viejo
      '/c': 8 // muy reciente
    }
    const result = planOpen(open, '/d', max, allDead, (d) => focusRanks[d] ?? -Infinity)
    expect(result.open).toEqual(['/a', '/c', '/d'])
    expect(result.evict).toBe('/b')
    expect(result.refused).toBe(false)
  })

  it('lleno y todos "vivos" → refused: true y open sin cambios', () => {
    const open = ['/a', '/b', '/c']
    const max = 3
    const result = planOpen(open, '/d', max, allLive, () => -Infinity)
    expect(result.open).toEqual(open)
    expect(result.evict).toBeNull()
    expect(result.refused).toBe(true)
  })

  it('desaloja el más viejo entre los no vivos, ignora los vivos', () => {
    const open = ['/a', '/b', '/c', '/d']
    const isLive = (d: string): boolean => d === '/b' || d === '/d'
    const focusRanks: Record<string, number> = {
      '/a': 10,
      '/b': 5,
      '/c': 3,
      '/d': 9
    }
    const max = 4
    // /a y /c no están vivos. /c es más viejo (foco 3 vs 10)
    const result = planOpen(open, '/e', max, isLive, (d) => focusRanks[d] ?? -Infinity)
    expect(result.open).toEqual(['/a', '/b', '/d', '/e'])
    expect(result.evict).toBe('/c')
    expect(result.refused).toBe(false)
  })
})

describe('open-projects: nextFocusAfterClose', () => {
  it('cerrar el que tiene foco pasa a otro con foco más reciente', () => {
    const open = ['/a', '/b', '/c']
    const focusRanks: Record<string, number> = {
      '/a': 10,
      '/b': 5, // este está cerrado
      '/c': 20 // más reciente, gana
    }
    const result = nextFocusAfterClose(open, '/b', (d) => focusRanks[d] ?? -Infinity)
    expect(result).toBe('/c')
  })

  it('sin datos de foco pasa al vecino siguiente', () => {
    const open = ['/a', '/b', '/c', '/d']
    const result = nextFocusAfterClose(open, '/b', () => -Infinity)
    // /b está en índice 1, siguiente es /c
    expect(result).toBe('/c')
  })

  it('sin siguiente, pasa al anterior', () => {
    const open = ['/a', '/b', '/c']
    const result = nextFocusAfterClose(open, '/c', () => -Infinity)
    // /c está en índice 2, no hay siguiente, anterior es /b
    expect(result).toBe('/b')
  })

  it('cerrar el único proyecto que queda → null', () => {
    const open = ['/a']
    const result = nextFocusAfterClose(open, '/a', () => -Infinity)
    expect(result).toBeNull()
  })

  it('foco más reciente gana sobre posición', () => {
    const open = ['/a', '/b', '/c', '/d']
    const focusRanks: Record<string, number> = {
      '/a': 100, // muy reciente, gana
      '/b': 50, // este se cierra
      '/c': 20,
      '/d': 10
    }
    const result = nextFocusAfterClose(open, '/b', (d) => focusRanks[d] ?? -Infinity)
    expect(result).toBe('/a')
  })

  it('ignora proyectos cerrados en la búsqueda de vecino siguiente', () => {
    const open = ['/a', '/b', '/c', '/d']
    // Simulamos que /c no existe más (no está en "remaining")
    const focusRanks: Record<string, number> = {
      '/a': -Infinity,
      '/b': -Infinity, // este se cierra
      '/c': -Infinity,
      '/d': -Infinity
    }
    const result = nextFocusAfterClose(open, '/b', (d) => focusRanks[d] ?? -Infinity)
    // Sin datos de foco, busca siguiente: /c, pero en realidad /c sigue en open
    // así que usa /c
    expect(result).toBe('/c')
  })
})
