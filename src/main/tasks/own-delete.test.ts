import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteOwnPaths, parseOwnDelete, type DeleteBaseline } from './own-delete'
import { RestorePoints } from './restore-points'

let root: string
let folder: string
let restore: RestorePoints
let created: number
const session = 'ses_abcdefgh'
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-own-delete-')))
  folder = join(root, 'task')
  mkdirSync(folder)
  restore = new RestorePoints({ root: join(root, 'points'), trash: async () => {}, freeBytes: () => 1e12 })
  created = Date.now() + 1
})
afterEach(() => rmSync(root, { recursive: true, force: true }))
const file = (name: string, text = 'x'): string => {
  const p = join(folder, name)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, text)
  return p
}
const snapshot = () => restore.create(folder, session, 'inicio', async () => true)
const baseline = (): DeleteBaseline => restore.deleteBaseline(folder, session, created)!
const clean = (cmd: string, b = baseline(), extras: string[] = []) => deleteOwnPaths(folder, parseOwnDelete(cmd)!, b, extras)

describe('borrado propio sobre archivos reales', () => {
  it('elimina archivo nuevo, carpeta vacía y árbol completamente nuevo', async () => {
    await snapshot()
    file('v3.pptx')
    mkdirSync(join(folder, 'vacio'))
    file('temporal/a/b.txt')
    expect(clean('rm v3.pptx')).toBe(true)
    expect(clean('rmdir vacio')).toBe(true)
    expect(clean('rm -rf temporal')).toBe(true)
    expect(existsSync(join(folder, 'v3.pptx'))).toBe(false)
    expect(existsSync(join(folder, 'vacio'))).toBe(false)
    expect(existsSync(join(folder, 'temporal'))).toBe(false)
  })
  it('previo y mezcla conservan TODOS los destinos para el flujo con tarjeta', async () => {
    const old = file('previo.txt')
    await snapshot()
    const fresh = file('nuevo.txt')
    expect(clean('rm previo.txt')).toBe(false)
    expect(clean('rm nuevo.txt previo.txt')).toBe(false)
    expect(readFileSync(old, 'utf8')).toBe('x')
    expect(existsSync(fresh)).toBe(true)
  })
  it('carpeta previa con un archivo previo y otro nuevo no se borra', async () => {
    file('datos/previo.txt')
    await snapshot()
    file('datos/nuevo.txt')
    expect(clean('rm -rf datos')).toBe(false)
    expect(existsSync(join(folder, 'datos/nuevo.txt'))).toBe(true)
  })
  it('rechaza enlace final e intermedio hacia afuera sin tocar el destino', async () => {
    await snapshot()
    const outside = join(root, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'dato'), 'real')
    symlinkSync(outside, join(folder, 'enlace'), 'junction')
    expect(clean('rm -rf enlace')).toBe(false)
    expect(clean('rm enlace/dato')).toBe(false)
    expect(readFileSync(join(outside, 'dato'), 'utf8')).toBe('real')
  })
  it('nunca borra fuera de la tarea, metadatos ni carpetas adicionales', async () => {
    await snapshot()
    file('nuevo.txt')
    file('.git/objeto')
    file('node_modules/nuevo')
    file('.lazunox/memoria.md')
    for (const cmd of ['rm ../fuera', 'rm -rf .git', 'rm -rf node_modules', 'rm .lazunox/memoria.md', 'rm -rf .'])
      expect(clean(cmd), cmd).toBe(false)
    expect(clean('rm nuevo.txt', baseline(), [join(folder, 'nuevo.txt')])).toBe(false)
  })
  it('rechaza enlaces duros, rmdir no vacío y rm sin recursión sobre directorio', async () => {
    await snapshot()
    const a = file('a')
    linkSync(a, join(folder, 'b'))
    file('dir/nuevo')
    expect(clean('rm a')).toBe(false)
    expect(clean('rmdir dir')).toBe(false)
    expect(clean('rm dir')).toBe(false)
  })
  it('APFS: mayúsculas y NFC/NFD no convierten un archivo previo en propio', async () => {
    const previous = file('prevío.txt')
    await snapshot()
    expect(clean('rm PREVÍO.TXT')).toBe(false)
    expect(clean(`rm ${'PREVÍO.TXT'.normalize('NFD')}`)).toBe(false)
    expect(existsSync(previous)).toBe(true)
    file('.lazunox/memoria.md')
    expect(clean('rm .LAZUNOX/memoria.md')).toBe(false)
    const finder = file('.DS_Store')
    const cloud = file('.Documento.icloud')
    expect(clean('rm .ds_store')).toBe(false)
    expect(clean('rm .DOCUMENTO.ICLOUD')).toBe(false)
    expect(existsSync(finder)).toBe(true)
    expect(existsSync(cloud)).toBe(true)
  })
  it('scratch: solo destinos pedidos, aunque existieran antes; restaura el resto y no deja staging', async () => {
    file('.lazunox/trabajo/grupo/previo')
    file('.lazunox/trabajo/grupo/ops.json')
    await snapshot()
    expect(clean('rm .lazunox/trabajo/grupo/ops.json')).toBe(true)
    expect(existsSync(join(folder, '.lazunox/trabajo/grupo/previo'))).toBe(true)
    expect(existsSync(join(folder, '.lazunox/trabajo/grupo/ops.json'))).toBe(false)
    expect(clean('rm -rf .lazunox/trabajo/grupo')).toBe(true)
    expect(clean('rmdir .lazunox/trabajo')).toBe(false)
  })
  it('scratch con enlace externo o mezcla con previo: no elimina ningún archivo', async () => {
    file('previo')
    await snapshot()
    const path = file('.lazunox/trabajo/nuevo')
    symlinkSync(root, join(folder, '.lazunox/trabajo/enlace'), 'junction')
    expect(clean('rm .lazunox/trabajo/nuevo previo')).toBe(false)
    expect(existsSync(path)).toBe(true)
    expect(clean('rm -rf .lazunox/trabajo/enlace')).toBe(false)
    expect(existsSync(root)).toBe(true)
  })
})

