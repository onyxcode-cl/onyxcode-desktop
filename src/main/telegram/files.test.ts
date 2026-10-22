import JSZip from 'jszip'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setLang } from '@shared/i18n'
import { checkOutgoingFile, prepareIncoming, readOutgoingFile } from './files'
import { posixOnly } from '../../test/platform'

let base: string
let proj: string
let outside: string
beforeEach(() => {
  setLang('es')
  base = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-tg-files-')))
  proj = join(base, 'proyecto')
  outside = join(base, 'fuera')
  mkdirSync(proj)
  mkdirSync(outside)
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

const put = (dir: string, name: string, data: string | Buffer = 'hola'): string => {
  const f = join(dir, name)
  mkdirSync(join(f, '..'), { recursive: true })
  writeFileSync(f, data)
  return f
}

describe('archivos que SALEN: mismas reglas que el Chat', () => {
  it('un documento normal dentro de la carpeta de la sesión pasa', () => {
    const f = put(proj, 'informe.md', '# Informe')
    const r = checkOutgoingFile([proj], f)
    expect(r).toMatchObject({ ok: true, name: 'informe.md', ext: 'md', bytes: 9 })
    if (r.ok) expect(readOutgoingFile(r)?.toString()).toBe('# Informe')
  })

  it('fuera de las carpetas autorizadas: rechazado (incluida otra carpeta de proyecto)', () => {
    const f = put(outside, 'datos.csv', 'a,b')
    expect(checkOutgoingFile([proj], f)).toEqual({ ok: false, reason: 'outside' })
    // Un archivo real y absoluto de otra parte (en Windows `/etc/hosts` no existe y daría «missing»).
    expect(checkOutgoingFile([proj], process.execPath)).toEqual({ ok: false, reason: 'outside' })
  })

  it.skipIf(!posixOnly)('un enlace simbólico que escapa de la carpeta se rechaza (se mira la ruta real)', () => {
    const real = put(outside, 'secreto.txt', 'x')
    const link = join(proj, 'atajo.txt')
    symlinkSync(real, link)
    expect(checkOutgoingFile([proj], link)).toEqual({ ok: false, reason: 'outside' })
  })

  it('rutas inválidas: relativas, con NUL, inexistentes', () => {
    expect(checkOutgoingFile([proj], 'relativa.txt').ok).toBe(false)
    expect(checkOutgoingFile([proj], join(proj, 'a\0b.txt')).ok).toBe(false)
    expect(checkOutgoingFile([proj], join(proj, 'noexiste.txt'))).toEqual({ ok: false, reason: 'missing' })
  })

  it('nombres de secretos: .env, llaves, credenciales', () => {
    for (const n of [
      '.env',
      '.env.local',
      'id_rsa',
      'id_ed25519',
      'clave.pem',
      'sello.key',
      'credentials.json',
      'secrets.yml',
      '.npmrc',
      'auth.json',
      'bd.kdbx'
    ]) {
      const f = put(proj, n, 'x')
      const r = checkOutgoingFile([proj], f)
      expect(r.ok, n).toBe(false)
      if (!r.ok) expect(r.reason, n).toBe('secret')
    }
  })

  it('ejecutables y lanzadores: .sh, .command, .app, .exe, sin extensión y con bit de ejecución', () => {
    for (const n of ['run.sh', 'lanzar.command', 'prog.exe', 'instalar.pkg', 'script.py', 'sinextension']) {
      const f = put(proj, n, 'x')
      const r = checkOutgoingFile([proj], f)
      expect(r.ok, n).toBe(false)
      if (!r.ok) expect(r.reason, n).toBe('blocked')
    }
  })

  // posixOnly: el bit de ejecución y los enlaces simbólicos sin privilegios son de POSIX.
  it.skipIf(!posixOnly)('un archivo con bit de ejecución, aunque se llame .txt, se rechaza', () => {
    const f = put(proj, 'parece.txt', 'x')
    chmodSync(f, 0o755)
    expect(checkOutgoingFile([proj], f)).toEqual({ ok: false, reason: 'blocked' })
  })

  it('carpetas reservadas (.git, .ssh, node_modules…) no se mandan aunque el nombre sea inocente', () => {
    for (const d of ['.git', '.ssh', '.aws', 'node_modules', '.opencode']) {
      const f = put(proj, `${d}/notas.txt`, 'x')
      expect(checkOutgoingFile([proj], f), d).toEqual({ ok: false, reason: 'hidden-dir' })
    }
  })

  it('más de 50 MB: rechazado sin leerlo', () => {
    const f = put(proj, 'enorme.pdf', 'x')
    truncateSync(f, 51 * 1024 * 1024)
    expect(checkOutgoingFile([proj], f)).toEqual({ ok: false, reason: 'too-big' })
    truncateSync(f, 50 * 1024 * 1024)
    expect(checkOutgoingFile([proj], f).ok).toBe(true)
  })

  it('un directorio no es un archivo', () => {
    expect(checkOutgoingFile([proj], proj).ok).toBe(false)
  })
})

async function zipBase64(files: Record<string, string>): Promise<Buffer> {
  const z = new JSZip()
  for (const [k, v] of Object.entries(files)) z.file(k, v)
  return z.generateAsync({ type: 'nodebuffer' })
}
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const docx = (text: string): Promise<Buffer> =>
  zipBase64({
    'word/document.xml': `<?xml version="1.0"?><w:document ${W}><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
    'docProps/app.xml': '<Properties><Pages>1</Pages></Properties>'
  })

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)])
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)])
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n')

describe('archivos que ENTRAN: tipos y tamaño validados', () => {
  it('texto, imagen y PDF viajan como data: igual que un adjunto normal', async () => {
    const t = await prepareIncoming({ name: 'notas.txt', mime: 'text/plain', bytes: Buffer.from('hola mundo') })
    expect(t).toMatchObject({ ok: true, part: { kind: 'text', mime: 'text/plain', filename: 'notas.txt' } })
    if (t.ok) expect(t.part.url).toBe(`data:text/plain;base64,${Buffer.from('hola mundo').toString('base64')}`)
    expect(await prepareIncoming({ name: 'foto.jpg', mime: 'image/jpeg', bytes: JPG })).toMatchObject({
      ok: true,
      part: { kind: 'image', mime: 'image/jpeg' }
    })
    expect(await prepareIncoming({ name: 'dibujo.png', mime: 'image/png', bytes: PNG })).toMatchObject({
      ok: true,
      part: { kind: 'image' }
    })
    expect(await prepareIncoming({ name: 'doc.pdf', mime: 'application/pdf', bytes: PDF })).toMatchObject({
      ok: true,
      part: { kind: 'pdf', mime: 'application/pdf' }
    })
  })

  it('nunca ejecutables ni scripts, con cualquier nombre o tipo declarado', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)])
    const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(100)])
    const macho = Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.alloc(100)])
    const she = Buffer.from('#!/bin/sh\nrm -rf ~\n')
    for (const [name, mime, bytes] of [
      ['setup.exe', 'application/x-msdownload', exe],
      ['foto.png', 'image/png', exe], // se disfraza
      ['notas.txt', 'text/plain', elf],
      ['x.txt', 'text/plain', macho],
      ['limpiar.sh', 'text/x-shellscript', she],
      ['limpiar.txt', 'text/plain', she],
      ['app.py', 'text/x-python', Buffer.from('print(1)')],
      ['lanzar.command', 'application/octet-stream', Buffer.from('x')],
      ['inst.pkg', 'application/octet-stream', Buffer.from('x')]
    ] as const) {
      const r = await prepareIncoming({ name, mime, bytes })
      expect(r, name).toEqual({ ok: false, reason: 'executable' })
    }
  })

  it('nombres de secretos se rechazan', async () => {
    for (const n of ['.env', 'id_rsa', 'clave.pem']) {
      expect(await prepareIncoming({ name: n, mime: 'text/plain', bytes: Buffer.from('x') }), n).toEqual({ ok: false, reason: 'secret' })
    }
  })

  it('el contenido debe coincidir con el tipo: una imagen falsa, un PDF falso y texto binario se rechazan', async () => {
    expect(await prepareIncoming({ name: 'a.png', mime: 'image/png', bytes: Buffer.from('esto es texto') })).toEqual({
      ok: false,
      reason: 'content'
    })
    expect(await prepareIncoming({ name: 'a.jpg', mime: 'image/png', bytes: JPG })).toEqual({ ok: false, reason: 'content' })
    expect(await prepareIncoming({ name: 'a.pdf', mime: 'application/pdf', bytes: Buffer.from('no soy pdf') })).toEqual({
      ok: false,
      reason: 'content'
    })
    expect(await prepareIncoming({ name: 'a.txt', mime: 'text/plain', bytes: Buffer.from([0x68, 0x00, 0x69, 0x01, 0x02]) })).toEqual({
      ok: false,
      reason: 'content'
    })
    expect(await prepareIncoming({ name: 'a.txt', mime: 'text/plain', bytes: Buffer.from([0xff, 0xfe, 0xfd, 0xc0]) })).toEqual({
      ok: false,
      reason: 'content'
    })
  })

  it('tipos no admitidos, vacíos y demasiado grandes', async () => {
    expect(await prepareIncoming({ name: 'musica.mp3', mime: 'audio/mpeg', bytes: Buffer.from('x') })).toEqual({
      ok: false,
      reason: 'type'
    })
    expect(await prepareIncoming({ name: 'x.zip', mime: 'application/zip', bytes: Buffer.from('PK') })).toEqual({
      ok: false,
      reason: 'type'
    })
    expect(await prepareIncoming({ name: 'a.txt', mime: 'text/plain', bytes: Buffer.alloc(0) })).toEqual({ ok: false, reason: 'empty' })
    // 10 MB es el tope general; las imágenes del Chat llegan solo a 5 MB y el texto a 1 MB.
    expect(await prepareIncoming({ name: 'a.txt', mime: 'text/plain', bytes: Buffer.alloc(10 * 1024 * 1024 + 1, 0x61) })).toEqual({
      ok: false,
      reason: 'size'
    })
    expect(await prepareIncoming({ name: 'a.txt', mime: 'text/plain', bytes: Buffer.alloc(1024 * 1024 + 1, 0x61) })).toEqual({
      ok: false,
      reason: 'size'
    })
    const bigPng = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])
    expect(await prepareIncoming({ name: 'g.png', mime: 'image/png', bytes: bigPng })).toEqual({ ok: false, reason: 'size' })
  })

  it('Word pasa por la extracción a texto existente y viaja como texto (marco de «datos»)', async () => {
    const r = await prepareIncoming({
      name: 'informe.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: await docx('Resumen trimestral')
    })
    expect(r).toMatchObject({ ok: true, part: { kind: 'office', mime: 'text/plain', filename: 'informe.docx' } })
    if (r.ok) {
      const text = Buffer.from(r.part.url.split(',')[1] as string, 'base64').toString('utf8')
      expect(text).toContain('Resumen trimestral')
      expect(text).toMatch(/FILE_CONTENT/)
    }
  })

  it('un .docx que no es un ZIP se rechaza como dañado; un formato antiguo, como antiguo', async () => {
    expect(await prepareIncoming({ name: 'x.docx', mime: '', bytes: Buffer.from('basura') })).toEqual({ ok: false, reason: 'corrupt' })
    const cfb = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(600)])
    expect(await prepareIncoming({ name: 'viejo.doc', mime: '', bytes: cfb })).toEqual({ ok: false, reason: 'legacy' })
  })

  it('el nombre se limpia: sin rutas', async () => {
    const r = await prepareIncoming({ name: '../../etc/pasa.txt', mime: 'text/plain', bytes: Buffer.from('x') })
    expect(r).toMatchObject({ ok: true, part: { filename: 'pasa.txt' } })
  })
})
