import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RestorePoints, type RestoreDeps, type RestoreLimits } from './restore-points'
import { macOnly } from '../../test/platform'

let base: string
let folder: string
let store: string
let trashDir: string
let trashed: string[]
let clock: number

function make(limits?: Partial<RestoreLimits>, extra: Partial<RestoreDeps> = {}): RestorePoints {
  return new RestorePoints({
    root: store,
    now: () => clock,
    limits,
    ...extra,
    trash: async (p) => {
      trashed.push(p)
      renameSync(p, join(trashDir, `${trashed.length}-${basename(p)}`))
    }
  })
}
const put = (rel: string, content: string, bump = 0): void => {
  const abs = join(folder, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content)
  // Fechas distintas y deterministas: la comparación rápida usa tamaño + mtime.
  const t = new Date(Date.now() + 5000 + bump)
  utimesSync(abs, t, t)
}
const read = (rel: string): string => readFileSync(join(folder, rel), 'utf8')

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'restore-points-')))
  folder = join(base, 'work')
  store = join(base, 'store')
  trashDir = join(base, 'trash')
  mkdirSync(folder)
  mkdirSync(trashDir)
  trashed = []
  clock = 1_700_000_000_000
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

// Puntos de restauración del modo Tareas: fuera de la v1 de Windows (fixtures POSIX: modos, symlinks, rutas).
describe.skipIf(!macOnly)('RestorePoints', () => {
  it('ida y vuelta: modificar, borrar y crear', async () => {
    put('a.txt', 'uno\ndos\n')
    put('c.txt', 'cc')
    put('sub/d.txt', 'dd')
    const rp = make()
    const pt = await rp.create(folder, 's1', 'prueba')
    expect(pt.status).toBe('ok')
    expect(pt.files).toBe(3)

    put('a.txt', 'uno\nDOS\ntres\n', 1000)
    put('b.txt', 'nuevo')
    rmSync(join(folder, 'c.txt'))
    mkdirSync(join(folder, 'nueva'))
    put('nueva/x.txt', 'x')

    const { changes, truncated } = await rp.changes(folder, pt.id)
    expect(truncated).toBe(false)
    expect(changes.map((c) => [c.path, c.status])).toEqual([
      ['a.txt', 'modified'],
      ['b.txt', 'added'],
      ['c.txt', 'deleted'],
      ['nueva/x.txt', 'added']
    ])
    const a = changes[0]
    expect(a.additions).toBe(2)
    expect(a.deletions).toBe(1)
    expect(a.binary).toBe(false)
    expect(a.patch).toContain('@@')

    const res = await rp.apply(folder, pt.id)
    expect(res.failed).toEqual([])
    expect(res.restored).toBe(2)
    expect(res.trashed).toBe(3) // b.txt, nueva/x.txt y la carpeta nueva vacía
    expect(read('a.txt')).toBe('uno\ndos\n')
    expect(read('c.txt')).toBe('cc')
    expect(existsSync(join(folder, 'b.txt'))).toBe(false)
    expect(existsSync(join(folder, 'nueva'))).toBe(false)
    expect(readdirSync(trashDir).length).toBe(3)
    expect((await rp.changes(folder, pt.id)).changes).toEqual([])

    // Rehacer: aplica el punto «Antes de deshacer».
    const redo = await rp.apply(folder, res.undoPointId)
    expect(redo.failed).toEqual([])
    expect(read('a.txt')).toBe('uno\nDOS\ntres\n')
    expect(existsSync(join(folder, 'c.txt'))).toBe(false)
  })

  it('crea el punto «Antes de deshacer» antes de tocar nada', async () => {
    put('a.txt', 'v1')
    const rp = make()
    const pt = await rp.create(folder, 's1', 'x')
    put('a.txt', 'v2-modificado', 1000)
    const res = await rp.apply(folder, pt.id)
    const undo = rp.list(folder, 's1').find((p) => p.id === res.undoPointId)
    expect(undo?.label).toBe('Antes de deshacer')
    expect(undo?.files).toBe(1)
    const back = await rp.apply(folder, res.undoPointId)
    expect(back.restored).toBe(1)
    expect(read('a.txt')).toBe('v2-modificado')
  })

  it('conserva el modo (permisos) del archivo', async () => {
    put('run.sh', '#!/bin/sh\n')
    chmodSync(join(folder, 'run.sh'), 0o755)
    const rp = make()
    const pt = await rp.create(folder, 's1', 'x')
    rmSync(join(folder, 'run.sh'))
    await rp.apply(folder, pt.id)
    expect(statSync(join(folder, 'run.sh')).mode & 0o777).toBe(0o755)
  })

  it('no sigue symlinks: se registran y no se restauran ni se tocan', async () => {
    const outside = join(base, 'fuera')
    mkdirSync(outside)
    writeFileSync(join(outside, 'secreto.txt'), 'S')
    put('a.txt', 'a')
    symlinkSync(outside, join(folder, 'enlace'))
    const rp = make()
    const pt = await rp.create(folder, 's1', 'x')
    expect(pt.files).toBe(1)
    // El agente cambia el contenido de fuera y crea un symlink nuevo.
    writeFileSync(join(outside, 'secreto.txt'), 'CAMBIADO')
    symlinkSync(outside, join(folder, 'otro'))
    const { changes } = await rp.changes(folder, pt.id)
    expect(changes).toEqual([])
    const res = await rp.apply(folder, pt.id)
    expect(res.restored + res.trashed).toBe(0)
    expect(readFileSync(join(outside, 'secreto.txt'), 'utf8')).toBe('CAMBIADO')
    expect(lstatSync(join(folder, 'otro')).isSymbolicLink()).toBe(true)
  })

  it('rechaza restaurar a través de un directorio intermedio que ahora es symlink', async () => {
    put('sub/f.txt', 'original')
    const rp = make()
    const pt = await rp.create(folder, 's1', 'x')
    const outside = join(base, 'fuera')
    mkdirSync(outside)
    rmSync(join(folder, 'sub'), { recursive: true })
    symlinkSync(outside, join(folder, 'sub'))
    const res = await rp.apply(folder, pt.id)
    expect(res.restored).toBe(0)
    expect(res.failed).toEqual([{ path: 'sub/f.txt', reason: expect.stringContaining('enlace simbólico') }])
    expect(existsSync(join(outside, 'f.txt'))).toBe(false)
  })

  it('rechaza rutas con .. o absolutas en paths', async () => {
    put('a.txt', 'a')
    const rp = make()
    const pt = await rp.create(folder, 's1', 'x')
    const res = await rp.apply(folder, pt.id, ['../fuera.txt', '/etc/passwd'])
    expect(res.restored + res.trashed).toBe(0)
    expect(res.failed.map((f) => f.path)).toEqual(['../fuera.txt', '/etc/passwd'])
  })

  it('apply con paths restaura solo esos archivos', async () => {
    put('a.txt', 'a')
    put('b.txt', 'b')
    const rp = make()
    const pt = await rp.create(folder, 's1', 'x')
    put('a.txt', 'A!', 1000)
    put('b.txt', 'B!', 1000)
    const res = await rp.apply(folder, pt.id, ['a.txt'])
    expect(res.restored).toBe(1)
    expect(read('a.txt')).toBe('a')
    expect(read('b.txt')).toBe('B!')
  })

  it('excluye .git, node_modules y .onyxcode', async () => {
    put('a.txt', 'a')
    put('.git/HEAD', 'ref')
    put('node_modules/x/i.js', 'js')
    put('.onyxcode/memory.md', 'm')
    const rp = make()
    const pt = await rp.create(folder, 's1', 'x')
    expect(pt.files).toBe(1)
    put('node_modules/x/i.js', 'cambiado', 1000)
    rmSync(join(folder, '.git'), { recursive: true })
    expect((await rp.changes(folder, pt.id)).changes).toEqual([])
  })

  it('límites: demasiados archivos y total excedido dejan el punto en skipped', async () => {
    put('a', '1')
    put('b', '2')
    put('c', '3')
    const few = await make({ maxFiles: 2 }).create(folder, 's1', 'x')
    expect(few.status).toBe('skipped')
    expect(few.reason).toMatch(/archivos/)
    const big = await make({ maxTotalBytes: 2 }).create(folder, 's1', 'x')
    expect(big.status).toBe('skipped')
    expect(big.reason).toMatch(/2 GB/)
  })

  it('archivo mayor que el límite: se lista pero no es restaurable', async () => {
    put('grande.bin', 'x'.repeat(100))
    put('a.txt', 'a')
    const rp = make({ maxFileBytes: 50 })
    const pt = await rp.create(folder, 's1', 'x')
    expect(pt.status).toBe('ok')
    put('grande.bin', 'y'.repeat(100), 1000)
    const { changes } = await rp.changes(folder, pt.id)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ path: 'grande.bin', status: 'modified', restorable: false, binary: true })
    const res = await rp.apply(folder, pt.id)
    expect(res.failed.map((f) => f.path)).toEqual(['grande.bin'])
    expect(read('grande.bin')).toBe('y'.repeat(100))
  })

  it('binarios: sin parche', async () => {
    writeFileSync(join(folder, 'img.png'), Buffer.from([1, 0, 2, 0, 3]))
    const rp = make()
    const pt = await rp.create(folder, 's1', 'x')
    writeFileSync(join(folder, 'img.png'), Buffer.from([9, 0, 9, 0, 9, 0]))
    const { changes } = await rp.changes(folder, pt.id)
    expect(changes[0]).toMatchObject({ binary: true, restorable: true })
    expect(changes[0].patch).toBeUndefined()
  })

  it('tope de parches: truncated y sin patch al pasarse', async () => {
    put('a.txt', 'a\n'.repeat(10))
    put('b.txt', 'b\n'.repeat(10))
    const rp = make({ maxPatchBytes: 50 })
    const pt = await rp.create(folder, 's1', 'x')
    put('a.txt', 'z\n'.repeat(10), 1000)
    put('b.txt', 'y\n'.repeat(10), 1000)
    const r = await rp.changes(folder, pt.id)
    expect(r.truncated).toBe(true)
    expect(r.changes.some((c) => c.patch === undefined)).toBe(true)
  })

  it('reutiliza hashes del punto anterior si tamaño y fecha coinciden (incremental)', async () => {
    put('a.txt', 'aaaa')
    put('b.txt', 'bbbb')
    const rp = make()
    await rp.create(folder, 's1', 'uno')
    const dir = join(store, readdirSync(store)[0])
    const objs = () => readdirSync(join(dir, 'objects')).sort()
    const before = objs()
    expect(before).toHaveLength(2)
    // Corrompe el contenido del objeto de a.txt: si se reutilizara sin releer, el hash nuevo sería el mismo.
    put('b.txt', 'BBBB', 1000)
    const p2 = await rp.create(folder, 's1', 'dos')
    expect(p2.files).toBe(2)
    const after = objs()
    expect(after).toHaveLength(3) // solo se añadió el objeto de b.txt
    expect(after.filter((o) => before.includes(o))).toHaveLength(2)
    // mismo contenido en dos archivos: un único objeto
    put('c.txt', 'aaaa')
    await rp.create(folder, 's1', 'tres')
    expect(objs()).toHaveLength(3)
  })

  it('retención: 20 por tarea y 30 días; recolecta objetos huérfanos', async () => {
    put('a.txt', 'v0')
    const rp = make({ maxPointsPerSession: 3 })
    const ids: string[] = []
    for (let i = 1; i <= 5; i++) {
      put('a.txt', `version-${i}`, i * 1000)
      clock += 1000
      ids.push((await rp.create(folder, 's1', `p${i}`)).id)
    }
    const kept = rp.list(folder, 's1').map((p) => p.id)
    expect(kept).toEqual(ids.slice(2))
    const dir = join(store, readdirSync(store)[0])
    expect(readdirSync(join(dir, 'objects'))).toHaveLength(3) // solo los objetos de los 3 puntos vivos
    // Otra tarea no se ve afectada
    put('a.txt', 'otra', 9000)
    await rp.create(folder, 's2', 'otra')
    expect(rp.list(folder, 's1')).toHaveLength(3)
    // 30 días después, el siguiente punto retira los antiguos
    clock += 31 * 24 * 3600 * 1000
    put('a.txt', 'nuevo', 9500)
    await rp.create(folder, 's1', 'fresco')
    expect(rp.list(folder, 's1').map((p) => p.label)).toEqual(['fresco'])
    expect(rp.list(folder, 's2')).toHaveLength(0)
    expect(readdirSync(join(dir, 'objects'))).toHaveLength(1)
  })

  it('gc elimina objetos sin manifiesto y temporales', async () => {
    put('a.txt', 'a')
    const rp = make()
    await rp.create(folder, 's1', 'x')
    const dir = join(store, readdirSync(store)[0])
    writeFileSync(join(dir, 'objects', 'f'.repeat(64)), 'huerfano')
    writeFileSync(join(dir, 'objects', '.tmp-abc'), 'tmp')
    expect(rp.gc()).toBe(2)
    expect(readdirSync(join(dir, 'objects'))).toHaveLength(1)
  })

  it('forget borra los puntos de una tarea y sus objetos', async () => {
    put('a.txt', 'a')
    const rp = make()
    await rp.create(folder, 's1', 'x')
    await rp.forget('s1')
    expect(rp.list(folder, 's1')).toEqual([])
    const dir = join(store, readdirSync(store)[0])
    expect(readdirSync(join(dir, 'objects'))).toEqual([])
  })

  it('almacén con permisos 0700 y nada dentro de la carpeta del usuario', async () => {
    put('a.txt', 'a')
    const before = readdirSync(folder)
    await make().create(folder, 's1', 'x')
    expect(readdirSync(folder)).toEqual(before)
    expect(statSync(store).mode & 0o777).toBe(0o700)
  })

  it('un archivo llamado «constructor» o «__proto__» no confunde al manifiesto', async () => {
    put('a.txt', 'a')
    const rp = make()
    const pt = await rp.create(folder, 's1', 'x')
    put('constructor', 'x')
    put('__proto__', 'y')
    const { changes } = await rp.changes(folder, pt.id)
    expect(changes.map((c) => c.path).sort()).toEqual(['__proto__', 'constructor'])
    expect(changes.every((c) => c.status === 'added')).toBe(true)
  })
})

