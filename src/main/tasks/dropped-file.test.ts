import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { attachDroppedFile } from './dropped-file'
import { safeWriteOps } from './safe-write'
import { PASTE_MAX_FILE_BYTES } from '@shared/paste-files'
import { CHANNEL_ROLES, IPC_SCHEMAS } from '../ipc/schemas'
import { decide } from '../remote/policy'
import { posixOnly } from '../../test/platform'

const roots: string[] = []
function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'tasks-drop-'))
  roots.push(folder)
  const tasks = {
    assertInsideApproved: vi.fn((path: string) => {
      if (path !== folder) throw new Error('fuera del ámbito')
      return folder
    })
  }
  return { folder, tasks }
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('adjuntar bytes de archivos arrastrados', () => {
  it('valida y copia un adjunto de 5 MiB sin desbordar la pila al revisar base64', () => {
    const { folder, tasks } = fixture()
    const bytes = Buffer.alloc(5 * 1024 * 1024, 0x61)
    const req = { folder, name: 'presentacion.pptx', base64: bytes.toString('base64') }
    expect(IPC_SCHEMAS['tasks:attachDroppedFile'](req)).toEqual(req)
    const saved = attachDroppedFile(req, tasks)
    const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex')
    expect(saved.size).toBe(bytes.length)
    expect(sha256(readFileSync(saved.path))).toBe(sha256(bytes))
  })
  it.each([false, true])('conserva bytes, usa nombres portátiles y no sobrescribe (escritura Windows: %s)', (windows) => {
    vi.spyOn(safeWriteOps, 'isWindows').mockReturnValue(windows)
    const { folder, tasks } = fixture()
    const bytes = Buffer.from('contenido PPTX recibido del arrastre')
    const req = { folder, name: 'CON.pptx', base64: bytes.toString('base64') }
    const first = attachDroppedFile(req, tasks)
    const second = attachDroppedFile(req, tasks)
    expect(first.relPath).toBe('_CON.pptx')
    expect(second.relPath).toBe('_CON-1.pptx')
    expect(readFileSync(first.path)).toEqual(bytes)
    expect(readFileSync(second.path)).toEqual(bytes)
    expect(tasks.assertInsideApproved).toHaveBeenCalledWith(folder)
  })

  // Crear symlinks requiere privilegios adicionales en Windows; el resto ejercita ambas escrituras.
  it.skipIf(!posixOnly)('no sigue un enlace que ocupa el nombre de destino', () => {
    const { folder, tasks } = fixture()
    const outside = join(fixture().folder, 'original.pptx')
    writeFileSync(outside, 'original')
    symlinkSync(outside, join(folder, 'deck.pptx'))
    const saved = attachDroppedFile({ folder, name: 'deck.pptx', base64: 'YQ==' }, tasks)
    expect(saved.relPath).toBe('deck-1.pptx')
    expect(readFileSync(outside, 'utf8')).toBe('original')
  })

  it('rechaza destino no autorizado, nombres ruta/ADS/ejecutables y base64 inválido antes de escribir', () => {
    const { folder, tasks } = fixture()
    const good = { folder, name: 'deck.pptx', base64: 'YQ==' }
    for (const name of ['../deck.pptx', 'C:\\deck.pptx', 'x:stream', '.', '..', 'x.exe', 'x.exe.', 'x.exe ', 'x.ppt<x'])
      expect(() => attachDroppedFile({ ...good, name }, tasks)).toThrow()
    for (const base64 of ['@@==', 'YQ', 'YR==', Buffer.alloc(PASTE_MAX_FILE_BYTES + 1).toString('base64')])
      expect(() => attachDroppedFile({ ...good, base64 }, tasks)).toThrow()
    expect(() => attachDroppedFile({ ...good, folder: join(folder, '..') }, tasks)).toThrow('fuera del ámbito')
    expect(readdirSync(folder)).toEqual([])
  })

  it('el esquema acepta bytes y rechaza una ruta de origen o claves adicionales', () => {
    const req = { folder: '/trabajo', name: 'deck.pptx', base64: 'YQ==' }
    expect(IPC_SCHEMAS['tasks:attachDroppedFile'](req)).toEqual(req)
    expect(() => IPC_SCHEMAS['tasks:attachDroppedFile']({ ...req, source: '/secreto' })).toThrow()
    expect(() => IPC_SCHEMAS['tasks:attachDroppedFile']({ ...req, folder: 'relativo' })).toThrow()
    expect(() => IPC_SCHEMAS['tasks:attachDroppedFile']({ ...req, name: '../deck.pptx' })).toThrow()
    expect(() => IPC_SCHEMAS['tasks:attachDroppedFile']({ ...req, name: 'C:\\deck.pptx' })).toThrow()
    expect(() => IPC_SCHEMAS['tasks:attachDroppedFile']({ ...req, base64: '@@' })).toThrow()
    for (const channels of Object.values(CHANNEL_ROLES)) expect(channels.has('tasks:attachDroppedFile')).toBe(false)
    expect(decide({ kind: 'ipc', channel: 'tasks:attachDroppedFile', payload: req }, { allowedDirs: ['/trabajo'] })).toMatchObject({
      allow: false,
      reason: 'forbidden'
    })
  })
})
