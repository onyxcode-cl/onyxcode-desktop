import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { prepareArtifactPhotos, type ArtifactPhotoResolvers } from './artifact-photos'
let dir: string, root: string, path: string
const resolvers: ArtifactPhotoResolvers = { standalone: vi.fn(async (s) => s), chat: vi.fn(async (s) => s), file: vi.fn(async (s) => s) }
beforeEach(async () => {
  vi.clearAllMocks()
  dir = await mkdtemp(join(tmpdir(), 'artifact-context-'))
  root = join(dir, 'project')
  await mkdir(root)
  root = await realpath(root)
  path = join(root, 'deck.html')
  await writeFile(path, '<section class="slide"></section>')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})
describe('contexto autorizado para fotos HTML', () => {
  it('lleva la conversación exacta al resolvedor, sin buscar otras', async () => {
    await prepareArtifactPhotos('imagen:a', { kind: 'chat', sessionId: 'ses_one' }, [], resolvers)
    expect(resolvers.chat).toHaveBeenCalledWith('imagen:a', 'ses_one')
    expect(resolvers.file).not.toHaveBeenCalled()
  })
  it('rechaza identificadores usados como rutas', async () => {
    await expect(prepareArtifactPhotos('', { kind: 'chat', sessionId: '../other' }, [], resolvers)).rejects.toThrow('inválida')
  })
  it('resuelve solo dentro de la carpeta autorizada que contiene el HTML', async () => {
    await prepareArtifactPhotos('html', { kind: 'file', path, root }, [root], resolvers)
    expect(resolvers.file).toHaveBeenCalledWith('html', { root, agentRoots: [root], baseDir: '' })
  })
  it('ancla las rutas relativas al directorio del HTML sin cambiar el ámbito del registro', async () => {
    await mkdir(join(root, 'decks'))
    const nested = join(root, 'decks', 'cafe.html')
    await writeFile(nested, '<section class="slide"></section>')
    await prepareArtifactPhotos('html', { kind: 'file', path: nested, root }, [root], resolvers)
    expect(resolvers.file).toHaveBeenCalledWith('html', { root, agentRoots: [root], baseDir: 'decks' })
  })
  it('no transforma permiso sobre un archivo exacto en permiso de carpeta', async () => {
    await prepareArtifactPhotos('html', { kind: 'file', path }, [path], resolvers)
    expect(resolvers.standalone).toHaveBeenCalledWith('html')
    expect(resolvers.file).not.toHaveBeenCalled()
  })
  it('rechaza carpeta de fotos ajena, aun con HTML autorizado', async () => {
    await expect(prepareArtifactPhotos('html', { kind: 'file', path, root: dir }, [root], resolvers)).rejects.toThrow('fuera del ámbito')
    expect(resolvers.file).not.toHaveBeenCalled()
  })
  it('revalida enlaces al abrir, sin autorizar el destino por el nombre del enlace', async () => {
    const outside = join(dir, 'outside.html')
    await writeFile(outside, 'x')
    const link = join(root, 'linked.html')
    await symlink(outside, link)
    await expect(prepareArtifactPhotos('html', { kind: 'file', path: link }, [root], resolvers)).rejects.toThrow('fuera')
  })
})
