import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DOCUMENTS_SERVER } from '@shared/documents-permissions'
import { DOCUMENTS_ROUTE_NAME } from './names'
import {
  CODE_BINDING_FOLDER,
  CODE_MSG_MISSING,
  CODE_MSG_NOT_OPEN,
  CODE_MSG_RELATIVE,
  DocumentsMcpServer,
  MAX_PER_BINDING_PER_HOUR,
  resolveCodeRoot,
  type AuditEntry
} from './mcp-server'

let base: string
let proyecto: string
let otro: string
let roots: string[]
let server: DocumentsMcpServer
let audits: AuditEntry[]
let previews: string[]

const DOCX = { blocks: [{ type: 'paragraph', text: 'Hola' }] }
const PNG = Buffer.from('iVBORw0KGgo=', 'base64')

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-docs-code-')))
  proyecto = join(base, 'proyecto')
  otro = join(base, 'ajena')
  mkdirSync(proyecto)
  mkdirSync(otro)
  roots = [proyecto]
  audits = []
  previews = []
  server = new DocumentsMcpServer({
    render: async () => Buffer.from('ARCHIVO'),
    preview: async (tipo) => {
      previews.push(tipo)
      return { images: [PNG], pages: 1, truncated: false }
    },
    audit: (e) => audits.push(e)
  })
})
afterEach(async () => {
  await server.stop()
  rmSync(base, { recursive: true, force: true })
})

