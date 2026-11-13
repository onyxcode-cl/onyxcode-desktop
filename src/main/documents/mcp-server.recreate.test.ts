/** Comportamiento del servidor real sin abrir puertos: el transporte HTTP tiene su propia suite. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { activeDocumentSession, DocumentsMcpServer, type DocumentsBinding, type DocumentsDeps } from './mcp-server'
import type { McpToolResult } from '../util/loopback-mcp'
import { safeWriteOps } from '../tasks/safe-write'
import { renderPreview } from './preview'
import { CraftTimeoutError } from '../office/craft/craft-run'

class Server extends DocumentsMcpServer {
  invoke(binding: DocumentsBinding, args: Record<string, unknown>, tool = 'crear', signal?: AbortSignal): Promise<McpToolResult> {
    return this.callTool(binding, tool, args, signal)
  }
}

const spec = { blocks: [{ type: 'paragraph', text: 'Informe para el comité' }] }
const args = { tipo: 'docx', nombre: 'Informe', spec }
const original = readFileSync(join(__dirname, 'fixtures-review/bueno.docx'))
const text = (result: McpToolResult): string =>
  result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
let folder: string
let outside: string
let session: string | null
let binding: DocumentsBinding
let server: Server
let output: Buffer
let deps: DocumentsDeps

beforeEach(() => {
  folder = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-recreate-')))
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-recreate-out-')))
  session = 'ses_primera'
  binding = { folder, session: async () => session }
  output = original
  deps = { render: vi.fn(async () => output), audit: () => {} }
  server = new Server(deps)
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(folder, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

async function corrected(): Promise<Buffer> {
  const zip = await JSZip.loadAsync(original)
  zip.file('docProps/revision.xml', '<revision>Corrección de la entrega</revision>')
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('documentos: correcciones sobre archivos reales', () => {
  it('crea y corrige un Word válido con la misma ruta, bytes nuevos y huella de vista previa actualizada', async () => {
    deps.preview = vi.fn(async () => ({ images: [Buffer.from('PNG')], pages: 1, truncated: false }))
    const first = await server.invoke(binding, args)
    expect(text(first)).toContain('RESULTADO: OK')
    output = await corrected()
    const second = await server.invoke(binding, args)
    expect(second.isError).toBeUndefined()
    expect(readdirSync(folder)).toEqual(['Informe.docx'])
    expect(readFileSync(join(folder, 'Informe.docx'))).toEqual(output)
    expect(output.equals(original)).toBe(false)
    const preview = await server.invoke(binding, { ruta: join(folder, 'Informe.docx') }, 'renderizar')
    expect(preview.isError).toBeUndefined()
    expect(deps.preview).toHaveBeenLastCalledWith('docx', output)
  })

  it('un archivo previo queda idéntico y las correcciones actualizan solo el « (2)» propio', async () => {
    writeFileSync(join(folder, 'Informe.docx'), original)
    await server.invoke(binding, args)
    output = await corrected()
    await server.invoke(binding, args)
    expect(readdirSync(folder)).toEqual(['Informe (2).docx', 'Informe.docx'])
    expect(readFileSync(join(folder, 'Informe.docx'))).toEqual(original)
    expect(readFileSync(join(folder, 'Informe (2).docx'))).toEqual(output)
  })

  it('una edición ajena se conserva y las correcciones siguientes solo rehacen la nueva copia propia', async () => {
    await server.invoke(binding, args)
    writeFileSync(join(folder, 'Informe.docx'), 'Edición de la persona')
    await server.invoke(binding, args)
    output = await corrected()
    await server.invoke(binding, args)
    expect(readdirSync(folder)).toEqual(['Informe (2).docx', 'Informe.docx'])
    expect(readFileSync(join(folder, 'Informe.docx'), 'utf8')).toBe('Edición de la persona')
    expect(readFileSync(join(folder, 'Informe (2).docx'))).toEqual(output)
  })

  it.each(['sesión', 'atadura', 'sin sesión'])('propiedad separada por %s', async (change) => {
    await server.invoke(binding, args)
    if (change === 'sesión') session = 'ses_segunda'
    if (change === 'atadura') binding = { ...binding }
    if (change === 'sin sesión') session = null
    output = await corrected()
    await server.invoke(binding, args)
    expect(readFileSync(join(folder, 'Informe.docx'))).toEqual(original)
    expect(readFileSync(join(folder, 'Informe (2).docx'))).toEqual(output)
  })

  it('ausencia del comprobador de sesión nunca habilita reemplazos', async () => {
    delete binding.session
    await server.invoke(binding, args)
    output = await corrected()
    await server.invoke(binding, args)
    expect(readFileSync(join(folder, 'Informe.docx'))).toEqual(original)
  })

  it('cambiar de sesión durante el render no atribuye la llamada antigua a la nueva', async () => {
    session = 'ses_segunda'
    await server.invoke(binding, args)
    session = 'ses_primera'
    output = await corrected()
    deps.render = async () => {
      session = 'ses_segunda'
      return output
    }
    await server.invoke(binding, args)
    expect(readFileSync(join(folder, 'Informe.docx'))).toEqual(original)
    expect(readFileSync(join(folder, 'Informe (2).docx'))).toEqual(output)
    // La salida ambigua tampoco se registra como propia de la segunda sesión.
    deps.render = async () => original
    await server.invoke(binding, args)
    expect(readFileSync(join(folder, 'Informe (2).docx'))).toEqual(output)
  })

  it('una desconexión durante el render impide guardar o reemplazar', async () => {
    await server.invoke(binding, args)
    const aborter = new AbortController()
    deps.render = async () => {
      aborter.abort()
      return corrected()
    }
    expect((await server.invoke(binding, args, 'crear', aborter.signal)).isError).toBe(true)
    expect(readFileSync(join(folder, 'Informe.docx'))).toEqual(original)
    expect(readdirSync(folder)).toEqual(['Informe.docx'])
  })

  it.each(['simbólico', 'duro', 'directorio'])('rechaza reemplazar un %s', async (kind) => {
    await server.invoke(binding, args)
    const file = join(folder, 'Informe.docx')
    const target = join(outside, 'respaldo.docx')
    if (kind === 'duro') linkSync(file, target)
    else {
      renameSync(file, target)
      if (kind === 'simbólico') symlinkSync(target, file)
      else mkdirSync(file)
    }
    output = await corrected()
    const result = await server.invoke(binding, args)
    expect(result.isError).toBeUndefined()
    expect(readFileSync(target)).toEqual(original)
    expect(readFileSync(join(folder, 'Informe (2).docx'))).toEqual(output)
  })

  it('un padre sustituido por un enlace no lleva escrituras fuera de la tarea', async () => {
    const nested = { ...args, subcarpeta: 'salida' }
    await server.invoke(binding, nested)
    renameSync(join(folder, 'salida'), join(folder, 'apartada'))
    writeFileSync(join(outside, 'Informe.docx'), original)
    symlinkSync(outside, join(folder, 'salida'), 'junction')
    output = await corrected()
    expect((await server.invoke(binding, nested)).isError).toBe(true)
    expect(readFileSync(join(outside, 'Informe.docx'))).toEqual(original)
    expect(readFileSync(join(folder, 'apartada/Informe.docx'))).toEqual(original)
  })

  it('un bloqueo de Windows al reemplazar conserva el archivo y usa otro nombre sin esperar', async () => {
    await server.invoke(binding, args)
    vi.spyOn(safeWriteOps, 'isWindows').mockReturnValue(true)
    const rename = vi.spyOn(safeWriteOps, 'rename').mockImplementation(() => {
      throw Object.assign(new Error('ocupado'), { code: 'EBUSY' })
    })
    const sleep = vi.spyOn(safeWriteOps, 'sleep')
    output = await corrected()
    const result = await server.invoke(binding, args)
    expect(result.isError).toBeUndefined()
    expect(rename).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
    expect(readFileSync(join(folder, 'Informe.docx'))).toEqual(original)
    expect(readFileSync(join(folder, 'Informe (2).docx'))).toEqual(output)
  })

  it('en Code separa raíces y revalida proyectos abiertos antes de reemplazar', async () => {
    let roots = [folder, outside]
    binding = { folder: '<code>', code: { roots: () => roots }, session: async () => session }
    await server.invoke(binding, { ...args, carpeta: folder })
    await server.invoke(binding, { ...args, carpeta: outside })
    output = await corrected()
    await server.invoke(binding, { ...args, carpeta: outside })
    expect(readFileSync(join(folder, 'Informe.docx'))).toEqual(original)
    expect(readFileSync(join(outside, 'Informe.docx'))).toEqual(output)
    roots = [outside]
    expect((await server.invoke(binding, { ...args, carpeta: folder })).isError).toBe(true)
    expect(readFileSync(join(folder, 'Informe.docx'))).toEqual(original)
  })
})

describe('documentos: imágenes en la misma respuesta', () => {
  it.each(['error', 'timeout'] as const)('crear y renderizar informan una vista parcial por %s sin inventar el total', async (failure) => {
    deps.preview = (tipo, bytes, range) =>
      renderPreview(
        tipo,
        bytes,
        { deckcraft: null, wordcraft: '/fake/w' },
        {
          range,
          run: async (_bin, argv) => {
            const page = Number(argv[argv.indexOf('--page') + 1])
            if (page === 3) throw failure === 'timeout' ? new CraftTimeoutError() : new Error('ruta/privada falló')
            writeFileSync(argv[2], `PNG-${page}`)
          }
        }
      )
    const created = await server.invoke(binding, args)
    expect(created.isError).toBeUndefined()
    const preview = await server.invoke(binding, { ruta: join(folder, 'Informe.docx') }, 'renderizar')
    for (const result of [created, preview]) {
      expect(text(result)).toContain('total de páginas desconocido')
      expect(text(result)).toContain('VISTA PREVIA PARCIAL')
      expect(text(result)).toContain(failure === 'timeout' ? 'agotó el tiempo' : 'falló el renderizado')
      expect(text(result)).toContain('desde_pagina=3')
      expect(text(result)).not.toContain('ruta/privada')
      expect(result.content.filter((c) => c.type === 'image')).toHaveLength(2)
    }
  })

  it('renderizar permite continuar en páginas 13–14 y comunica su numeración real', async () => {
    await server.invoke(binding, args)
    const calls: number[] = []
    deps.preview = (tipo, bytes, range) =>
      renderPreview(
        tipo,
        bytes,
        { deckcraft: null, wordcraft: '/fake/w' },
        {
          range,
          run: async (_bin, argv) => {
            const page = Number(argv[argv.indexOf('--page') + 1])
            calls.push(page)
            if (page === 15) throw new Error('bad parameters: no page 15')
            writeFileSync(argv[2], `PNG-${page}`)
          }
        }
      )
    const result = await server.invoke(binding, { ruta: join(folder, 'Informe.docx'), desde_pagina: 13, hasta_pagina: 14 }, 'renderizar')
    expect(calls).toEqual([13, 14, 15])
    expect(text(result)).toContain('14 página(s)')
    expect(text(result)).toContain('páginas 13–14')
    expect(result.content.filter((c) => c.type === 'image')).toHaveLength(2)
  })

  it('rechaza intervalos inválidos sin tocar el motor', async () => {
    deps.preview = vi.fn(async () => null)
    for (const range of [
      { desde_pagina: 1 },
      { desde_pagina: 0, hasta_pagina: 2 },
      { desde_pagina: 3, hasta_pagina: 2 },
      { desde_pagina: 1, hasta_pagina: 13 },
      { desde_pagina: Number.MAX_SAFE_INTEGER, hasta_pagina: Number.MAX_SAFE_INTEGER },
      { desde_pagina: '1', hasta_pagina: 2 }
    ]) {
      const result = await server.invoke(binding, { ruta: 'Informe.docx', ...range }, 'renderizar')
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('enteros positivos')
    }
    expect(deps.preview).not.toHaveBeenCalled()
  })

  it.each(['docx', 'pptx', 'xlsx', 'pdf'])('crear %s incluye imágenes y revisión', async (tipo) => {
    deps.preview = vi.fn(async () => ({ images: [Buffer.from('PNG1'), Buffer.from('PNG2')], pages: 2, truncated: false }))
    const result = await server.invoke(binding, {
      tipo,
      nombre: 'Entrega',
      spec: tipo === 'pptx' ? { slides: [{ title: 'Portada' }] } : tipo === 'xlsx' ? { sheets: [{ name: 'Datos', rows: [['A']] }] } : spec,
      html: '<html lang="es"><style>@page { size:A4 }</style><body>Informe</body></html>'
    })
    expect(result.isError).toBeUndefined()
    expect(text(result)).toContain('Revisión de calidad')
    expect(text(result)).toContain('Mira TODAS')
    expect(result.content.filter((c) => c.type === 'image')).toHaveLength(2)
    expect(deps.preview).toHaveBeenCalledWith(tipo, output)
  })

  it('conserva avisos de truncamiento y vista simplificada', async () => {
    deps.preview = async () => ({ images: [Buffer.from('PNG')], pages: 20, truncated: true, viaViewer: true })
    const result = await server.invoke(binding, args)
    expect(text(result)).toContain('primeras 1')
    expect(text(result)).toContain('VISTA SIMPLIFICADA')
    expect(text(result)).toContain('VISTA NO VERIFICADA')
  })

  it.each(['ausente', 'vacía', 'error', 'tiempo'])('preview %s conserva la entrega y explica lo pendiente', async (failure) => {
    deps.renderTimeoutMs = 20
    if (failure !== 'ausente')
      deps.preview = async () => {
        if (failure === 'error') throw new Error('ruta privada')
        if (failure === 'tiempo') return new Promise(() => {})
        return { images: [], pages: 0, truncated: false }
      }
    const result = await server.invoke(binding, args)
    expect(result.isError).toBeUndefined()
    expect(readFileSync(join(folder, 'Informe.docx'))).toEqual(original)
    expect(text(result)).toContain('Para revisar')
    expect(text(result)).not.toContain('ruta privada')
  })

  it('mantiene el cerrojo de la atadura durante la revisión visual, y lo libera al terminar', async () => {
    let release!: () => void
    let entered!: () => void
    const enteredPreview = new Promise<void>((resolve) => {
      entered = resolve
    })
    deps.preview = async () => {
      entered()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return null
    }
    const first = server.invoke(binding, args)
    await enteredPreview
    expect((await server.invoke(binding, { ...args, nombre: 'Otra' })).isError).toBe(true)
    release()
    await first
    delete deps.preview
    expect((await server.invoke(binding, args)).isError).toBeUndefined()
    expect(readdirSync(folder)).toEqual(['Informe.docx'])
  })

  it('la vista incorporada mantiene el límite global de dos documentos', async () => {
    const releases: Array<() => void> = []
    let entered!: () => void
    const bothEntered = new Promise<void>((resolve) => {
      entered = resolve
    })
    deps.preview = async () => {
      await new Promise<void>((resolve) => {
        releases.push(resolve)
        if (releases.length === 2) entered()
      })
      return null
    }
    const one = server.invoke(binding, args)
    const two = server.invoke({ ...binding, folder: outside }, args)
    await bothEntered
    expect((await server.invoke({ ...binding }, { ...args, nombre: 'Otra' })).isError).toBe(true)
    for (const release of releases) release()
    await Promise.all([one, two])
  })
})

describe('sesión para reemplazar documentos', () => {
  it('solo acepta una sesión activa leída del motor (sin aceptar identidad del modelo)', async () => {
    const conn = { baseUrl: 'http://127.0.0.1:12345', authorization: 'Basic prueba' }
    for (const [body, expected] of [
      [{ ses_1: { type: 'busy' }, ses_2: { type: 'idle' } }, 'ses_1'],
      [{ ses_1: { type: 'retry' } }, 'ses_1'],
      [{ ses_1: { type: 'busy' }, ses_2: { type: 'busy' } }, null],
      [{ ses_1: { type: 'idle' } }, null],
      [[], null],
      [null, null],
      [{ fake: { type: 'busy' } }, null]
    ] as const) {
      const fetcher = vi.fn(async () => new Response(JSON.stringify(body)))
      expect(await activeDocumentSession(conn, '/win/c/mi carpeta', fetcher)).toBe(expected)
      expect(fetcher).toHaveBeenCalledWith(
        expect.stringContaining('directory=%2Fwin%2Fc%2Fmi%20carpeta'),
        expect.objectContaining({ redirect: 'error', headers: { authorization: 'Basic prueba' } })
      )
    }
  })

  it('motor caído, respuesta enorme o JSON inválido = no reemplazar', async () => {
    const conn = { baseUrl: 'http://127.0.0.1:12345', authorization: 'Basic prueba' }
    for (const fetcher of [
      vi.fn(async () => new Response('x'.repeat(65537))),
      vi.fn(async () => new Response('{')),
      vi.fn(async () => new Response('', { status: 500 })),
      vi.fn(async () => {
        throw new Error('offline')
      })
    ])
      expect(await activeDocumentSession(conn, '/carpeta', fetcher)).toBeNull()
  })
})
