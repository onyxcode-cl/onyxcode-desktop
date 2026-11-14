import { linkSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { OutputPathError } from './output-path'
import { MAX_INPUT_BYTES, readTaskFile, relativeInputPath } from './input-path'

const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('contenido')])
const base = mkdtempSync(join(tmpdir(), 'input-path-'))
afterAll(() => rmSync(base, { recursive: true, force: true }))
let root: string
let outside: string
beforeEach(() => {
  root = mkdtempSync(join(base, 'tarea-'))
  outside = mkdtempSync(join(base, 'fuera-'))
  writeFileSync(join(outside, 'secreto.docx'), ZIP)
})

const fails = async (p: Promise<unknown>, re?: RegExp): Promise<void> => {
  const err = await p.then(
    () => null,
    (e: unknown) => e
  )
  expect(err).toBeInstanceOf(OutputPathError)
  if (re) expect((err as Error).message).toMatch(re)
}

describe('relativeInputPath', () => {
  it('acepta relativas y las absolutas que empiezan por la carpeta de la tarea tal como la ve el agente', () => {
    expect(relativeInputPath('informes/a.docx')).toEqual(['informes', 'a.docx'])
    expect(relativeInputPath('./a.docx')).toEqual(['a.docx'])
    expect(relativeInputPath('/win/c/x/sub/a.docx', ['C:\\x', '/win/c/x'])).toEqual(['sub', 'a.docx'])
  })
  it('rechaza «..», rutas absolutas ajenas, unidad, «~» y vacías', () => {
    for (const r of ['../a.docx', 'a/../../b.docx', '/etc/passwd', 'C:\\Windows\\a.docx', '~/a.docx', '', '///', 42]) {
      expect(() => relativeInputPath(r, ['/win/c/x'])).toThrow(OutputPathError)
    }
  })
})

