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

describe('renderPreview: tiempo total, memoria y carpeta privada', () => {
  it('no sigue lanzando programas de Word una vez vencido el tiempo total', async () => {
    const { renderPreview } = await import('./preview')
    let calls = 0
    const run = async (_b: string, args: string[]): Promise<void> => {
      calls++
      await new Promise((r) => setTimeout(r, 30))
      if (args[0] === 'render') await (await import('node:fs/promises')).writeFile(args[2], 'PNG')
    }
    const res = await renderPreview('docx', Buffer.from('x'), { deckcraft: null, wordcraft: '/w' }, { run, totalMs: 80 })
    expect(calls).toBeLessThan(5)
    expect(res?.images.length ?? 0).toBeLessThan(5)
  })
  it('con muchas diapositivas solo lee las primeras 12 y cuenta el resto', async () => {
    const { renderPreview, MAX_PREVIEW_PAGES } = await import('./preview')
    const fs = await import('node:fs/promises')
    const run = async (_b: string, args: string[]): Promise<void> => {
      const out = args[args.length - 1]
      await fs.mkdir(out, { recursive: true })
      for (let i = 1; i <= 40; i++) await fs.writeFile(`${out}/s${String(i).padStart(2, '0')}.png`, 'PNG')
    }
    const res = await renderPreview('pptx', Buffer.from('x'), { deckcraft: '/d', wordcraft: null }, { run })
    expect(res?.images.length).toBe(MAX_PREVIEW_PAGES)
    expect(res?.pages).toBe(40)
    expect(res?.truncated).toBe(true)
  })
  it('crea sus temporales bajo la carpeta privada configurada, no en os.tmpdir()', async () => {
    const { renderPreview } = await import('./preview')
    const { setPrivateTmpBase } = await import('../office/craft/private-tmp')
    const fs = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const priv = await fs.mkdtemp(`${tmpdir()}/priv-base-`)
    setPrivateTmpBase(`${priv}/dentro`)
    let seen = ''
    try {
      await renderPreview(
        'pptx',
        Buffer.from('x'),
        { deckcraft: '/d', wordcraft: null },
        {
          run: async (_b, args) => {
            seen = args[args.length - 1]
            await fs.mkdir(seen, { recursive: true })
            await fs.writeFile(`${seen}/a.png`, 'PNG')
          }
        }
      )
      expect(seen.startsWith(`${priv}/dentro/lazunox-preview-`)).toBe(true)
    } finally {
      setPrivateTmpBase(null)
      await fs.rm(priv, { recursive: true, force: true })
    }
  })
})

describe('renderPreview: Word sin ArtCraft usa el visor de la app', () => {
  const PNG = Buffer.from('PNG')
  it('sin WordCraft, devuelve lo que captura el visor (con el tope de páginas)', async () => {
    const { renderPreview } = await import('./preview')
    const res = await renderPreview(
      'docx',
      Buffer.from('zip'),
      { deckcraft: null, wordcraft: null },
      { captureDocx: async (_b: Buffer, _t: number) => ({ images: [PNG, PNG], pages: 2 }) }
    )
    expect(res?.images.length).toBe(2)
    expect(res?.pages).toBe(2)
  })
  it('sin WordCraft ni visor (o si el visor no pudo pintarlo) sigue siendo null: la herramienta lo dice', async () => {
    const { renderPreview } = await import('./preview')
    expect(await renderPreview('docx', Buffer.from('zip'), { deckcraft: null, wordcraft: null })).toBeNull()
    expect(
      await renderPreview('docx', Buffer.from('zip'), { deckcraft: null, wordcraft: null }, { captureDocx: async () => null })
    ).toBeNull()
  })
  it('con WordCraft que falla en la primera página, prueba el visor antes de rendirse', async () => {
    const { renderPreview } = await import('./preview')
    const run = async (): Promise<void> => {
      throw new Error('falla')
    }
    const res = await renderPreview(
      'docx',
      Buffer.from('zip'),
      { deckcraft: null, wordcraft: '/w' },
      { run, captureDocx: async (_b: Buffer, _t: number) => ({ images: [PNG], pages: 1 }) }
    )
    expect(res?.images.length).toBe(1)
  })
  it('con WordCraft sano NO usa el visor', async () => {
    const { renderPreview } = await import('./preview')
    const fs = await import('node:fs/promises')
    let used = false
    const run = async (_b: string, args: string[]): Promise<void> => {
      if (args[0] === 'render' && args.includes('--page') && args[args.indexOf('--page') + 1] !== '1') throw new Error('fin')
      await fs.writeFile(args[2], 'PNG')
    }
    const res = await renderPreview(
      'docx',
      Buffer.from('zip'),
      { deckcraft: null, wordcraft: '/w' },
      { run, captureDocx: async () => ((used = true), null) }
    )
    expect(res?.images.length).toBe(1)
    expect(used).toBe(false)
  })
})

