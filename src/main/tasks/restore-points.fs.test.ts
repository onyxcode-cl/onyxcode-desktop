/**
 * Puntos de restauración contra sistemas de archivos reales (solo macOS): ExFAT, FAT32 y HFS+ con
 * mayúsculas. Monta imágenes con `hdiutil` (sin tocar discos reales). Opcional: `npm run test:fs`
 * (`ONYXCODE_FS_IT=1`); no entra en `npm run verify`.
 */
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  truncateSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RestorePoints } from './restore-points'

const RUN = process.platform === 'darwin' && process.env.ONYXCODE_FS_IT === '1'
const FORMATS = [
  { name: 'ExFAT', fs: 'ExFAT', caseSensitive: false },
  { name: 'FAT32', fs: 'MS-DOS FAT32', caseSensitive: false },
  { name: 'HFS+ con mayúsculas', fs: 'Case-sensitive HFS+', caseSensitive: true }
]

describe.skipIf(!RUN).each(FORMATS)('Puntos de restauración en $name', ({ fs, caseSensitive }) => {
  let tmp: string
  let mount: string
  let attached = false
  let work: string
  let store: string
  let trashDir: string
  let trashed: string[] = []

  beforeAll(() => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-fs-')))
    const img = join(tmp, 'vol.dmg')
    mount = join(tmp, 'mnt')
    mkdirSync(mount)
    execFileSync('hdiutil', ['create', '-size', '64m', '-fs', fs, '-volname', 'ONYXFS', '-type', 'SPARSE', '-ov', img], { stdio: 'pipe' })
    execFileSync('hdiutil', ['attach', '-nobrowse', '-mountpoint', mount, `${img}.sparseimage`], { stdio: 'pipe' })
    attached = true
    mount = realpathSync(mount)
    work = join(mount, 'work')
    mkdirSync(work)
    store = join(tmp, 'store')
    trashDir = join(mount, 'trash') // en el mismo volumen: renameSync no cruza dispositivos
    mkdirSync(trashDir)
  }, 120_000)

  afterAll(() => {
    if (attached) {
      try {
        execFileSync('hdiutil', ['detach', '-force', mount], { stdio: 'pipe' })
      } catch {
        // ya desmontado
      }
    }
    if (tmp) rmSync(tmp, { recursive: true, force: true })
  }, 60_000)

  const make = (): RestorePoints =>
    new RestorePoints({
      root: store,
      trash: async (p) => {
        trashed.push(p)
        renameSync(p, join(trashDir, `${trashed.length}-${basename(p)}`))
      }
    })
  const put = (rel: string, content: string): void => {
    mkdirSync(join(work, rel, '..'), { recursive: true })
    writeFileSync(join(work, rel), content)
  }
  const read = (rel: string): string => readFileSync(join(work, rel), 'utf8')

  it('crear, modificar/crear/borrar, ver cambios, deshacer y rehacer', async () => {
    trashed = []
    put('a.txt', 'uno\ndos\n')
    put('c.txt', 'cc')
    put('sub/d.txt', 'dd')
    const rp = make()
    const pt = await rp.create(work, 's1', 'prueba')
    expect(pt.status).toBe('ok')
    // Cambio inmediato (sin esperar): en FAT/exFAT la fecha tiene 2 s de precisión.
    put('a.txt', 'uno\nDOS\n')
    put('b.txt', 'nuevo')
    rmSync(join(work, 'c.txt'))
    const { changes } = await rp.changes(work, pt.id)
    expect(changes.map((c) => [c.path, c.status])).toEqual([
      ['a.txt', 'modified'],
      ['b.txt', 'added'],
      ['c.txt', 'deleted']
    ])
    const res = await rp.apply(work, pt.id)
    expect(res.failed).toEqual([])
    expect(read('a.txt')).toBe('uno\ndos\n')
    expect(read('c.txt')).toBe('cc')
    expect(existsSync(join(work, 'b.txt'))).toBe(false)
    expect(trashed.map((p) => basename(p))).toEqual(['b.txt'])
    const redo = await rp.apply(work, res.undoPointId)
    expect(redo.failed).toEqual([])
    expect(read('a.txt')).toBe('uno\nDOS\n')
    expect(read('b.txt')).toBe('nuevo')
    expect(existsSync(join(work, 'c.txt'))).toBe(false)
  }, 60_000)

  it('misma fecha y mismo tamaño con contenido distinto se detecta (granularidad de fecha)', async () => {
    put('f.txt', 'aaaa')
    const t = new Date(Math.floor(Date.now() / 2000) * 2000)
    utimesSync(join(work, 'f.txt'), t, t)
    const rp = make()
    const pt = await rp.create(work, 's2', 'x')
    writeFileSync(join(work, 'f.txt'), 'bbbb')
    utimesSync(join(work, 'f.txt'), t, t)
    const { changes } = await rp.changes(work, pt.id)
    expect(changes.find((c) => c.path === 'f.txt')?.status).toBe('modified')
  }, 60_000)

  it('un archivo disperso (imita iCloud) no se lee ni se manda a la Papelera', async () => {
    trashed = []
    const sparse = join(work, 'nube.bin')
    writeFileSync(sparse, '')
    truncateSync(sparse, 4 * 1024 * 1024)
    const rp = make()
    const pt = await rp.create(work, 's3', 'x')
    if (pt.notCopied) {
      expect(pt.notCopied).toBeGreaterThanOrEqual(1)
      put('otro.txt', 'x')
      await rp.apply(work, pt.id)
      expect(existsSync(sparse)).toBe(true)
      expect(trashed.map((p) => basename(p))).not.toContain('nube.bin')
    }
    expect(pt.status).toBe('ok')
  }, 60_000)

  it(
    caseSensitive ? 'A.txt y a.txt son archivos distintos' : 'A.txt y a.txt son el mismo sitio: la Papelera va antes de restaurar',
    async () => {
      trashed = []
      put('a-case.txt', 'original')
      const rp = make()
      const pt = await rp.create(work, 's4', 'x')
      rmSync(join(work, 'a-case.txt'))
      put('A-case.txt', 'del agente')
      const res = await rp.apply(work, pt.id)
      expect(res.failed).toEqual([])
      expect(read('a-case.txt')).toBe('original')
      if (caseSensitive)
        expect(trashed.map((p) => basename(p))).toEqual(['A-case.txt']) // son archivos distintos: el nuevo a la Papelera
      else expect(readdirSync(work).filter((n) => n.toLowerCase() === 'a-case.txt')).toHaveLength(1)
    },
    60_000
  )
})
