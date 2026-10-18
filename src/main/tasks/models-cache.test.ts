import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { seedBinaries, seedConfigModels, seedModelsCache } from './models-cache'

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

describe('seedBinaries', () => {
  it('copia los binarios que faltan (rg) con permiso de ejecución y no pisa los existentes', () => {
    const { main, folder } = setup()
    mkdirSync(join(main, 'bin'), { recursive: true })
    writeFileSync(join(main, 'bin', 'rg'), 'binario')
    expect(seedBinaries(folder, main)).toBe(true)
    const dest = join(folder, 'opencode', 'bin', 'rg')
    expect(readFileSync(dest, 'utf8')).toBe('binario')
    // Windows no tiene bit de ejecución: solo se comprueba en macOS/Linux.
    if (process.platform !== 'win32') expect(statSync(dest).mode & 0o111).not.toBe(0)
    expect(seedBinaries(folder, main)).toBe(false)
  })
  it('sin carpeta bin principal no hace nada', () => {
    const { main, folder } = setup()
    expect(seedBinaries(folder, main)).toBe(false)
    expect(existsSync(join(folder, 'opencode', 'bin'))).toBe(false)
  })
})

describe('seedConfigModels (backend WSL)', () => {
  it('copia models.json a <config>/catalogo y devuelve su ruta; no vuelve a copiar si está al día', () => {
    const { main, folder: cfg } = setup()
    writeFileSync(join(main, 'models.json'), '{"m":1}')
    const dest = seedConfigModels(cfg, main)
    expect(dest).toBe(join(cfg, 'catalogo', 'models.json'))
    expect(readFileSync(dest!, 'utf8')).toBe('{"m":1}')
    writeFileSync(dest!, '{"m":"tocado"}')
    expect(seedConfigModels(cfg, main)).toBe(dest)
    expect(readFileSync(dest!, 'utf8')).toBe('{"m":"tocado"}')
  })
  it('actualiza si el principal es más nuevo', () => {
    const { main, folder: cfg } = setup()
    writeFileSync(join(main, 'models.json'), '{"v":1}')
    const dest = seedConfigModels(cfg, main)!
    const old = new Date(Date.now() - 86_400_000)
    utimesSync(dest, old, old)
    writeFileSync(join(main, 'models.json'), '{"v":2}')
    expect(seedConfigModels(cfg, main)).toBe(dest)
    expect(readFileSync(dest, 'utf8')).toBe('{"v":2}')
  })
  it('sin catálogo principal o con la carpeta imposible devuelve null y no lanza', () => {
    const { main, folder: cfg } = setup()
    expect(seedConfigModels(cfg, main)).toBeNull()
    writeFileSync(join(main, 'models.json'), '{}')
    writeFileSync(join(cfg, 'catalogo'), 'es un archivo, no una carpeta')
    expect(seedConfigModels(cfg, main)).toBeNull()
  })
})