describe('readTaskFile', () => {
  it('lee procedencia JSON con límite propio, sin enlaces y sin ampliar los archivos de oficina admitidos', async () => {
    writeFileSync(join(root, 'foto.json'), '{"status":"licencia-comprobada"}')
    expect((await readTaskFile(root, 'foto.json', [], {}, 'provenance')).bytes.toString()).toContain('licencia-comprobada')
    await fails(readTaskFile(root, 'foto.json'), /Solo se puede/)
    await fails(readTaskFile(root, 'foto.jpg', [], {}, 'provenance'), /archivo .json/)
    symlinkSync(join(root, 'foto.json'), join(root, 'enlace.json'))
    await fails(readTaskFile(root, 'enlace.json', [], {}, 'provenance'), /enlace/)
    writeFileSync(join(root, 'grande.json'), Buffer.alloc(128 * 1024 + 1))
    await fails(readTaskFile(root, 'grande.json', [], {}, 'provenance'), /demasiado grande/)
  })

  it('lee un archivo normal de la carpeta (relativo, en subcarpeta o con la ruta absoluta de la tarea)', async () => {
    mkdirSync(join(root, 'sub'))
    writeFileSync(join(root, 'sub', 'a.docx'), ZIP)
    writeFileSync(join(root, 'b.pdf'), '%PDF-1.7\nx')
    const a = await readTaskFile(root, 'sub/a.docx')
    expect(a.tipo).toBe('docx')
    expect(a.bytes.equals(ZIP)).toBe(true)
    expect(a.rel).toBe('sub/a.docx')
    expect((await readTaskFile(root, 'b.pdf')).tipo).toBe('pdf')
    expect((await readTaskFile(root, join(root, 'sub', 'a.docx'), [root])).rel).toBe('sub/a.docx')
  })
  it('un enlace simbólico hacia fuera (archivo o carpeta) no se sigue', async () => {
    symlinkSync(join(outside, 'secreto.docx'), join(root, 'enlace.docx'))
    symlinkSync(outside, join(root, 'carpeta'))
    await fails(readTaskFile(root, 'enlace.docx'), /enlace/)
    await fails(readTaskFile(root, 'carpeta/secreto.docx'), /enlace/)
  })
  it('«..», ruta absoluta ajena y archivo inexistente se rechazan', async () => {
    await fails(readTaskFile(root, '../' + outside.split('/').pop() + '/secreto.docx'), /subir/)
    await fails(readTaskFile(root, join(outside, 'secreto.docx'), [root]), /relativa/)
    await fails(readTaskFile(root, 'no-existe.docx'), /No se encuentra/)
  })
  it('extensión fuera de la lista, sin firma de zip o sin %PDF- se rechazan', async () => {
    writeFileSync(join(root, 'a.txt'), ZIP)
    writeFileSync(join(root, 'falso.docx'), 'no soy un zip')
    writeFileSync(join(root, 'falso.pdf'), 'MZ ejecutable')
    writeFileSync(join(root, 'sinext'), ZIP)
    await fails(readTaskFile(root, 'a.txt'), /Solo se puede/)
    await fails(readTaskFile(root, 'sinext'), /Solo se puede/)
    await fails(readTaskFile(root, 'falso.docx'), /no es un \.docx/)
    await fails(readTaskFile(root, 'falso.pdf'), /no es un \.pdf/)
  })
  it('un archivo de más de 25 MB se rechaza sin leerlo', async () => {
    writeFileSync(join(root, 'grande.pptx'), Buffer.concat([ZIP, Buffer.alloc(MAX_INPUT_BYTES)]))
    await fails(readTaskFile(root, 'grande.pptx'), /demasiado grande/)
  })
  it('una carpeta con nombre .docx no es un archivo', async () => {
    mkdirSync(join(root, 'carpeta.docx'))
    await fails(readTaskFile(root, 'carpeta.docx'), /archivo normal/)
  })
  it('un directorio intermedio cambiado por un enlace DESPUÉS de validar (la carrera real) no deja leer el archivo de fuera', async () => {
    mkdirSync(join(root, 'sub'))
    writeFileSync(join(root, 'sub', 'x.docx'), ZIP)
    mkdirSync(join(outside, 'sub'))
    writeFileSync(join(outside, 'sub', 'x.docx'), Buffer.concat([ZIP, Buffer.from('SECRETO')]))
    const err = await readTaskFile(root, 'sub/x.docx', [], {
      afterWalk: async () => {
        renameSync(join(root, 'sub'), join(root, 'sub-real'))
        symlinkSync(join(outside, 'sub'), join(root, 'sub'))
      }
    }).then(
      () => null,
      (e: unknown) => e
    )
    expect(err).toBeInstanceOf(OutputPathError)
  })
  it('un archivo con otro nombre duro se rechaza', async () => {
    writeFileSync(join(root, 'a.docx'), ZIP)
    linkSync(join(root, 'a.docx'), join(root, 'copia.docx'))
    await fails(readTaskFile(root, 'a.docx'), /varios nombres/)
  })
  it('si el archivo se reemplaza entre la apertura y la lectura (otro archivo o un enlace), se rechaza', async () => {
    // Propiedad de seguridad: NUNCA se devuelve el contenido del reemplazo. En macOS/Linux el reemplazo se hace y la lectura lo detecta
    // («cambió»). En Windows el sistema no deja renombrar sobre un archivo abierto (EBUSY/EPERM/EACCES), o borrarlo y crear un enlace
    // (EPERM sin privilegio / EEXIST porque el nombre sigue ocupado hasta cerrar): entonces el reemplazo no ocurre y se lee el original.
    const intenta = (op: () => void) => async (): Promise<void> => {
      try {
        op()
      } catch (e) {
        expect(['EBUSY', 'EPERM', 'EACCES', 'EEXIST']).toContain((e as NodeJS.ErrnoException).code)
        if (process.platform !== 'win32') throw e // fuera de Windows el reemplazo SÍ tiene que poder hacerse
      }
    }
    const lee = (name: string, op: () => void) =>
      readTaskFile(root, name, [], { afterOpen: intenta(op) }).then(
        (r) => ({ r, err: null as unknown }),
        (err: unknown) => ({ r: null, err })
      )
    writeFileSync(join(root, 'a.docx'), ZIP)
    writeFileSync(join(root, 'otro.docx'), Buffer.concat([ZIP, Buffer.from('distinto')]))
    const r1 = await lee('a.docx', () => renameSync(join(root, 'otro.docx'), join(root, 'a.docx')))
    if (r1.err) {
      expect(r1.err).toBeInstanceOf(OutputPathError)
      expect((r1.err as Error).message).toMatch(/cambió/)
    } else {
      expect(process.platform).toBe('win32') // el reemplazo no ocurrió: solo es posible en Windows
      expect(r1.r!.bytes.equals(ZIP)).toBe(true)
    }
    writeFileSync(join(root, 'b.docx'), ZIP)
    const r2 = await lee('b.docx', () => {
      rmSync(join(root, 'b.docx'))
      symlinkSync(join(outside, 'secreto.docx'), join(root, 'b.docx'))
    })
    if (r2.err) {
      expect(r2.err).toBeInstanceOf(OutputPathError)
      expect((r2.err as Error).message).toMatch(/cambió/)
    } else {
      expect(process.platform).toBe('win32')
      expect(r2.r!.bytes.includes('SECRETO')).toBe(false)
      expect(r2.r!.bytes.equals(ZIP)).toBe(true)
    }
  })
})
