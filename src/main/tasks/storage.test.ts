/** Almacenamiento de Tareas (W6/H11): en Windows no se usa `du`; se mide con Node y no se siguen enlaces. */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sizeFnFor, storageReport, walkBytes, duBytes, type StorageEnv } from './storage'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lzx-storage-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function fill(): void {
  mkdirSync(join(root, 'a', 'b'), { recursive: true })
  writeFileSync(join(root, 'a', 'x.bin'), Buffer.alloc(1000))
  writeFileSync(join(root, 'a', 'b', 'y.bin'), Buffer.alloc(234))
}

describe('walkBytes', () => {
  it('suma los archivos del árbol', async () => {
    fill()
    expect(await walkBytes(join(root, 'a'))).toBe(1234)
  })
  it('una ruta que no existe vale 0', async () => {
    expect(await walkBytes(join(root, 'nada'))).toBe(0)
  })
  it('no sigue enlaces simbólicos (ni cuenta lo de fuera ni se cicla)', async () => {
    fill()
    const outside = mkdtempSync(join(tmpdir(), 'lzx-out-'))
    try {
      writeFileSync(join(outside, 'grande.bin'), Buffer.alloc(5000))
      symlinkSync(outside, join(root, 'a', 'enlace'), 'dir')
      symlinkSync(join(root, 'a'), join(root, 'a', 'b', 'bucle'), 'dir')
      expect(await walkBytes(join(root, 'a'))).toBe(1234)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
  it('se detiene al pasar el tiempo límite', async () => {
    fill()
    let t = 0
    const n = await walkBytes(join(root, 'a'), () => (t += 61_000))
    expect(n).toBeLessThan(1234)
  })
})

describe('sizeFnFor / storageReport con la plataforma inyectada', () => {
  it('win32 usa el recorrido con Node y darwin usa du', () => {
    expect(sizeFnFor('win32')).not.toBe(duBytes)
    expect(sizeFnFor('darwin')).toBe(duBytes)
    expect(sizeFnFor('linux')).toBe(duBytes)
  })
  it('en win32 el informe mide sin llamar a du', async () => {
    const userData = join(root, 'ud')
    const key = 'abcd1234'
    mkdirSync(join(userData, 'tasks-sandbox', key, 'cache'), { recursive: true })
    writeFileSync(join(userData, 'tasks-sandbox', key, 'cache', 'c.bin'), Buffer.alloc(300))
    writeFileSync(join(userData, 'tasks-sandbox', key, 'h.bin'), Buffer.alloc(100))
    const env: StorageEnv = {
      userData,
      screenshotsDir: join(root, 'shots'),
      sandboxKey: () => key,
      platform: 'win32'
    }
    const rep = await storageReport(env, ['C:\\p'], [])
    expect(rep.entries).toHaveLength(1)
    expect(rep.entries[0]).toMatchObject({ key, folder: 'C:\\p', bytes: 400, cacheBytes: 300, running: false })
    expect(rep.screenshotsBytes).toBe(0)
  })
  it('un du inyectado manda sobre la plataforma', async () => {
    const env: StorageEnv = { userData: root, screenshotsDir: root, sandboxKey: () => 'abcd', platform: 'win32', du: async () => 7 }
    expect((await storageReport(env, [], [])).screenshotsBytes).toBe(7)
  })
})
