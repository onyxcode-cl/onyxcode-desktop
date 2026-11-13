import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DocumentsMcpServer, localImageRefs, MAX_PER_BINDING_PER_HOUR, MAX_PREVIEWS_PER_HOUR, type AuditEntry } from './mcp-server'
import type { ChatDocInput } from './engine'

let folder: string
let folder2: string
let server: DocumentsMcpServer
let audits: AuditEntry[]
let renders: Array<{ input: ChatDocInput; title: string; opts: { remoteImages: false } }>
let renderImpl: (input: ChatDocInput) => Promise<Buffer>

const DOCX = { blocks: [{ type: 'paragraph', text: 'Hola' }] }
const XLSX = { sheets: [{ name: 'Hoja', rows: [['a', 'b']] }] }

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'lzx-docs-a-'))
  folder2 = mkdtempSync(join(tmpdir(), 'lzx-docs-b-'))
  audits = []
  renders = []
  renderImpl = async () => Buffer.from('ARCHIVO')
  server = new DocumentsMcpServer({
    render: async (input, title, opts) => {
      renders.push({ input, title, opts })
      return renderImpl(input)
    },
    audit: (e) => audits.push(e)
  })
})
afterEach(async () => {
  await server.stop()
  rmSync(folder, { recursive: true, force: true })
  rmSync(folder2, { recursive: true, force: true })
})

interface Resp {
  status: number
  body: any
}

function post(port: number, token: string | undefined, body: unknown, extra: Record<string, string> = {}, rawBody?: string): Promise<Resp> {
  const payload = rawBody ?? JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        agent: false,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...extra
        }
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let parsed: unknown = text
          try {
            parsed = text ? JSON.parse(text) : null
          } catch {
            /* texto */
          }
          resolve({ status: res.statusCode ?? 0, body: parsed })
        })
      }
    )
    req.on('error', reject)
    req.end(payload)
  })
}

const call = (port: number, token: string, args: Record<string, unknown>, name = 'crear') =>
  post(port, token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })

const textOf = (r: Resp): string => r.body.result.content[0].text

