import { describe, expect, it } from 'vitest'
import { MAX_ATTACHMENTS, MAX_IMAGE_BYTES, MAX_PDF_BYTES, MAX_TEXT_BYTES, MAX_TOTAL_BYTES } from '../../../lib/attachments'
import {
  MAX_DISCARD_WITHOUT_MAC,
  abbreviatePath,
  displayPath,
  needsMacConfirm,
  phoneReplies,
  phoneSafeAttachments,
  validatePhoneAttachments
} from './mobile-logic'

describe('displayPath / abbreviatePath', () => {
  it('muestra la ruta con ~ y la carpeta del proyecto', () => {
    expect(displayPath('/Users/ana/proyecto/', 'src/a.ts')).toBe('~/proyecto/src/a.ts')
    expect(displayPath('C:\\Users\\ana\\repo', 'src\\a.ts')).toBe('~\\repo\\src\\a.ts')
  })
  it('no toca lo que ya cabe', () => {
    expect(abbreviatePath('/Users/ana/p/src/a.ts', 40)).toBe('~/p/src/a.ts')
  })
  it('conserva el comienzo y los últimos tramos', () => {
    const p = '/Users/ana/proyecto-grande/packages/web/src/components/chat/Composer.tsx'
    const a = abbreviatePath(p, 36)
    expect(a.length).toBeLessThanOrEqual(36)
    expect(a.startsWith('~/…/')).toBe(true)
    expect(a.endsWith('Composer.tsx')).toBe(true)
    expect(a).toBe('~/…/src/components/chat/Composer.tsx')
  })
  it('rutas fuera del home conservan la raíz', () => {
    expect(abbreviatePath('/opt/some/very/long/path/to/the/file-name.ts', 24)).toBe('/…/to/the/file-name.ts')
  })
  it('si ni el nombre cabe lo recorta por la izquierda', () => {
    const a = abbreviatePath('/Users/ana/p/un-nombre-de-archivo-larguisimo.test.tsx', 16)
    expect(a.length).toBeLessThanOrEqual(16)
    expect(a.startsWith('…')).toBe(true)
    expect(a.endsWith('.test.tsx')).toBe(true)
  })
  it('usa la barra invertida en Windows', () => {
    expect(abbreviatePath('C:\\Users\\ana\\repo\\packages\\app\\src\\deep\\file.ts', 24)).toBe('~\\…\\app\\src\\deep\\file.ts')
  })
})

describe('needsMacConfirm', () => {
  it('descartar: hasta el tope, sin confirmar; todo o más del tope, sí', () => {
    expect(needsMacConfirm({ kind: 'git.discard', files: 1 })).toBe(false)
    expect(needsMacConfirm({ kind: 'git.discard', files: MAX_DISCARD_WITHOUT_MAC })).toBe(false)
    expect(needsMacConfirm({ kind: 'git.discard', files: MAX_DISCARD_WITHOUT_MAC + 1 })).toBe(true)
    expect(needsMacConfirm({ kind: 'git.discard', files: 1, all: true })).toBe(true)
  })
  it('archivos: uno solo no; carpetas o varios, sí', () => {
    expect(needsMacConfirm({ kind: 'files.trash', isDirectory: false })).toBe(false)
    expect(needsMacConfirm({ kind: 'files.trash', isDirectory: true })).toBe(true)
    expect(needsMacConfirm({ kind: 'files.trash', isDirectory: false, count: 2 })).toBe(true)
    expect(needsMacConfirm({ kind: 'files.rename', isDirectory: false })).toBe(false)
    expect(needsMacConfirm({ kind: 'files.rename', isDirectory: true })).toBe(true)
  })
  it('quitar un worktree siempre se confirma', () => {
    expect(needsMacConfirm({ kind: 'git.removeWorktree' })).toBe(true)
  })
  it('permisos: lo conocido se aprueba «una vez» en el celular; lo demás, en el Mac', () => {
    expect(phoneReplies('edit')).toEqual(['once', 'reject'])
    expect(phoneReplies('bash')).toEqual(['once', 'reject'])
    expect(phoneReplies('external_directory')).toEqual(['reject'])
    expect(phoneReplies('doom_loop')).toEqual(['reject'])
    expect(phoneReplies('algo-nuevo')).toEqual(['reject'])
  })
  it('nunca ofrece «siempre»', () => {
    for (const p of ['edit', 'bash', 'external_directory', 'x']) expect(phoneReplies(p)).not.toContain('always' as never)
  })
})

describe('adjuntos del celular', () => {
  const dataUrl = (bytes: number): string => `data:image/png;base64,${'A'.repeat(Math.ceil((bytes * 4) / 3))}`
  it('acepta imagen, PDF y texto dentro de sus límites', () => {
    const r = validatePhoneAttachments(
      [
        { name: 'f.jpg', type: 'image/jpeg', size: MAX_IMAGE_BYTES },
        { name: 'a.pdf', type: 'application/pdf', size: MAX_PDF_BYTES - 5 * 1024 * 1024 },
        { name: 'n.txt', type: 'text/plain', size: MAX_TEXT_BYTES }
      ],
      []
    )
    expect(r.accepted).toEqual([0, 1, 2])
    expect(r.errors).toEqual([])
  })
  it('cada tipo respeta su propio máximo', () => {
    expect(validatePhoneAttachments([{ name: 'a.pdf', type: 'application/pdf', size: MAX_PDF_BYTES }], []).accepted).toEqual([0])
    expect(validatePhoneAttachments([{ name: 'a.pdf', type: 'application/pdf', size: MAX_PDF_BYTES + 1 }], []).accepted).toEqual([])
    expect(validatePhoneAttachments([{ name: 'n.txt', type: 'text/plain', size: MAX_TEXT_BYTES + 1 }], []).accepted).toEqual([])
  })
  it('rechaza lo que pasa el límite por tipo, el tipo no admitido y los .exe', () => {
    const r = validatePhoneAttachments(
      [
        { name: 'g.jpg', type: 'image/jpeg', size: MAX_IMAGE_BYTES + 1 },
        { name: 'x.zip', type: 'application/zip', size: 10 },
        { name: 'ok.png', type: 'image/png', size: 10 }
      ],
      []
    )
    expect(r.accepted).toEqual([2])
    expect(r.errors).toHaveLength(2)
  })
  it('cuenta lo ya adjuntado: cantidad y total', () => {
    const five = Array.from({ length: MAX_ATTACHMENTS }, () => ({ url: dataUrl(10) }))
    expect(validatePhoneAttachments([{ name: 'a.png', type: 'image/png', size: 1 }], five).accepted).toEqual([])
    const big = [{ url: dataUrl(MAX_TOTAL_BYTES - 100) }]
    expect(validatePhoneAttachments([{ name: 'a.png', type: 'image/png', size: 1000 }], big).accepted).toEqual([])
    expect(validatePhoneAttachments([{ name: 'a.png', type: 'image/png', size: 50 }], big).accepted).toEqual([0])
  })
  it('nunca deja salir un file://', () => {
    const list = [{ url: 'file:///Users/ana/.ssh/id_rsa' }, { url: 'data:text/plain;base64,QQ==' }, { url: 'FILE:///etc/passwd' }]
    expect(phoneSafeAttachments(list)).toEqual([{ url: 'data:text/plain;base64,QQ==' }])
  })
})
