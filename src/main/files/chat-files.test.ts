import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { posixOnly } from '../../test/platform'
import {
  MAX_TEXT_BYTES,
  assertNativeViewable,
  assertOpenable,
  assertRevealable,
  canViewChatFile,
  chatFilesInfo,
  classifyChatFile,
  readChatFile,
  resolveChatFile
} from './chat-files'
import { IPC_SCHEMAS } from '../ipc/schemas'
import { CELULAR_POLICY } from '../remote/policy'

let base: string
let root: string
let outside: string

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'chat-files-')))
  root = join(base, 'chat')
  outside = join(base, 'fuera')
  mkdirSync(root)
  mkdirSync(outside)
  writeFileSync(join(root, 'foto.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(join(root, 'nota.md'), '# Hola\n\ntexto')
  writeFileSync(join(root, 'datos.csv'), 'a,b\n1,2\n')
  writeFileSync(join(root, 'pagina.html'), '<h1>x</h1><script>alert(1)</script>')
  writeFileSync(join(root, 'informe.pdf'), '%PDF-1.4')
  writeFileSync(join(root, 'hoja.xlsx'), 'PK')
  writeFileSync(join(root, 'instalar.sh'), 'echo hola')
  writeFileSync(join(root, 'programa.exe'), 'MZ')
  writeFileSync(join(root, 'script.bat'), 'echo hola')
  writeFileSync(join(root, 'tarea.ps1'), 'Write-Host hola')
  writeFileSync(join(root, 'lanzar.command'), 'echo hola')
  writeFileSync(join(root, 'app.js'), 'console.log(1)')
  writeFileSync(join(root, '.env'), 'CLAVE=1')
  writeFileSync(join(root, 'llave.pem'), 'x')
  writeFileSync(join(root, 'binario.txt'), Buffer.from([0x41, 0x00, 0x42]))
  writeFileSync(join(root, 'sinextension'), 'x')
  writeFileSync(join(root, 'grande.txt'), 'a'.repeat(MAX_TEXT_BYTES + 100))
  writeFileSync(join(outside, 'secreto.txt'), 'no')
  writeFileSync(join(outside, 'otro.png'), 'x')
})

afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('classifyChatFile / canViewChatFile', () => {
  it('reconoce los tipos que la IA suele producir', () => {
    expect(classifyChatFile('/a/foto.PNG')).toBe('image')
    expect(classifyChatFile('/a/x.pdf')).toBe('office')
    expect(classifyChatFile('/a/x.docx')).toBe('office')
    expect(classifyChatFile('/a/x.html')).toBe('html')
    expect(classifyChatFile('/a/x.md')).toBe('markdown')
    expect(classifyChatFile('/a/x.csv')).toBe('text')
    expect(classifyChatFile('/a/x.json')).toBe('code')
    expect(classifyChatFile('/a/x.zzz')).toBe('other')
  })
  it('ejecutables y lanzadores quedan bloqueados, en cualquier mayúscula', () => {
    for (const f of ['x.exe', 'x.sh', 'x.bat', 'x.ps1', 'x.command', 'X.APP', 'x.msi', 'x.scpt', 'x.lnk', 'x.py']) {
      expect(classifyChatFile(`/a/${f}`), f).toBe('blocked')
      expect(canViewChatFile(`/a/${f}`), f).toBe(false)
    }
  })
  it('qué se puede mostrar', () => {
    expect(canViewChatFile('/a/x.pdf')).toBe(true)
    expect(canViewChatFile('/a/x.pptx')).toBe(true)
    expect(canViewChatFile('/a/x.doc')).toBe(false) // el visor solo sabe docx/xlsx/pptx/pdf
    expect(canViewChatFile('/a/x.zzz')).toBe(false)
  })
})

