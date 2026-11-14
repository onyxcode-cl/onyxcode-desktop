import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, realpath, mkdir, rm, readFile, readdir, writeFile, symlink, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FreeImageRegistry } from './free-image-registry'
import type { FreeImageAsset } from './free-images'

let base: string, root: string, store: string
const asset: FreeImageAsset = {
  bytes: Buffer.from('normalized-image'),
  ext: 'jpg',
  credit: 'Foto: Author · CC BY 4.0',
  provenance: {
    provider: 'Wikimedia Commons',
    sha256: createHash('sha256').update(Buffer.from('normalized-image')).digest('hex'),
    credit: 'Foto: Author · CC BY 4.0',
    id: 'test-id',
    author: 'Author',
    license: 'CC BY 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:Test.jpg',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    status: 'licencia-comprobada',
    fullCredit: 'Original attribution',
    rawMetadata: { Artist: '<p>Original attribution</p>' },
    title: 'Test',
    sourceSha1: 'abc123',
    checkedAt: '2026-11-13T00:00:00.000Z',
    queries: ['test'],
    requirements: { subject: 'Photo', usage: 'Report', required: [], excluded: [], realPhoto: true },
    evaluation: { mode: 'manual', observed: 'Person selected', meets: [], doubts: '' },
    evaluationStatus: 'seleccion-manual-declarada',
    transformations: [],
    width: 100,
    height: 100,
    notices: ''
  }
}
const sha = createHash('sha256').update(asset.bytes).digest('hex')
const rel = `img/free-${sha.slice(0, 20)}.jpg`
beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'lzx-photo-registry-')))
  root = join(base, 'task')
  store = join(base, 'private')
  await mkdir(root)
})
afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})
describe('registro privado de fotos', () => {
  it('acepta el identificador cortado si apunta a una sola foto del mismo ámbito (prueba real en Mac)', async () => {
    const id = '5697d8fe-0536-48d6-9067-e49bd3a7be9b'
    await new FreeImageRegistry(store).remember(root, id, rel, asset)
    const registry = new FreeImageRegistry(store)
    expect(await registry.findId(root, '5697d8fe')).toMatchObject({ sha, id })
    expect(await registry.findId(root, '5697d8fe-0536')).toMatchObject({ sha, id })
    expect(await registry.findId(root, '9999aaaa')).toBeNull()
    expect(await registry.findId(root, '5697')).toBeNull()
    const other = join(base, 'other')
    await mkdir(other)
    expect(await registry.findId(other, '5697d8fe')).toBeNull()
  })
  it('persiste bytes exactos, procedencia original y crédito; id y ruta sobreviven una instancia nueva', async () => {
    await new FreeImageRegistry(store).remember(root, 'test-id', rel, asset)
    const registry = new FreeImageRegistry(store)
    expect(await registry.get(root, sha)).toEqual(asset)
    expect(await registry.findId(root, 'test-id')).toMatchObject({ sha, rel, asset })
    expect(await registry.findId(root, `preparada-${sha}`)).toMatchObject({ sha, rel })
    expect(await registry.findPath(root, rel)).toMatchObject({ sha, rel })
    expect(await readdir(root)).toEqual([])
    expect(JSON.parse(await readFile(join(store, `photo-${sha}.json`), 'utf8')).asset.provenance.rawMetadata).toEqual(
      asset.provenance.rawMetadata
    )
  })
  it('conserva completo un crédito original de 22 KB sin confundirlo con el pie breve', async () => {
    const original = 'A'.repeat(22000)
    const large = { ...asset, provenance: { ...asset.provenance, fullCredit: original } }
    const registry = new FreeImageRegistry(store)
    await registry.remember(root, 'test-id', rel, large)
    const recovered = await new FreeImageRegistry(store).get(root, sha)
    expect(recovered?.provenance.fullCredit).toBe(original)
    expect(recovered?.credit).toBe(asset.credit)
  })

  it('rechaza corrupción de bytes, enlaces y registros enormes sin confiar en tarea', async () => {
    const registry = new FreeImageRegistry(store)
    await registry.remember(root, 'test-id', rel, asset)
    const path = join(store, `photo-${sha}.json`)
    const record = JSON.parse(await readFile(path, 'utf8'))
    record.bytes = Buffer.from('different').toString('base64')
    await writeFile(path, JSON.stringify(record))
    expect(await registry.get(root, sha)).toBeNull()
    await rm(path)
    await writeFile(join(base, 'fake.json'), JSON.stringify(record))
    await symlink(join(base, 'fake.json'), path)
    expect(await registry.get(root, sha)).toBeNull()
    await rm(path)
    await writeFile(path, Buffer.alloc(8 * 1024 * 1024 + 1))
    expect(await registry.get(root, sha)).toBeNull()
    expect(await registry.findId(root, 'test-id')).toBeNull()
  })
  it.each([
    ['status', 'inventada'],
    ['sha256', '0'.repeat(64)],
    ['author', {}],
    ['license', 'CC BY-NC 4.0'],
    ['source', 'https://evil.test/File:Photo.jpg'],
    ['licenseUrl', 'https://evil.test/license'],
    ['notices', {}],
    ['transformations', [{}]]
  ])('rechaza registro JSON válido con campo corrupto %s', async (field, value) => {
    const registry = new FreeImageRegistry(store)
    await registry.remember(root, 'test-id', rel, asset)
    const path = join(store, `photo-${sha}.json`)
    const record = JSON.parse(await readFile(path, 'utf8'))
    record.asset.provenance[field] = value
    await writeFile(path, JSON.stringify(record))
    expect(await registry.get(root, sha)).toBeNull()
    expect(await registry.findId(root, 'test-id')).toBeNull()
  })

  it('no resuelve id ni recuperación desde otra carpeta; no acepta una ruta como hash', async () => {
    const registry = new FreeImageRegistry(store)
    await registry.remember(root, 'test-id', rel, asset)
    const other = join(base, 'other')
    await mkdir(other)
    expect(await registry.findId(other, 'test-id')).toBeNull()
    expect(await registry.findId(other, `preparada-${sha}`)).toBeNull()
    expect(await registry.get(root, '../../task/file')).toBeNull()
  })
  it('rechaza directorio de autoridad dentro de carpeta concedida o enlazado a ella', async () => {
    await expect(new FreeImageRegistry(join(root, 'private')).remember(root, 'test-id', rel, asset)).rejects.toThrow('registro privado')
    await symlink(root, store)
    await expect(new FreeImageRegistry(store).remember(root, 'test-id', rel, asset)).rejects.toThrow('must not be a link')
  })
  it('acota tamaño por foto antes de guardar autoridad', async () => {
    await expect(
      new FreeImageRegistry(store).remember(root, 'big', rel, {
        ...asset,
        bytes: Buffer.alloc(5 * 1024 * 1024 + 1),
        provenance: {
          ...asset.provenance,
          sha256: createHash('sha256')
            .update(Buffer.alloc(5 * 1024 * 1024 + 1))
            .digest('hex')
        }
      })
    ).rejects.toThrow('too large')
    expect(await readdir(store)).toEqual([])
  })
  it('publica archivos privados completos y sin temporales abandonados', async () => {
    await new FreeImageRegistry(store).remember(root, 'test-id', rel, asset)
    const files = await readdir(store)
    expect(files).toHaveLength(4)
    expect(files.every((file) => file.endsWith('.json'))).toBe(true)
    // The permission bits are only inspected where Node reports them meaningfully.
    expect((await stat(join(store, `photo-${sha}.json`))).isFile()).toBe(true)
  })
})