// ───────────────────────── Robustez (F8-B21) ─────────────────────────

const caseInsensitive = (): boolean => {
  writeFileSync(join(base, 'Zz'), 'x')
  return existsSync(join(base, 'zZ'))
}
const manifestOf = (id: string): any => {
  const dir = join(store, readdirSync(store)[0])
  return JSON.parse(readFileSync(join(dir, 'points', `${id}.json`), 'utf8'))
}

// Puntos de restauración del modo Tareas: fuera de la v1 de Windows (fixtures POSIX: modos, symlinks, rutas).
describe.skipIf(!macOnly)('RestorePoints: robustez', () => {
  it('H1: un archivo que no se puede copiar se registra y nunca va a la Papelera al deshacer', async () => {
    put('ok.txt', 'ok')
    put('secreto.txt', 'datos del usuario')
    const secret = join(folder, 'secreto.txt')
    chmodSync(secret, 0o000)
    try {
      const rp = make()
      const pt = await rp.create(folder, 's1', 'x')
      expect(pt.status).toBe('ok')
      expect(pt.notCopied).toBe(1)
      const e = manifestOf(pt.id).entries['secreto.txt']
      expect(e).toMatchObject({ hash: null, skip: 'unreadable' })
      put('ok.txt', 'cambiado', 1000)
      put('nuevo.txt', 'n')
      const { changes } = await rp.changes(folder, pt.id)
      expect(changes.map((c) => c.path)).toEqual(['nuevo.txt', 'ok.txt'])
      const res = await rp.apply(folder, pt.id)
      expect(res.failed).toEqual([])
      expect(trashed.map((p) => basename(p))).toEqual(['nuevo.txt'])
      expect(existsSync(secret)).toBe(true)
      expect(read('ok.txt')).toBe('ok')
    } finally {
      chmodSync(secret, 0o644)
    }
  })

  it('H1: si el archivo ilegible se borra, aparece como eliminado y no restaurable (con motivo)', async () => {
    put('secreto.txt', 'datos')
    const secret = join(folder, 'secreto.txt')
    chmodSync(secret, 0o000)
    const rp = make()
    const pt = await rp.create(folder, 's1', 'x')
    rmSync(secret)
    const { changes } = await rp.changes(folder, pt.id)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ status: 'deleted', restorable: false, reason: 'unreadable' })
    const res = await rp.apply(folder, pt.id)
    expect(res.failed.map((f) => f.path)).toEqual(['secreto.txt'])
  })

  it('H2: un subdirectorio ilegible no hace que lo de debajo pase por «nuevo»', async () => {
    put('a.txt', 'a')
    put('privado/doc.txt', 'documento')
    chmodSync(join(folder, 'privado'), 0o000)
    let rp: RestorePoints
    let pt
    try {
      rp = make()
      pt = await rp.create(folder, 's1', 'x')
      expect(pt.status).toBe('ok')
      expect(manifestOf(pt.id).unreadableDirs).toEqual(['privado'])
    } finally {
      chmodSync(join(folder, 'privado'), 0o755)
    }
    put('privado/otro.txt', 'creado después')
    const { changes } = await rp.changes(folder, pt.id)
    expect(changes).toEqual([])
    const res = await rp.apply(folder, pt.id)
    expect(res).toMatchObject({ trashed: 0, restored: 0, failed: [] })
    expect(read('privado/doc.txt')).toBe('documento')
    expect(read('privado/otro.txt')).toBe('creado después')
  })

  it('H4: fecha dentro del margen del punto (FAT/exFAT/HFS+): se compara por contenido', async () => {
    const rp = make()
    const abs = join(folder, 'a.txt')
    writeFileSync(abs, 'aaaa')
    const t = new Date(clock - 500)
    utimesSync(abs, t, t)
    const p1 = await rp.create(folder, 's1', 'uno')
    // Mismo tamaño y misma fecha (granularidad gruesa), contenido distinto.
    writeFileSync(abs, 'bbbb')
    utimesSync(abs, t, t)
    const { changes } = await rp.changes(folder, p1.id)
    expect(changes.map((c) => [c.path, c.status])).toEqual([['a.txt', 'modified']])
    // Y el punto siguiente no reutiliza el hash viejo.
    clock += 1000
    const p2 = await rp.create(folder, 's1', 'dos')
    expect(manifestOf(p2.id).entries['a.txt'].hash).not.toBe(manifestOf(p1.id).entries['a.txt'].hash)
    expect(manifestOf(p1.id).createdAt).toBe(1_700_000_000_000)
  })

  it('H5: pasado el presupuesto el punto queda omitido, sin temporales', async () => {
    put('a.txt', 'a')
    put('b.txt', 'b')
    const rp = make({ maxCreateMs: 30_000 }, { freeBytes: () => ((clock += 31_000), Number.MAX_SAFE_INTEGER) })
    const pt = await rp.create(folder, 's1', 'x')
    expect(pt.status).toBe('skipped')
    expect(pt.reason).toBe('tardaba demasiado')
    const dir = join(store, readdirSync(store)[0])
    expect(readdirSync(join(dir, 'objects'))).toEqual([])
    // Con apply no se toca nada si el punto previo no se pudo guardar.
    clock = 1_700_000_000_000
    const rp2 = make()
    const ok = await rp2.create(folder, 's1', 'ok')
    const slow = make({ maxCreateMs: 30_000 }, { freeBytes: () => ((clock += 31_000), Number.MAX_SAFE_INTEGER) })
    put('n.txt', 'nuevo')
    await expect(slow.apply(folder, ok.id)).rejects.toThrow(/no se deshizo nada/)
    expect(existsSync(join(folder, 'n.txt'))).toBe(true)
    expect(trashed).toEqual([])
  })

  it('H6: sin espacio libre (bytes + 512 MB) el punto queda omitido', async () => {
    put('a.txt', 'a'.repeat(1000))
    const pt = await make(undefined, { freeBytes: () => 512 * 1024 * 1024 + 999 }).create(folder, 's1', 'x')
    expect(pt).toMatchObject({ status: 'skipped', reason: 'no queda espacio en el disco' })
    const ok = await make(undefined, { freeBytes: () => 512 * 1024 * 1024 + 1000 }).create(folder, 's1', 'x')
    expect(ok.status).toBe('ok')
  })

  it('H7: «solo en la nube» no se lee, se cuenta y nunca se manda a la Papelera', async () => {
    put('nube.bin', '12345')
    put('normal.txt', 'normal')
    put('.doc.icloud', 'stub')
    const cloud = (st: { size: number }): boolean => st.size === 5
    const rp = make(undefined, { isCloudPlaceholder: cloud as never })
    const pt = await rp.create(folder, 's1', 'x')
    expect(pt.notCopied).toBe(1)
    expect(pt.files).toBe(2)
    const man = manifestOf(pt.id)
    expect(man.entries['nube.bin']).toMatchObject({ hash: null, skip: 'cloud' })
    expect(man.cloudStubs).toEqual(['doc'])
    // El stub se materializa (aparece «doc»): no es un archivo nuevo del agente.
    rmSync(join(folder, '.doc.icloud'))
    put('doc', 'descargado')
    put('real-nuevo.txt', 'n')
    const { changes } = await rp.changes(folder, pt.id)
    expect(changes.map((c) => c.path)).toEqual(['real-nuevo.txt'])
    // Si el agente borra el de la nube: eliminado, no restaurable, con motivo.
    rmSync(join(folder, 'nube.bin'))
    const again = (await rp.changes(folder, pt.id)).changes.find((c) => c.path === 'nube.bin')
    expect(again).toMatchObject({ status: 'deleted', restorable: false, reason: 'cloud' })
    await rp.apply(folder, pt.id)
    expect(trashed.map((p) => basename(p))).toEqual(['real-nuevo.txt'])
    expect(existsSync(join(folder, 'doc'))).toBe(true)
  })

  it('H7: archivo que pasa a ser stub no cuenta como eliminado', async () => {
    put('doc.txt', 'contenido')
    const rp = make()
    const pt = await rp.create(folder, 's1', 'x')
    rmSync(join(folder, 'doc.txt'))
    put('.doc.txt.icloud', 'stub')
    expect((await rp.changes(folder, pt.id)).changes).toEqual([])
  })

  it('H7: un archivo pequeño normal tiene bloques (no se confunde con la nube); uno disperso sí', async () => {
    put('chico.txt', 'x')
    expect(statSync(join(folder, 'chico.txt')).blocks).toBeGreaterThan(0)
    const rp = make()
    expect((await rp.create(folder, 's1', 'x')).notCopied).toBeUndefined()
    const sparse = join(folder, 'disperso.bin')
    writeFileSync(sparse, '')
    truncateSync(sparse, 2 * 1024 * 1024)
    if (statSync(sparse).blocks !== 0) return // el sistema de archivos del tmp no admite dispersos
    const pt = await rp.create(folder, 's1', 'y')
    expect(pt.notCopied).toBe(1)
    expect(manifestOf(pt.id).entries['disperso.bin']).toMatchObject({ hash: null, skip: 'cloud' })
  })

  it('H8: .DS_Store y ._* se ignoran en el punto y en el diff', async () => {
    put('a.txt', 'a')
    put('.DS_Store', 'x')
    put('._a.txt', 'x')
    const rp = make()
    const pt = await rp.create(folder, 's1', 'x')
    expect(pt.files).toBe(1)
    put('sub/.DS_Store', 'y')
    put('._otro', 'y')
    expect((await rp.changes(folder, pt.id)).changes).toEqual([])
    const res = await rp.apply(folder, pt.id)
    // Solo la carpeta nueva (que únicamente contenía .DS_Store) va a la Papelera; los archivos de sistema no cuentan.
    expect(res).toMatchObject({ trashed: 1, restored: 0 })
    expect(trashed.map((p) => basename(p))).toEqual(['sub'])
    expect(existsSync(join(folder, '._otro'))).toBe(true)
  })

  it('H9: la Papelera va antes de restaurar (volúmenes sin distinción de mayúsculas)', async () => {
    if (!caseInsensitive()) return
    put('a.txt', 'original')
    const rp = make()
    const pt = await rp.create(folder, 's1', 'x')
    rmSync(join(folder, 'a.txt'))
    put('A.txt', 'del agente')
    const res = await rp.apply(folder, pt.id)
    expect(res.failed).toEqual([])
    expect(read('a.txt')).toBe('original')
    expect(trashed.map((p) => basename(p))).toEqual(['A.txt'])
    expect(readFileSync(join(trashDir, readdirSync(trashDir)[0]), 'utf8')).toBe('del agente')
  })

  it('H11: forget y clearAll esperan a las operaciones en curso', async () => {
    put('a.txt', 'a')
    const rp = make()
    const creating = rp.create(folder, 's1', 'x')
    await rp.forget('s1')
    await creating
    expect(rp.list(folder, 's1')).toEqual([])
    const dir = join(store, readdirSync(store)[0])
    expect(readdirSync(join(dir, 'objects'))).toEqual([])
    const again = rp.create(folder, 's1', 'y')
    await rp.clearAll()
    await again
    expect(existsSync(store)).toBe(false)
  })

  it('H12: carpeta inexistente (disco desconectado) da un mensaje claro', async () => {
    await expect(make().create(join(base, 'no-existe'), 's1', 'x')).rejects.toThrow('La carpeta no está disponible (¿disco desconectado?)')
    expect(() => make().list(join(base, 'no-existe'), 's1')).toThrow('La carpeta no está disponible')
  })

  it('crear un punto con un archivo de 40 MB no bloquea el bucle de eventos (>200 ms)', async () => {
    writeFileSync(join(folder, 'grande.bin'), Buffer.alloc(40 * 1024 * 1024, 7))
    put('a.txt', 'a')
    let last = performance.now()
    let worst = 0
    const timer = setInterval(() => {
      const t = performance.now()
      worst = Math.max(worst, t - last)
      last = t
    }, 5)
    try {
      const rp = make()
      const pt = await rp.create(folder, 's1', 'x')
      expect(pt.status).toBe('ok')
      writeFileSync(join(folder, 'grande.bin'), Buffer.alloc(40 * 1024 * 1024, 8))
      await rp.changes(folder, pt.id)
    } finally {
      clearInterval(timer)
    }
    expect(worst).toBeLessThan(200)
  })
})