describe('resolveChatFile', () => {
  it('acepta un archivo dentro de la carpeta permitida', () => {
    const i = resolveChatFile([root], join(root, 'foto.png'))
    expect(i).toMatchObject({ name: 'foto.png', kind: 'image', canView: true, canOpen: true })
  })
  it('rechaza rutas relativas, vacías, con NUL y de otro tipo', () => {
    expect(() => resolveChatFile([root], 'foto.png')).toThrow()
    expect(() => resolveChatFile([root], '')).toThrow()
    expect(() => resolveChatFile([root], join(root, 'foto.png\0.txt'))).toThrow()
    expect(() => resolveChatFile([root], 42 as unknown as string)).toThrow()
  })
  it('rechaza lo que está fuera de las carpetas permitidas, también con ..', () => {
    expect(() => resolveChatFile([root], join(outside, 'secreto.txt'))).toThrow(/fuera/)
    expect(() => resolveChatFile([root], join(root, '..', 'fuera', 'secreto.txt'))).toThrow(/fuera/)
    expect(() => resolveChatFile([], join(root, 'nota.md'))).toThrow()
  })
  it('un prefijo parecido no cuenta como dentro (chat vs chat-otro)', () => {
    mkdirSync(join(base, 'chat-otro'), { recursive: true })
    writeFileSync(join(base, 'chat-otro', 'a.txt'), 'x')
    expect(() => resolveChatFile([root], join(base, 'chat-otro', 'a.txt'))).toThrow(/fuera/)
  })
  it('una carpeta o un archivo inexistente no sirven', () => {
    expect(() => resolveChatFile([root], root)).toThrow()
    expect(() => resolveChatFile([root], join(root, 'no-existe.png'))).toThrow()
  })
  it('archivos con nombre de secreto no se ofrecen', () => {
    expect(() => resolveChatFile([root], join(root, '.env'))).toThrow()
    expect(() => resolveChatFile([root], join(root, 'llave.pem'))).toThrow()
  })
  it('ejecutables y scripts: sin Ver ni Abrir, pero sí identificables para Mostrar en la carpeta', () => {
    for (const f of ['instalar.sh', 'programa.exe', 'script.bat', 'tarea.ps1', 'lanzar.command', 'sinextension']) {
      const i = resolveChatFile([root], join(root, f))
      expect(i, f).toMatchObject({ kind: 'blocked', canView: false, canOpen: false })
      expect(() => assertOpenable([root], join(root, f)), f).toThrow()
      expect(assertRevealable([root], join(root, f)), f).toBe(join(root, f))
    }
  })
  it('un .js se puede ver pero no abrir con el sistema (Windows lo ejecutaría)', () => {
    expect(resolveChatFile([root], join(root, 'app.js'))).toMatchObject({ kind: 'code', canView: true, canOpen: false })
    expect(() => assertOpenable([root], join(root, 'app.js'))).toThrow()
  })
  it.skipIf(!posixOnly)('un enlace simbólico que escapa de la carpeta se rechaza', () => {
    symlinkSync(join(outside, 'otro.png'), join(root, 'enlace.png'))
    expect(() => resolveChatFile([root], join(root, 'enlace.png'))).toThrow(/fuera/)
  })
  it.skipIf(!posixOnly)('un enlace «.pdf» hacia un script se trata como script', () => {
    symlinkSync(join(root, 'instalar.sh'), join(root, 'engano.pdf'))
    expect(resolveChatFile([root], join(root, 'engano.pdf'))).toMatchObject({ kind: 'blocked', canOpen: false })
  })
  it.skipIf(!posixOnly)('un archivo con bit de ejecución queda bloqueado aunque sea .txt', () => {
    writeFileSync(join(root, 'ejecutable.txt'), 'x')
    chmodSync(join(root, 'ejecutable.txt'), 0o755)
    expect(resolveChatFile([root], join(root, 'ejecutable.txt'))).toMatchObject({ kind: 'blocked', canOpen: false, canView: false })
  })
})

describe('chatFilesInfo', () => {
  it('omite en silencio lo inválido, sin repetidos y con tope de 40', () => {
    const res = chatFilesInfo([root], [join(root, 'foto.png'), join(root, 'foto.png'), join(outside, 'otro.png'), join(root, 'nota.md')])
    expect(res.map((r) => r.name)).toEqual(['foto.png', 'nota.md'])
    const many = Array.from({ length: 100 }, () => join(root, 'nota.md'))
    expect(chatFilesInfo([root], many)).toHaveLength(1)
  })
})