describe('transporte y autenticación', () => {
  it('sin token → 401; token ajeno → 401; token revocado → 401', async () => {
    const { token, port } = await server.clientFor({ folder })
    expect((await post(port, undefined, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401)
    expect((await post(port, 'x'.repeat(43), { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401)
    expect((await post(port, token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(200)
    expect(server.revokeToken(token)).toBe(true)
    expect((await post(port, token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401)
  })

  it('cualquier Origin → 403 y un Host raro → 403', async () => {
    const { token, port } = await server.clientFor({ folder })
    expect((await post(port, token, { jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'http://evil.example' })).status).toBe(403)
    expect((await post(port, token, { jsonrpc: '2.0', id: 1, method: 'ping' }, { host: 'evil.example' })).status).toBe(403)
  })

  it('cuerpo mayor de 1 MiB → 413 y JSON roto → 400', async () => {
    const { token, port } = await server.clientFor({ folder })
    const big = await post(port, token, null, {}, JSON.stringify({ x: 'a'.repeat(1024 * 1024 + 10) })).catch(() => ({ status: 413 }))
    expect(big.status).toBe(413)
    expect((await post(port, token, null, {}, '{no es json')).status).toBe(400)
  })

  it('initialize y tools/list', async () => {
    const { token, port } = await server.clientFor({ folder })
    const init = await post(port, token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
    expect(init.body.result.serverInfo.name).toBe('lazunox-documentos')
    const list = await post(port, token, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect(list.body.result.tools.map((t: { name: string }) => t.name)).toEqual([
      'crear',
      'imagenes_buscar',
      'imagenes_ver',
      'imagenes_usar'
    ])
  })

  it('el config remoto lleva el token y la URL del servidor', async () => {
    const cfg = await server.configFor({ folder })
    expect(cfg?.type).toBe('remote')
    expect(String(cfg?.url)).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    expect((cfg?.headers as { Authorization: string }).Authorization).toMatch(/^Bearer [A-Za-z0-9_-]{43}$/)
    expect(server.knownTokens().length).toBe(1)
  })

  it('un token nuevo para la misma carpeta invalida el anterior', async () => {
    const a = await server.clientFor({ folder })
    const b = await server.clientFor({ folder })
    expect((await post(a.port, a.token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401)
    expect((await post(b.port, b.token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(200)
  })
})

describe('crear: marcadores pendientes', () => {
  const PEND = { blocks: [{ type: 'paragraph', text: 'Preparada para: [PENDIENTE: nombre]' }] }
  it('rechaza un spec con [PENDIENTE…] con un error duro y sin generar nada', async () => {
    const { token, port } = await server.clientFor({ folder })
    const before = renders.length
    const r = await call(port, token, { tipo: 'docx', nombre: 'Pend', spec: PEND })
    expect(r.body.result.isError).toBe(true)
    expect(textOf(r)).toContain('No dejes marcadores')
    expect(renders.length).toBe(before)
    expect(audits.at(-1)).toMatchObject({ tool: 'crear', result: 'rechazado', detail: 'contenido' })
  })
  it('rechaza el HTML de un pdf con marcadores', async () => {
    const { token, port } = await server.clientFor({ folder })
    const r = await call(port, token, { tipo: 'pdf', nombre: 'P', html: '<html><body><p>Total: [por definir]</p></body></html>' })
    expect(r.body.result.isError).toBe(true)
  })
  it('con allow_placeholders: true (plantilla pedida) lo acepta', async () => {
    const { token, port } = await server.clientFor({ folder })
    const r = await call(port, token, { tipo: 'docx', nombre: 'Plantilla', spec: PEND, allow_placeholders: true })
    expect(r.body.result.isError).toBeUndefined()
  })
})

describe('crear', () => {
  it('Word: escribe en la carpeta de la atadura, sin imágenes remotas, y responde la ruta', async () => {
    const { token, port } = await server.clientFor({ folder })
    const r = await call(port, token, { tipo: 'docx', nombre: 'Informe', spec: DOCX })
    expect(r.body.result.isError).toBeUndefined()
    // En Windows el servidor puede devolver la ruta en su forma larga (RUNNER~1 → runneradmin).
    expect([join(folder, 'Informe.docx'), join(realpathSync.native(folder), 'Informe.docx')].some((p) => textOf(r).includes(p))).toBe(true)
    expect(readFileSync(join(folder, 'Informe.docx'), 'utf8')).toBe('ARCHIVO')
    expect(renders[0]!.opts).toEqual({ remoteImages: false })
    expect(audits.at(-1)).toMatchObject({ tool: 'crear', tipo: 'docx', result: 'ok', rel: 'Informe.docx' })
  })

  it('la respuesta trae la revisión de calidad de la herramienta; si no se pudo abrir el archivo lo dice («NO corrida»)', async () => {
    const { token, port } = await server.clientFor({ folder })
    const r = await call(port, token, { tipo: 'docx', nombre: 'Revisado', spec: DOCX })
    expect(textOf(r)).toContain('Revisión de calidad: NO corrida')
    const withReview = new DocumentsMcpServer({
      render: async () => Buffer.from('x'),
      audit: () => undefined,
      review: async () => ({
        ok: false,
        items: [
          { ok: true, text: 'Bien A' },
          { ok: false, text: 'Mal B' }
        ]
      })
    })
    try {
      const c = await withReview.clientFor({ folder: folder2 })
      const t = textOf(await call(c.port, c.token, { tipo: 'docx', nombre: 'Doble', spec: DOCX }))
      expect(t).toContain('✔ Bien A')
      expect(t).toContain('✘ Mal B')
      expect(t).toContain('MISMO nombre')
    } finally {
      await withReview.stop()
    }
  })

  it('la ruta que ve el agente pasa por toAgentPath (Windows: /win/c/…)', async () => {
    const { token, port } = await server.clientFor({ folder, toAgentPath: (p) => `/win/c/${p.length}` })
    const r = await call(port, token, { tipo: 'xlsx', nombre: 'Ventas', spec: XLSX })
    expect(textOf(r)).toContain('/win/c/')
  })

  it('PDF: usa html y se rechaza sin él', async () => {
    const { token, port } = await server.clientFor({ folder })
    const ok = await call(port, token, { tipo: 'pdf', nombre: 'guia', html: '<p>hola</p>' })
    expect(ok.body.result.isError).toBeUndefined()
    expect(renders[0]!.input).toEqual({ kind: 'pdf', html: '<p>hola</p>' })
    const bad = await call(port, token, { tipo: 'pdf', nombre: 'guia' })
    expect(bad.body.result.isError).toBe(true)
  })

  it('cada token escribe SOLO en su carpeta', async () => {
    const a = await server.clientFor({ folder })
    const b = await server.clientFor({ folder: folder2 })
    await call(a.port, a.token, { tipo: 'docx', nombre: 'a', spec: DOCX })
    await call(b.port, b.token, { tipo: 'docx', nombre: 'b', spec: DOCX })
    expect(readdirSync(folder)).toEqual(['a.docx'])
    expect(readdirSync(folder2)).toEqual(['b.docx'])
  })

  it('rehace el mismo archivo propio intacto de la misma sesión', async () => {
    const { token, port } = await server.clientFor({ folder, session: async () => 'ses_prueba' })
    await call(port, token, { tipo: 'docx', nombre: 'x', spec: DOCX })
    const r = await call(port, token, { tipo: 'docx', nombre: 'x', spec: DOCX })
    expect(textOf(r)).toContain('x.docx')
    expect(readdirSync(folder)).toEqual(['x.docx'])
  })

  it.each([
    ['tipo inválido', { tipo: 'exe', nombre: 'x', spec: DOCX }],
    ['sin tipo', { nombre: 'x', spec: DOCX }],
    ['spec ausente', { tipo: 'docx', nombre: 'x' }],
    ['spec es lista', { tipo: 'docx', nombre: 'x', spec: [] }],
    ['spec no cumple el esquema', { tipo: 'docx', nombre: 'x', spec: { blocks: [{ type: 'script' }] } }],
    ['xlsx sin hojas', { tipo: 'xlsx', nombre: 'x', spec: { sheets: [] } }],
    ['pptx sin diapositivas', { tipo: 'pptx', nombre: 'x', spec: { slides: [] } }]
  ])('contenido inválido (%s) → error sin escribir ni renderizar', async (_n, args) => {
    const { token, port } = await server.clientFor({ folder })
    const r = await call(port, token, args)
    expect(r.body.result.isError).toBe(true)
    expect(readdirSync(folder)).toEqual([])
    expect(renders).toEqual([])
  })

  it('un spec de más de 1 MB se rechaza', async () => {
    const { token, port } = await server.clientFor({ folder })
    const big = {
      blocks: [
        { type: 'paragraph', text: 'a'.repeat(600_000) },
        { type: 'paragraph', text: 'b'.repeat(600_000) }
      ]
    }
    const r = await post(
      port,
      token,
      null,
      {},
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'crear', arguments: { tipo: 'docx', nombre: 'x', spec: big } }
      })
    )
    expect(r.status).toBe(413)
    expect(readdirSync(folder)).toEqual([])
  })

  it.each(['../fuera', '/etc', 'C:\\Windows', 'a:b'])('subcarpeta hostil %j → error y nada escrito', async (sub) => {
    const { token, port } = await server.clientFor({ folder })
    const r = await call(port, token, { tipo: 'docx', nombre: 'x', spec: DOCX, subcarpeta: sub })
    expect(r.body.result.isError).toBe(true)
    expect(readdirSync(folder)).toEqual([])
  })

  it('subcarpeta válida se crea', async () => {
    const { token, port } = await server.clientFor({ folder })
    const r = await call(port, token, { tipo: 'docx', nombre: 'x', spec: DOCX, subcarpeta: 'docs/2026' })
    expect(r.body.result.isError).toBeUndefined()
    expect(readdirSync(join(folder, 'docs', '2026'))).toEqual(['x.docx'])
  })

  it('un fallo del motor NO le devuelve al agente la salida cruda (rutas del equipo)', async () => {
    renderImpl = async () => {
      throw new Error('deckcraft falló en /Users/ben/Library/Application Support/Lazunox/secreto')
    }
    const { token, port } = await server.clientFor({ folder })
    const r = await call(port, token, { tipo: 'docx', nombre: 'x', spec: DOCX })
    expect(r.body.result.isError).toBe(true)
    expect(textOf(r)).not.toContain('/Users/ben')
    expect(textOf(r)).not.toContain('secreto')
    expect(audits.at(-1)).toMatchObject({ result: 'error' })
  })

  it('sin ArtCraft instalado, dice cómo instalarlo', async () => {
    renderImpl = async () => {
      throw Object.assign(new Error('El diseñador de documentos (WordCraft) no está instalado.'), { code: 'no-craft' })
    }
    const { token, port } = await server.clientFor({ folder })
    const r = await call(port, token, { tipo: 'docx', nombre: 'x', spec: DOCX })
    expect(textOf(r)).toContain('Componentes opcionales')
  })

  it('un motor que cuelga se corta por tiempo', async () => {
    const s = new DocumentsMcpServer({ render: () => new Promise(() => undefined), audit: () => undefined, renderTimeoutMs: 50 })
    try {
      const { token, port } = await s.clientFor({ folder })
      const r = await call(port, token, { tipo: 'docx', nombre: 'x', spec: DOCX })
      expect(r.body.result.isError).toBe(true)
      expect(textOf(r)).toContain('tardó demasiado')
      // y la atadura queda libre para el siguiente
      const again = await call(port, token, { tipo: 'docx', nombre: 'y', spec: DOCX })
      expect(textOf(again)).toContain('tardó demasiado')
    } finally {
      await s.stop()
    }
  })

  it('una operación a la vez por atadura', async () => {
    let release: (() => void) | undefined
    renderImpl = () => new Promise<Buffer>((res) => (release = () => res(Buffer.from('x'))))
    const { token, port } = await server.clientFor({ folder })
    const first = call(port, token, { tipo: 'docx', nombre: 'a', spec: DOCX })
    await new Promise((r) => setTimeout(r, 40))
    const second = await call(port, token, { tipo: 'docx', nombre: 'b', spec: DOCX })
    expect(second.body.result.isError).toBe(true)
    expect(textOf(second)).toContain('otro documento en curso')
    release?.()
    expect((await first).body.result.isError).toBeUndefined()
  })

  it('tope por hora', async () => {
    let t = 1_000_000
    const s = new DocumentsMcpServer({ render: async () => Buffer.from('x'), audit: () => undefined, now: () => t })
    try {
      const { token, port } = await s.clientFor({ folder })
      for (let i = 0; i < MAX_PER_BINDING_PER_HOUR; i++) {
        const r = await call(port, token, { tipo: 'docx', nombre: `d${i}`, spec: DOCX })
        expect(r.body.result.isError).toBeUndefined()
      }
      const over = await call(port, token, { tipo: 'docx', nombre: 'de-mas', spec: DOCX })
      expect(over.body.result.isError).toBe(true)
      t += 3_600_001
      const later = await call(port, token, { tipo: 'docx', nombre: 'despues', spec: DOCX })
      expect(later.body.result.isError).toBeUndefined()
    } finally {
      await s.stop()
    }
  })

  it('herramienta desconocida', async () => {
    const { token, port } = await server.clientFor({ folder })
    const r = await call(port, token, {}, 'borrar_todo')
    expect(r.body.result.isError).toBe(true)
  })

  it('la auditoría no lleva el contenido del documento', async () => {
    const { token, port } = await server.clientFor({ folder })
    await call(port, token, { tipo: 'docx', nombre: 'x', spec: { blocks: [{ type: 'paragraph', text: 'DATO-CONFIDENCIAL' }] } })
    expect(JSON.stringify(audits)).not.toContain('DATO-CONFIDENCIAL')
  })
})

describe('renderizar', () => {
  const PPTX = { slides: [{ layout: 'cover', title: 'Hola' }] }
  const PNG = Buffer.from('PNG-FALSO')
  let previews: Array<{ tipo: string; bytes: Buffer }>
  let previewImpl: () => Promise<{ images: Buffer[]; pages: number; truncated: boolean } | null>
  let s2: DocumentsMcpServer

  beforeEach(() => {
    previews = []
    previewImpl = async () => ({ images: [PNG, PNG], pages: 2, truncated: false })
    s2 = new DocumentsMcpServer({
      render: async () => Buffer.from('ARCHIVO'),
      preview: async (tipo, bytes) => {
        previews.push({ tipo, bytes })
        return previewImpl()
      },
      audit: (e) => audits.push(e)
    })
  })
  afterEach(async () => {
    await s2.stop()
  })

  it('sin motor de vista previa, la herramienta ni se anuncia', async () => {
    const { token, port } = await server.clientFor({ folder })
    const list = await post(port, token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(list.body.result.tools.map((t: { name: string }) => t.name)).toEqual([
      'crear',
      'imagenes_buscar',
      'imagenes_ver',
      'imagenes_usar'
    ])
    const r = await call(port, token, { ruta: 'x' }, 'renderizar')
    expect(r.body.result.isError).toBe(true)
  })

  it('con motor, se anuncia y devuelve texto + imágenes base64 de lo creado', async () => {
    const { token, port } = await s2.clientFor({ folder })
    const list = await post(port, token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(list.body.result.tools.map((t: { name: string }) => t.name)).toEqual([
      'crear',
      'renderizar',
      'imagenes_buscar',
      'imagenes_ver',
      'imagenes_usar'
    ])
    const created = await call(port, token, { tipo: 'pptx', nombre: 'deck', spec: PPTX })
    const ruta = textOf(created).match(/creado: (.+) \(/)![1]!
    const r = await call(port, token, { ruta }, 'renderizar')
    expect(r.body.result.isError).toBeUndefined()
    const content = r.body.result.content
    expect(content[0].type).toBe('text')
    expect(content[0].text).toContain('2 diapositiva')
    expect(content.slice(1).map((c: { type: string }) => c.type)).toEqual(['image', 'image'])
    expect(Buffer.from(content[1].data, 'base64').equals(PNG)).toBe(true)
    expect(content[1].mimeType).toBe('image/png')
    expect(previews[0]!.tipo).toBe('pptx')
  })

  it('rechaza una ruta que no creó `crear` (archivo ajeno de la carpeta, o fuera de ella)', async () => {
    writeFileSync(join(folder, 'ajeno.docx'), 'x')
    const { token, port } = await s2.clientFor({ folder })
    for (const ruta of [join(folder, 'ajeno.docx'), '/etc/passwd', '../x', '']) {
      const r = await call(port, token, { ruta }, 'renderizar')
      expect(r.body.result.isError).toBe(true)
    }
    expect(previews).toEqual([])
  })

  it('un archivo ajeno de la carpeta (bash/edición) se renderiza por ruta relativa y por la absoluta de la tarea', async () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('doc')])
    writeFileSync(join(folder, 'editado.docx'), zip)
    const { token, port } = await s2.clientFor({ folder })
    for (const ruta of ['editado.docx', join(folder, 'editado.docx')]) {
      const r = await call(port, token, { ruta }, 'renderizar')
      expect(r.body.result.isError).toBeUndefined()
      expect(r.body.result.content[1].type).toBe('image')
    }
    expect(previews.map((p) => p.tipo)).toEqual(['docx', 'docx'])
    expect(previews[0]!.bytes.equals(zip)).toBe(true)
  })

  it('un archivo ajeno que no es un zip, enlaza hacia fuera o sube con «..» no llega al motor', async () => {
    writeFileSync(join(folder, 'falso.docx'), 'no soy un zip')
    writeFileSync(join(folder2, 'secreto.docx'), Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    symlinkSync(join(folder2, 'secreto.docx'), join(folder, 'enlace.docx'))
    const { token, port } = await s2.clientFor({ folder })
    for (const ruta of ['falso.docx', 'enlace.docx', '../x.docx', join(folder2, 'secreto.docx')]) {
      const r = await call(port, token, { ruta }, 'renderizar')
      expect(r.body.result.isError).toBe(true)
    }
    expect(previews).toEqual([])
  })

  it('la cuota por hora también cuenta los archivos ajenos', async () => {
    let t = 5_000_000
    const s3 = new DocumentsMcpServer({
      render: async () => Buffer.from('x'),
      preview: async () => ({ images: [PNG], pages: 1, truncated: false }),
      audit: () => undefined,
      now: () => t
    })
    try {
      writeFileSync(join(folder, 'a.pdf'), '%PDF-1.4 x')
      const { token, port } = await s3.clientFor({ folder })
      for (let i = 0; i < MAX_PREVIEWS_PER_HOUR; i++) {
        expect((await call(port, token, { ruta: 'a.pdf' }, 'renderizar')).body.result.isError).toBeUndefined()
      }
      expect((await call(port, token, { ruta: 'a.pdf' }, 'renderizar')).body.result.isError).toBe(true)
      t += 3_600_001
      expect((await call(port, token, { ruta: 'a.pdf' }, 'renderizar')).body.result.isError).toBeUndefined()
    } finally {
      await s3.stop()
    }
  })

  it('si las imágenes salen de la vista simplificada del visor, el texto se lo avisa a la IA', async () => {
    const s3 = new DocumentsMcpServer({
      render: async () => Buffer.from('ARCHIVO'),
      preview: async () => ({ images: [PNG], pages: 1, truncated: false, viaViewer: true }),
      audit: () => undefined
    })
    try {
      const { token, port } = await s3.clientFor({ folder })
      const created = await call(port, token, { tipo: 'pptx', nombre: 'deck', spec: PPTX })
      const ruta = textOf(created).match(/creado: (.+) \(/)![1]!
      const r = await call(port, token, { ruta }, 'renderizar')
      expect(r.body.result.content[0].text).toContain('VISTA SIMPLIFICADA')
    } finally {
      await s3.stop()
    }
  })

  it('una ruta creada por OTRA atadura no vale', async () => {
    const a = await s2.clientFor({ folder })
    const b = await s2.clientFor({ folder: folder2 })
    const created = await call(a.port, a.token, { tipo: 'docx', nombre: 'a', spec: DOCX })
    const ruta = textOf(created).match(/creado: (.+) \(/)![1]!
    const r = await call(b.port, b.token, { ruta }, 'renderizar')
    expect(r.body.result.isError).toBe(true)
  })

  it('si el archivo cambió después de crearlo, no se renderiza', async () => {
    const { token, port } = await s2.clientFor({ folder })
    const created = await call(port, token, { tipo: 'docx', nombre: 'a', spec: DOCX })
    const ruta = textOf(created).match(/creado: (.+) \(/)![1]!
    previews.length = 0 // crear ya devolvió su vista previa
    writeFileSync(ruta, 'MANIPULADO')
    const r = await call(port, token, { ruta }, 'renderizar')
    expect(r.body.result.isError).toBe(true)
    expect(textOf(r)).toContain('cambió')
    expect(previews).toEqual([])
  })

  it('xlsx y pdf también se renderizan (pasan por el PDF)', async () => {
    const { token, port } = await s2.clientFor({ folder })
    for (const args of [
      { tipo: 'xlsx', nombre: 'libro', spec: XLSX },
      { tipo: 'pdf', nombre: 'guia', html: '<p>hola</p>' }
    ]) {
      const created = await call(port, token, args)
      const ruta = textOf(created).match(/creado: (.+) \(/)![1]!
      const r = await call(port, token, { ruta }, 'renderizar')
      expect(r.body.result.isError).toBeUndefined()
      expect(r.body.result.content[1].type).toBe('image')
    }
    expect(previews.map((p) => p.tipo)).toEqual(['xlsx', 'xlsx', 'pdf', 'pdf'])
  })

  it('sin render disponible (falta ArtCraft) explica qué hacer', async () => {
    previewImpl = async () => null
    const { token, port } = await s2.clientFor({ folder })
    const created = await call(port, token, { tipo: 'pptx', nombre: 'a', spec: PPTX })
    const ruta = textOf(created).match(/creado: (.+) \(/)![1]!
    const r = await call(port, token, { ruta }, 'renderizar')
    expect(r.body.result.isError).toBe(true)
    expect(textOf(r)).toContain('Para revisar')
  })

  it('un fallo del motor no filtra la salida cruda', async () => {
    previewImpl = async () => {
      throw new Error('deckcraft: /Users/ben/secreto falló')
    }
    const { token, port } = await s2.clientFor({ folder })
    const created = await call(port, token, { tipo: 'pptx', nombre: 'a', spec: PPTX })
    const ruta = textOf(created).match(/creado: (.+) \(/)![1]!
    const r = await call(port, token, { ruta }, 'renderizar')
    expect(r.body.result.isError).toBe(true)
    expect(textOf(r)).not.toContain('/Users/ben')
  })
})

describe('crear: argumentos con variantes y errores claros', () => {
  it('acepta spec como texto JSON y nombre ausente', async () => {
    const { token, port } = await server.clientFor({ folder })
    const r = await call(port, token, { tipo: 'docx', spec: JSON.stringify(DOCX) })
    expect(r.body.result.isError).toBeUndefined()
  })
  it('el rechazo de pptx dice qué campo corregir', async () => {
    const { token, port } = await server.clientFor({ folder })
    const r = await call(port, token, {
      tipo: 'pptx',
      nombre: 'x',
      spec: { slides: [{ title: 'ok' }, { title: 'mal', layout: 'inventado' }] }
    })
    expect(r.body.result.isError).toBe(true)
    expect(textOf(r)).toContain('slides[1]')
    expect(textOf(r)).toContain('layout')
  })
  it('rechaza «a definir» y celdas «pendiente»', async () => {
    const { token, port } = await server.clientFor({ folder })
    const r = await call(port, token, {
      tipo: 'docx',
      nombre: 'y',
      spec: { blocks: [{ type: 'paragraph', text: 'Monto: a definir por Finanzas' }] }
    })
    expect(r.body.result.isError).toBe(true)
  })
})

describe('crear: pase 4', () => {
  it('rechaza [PENDIENTE: …] largo en un caption de tabla y «en evaluación»', async () => {
    const { token, port } = await server.clientFor({ folder })
    const long =
      '[PENDIENTE: montos reales de cada modalidad según la cotización vigente del proveedor de servicios, a confirmar con Finanzas el próximo mes]'
    const t = (caption: string) => ({ blocks: [{ type: 'table', columns: ['A'], rows: [['1']], caption }] })
    expect((await call(port, token, { tipo: 'docx', nombre: 'a', spec: t(long) })).body.result.isError).toBe(true)
    expect((await call(port, token, { tipo: 'docx', nombre: 'b', spec: t('Montos en evaluación') })).body.result.isError).toBe(true)
  })
  it('rechaza una lámina de presupuesto sin ninguna cifra', async () => {
    const { token, port } = await server.clientFor({ folder })
    const r = await call(port, token, {
      tipo: 'pptx',
      nombre: 'p',
      spec: { slides: [{ title: 'Presupuesto 2027', bullets: ['Personal', 'Tecnología'] }] }
    })
    expect(r.body.result.isError).toBe(true)
    expect(textOf(r)).toContain('cifras de ejemplo')
  })
  it('avisa si el Word calculado se pasa de paginas_objetivo', async () => {
    const { token, port } = await server.clientFor({ folder })
    const text = Array.from({ length: 100 }, () => 'palabra').join(' ')
    const blocks = Array.from({ length: 24 }, () => ({ type: 'paragraph', text }))
    const r = await call(port, token, { tipo: 'docx', nombre: 'largo', spec: { blocks }, paginas_objetivo: '4-5' })
    expect(textOf(r)).toContain('calculo unas')
  })
})

describe('pdf con imágenes de la carpeta', () => {
  it('resuelve el src real con entidades sin atribuir data-src, comentarios ni texto de scripts', () => {
    const html =
      '<!-- <img src="comentario.jpg"> --><script>"<img src=script.jpg>"</script>' +
      '<img data-src="equivocada.jpg" alt="a > b" src="img/caf&#233;.jpg"><img src=sin-comillas.png>'
    expect(localImageRefs(html)).toEqual(['img/café.jpg', 'sin-comillas.png'])
  })

  it('localImageRefs encuentra rutas relativas y descarta data: y http (una ruta absoluta se deja pasar para que se rechace con mensaje)', () => {
    const html =
      '<img src="logo.png"><img src="data:image/png;base64,xx"><img src="https://x/y.png"><div style="background:url(fondo.jpg)"></div><img src="/abs.png">'
    expect(localImageRefs(html).sort()).toEqual(['/abs.png', 'fondo.jpg', 'logo.png'])
  })
})

describe('errores de datos: mensaje accionable, no «Error interno»', () => {
  const bad: Array<[string, Record<string, unknown>, RegExp]> = [
    ['Word: blocks es un objeto', { tipo: 'docx', spec: { blocks: { item: [1] } } }, /`blocks` debe ser una lista[\s\S]*Ejemplo/],
    ['Word: blocks con un null', { tipo: 'docx', spec: { blocks: [null] } }, /blocks\[0\]/],
    [
      'Word: tabla con filas de otro largo',
      { tipo: 'docx', spec: { blocks: [{ type: 'table', columns: ['A', 'B'], rows: [['1']] }] } },
      /rows\[0\][\s\S]*2 celdas/
    ],
    ['Excel: sheets es un objeto', { tipo: 'xlsx', spec: { sheets: { a: 1 } } }, /`sheets` debe ser una lista[\s\S]*Ejemplo/],
    ['PowerPoint: slides es un objeto', { tipo: 'pptx', spec: { slides: { a: 1 } } }, /`slides` debe ser una lista[\s\S]*Ejemplo/],
    ['PowerPoint: lámina null', { tipo: 'pptx', spec: { slides: [null] } }, /slides\[0\]/],
    ['PDF: html no es texto', { tipo: 'pdf', html: { a: 1 } }, /pasa `html`/]
  ]
  for (const [name, args, re] of bad)
    it(name, async () => {
      const { token, port } = await server.clientFor({ folder })
      const r = await call(port, token, args)
      expect(r.body.error).toBeUndefined()
      expect(r.body.result.isError).toBe(true)
      expect(textOf(r)).toMatch(re)
      expect(textOf(r)).not.toContain(folder)
      expect(renders.length).toBe(0)
    })

  it('un fallo inesperado del programa no es «Error interno»: avisa que no es del contenido, sin rutas ni traza, y lo deja en el registro', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(server as any, 'callToolInner').mockRejectedValue(new Error(`boom en ${folder}/secreto`))
    const { token, port } = await server.clientFor({ folder })
    const r = await call(port, token, { tipo: 'docx', spec: DOCX })
    expect(r.body.error).toBeUndefined()
    expect(r.body.result.isError).toBe(true)
    expect(textOf(r)).toMatch(/no es un error de tu contenido/)
    expect(textOf(r)).not.toContain(folder)
    expect(warn.mock.calls.flat().join(' ')).toContain('boom')
    warn.mockRestore()
  })
})
