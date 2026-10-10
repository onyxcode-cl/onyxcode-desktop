import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { seedModelsCache } from './models-cache'

function setup(): { main: string; folder: string } {
  const root = mkdtempSync(join(tmpdir(), 'mc-'))
  const main = join(root, 'main')
  const folder = join(root, 'folder')
  mkdirSync(main, { recursive: true })
  mkdirSync(folder, { recursive: true })
  return { main, folder }
}

describe('seedModelsCache', () => {
  it('copia el catálogo al caché de la carpeta cuando no existe', () => {
    const { main, folder } = setup()
    writeFileSync(join(main, 'models.json'), '{"a":1}')
    expect(seedModelsCache(folder, main)).toBe(true)
    expect(readFileSync(join(folder, 'opencode', 'models.json'), 'utf8')).toBe('{"a":1}')
  })
  it('no copia si el de la carpeta ya es igual o más nuevo, y lo actualiza si es más viejo', () => {
    const { main, folder } = setup()
    writeFileSync(join(main, 'models.json'), '{"v":2}')
    expect(seedModelsCache(folder, main)).toBe(true)
    expect(seedModelsCache(folder, main)).toBe(false)
    const old = new Date(Date.now() - 86_400_000)
    utimesSync(join(folder, 'opencode', 'models.json'), old, old)
    expect(seedModelsCache(folder, main)).toBe(true)
  })
  it('sin catálogo principal no hace nada ni lanza', () => {
    const { main, folder } = setup()
    expect(seedModelsCache(folder, main)).toBe(false)
  })
})