describe('renderPreview: el respaldo del visor respeta el tiempo total', () => {
  it('sin tiempo suficiente no abre otra ventana', async () => {
    const { renderPreview } = await import('./preview')
    let used = false
    const res = await renderPreview(
      'docx',
      Buffer.from('zip'),
      { deckcraft: null, wordcraft: null },
      {
        totalMs: 1_000,
        captureDocx: async () => {
          used = true
          return null
        }
      }
    )
    expect(res).toBeNull()
    expect(used).toBe(false)
  })
  it('le pasa al visor lo que queda del tiempo', async () => {
    const { renderPreview } = await import('./preview')
    let given = 0
    await renderPreview(
      'docx',
      Buffer.from('zip'),
      { deckcraft: null, wordcraft: null },
      {
        totalMs: 50_000,
        captureDocx: async (_b, t) => {
          given = t
          return null
        }
      }
    )
    expect(given).toBeGreaterThan(0)
    expect(given).toBeLessThanOrEqual(50_000)
  })
})

describe('renderPreview: PowerPoint sin DeckCraft usa el visor de la app', () => {
  const PNG = Buffer.from('PNG')
  it('sin DeckCraft, devuelve lo que captura el visor', async () => {
    const { renderPreview } = await import('./preview')
    const res = await renderPreview(
      'pptx',
      Buffer.from('zip'),
      { deckcraft: null, wordcraft: null },
      { captureDeck: async () => ({ images: [PNG, PNG, PNG], pages: 3 }) }
    )
    expect(res?.images.length).toBe(3)
    expect(res?.pages).toBe(3)
  })
  it('sin DeckCraft ni visor sigue siendo null', async () => {
    const { renderPreview } = await import('./preview')
    expect(await renderPreview('pptx', Buffer.from('zip'), { deckcraft: null, wordcraft: null })).toBeNull()
  })
  it('si DeckCraft falla, prueba el visor; si no hay nada que mostrar, relanza el error de DeckCraft', async () => {
    const { renderPreview } = await import('./preview')
    const run = async (): Promise<void> => {
      throw new Error('deckcraft falló')
    }
    const ok = await renderPreview(
      'pptx',
      Buffer.from('zip'),
      { deckcraft: '/d', wordcraft: null },
      { run, captureDeck: async () => ({ images: [PNG], pages: 1 }) }
    )
    expect(ok?.images.length).toBe(1)
    await expect(
      renderPreview('pptx', Buffer.from('zip'), { deckcraft: '/d', wordcraft: null }, { run, captureDeck: async () => null })
    ).rejects.toThrow('deckcraft falló')
  })
  it('con DeckCraft sano NO usa el visor', async () => {
    const { renderPreview } = await import('./preview')
    const fs = await import('node:fs/promises')
    let used = false
    const run = async (_b: string, args: string[]): Promise<void> => {
      const out = args[args.length - 1]
      await fs.mkdir(out, { recursive: true })
      await fs.writeFile(`${out}/s1.png`, 'PNG')
    }
    const res = await renderPreview(
      'pptx',
      Buffer.from('zip'),
      { deckcraft: '/d', wordcraft: null },
      { run, captureDeck: async () => ((used = true), null) }
    )
    expect(res?.images.length).toBe(1)
    expect(used).toBe(false)
  })
})
