/**
 * `assertInsideChatDocs`: la misma idea que `tasks.assertInsideApproved` pero para la carpeta
 * temporal de documentos de Chat — nunca confía en una ruta que no esté DENTRO de esa carpeta,
 * ni siquiera si el string empieza igual (`…/lazunox-chat-docs-evil/x` no es un prefijo válido).
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let fakeTemp: string
vi.mock('electron', () => ({ app: { getPath: () => fakeTemp } }))

// Sin DeckCraft instalado: estas pruebas son del generador de siempre (ArtCraft se prueba en `office/craft/chat-deck.test.ts`).
vi.mock('../office/craft/service', () => ({ craftService: () => ({ status: () => ({ state: 'missing', version: '0', sizeBytes: 0 }) }) }))

let chatDocs: typeof import('./chat-docs')

beforeEach(async () => {
  fakeTemp = mkdtempSync(join(tmpdir(), 'lzx-chatdocs-root-'))
  vi.resetModules()
  chatDocs = await import('./chat-docs')
}, 30_000) // en Windows la primera importación (exceljs, pptxgenjs…) tarda más de 10 s
afterEach(() => {
  rmSync(fakeTemp, { recursive: true, force: true })
})

describe('assertInsideChatDocs', () => {
  it('acepta un archivo real dentro de lazunox-chat-docs/<sesión>/', () => {
    const dir = join(fakeTemp, 'lazunox-chat-docs', 's1')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'x.pdf')
    writeFileSync(file, 'pdf falso')
    // macOS: /var es un symlink a /private/var — se compara contra el realpath, no contra el string crudo.
    expect(chatDocs.assertInsideChatDocs(file)).toBe(realpathSync(file))
  })

  it('rechaza una ruta hermana cuyo nombre solo empieza igual (no es un subpath real)', () => {
    const evil = join(fakeTemp, 'lazunox-chat-docs-evil')
    mkdirSync(evil, { recursive: true })
    const file = join(evil, 'x.pdf')
    writeFileSync(file, 'x')
    expect(() => chatDocs.assertInsideChatDocs(file)).toThrow()
  })

  it('rechaza algo fuera de la carpeta por completo', () => {
    const outside = join(fakeTemp, 'otra-carpeta', 'x.pdf')
    mkdirSync(join(fakeTemp, 'otra-carpeta'), { recursive: true })
    writeFileSync(outside, 'x')
    expect(() => chatDocs.assertInsideChatDocs(outside)).toThrow()
  })

  it('rechaza una ruta que no existe (no puede resolver el realpath)', () => {
    expect(() => chatDocs.assertInsideChatDocs(join(fakeTemp, 'lazunox-chat-docs', 'nada', 'x.pdf'))).toThrow()
  })
})

describe('sessionDir / generateChatDoc: valida el ID de sesión', () => {
  it('un sessionId con separadores de ruta se rechaza antes de tocar el disco', async () => {
    await expect(chatDocs.generateChatDoc({ kind: 'pdf', html: '<html></html>' }, 't', '../escape')).rejects.toThrow()
    await expect(chatDocs.cleanChatDocuments('../escape')).resolves.toBeUndefined()
  })
})

describe('generateChatDoc: datos inválidos de Excel/PowerPoint se rechazan antes de escribir nada', () => {
  it('xlsx sin hojas', async () => {
    await expect(chatDocs.generateChatDoc({ kind: 'xlsx', data: { sheets: [] } }, 't', 's1')).rejects.toThrow()
  })

  it('pptx sin diapositivas', async () => {
    await expect(chatDocs.generateChatDoc({ kind: 'pptx', data: { slides: [] } }, 't', 's1')).rejects.toThrow()
  })
})

describe('generateChatDoc: Word sin ArtCraft instalado', () => {
  it('lanza ChatDocError no-craft (el panel lo convierte en un aviso con «Instalar»)', async () => {
    const data = { blocks: [{ type: 'paragraph', text: 'hola' }] } as never
    await expect(chatDocs.generateChatDoc({ kind: 'docx', data }, 't', 's1')).rejects.toMatchObject({ code: 'no-craft' })
  })
})

describe('generateChatDoc: genera xlsx/pptx reales con el token/kind correcto', () => {
  it('xlsx', async () => {
    const doc = await chatDocs.generateChatDoc({ kind: 'xlsx', data: { sheets: [{ name: 'A', rows: [['x']] }] } }, 't', 's1')
    expect(doc.kind).toBe('xlsx')
    expect(doc.token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('pptx, sin DeckCraft: el de siempre, kind "pptx"', async () => {
    const doc = await chatDocs.generateChatDoc({ kind: 'pptx', data: { slides: [{ title: 'A' }] } }, 't', 's1')
    expect(doc.kind).toBe('pptx')
    expect(doc.token).toMatch(/^[0-9a-f]{64}$/)
  })
})
