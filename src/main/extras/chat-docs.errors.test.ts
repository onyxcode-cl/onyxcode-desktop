/**
 * Los fallos de generación de un documento de Chat llevan un código que la ventana sabe explicar (`no-craft`: falta ArtCraft; `invalid`:
 * los datos no pasan la validación) en vez de un `failed` mudo.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let fakeTemp: string
vi.mock('electron', () => ({ app: { getPath: () => fakeTemp } }))
vi.mock('../office/craft/service', () => ({ craftService: () => ({ status: () => ({ state: 'missing', version: '0', sizeBytes: 0 }) }) }))

let chatDocs: typeof import('./chat-docs')

beforeEach(async () => {
  fakeTemp = mkdtempSync(join(tmpdir(), 'lzx-chatdocs-err-'))
  vi.resetModules()
  chatDocs = await import('./chat-docs')
}, 30_000)
afterEach(() => {
  rmSync(fakeTemp, { recursive: true, force: true })
})

describe('generateChatDoc: errores con motivo', () => {
  it('Word sin WordCraft instalado → ChatDocError «no-craft»', async () => {
    const err = await chatDocs
      .generateChatDoc({ kind: 'docx', data: { blocks: [{ type: 'paragraph', text: 'Hola' }] } }, 'Doc', 's1')
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(chatDocs.ChatDocError)
    expect((err as InstanceType<typeof chatDocs.ChatDocError>).code).toBe('no-craft')
  })

  it('datos que no pasan la validación → ChatDocError «invalid»', async () => {
    const err = await chatDocs.generateChatDoc({ kind: 'pptx', data: { slides: [] } as never }, 'Deck', 's1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(chatDocs.ChatDocError)
    expect((err as InstanceType<typeof chatDocs.ChatDocError>).code).toBe('invalid')
  })
})
