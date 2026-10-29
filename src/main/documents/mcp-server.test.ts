import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DocumentsMcpServer, MAX_PER_BINDING_PER_HOUR, type AuditEntry } from './mcp-server'
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
    expect(list.body.result.tools.map((t: { name: string }) => t.name)).toEqual(['crear'])
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

describe('crear', () => {
  it('Word: escribe en la carpeta de la atadura, sin imágenes remotas, y responde la ruta', async () => {
    const { token, port } = await server.clientFor({ folder })
    const r = await call(port, token, { tipo: 'docx', nombre: 'Informe', spec: DOCX })
    expect(r.body.result.isError).toBeUndefined()
    expect(textOf(r)).toContain(join(folder, 'Informe.docx'))
    expect(readFileSync(join(folder, 'Informe.docx'), 'utf8')).toBe('ARCHIVO')
    expect(renders[0]!.opts).toEqual({ remoteImages: false })
    expect(audits.at(-1)).toMatchObject({ tool: 'crear', tipo: 'docx', result: 'ok', rel: 'Informe.docx' })
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

  it('no pisa: el segundo con el mismo nombre queda « (2)»', async () => {
    const { token, port } = await server.clientFor({ folder })
    await call(port, token, { tipo: 'docx', nombre: 'x', spec: DOCX })
    const r = await call(port, token, { tipo: 'docx', nombre: 'x', spec: DOCX })
    expect(textOf(r)).toContain('x (2).docx')
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
    expect(list.body.result.tools.map((t: { name: string }) => t.name)).toEqual(['crear'])
    const r = await call(port, token, { ruta: 'x' }, 'renderizar')
    expect(r.body.result.isError).toBe(true)
  })

  it('con motor, se anuncia y devuelve texto + imágenes base64 de lo creado', async () => {
    const { token, port } = await s2.clientFor({ folder })
    const list = await post(port, token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(list.body.result.tools.map((t: { name: string }) => t.name)).toEqual(['crear', 'renderizar'])
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
    expect(previews.map((p) => p.tipo)).toEqual(['xlsx', 'pdf'])
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
