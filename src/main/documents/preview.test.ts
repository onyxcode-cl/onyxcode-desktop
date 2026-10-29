import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_PREVIEW_PAGES, renderPreview } from './preview'

const png = (n: number): Buffer => Buffer.from(`png-${n}`)
const tools = { deckcraft: '/fake/deckcraft-cli', wordcraft: '/fake/wordcraft-cli' }

describe('renderPreview', () => {
  it('pptx: pide todas las diapositivas a escala reducida y las devuelve en orden', async () => {
    const calls: string[][] = []
    const res = await renderPreview('pptx', Buffer.from('x'), tools, {
      run: async (_bin, args) => {
        calls.push(args)
        const out = args[args.length - 1]!
        mkdirSync(out, { recursive: true })
        for (const n of [3, 1, 2]) writeFileSync(join(out, `slide-0${n}.png`), png(n))
      }
    })
    expect(calls[0]!.slice(0, 1)).toEqual(['render'])
    expect(calls[0]).toContain('--all')
    expect(res!.pages).toBe(3)
    expect(res!.images.map((b) => b.toString())).toEqual(['png-1', 'png-2', 'png-3'])
    expect(res!.truncated).toBe(false)
  })

  it('docx: una llamada por página hasta que el programa dice que no hay más', async () => {
    let page = 0
    const res = await renderPreview('docx', Buffer.from('x'), tools, {
      run: async (_bin, args) => {
        page = Number(args[args.indexOf('--page') + 1])
        if (page > 2) throw new Error('bad parameters: no page 3')
        writeFileSync(args[2]!, png(page))
      }
    })
    expect(res!.pages).toBe(2)
    expect(res!.images.length).toBe(2)
  })

  it('docx: nunca más de 12 páginas', async () => {
    const res = await renderPreview('docx', Buffer.from('x'), tools, {
      run: async (_bin, args) => {
        writeFileSync(args[2]!, png(1))
      }
    })
    expect(res!.images.length).toBe(MAX_PREVIEW_PAGES)
    expect(res!.truncated).toBe(true)
  })

  it('docx: si ni la primera página sale, falla', async () => {
    await expect(
      renderPreview('docx', Buffer.from('x'), tools, {
        run: async () => {
          throw new Error('roto')
        }
      })
    ).rejects.toThrow()
  })

  it('sin rasterizador o sin programa instalado → null', async () => {
    expect(await renderPreview('xlsx', Buffer.from('x'), tools)).toBeNull()
    expect(await renderPreview('pdf', Buffer.from('x'), tools)).toBeNull()
    expect(await renderPreview('pptx', Buffer.from('x'), { deckcraft: null, wordcraft: null })).toBeNull()
    expect(
      await renderPreview('xlsx', Buffer.from('x'), { deckcraft: null, wordcraft: null, gridcraft: null }, { rasterize: async () => null })
    ).toBeNull()
  })

  it('pdf: lo rasteriza directamente', async () => {
    const res = await renderPreview('pdf', Buffer.from('%PDF'), tools, { rasterize: async () => ({ images: [png(1), png(2)], pages: 5 }) })
    expect(res!.images.length).toBe(2)
    expect(res!.pages).toBe(5)
    expect(res!.truncated).toBe(true)
  })

  it('xlsx: GridCraft lo exporta a PDF y ese PDF se rasteriza', async () => {
    const gridTools = { ...tools, gridcraft: '/fake/gridcraft-cli' }
    let rasterized: Buffer | null = null
    const res = await renderPreview('xlsx', Buffer.from('x'), gridTools, {
      run: async (_bin, args) => {
        const cmd = args[args.indexOf('--cmd') + 1]!
        const out = JSON.parse(cmd.slice('file.exportPdf='.length)).path as string
        writeFileSync(out, Buffer.from('%PDF-FALSO'))
      },
      rasterize: async (pdf) => {
        rasterized = pdf
        return { images: [png(1)], pages: 1 }
      }
    })
    expect(rasterized!.toString()).toBe('%PDF-FALSO')
    expect(res!.images.length).toBe(1)
    expect(res!.truncated).toBe(false)
  })

  it('xlsx: si GridCraft no exporta, null', async () => {
    const res = await renderPreview(
      'xlsx',
      Buffer.from('x'),
      { ...tools, gridcraft: '/fake/g' },
      {
        run: async () => {
          throw new Error('roto')
        },
        rasterize: async () => ({ images: [png(1)], pages: 1 })
      }
    )
    expect(res).toBeNull()
  })

  it('respeta el tope de bytes', async () => {
    const big = Buffer.alloc(4 * 1024 * 1024, 1)
    const res = await renderPreview('pptx', Buffer.from('x'), tools, {
      run: async (_bin, args) => {
        const out = args[args.length - 1]!
        mkdirSync(out, { recursive: true })
        for (const n of [1, 2, 3]) writeFileSync(join(out, `slide-0${n}.png`), big)
      }
    })
    expect(res!.images.length).toBe(1)
    expect(res!.truncated).toBe(true)
  })
})