function post(port: number, token: string, body: unknown): Promise<{ status: number; body: any }> {
  const payload = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        agent: false,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), authorization: `Bearer ${token}` }
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }))
      }
    )
    req.on('error', reject)
    req.end(payload)
  })
}
const call = (port: number, token: string, args: Record<string, unknown>, name = 'crear') =>
  post(port, token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
const textOf = (r: { body: any }): string => r.body.result.content[0].text
const isErr = (r: { body: any }): boolean => r.body.result.isError === true

async function code() {
  return server.clientFor({ folder: CODE_BINDING_FOLDER, code: { roots: () => roots } })
}

describe('nombres', () => {
  it('el servidor de los permisos de Code coincide con la ruta/servidor de main', () => {
    expect(DOCUMENTS_SERVER).toBe(DOCUMENTS_ROUTE_NAME)
    expect(DOCUMENTS_SERVER).toBe('documentos')
  })
})

describe('resolveCodeRoot', () => {
  it('sin carpeta, relativa o inexistente → rechazo con texto fijo', async () => {
    expect(await resolveCodeRoot(undefined, roots)).toEqual({ ok: false, message: CODE_MSG_MISSING })
    expect(await resolveCodeRoot('   ', roots)).toEqual({ ok: false, message: CODE_MSG_MISSING })
    expect(await resolveCodeRoot('proyecto', roots)).toEqual({ ok: false, message: CODE_MSG_RELATIVE })
    expect(await resolveCodeRoot(join(base, 'no-existe'), roots)).toEqual({ ok: false, message: CODE_MSG_NOT_OPEN })
  })

  it('la raíz y sus subcarpetas valen; una carpeta ajena no', async () => {
    expect(await resolveCodeRoot(proyecto, roots)).toEqual({ ok: true, root: proyecto })
    mkdirSync(join(proyecto, 'sub'))
    expect(await resolveCodeRoot(join(proyecto, 'sub'), roots)).toEqual({ ok: true, root: join(proyecto, 'sub') })
    const r = await resolveCodeRoot(otro, roots)
    expect(r).toEqual({ ok: false, message: CODE_MSG_NOT_OPEN })
    expect(JSON.stringify(r)).not.toContain(base)
  })

  it('un archivo no es una carpeta; un prefijo parecido (proyecto-2) no cuenta como dentro', async () => {
    writeFileSync(join(proyecto, 'a.txt'), 'x')
    expect((await resolveCodeRoot(join(proyecto, 'a.txt'), roots)).ok).toBe(false)
    mkdirSync(join(base, 'proyecto-2'))
    expect((await resolveCodeRoot(join(base, 'proyecto-2'), roots)).ok).toBe(false)
  })

  it('un enlace que entra a una raíz se acepta (realpath); uno que sale se rechaza', async () => {
    const entra = join(base, 'entra')
    symlinkSync(proyecto, entra)
    expect(await resolveCodeRoot(entra, roots)).toEqual({ ok: true, root: proyecto })
    const sale = join(proyecto, 'sale')
    symlinkSync(otro, sale)
    expect((await resolveCodeRoot(sale, roots)).ok).toBe(false)
  })

  it('una raíz que ya no existe se ignora y la raíz del disco nunca vale como proyecto', async () => {
    expect((await resolveCodeRoot(proyecto, [join(base, 'borrada')])).ok).toBe(false)
    expect((await resolveCodeRoot(proyecto, ['/'])).ok).toBe(false)
    expect((await resolveCodeRoot(proyecto, [join(base, 'borrada'), proyecto])).ok).toBe(true)
  })
})

describe('crear en Code', () => {
  it('sin carpeta → error fijo y no escribe nada', async () => {
    const { token, port } = await code()
    const r = await call(port, token, { tipo: 'docx', nombre: 'Informe', spec: DOCX })
    expect(isErr(r)).toBe(true)
    expect(textOf(r)).toBe(CODE_MSG_MISSING)
    expect(readdirSync(proyecto)).toEqual([])
  })

  it('carpeta relativa o fuera de los proyectos abiertos → rechazo sin revelar rutas', async () => {
    const { token, port } = await code()
    const rel = await call(port, token, { tipo: 'docx', nombre: 'A', spec: DOCX, carpeta: 'proyecto' })
    expect(textOf(rel)).toBe(CODE_MSG_RELATIVE)
    const fuera = await call(port, token, { tipo: 'docx', nombre: 'A', spec: DOCX, carpeta: otro })
    expect(isErr(fuera)).toBe(true)
    expect(textOf(fuera)).toBe(CODE_MSG_NOT_OPEN)
    expect(textOf(fuera)).not.toContain(base)
    expect(readdirSync(otro)).toEqual([])
  })

  it('carpeta = raíz crea dentro; no crea la carpeta «<code>»; acepta el alias folder', async () => {
    const { token, port } = await code()
    const r = await call(port, token, { tipo: 'docx', nombre: 'Informe', spec: DOCX, carpeta: proyecto })
    expect(isErr(r)).toBe(false)
    expect(textOf(r)).toContain(join(proyecto, 'Informe.docx'))
    expect(existsSync(join(proyecto, 'Informe.docx'))).toBe(true)
    const alias = await call(port, token, { tipo: 'docx', nombre: 'Otro', spec: DOCX, folder: proyecto })
    expect(isErr(alias)).toBe(false)
    expect(existsSync(join(proyecto, 'Otro.docx'))).toBe(true)
    expect(existsSync(CODE_BINDING_FOLDER)).toBe(false)
    expect(existsSync(join(process.cwd(), CODE_BINDING_FOLDER))).toBe(false)
  })

  it('carpeta = subcarpeta de una raíz → crea ahí; subcarpeta con «..» → rechazo', async () => {
    mkdirSync(join(proyecto, 'docs'))
    const { token, port } = await code()
    const r = await call(port, token, { tipo: 'docx', nombre: 'Sub', spec: DOCX, carpeta: join(proyecto, 'docs') })
    expect(isErr(r)).toBe(false)
    expect(existsSync(join(proyecto, 'docs', 'Sub.docx'))).toBe(true)
    const up = await call(port, token, { tipo: 'docx', nombre: 'X', spec: DOCX, carpeta: proyecto, subcarpeta: '../ajena' })
    expect(isErr(up)).toBe(true)
    expect(readdirSync(otro)).toEqual([])
  })

  it('enlace simbólico a una raíz → se escribe en la raíz real', async () => {
    const link = join(base, 'enlace')
    symlinkSync(proyecto, link)
    const { token, port } = await code()
    const r = await call(port, token, { tipo: 'docx', nombre: 'ViaEnlace', spec: DOCX, carpeta: link })
    expect(isErr(r)).toBe(false)
    expect(existsSync(join(proyecto, 'ViaEnlace.docx'))).toBe(true)
  })

  it('la lista de proyectos se consulta en cada llamada (cerrar el proyecto retira el permiso)', async () => {
    const { token, port } = await code()
    expect(isErr(await call(port, token, { tipo: 'docx', nombre: 'Uno', spec: DOCX, carpeta: proyecto }))).toBe(false)
    roots = []
    const r = await call(port, token, { tipo: 'docx', nombre: 'Dos', spec: DOCX, carpeta: proyecto })
    expect(textOf(r)).toBe(CODE_MSG_NOT_OPEN)
    expect(existsSync(join(proyecto, 'Dos.docx'))).toBe(false)
  })

  it('la cuota se comparte entre llamadas de la misma atadura', async () => {
    const { token, port } = await code()
    for (let i = 0; i < MAX_PER_BINDING_PER_HOUR; i++) {
      const r = await call(port, token, { tipo: 'docx', nombre: `D${i}`, spec: DOCX, carpeta: proyecto })
      expect(isErr(r)).toBe(false)
    }
    const r = await call(port, token, { tipo: 'docx', nombre: 'Extra', spec: DOCX, carpeta: proyecto })
    expect(isErr(r)).toBe(true)
    expect(textOf(r)).toContain('muchos documentos')
  })

  it('una atadura de Tareas sigue sin pedir carpeta y escribe en la suya', async () => {
    const { token, port } = await server.clientFor({ folder: proyecto })
    const r = await call(port, token, { tipo: 'docx', nombre: 'Tarea', spec: DOCX })
    expect(isErr(r)).toBe(false)
    expect(existsSync(join(proyecto, 'Tarea.docx'))).toBe(true)
    // `carpeta` se ignora en Tareas: no sirve para salirse de la carpeta de la tarea.
    const r2 = await call(port, token, { tipo: 'docx', nombre: 'Tarea2', spec: DOCX, carpeta: otro })
    expect(isErr(r2)).toBe(false)
    expect(readdirSync(otro)).toEqual([])
  })

  it('relanzar (misma atadura de Code) invalida el token anterior', async () => {
    const a = await code()
    const b = await code()
    expect((await post(a.port, a.token, { jsonrpc: '2.0', id: 1, method: 'ping' }).catch(() => ({ status: 0 }))).status).toBe(401)
    expect((await post(b.port, b.token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(200)
  })
})

describe('renderizar en Code', () => {
  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('contenido')])

  it('sin carpeta o fuera de los proyectos → rechazo y no renderiza', async () => {
    writeFileSync(join(otro, 'x.docx'), zip)
    const { token, port } = await code()
    const sin = await call(port, token, { ruta: 'x.docx' }, 'renderizar')
    expect(textOf(sin)).toBe(CODE_MSG_MISSING)
    const fuera = await call(port, token, { ruta: 'x.docx', carpeta: otro }, 'renderizar')
    expect(textOf(fuera)).toBe(CODE_MSG_NOT_OPEN)
    expect(previews).toEqual([])
  })

  it('ruta relativa a la carpeta y ruta absoluta dentro funcionan; absoluta fuera se rechaza', async () => {
    writeFileSync(join(proyecto, 'ok.docx'), zip)
    writeFileSync(join(otro, 'ajeno.docx'), zip)
    const { token, port } = await code()
    const rel = await call(port, token, { ruta: 'ok.docx', carpeta: proyecto }, 'renderizar')
    expect(isErr(rel)).toBe(false)
    const abs = await call(port, token, { ruta: join(proyecto, 'ok.docx'), carpeta: proyecto }, 'renderizar')
    expect(isErr(abs)).toBe(false)
    const fuera = await call(port, token, { ruta: join(otro, 'ajeno.docx'), carpeta: proyecto }, 'renderizar')
    expect(isErr(fuera)).toBe(true)
    expect(previews.length).toBe(2)
  })

  it('un archivo creado con `crear` se renderiza por su ruta absoluta', async () => {
    const { token, port } = await code()
    const c = await call(port, token, { tipo: 'docx', nombre: 'Hecho', spec: DOCX, carpeta: proyecto })
    const ruta = join(proyecto, 'Hecho.docx')
    expect(textOf(c)).toContain(ruta)
    // El render falso devuelve bytes que no son un zip, pero `crear` ya lo registró: se renderiza sin pedir carpeta.
    const r = await call(port, token, { ruta }, 'renderizar')
    expect(isErr(r)).toBe(false)
    expect(previews).toEqual(['docx'])
  })
})