describe('assert*', () => {
  it('assertNativeViewable solo deja PDF/Word/Excel/PowerPoint', () => {
    expect(assertNativeViewable([root], join(root, 'informe.pdf'))).toBe(join(root, 'informe.pdf'))
    expect(assertNativeViewable([root], join(root, 'hoja.xlsx'))).toBe(join(root, 'hoja.xlsx'))
    expect(() => assertNativeViewable([root], join(root, 'nota.md'))).toThrow()
    expect(() => assertNativeViewable([root], join(root, 'programa.exe'))).toThrow()
    expect(() => assertNativeViewable([root], join(outside, 'otro.png'))).toThrow()
  })
  it('assertOpenable deja abrir documentos normales y nada fuera de las carpetas', () => {
    expect(assertOpenable([root], join(root, 'informe.pdf'))).toBe(join(root, 'informe.pdf'))
    expect(() => assertOpenable([root], join(outside, 'secreto.txt'))).toThrow()
  })
})

describe('readChatFile', () => {
  it('imagen: data URL con el tipo correcto', () => {
    const r = readChatFile([root], join(root, 'foto.png'))
    expect(r.ok && r.kind === 'image' && r.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })
  it('texto y markdown: contenido tal cual', () => {
    expect(readChatFile([root], join(root, 'nota.md'))).toEqual({ ok: true, kind: 'markdown', text: '# Hola\n\ntexto', truncated: false })
    expect(readChatFile([root], join(root, 'datos.csv'))).toMatchObject({ ok: true, kind: 'text' })
  })
  it('html: devuelve el texto (no se ejecuta aquí; la vista previa es la aislada de siempre)', () => {
    expect(readChatFile([root], join(root, 'pagina.html'))).toMatchObject({ ok: true, kind: 'html' })
  })
  it('trunca los archivos grandes e indica que se cortó', () => {
    const r = readChatFile([root], join(root, 'grande.txt'))
    expect(r.ok && r.kind !== 'image' && r.truncated && r.text.length === MAX_TEXT_BYTES).toBe(true)
  })
  it('rechaza binarios disfrazados de texto, PDF/Office (van por el visor nativo) y rutas no permitidas', () => {
    expect(readChatFile([root], join(root, 'binario.txt'))).toEqual({ ok: false, reason: 'unsupported' })
    expect(readChatFile([root], join(root, 'informe.pdf'))).toEqual({ ok: false, reason: 'unsupported' })
    expect(readChatFile([root], join(root, 'instalar.sh'))).toEqual({ ok: false, reason: 'unsupported' })
    expect(readChatFile([root], join(outside, 'secreto.txt'))).toEqual({ ok: false, reason: 'unreadable' })
    expect(readChatFile([root], join(root, '.env'))).toEqual({ ok: false, reason: 'unreadable' })
  })
})

describe('IPC de archivos del Chat', () => {
  const CHANNELS = [
    'extras:chatFile:info',
    'extras:chatFile:read',
    'extras:chatFile:viewNative',
    'extras:chatFile:open',
    'extras:chatFile:reveal'
  ] as const
  it('tienen esquema estricto', () => {
    const ok = join(root, 'nota.md')
    expect(() => IPC_SCHEMAS['extras:chatFile:info']({ paths: [ok] })).not.toThrow()
    expect(() => IPC_SCHEMAS['extras:chatFile:info']({ paths: [ok], extra: 1 } as never)).toThrow()
    expect(() => IPC_SCHEMAS['extras:chatFile:info']({ paths: Array.from({ length: 41 }, () => ok) })).toThrow()
    expect(() => IPC_SCHEMAS['extras:chatFile:info']({ paths: [''] })).toThrow()
    for (const c of ['extras:chatFile:read', 'extras:chatFile:open', 'extras:chatFile:reveal'] as const) {
      expect(() => IPC_SCHEMAS[c]({ path: ok }), c).not.toThrow()
      expect(() => IPC_SCHEMAS[c]({ path: 'relativa.txt' }), c).toThrow()
      expect(() => IPC_SCHEMAS[c]({ path: ok, otra: 1 } as never), c).toThrow()
      expect(() => IPC_SCHEMAS[c]({} as never), c).toThrow()
    }
    expect(() => IPC_SCHEMAS['extras:chatFile:viewNative']({ path: ok, lang: 'es', theme: 'dark' })).not.toThrow()
    expect(() => IPC_SCHEMAS['extras:chatFile:viewNative']({ path: ok, lang: 'fr', theme: 'dark' } as never)).toThrow()
  })
  it('el control remoto no puede usarlos (clase X)', () => {
    for (const c of CHANNELS) {
      expect(CELULAR_POLICY[c], c).toBe('X')
    }
  })
})
