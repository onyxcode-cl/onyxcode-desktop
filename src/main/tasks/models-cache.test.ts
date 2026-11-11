import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { seedConfigModels } from './models-cache'

const roots: string[] = []
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })))

function setup(): { main: string; folder: string } {
  const root = mkdtempSync(join(tmpdir(), 'mc-'))
  roots.push(root)
  const main = join(root, 'main')
  const folder = join(root, 'folder')
  mkdirSync(main, { recursive: true })
  mkdirSync(folder, { recursive: true })
  return { main, folder }
}

describe('seedConfigModels (backends WSL y Seatbelt)', () => {
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