describe('registro inicial fiable', () => {
  it('sin registro, registro omitido y sesión anterior a la instancia no habilitan borrado', async () => {
    expect(restore.deleteBaseline(folder, session, created)).toBeNull()
    await snapshot()
    expect(restore.deleteBaseline(folder, session, 0)).toBeNull()
    const limited = new RestorePoints({ root: join(root, 'limited'), trash: async () => {}, limits: { maxFiles: 0 } })
    file('existente')
    expect((await limited.create(folder, session, 'inicio', async () => true)).status).toBe('skipped')
    rmSync(join(folder, 'existente'))
    await limited.create(folder, session, 'segundo')
    expect(limited.deleteBaseline(folder, session, Date.now() + 100)).toBeNull()
  })
  it('persiste el inicio tras más puntos, retención y reinicio; olvidar lo inhabilita', async () => {
    const limited = new RestorePoints({
      root: join(root, 'limited'),
      trash: async () => {},
      freeBytes: () => 1e12,
      limits: { maxPointsPerSession: 1 }
    })
    await limited.create(folder, session, 'inicio', async () => true)
    file('nuevo')
    await limited.create(folder, session, 'siguiente')
    const reopened = new RestorePoints({ root: join(root, 'limited'), trash: async () => {} })
    const b = reopened.deleteBaseline(folder, session, Date.now() + 100)!
    expect(b.paths).not.toContain('nuevo')
    expect(clean('rm nuevo', b)).toBe(true)
    await reopened.forget(session)
    await reopened.create(folder, session, 'después de olvidar')
    expect(reopened.deleteBaseline(folder, session, Date.now() + 100)).toBeNull()
  })
  it('un punto de la versión anterior no se trata como un registro del inicio', async () => {
    await restore.create(folder, session, 'sin verificación inicial')
    await snapshot()
    expect(baseline()).toBeNull()
    expect(restore.deleteBaseline(folder, 'ses_desconocida', created)).toBeNull()
  })
  it('inventario tardío o ejecución empezada durante la copia no se habilitan después', async () => {
    let checks = 0
    await restore.create(folder, session, 'inicio', async () => ++checks === 1)
    expect(checks).toBe(2)
    expect(baseline()).toBeNull()
    await snapshot()
    expect(baseline()).toBeNull()
  })
  it('archivos sin copia y áreas desconocidas jamás se tratan como nuevos', async () => {
    const limited = new RestorePoints({
      root: join(root, 'limited'),
      trash: async () => {},
      freeBytes: () => 1e12,
      limits: { maxFileBytes: 0 }
    })
    file('grande')
    await limited.create(folder, session, 'inicio', async () => true)
    const b = limited.deleteBaseline(folder, session, Date.now() + 100)!
    expect(clean('rm grande', b)).toBe(false)
    file('ilegible/nuevo')
    expect(clean('rm ilegible/nuevo', { ...b, unknown: ['ilegible'] })).toBe(false)
  })
})

describe('parser cerrado', () => {
  it.each(['rm a', "rm -rf -- 'con espacios'", '/bin/rmdir vacio', 'unlink ./a'])('acepta %s', (c) =>
    expect(parseOwnDelete(c)).not.toBeNull()
  )
  it.each([
    'mv a b',
    'rm a && rm b',
    'rm a; echo ok',
    'rm *.pptx',
    'rm "$HOME/a"',
    'rm a\nrm b',
    'python3 limpiar.py',
    'rm -i a',
    'rm --preserve-root a',
    'rm "a"b',
    'rm "sin cerrar',
    'rm',
    'rm nuevo.txt/',
    'rm enlace/../otro'
  ])('no interpreta %s', (c) => expect(parseOwnDelete(c)).toBeNull())
})
