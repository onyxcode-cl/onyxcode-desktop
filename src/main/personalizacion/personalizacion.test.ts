import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { posixOnly } from '../../test/platform'

vi.mock('electron', () => ({
  app: { getPath: () => '/nonexistent', getAppPath: () => '/nonexistent', isPackaged: false, getVersion: () => '0' }
}))

import { syncDirRecursive } from '../tasks/opencode-config'
import { SkillFolderError, parseFrontmatter, scanSkillFolder, SKILL_MAX_FILES, type SkillFolderCode } from './skill-folder'
import { bundledSkillIds, createSkillsService, SKILL_TOKEN_TTL_MS } from './skills-service'
import { PersonalizacionStore, readPersonalizacionState } from './store'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'lazunox-pers-'))
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

const SKILL_MD = (name = 'mi-habilidad', desc = 'Hace algo útil'): string =>
  `---\nname: ${name}\ndescription: "${desc}"\n---\n\n# Mi habilidad\n\nPasos de ejemplo.\n`

function makeSkill(dir: string, files: Record<string, string | Buffer> = {}, md = SKILL_MD()): string {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), md)
  for (const [rel, data] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true })
    writeFileSync(join(dir, rel), data)
  }
  return dir
}

const code = (fn: () => unknown): SkillFolderCode | 'ok' => {
  try {
    fn()
    return 'ok'
  } catch (err) {
    if (err instanceof SkillFolderError) return err.code
    throw err
  }
}

describe('parseFrontmatter', () => {
  it('lee name y description (con comillas, sin comillas y en bloque)', () => {
    expect(parseFrontmatter('---\nname: a-b\ndescription: Hola\n---\ncuerpo')).toMatchObject({
      name: 'a-b',
      description: 'Hola',
      body: 'cuerpo'
    })
    expect(parseFrontmatter("---\nname: a\ndescription: 'x y'\n---\n\nz")?.description).toBe('x y')
    expect(parseFrontmatter('---\nname: a\ndescription: >\n  una\n  dos\n---\nz')?.description).toBe('una dos')
  })
  it('sin encabezado o sin campos → null', () => {
    expect(parseFrontmatter('# solo texto')).toBeNull()
    expect(parseFrontmatter('---\nname: a\n---\nz')).toBeNull()
  })
})

describe('scanSkillFolder: solo lee y valida', () => {
  it('una habilidad válida devuelve nombre, descripción, cuerpo, archivos y huella estable', () => {
    const dir = makeSkill(join(tmp, 'src'), { 'scripts/run.py': 'print(1)\n', 'notas.txt': 'hola' })
    const s = scanSkillFolder(dir)
    expect(s).toMatchObject({ name: 'mi-habilidad', description: 'Hace algo útil' })
    expect(s.files.map((f) => f.path).sort()).toEqual(['SKILL.md', 'notas.txt', 'scripts/run.py'])
    expect(s.files.find((f) => f.path === 'scripts/run.py')?.script).toBe(true)
    expect(s.files.find((f) => f.path === 'notas.txt')?.script).toBe(false)
    expect(scanSkillFolder(dir).digest).toBe(s.digest)
    writeFileSync(join(dir, 'notas.txt'), 'otra cosa')
    expect(scanSkillFolder(dir).digest).not.toBe(s.digest)
  })

  it('no ejecuta nada: un script con efecto secundario queda intacto', () => {
    const marker = join(tmp, 'marca')
    const dir = makeSkill(join(tmp, 'src'), { 'x.sh': `#!/bin/sh\ntouch ${marker}\n`, 'y.py': `open(${JSON.stringify(marker)}, 'w')\n` })
    scanSkillFolder(dir)
    expect(existsSync(marker)).toBe(false)
  })

  it('rechaza lo que no cumple, con su código', () => {
    const base = (files: Record<string, string | Buffer> = {}, md?: string): string => makeSkill(join(tmp, `s${Math.random()}`), files, md)
    expect(code(() => scanSkillFolder(join(tmp, 'no-existe')))).toBe('unreadable')
    const file = join(tmp, 'archivo.txt')
    writeFileSync(file, 'x')
    expect(code(() => scanSkillFolder(file))).toBe('not-folder')
    const empty = join(tmp, 'vacia')
    mkdirSync(empty)
    expect(code(() => scanSkillFolder(empty))).toBe('no-skill-md')
    expect(code(() => scanSkillFolder(base({}, '# sin encabezado')))).toBe('bad-frontmatter')
    expect(code(() => scanSkillFolder(base({}, SKILL_MD('Mala Mayuscula'))))).toBe('bad-name')
    expect(code(() => scanSkillFolder(base({}, SKILL_MD('doble--guion'))))).toBe('bad-name')
    expect(code(() => scanSkillFolder(base({}, SKILL_MD('ok', 'x'.repeat(1025)))))).toBe('bad-description')
    expect(code(() => scanSkillFolder(base({ 'prog.exe': 'MZ' })))).toBe('file-type')
    expect(code(() => scanSkillFolder(base({ 'notas.txt': Buffer.from([0x4d, 0x5a, 0x90, 0x00, 1, 2]) })))).toBe('executable')
    expect(code(() => scanSkillFolder(base({ 'notas.txt': Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]) })))).toBe('executable')
    expect(code(() => scanSkillFolder(base({ 'notas.txt': Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 7, 0]) })))).toBe('executable')
    expect(code(() => scanSkillFolder(base({ 'datos.json': Buffer.from('a\0b') })))).toBe('file-type')
    expect(code(() => scanSkillFolder(base({ 'cfg.txt': 'token=' + 'ghp_' + 'a'.repeat(30) })))).toBe('secret')
    expect(code(() => scanSkillFolder(base({ '.env': 'A=1' })))).toBe('file-type')
    expect(code(() => scanSkillFolder(base({ 'node_modules/x/index.js': 'x' })))).toBe('file-type')
    expect(code(() => scanSkillFolder(base({ 'a/b/c/d/e/f.txt': 'x' })))).toBe('too-deep')
    expect(code(() => scanSkillFolder(base({ 'grande.txt': 'x'.repeat(2 * 1024 * 1024 + 1) })))).toBe('too-big')
  })

  it('demasiados archivos y tamaño total', () => {
    const many: Record<string, string> = {}
    for (let i = 0; i < SKILL_MAX_FILES + 1; i++) many[`f${i}.txt`] = 'x'
    expect(code(() => scanSkillFolder(makeSkill(join(tmp, 'muchos'), many)))).toBe('too-many-files')
    const big: Record<string, string> = {}
    for (let i = 0; i < 5; i++) big[`b${i}.txt`] = 'x'.repeat(1.9 * 1024 * 1024)
    expect(code(() => scanSkillFolder(makeSkill(join(tmp, 'pesada'), big)))).toBe('too-big')
  })

  it.skipIf(!posixOnly)('rechaza enlaces simbólicos (a archivos, a carpetas y la propia carpeta)', () => {
    const dir = makeSkill(join(tmp, 'a'))
    writeFileSync(join(tmp, 'fuera.txt'), 'secreto fuera')
    symlinkSync(join(tmp, 'fuera.txt'), join(dir, 'enlace.txt'))
    expect(code(() => scanSkillFolder(dir))).toBe('symlink')
    const dir2 = makeSkill(join(tmp, 'b'))
    symlinkSync(tmp, join(dir2, 'sub'))
    expect(code(() => scanSkillFolder(dir2))).toBe('symlink')
    symlinkSync(dir2, join(tmp, 'enlace-carpeta'))
    expect(code(() => scanSkillFolder(join(tmp, 'enlace-carpeta')))).toBe('symlink')
  })

  it('ignora archivos del sistema (.DS_Store, .git) sin copiarlos', () => {
    const dir = makeSkill(join(tmp, 'sys'), { '.DS_Store': 'x', '.git/config': 'x' })
    expect(scanSkillFolder(dir).files.map((f) => f.path)).toEqual(['SKILL.md'])
  })
})

describe('store', () => {
  it('lee con tolerancia y escribe de forma atómica', () => {
    const p = join(tmp, 'personalizacion.json')
    expect(readPersonalizacionState(p)).toEqual({ disabledSkills: [], userSkills: {} })
    writeFileSync(p, '{no es json')
    expect(readPersonalizacionState(p)).toEqual({ disabledSkills: [], userSkills: {} })
    writeFileSync(
      p,
      JSON.stringify({
        disabledSkills: ['docx', '../x', 5],
        userSkills: { Mala: { installedAt: 1 }, ok: { installedAt: 1, description: 'd', digest: 'h' } }
      })
    )
    const s = readPersonalizacionState(p)
    expect(s.disabledSkills).toEqual(['docx'])
    expect(Object.keys(s.userSkills)).toEqual(['ok'])
    const store = new PersonalizacionStore(p)
    store.update((st) => st.disabledSkills.push('pdf'))
    expect(readPersonalizacionState(p).disabledSkills).toEqual(['docx', 'pdf'])
    expect(readdirSync(tmp).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })
})

describe('servicio de habilidades', () => {
  let bundled: string
  let work: string
  let store: PersonalizacionStore
  let picked: string | null
  let changes: number
  let now: number

  const make = (): ReturnType<typeof createSkillsService> =>
    createSkillsService({
      store,
      skillsDir: () => work,
      bundledDir: () => bundled,
      pickFolder: async () => picked,
      afterChange: () => void changes++,
      now: () => now
    })

  beforeEach(() => {
    bundled = join(tmp, 'bundled')
    work = join(tmp, 'work')
    for (const id of ['docx', 'pdf']) makeSkill(join(bundled, id), { 'scripts/x.py': 'x' }, SKILL_MD(id, 'incluida'))
    mkdirSync(join(bundled, '_shared'))
    writeFileSync(join(bundled, '_shared', 'doctor.py'), 'x')
    mkdirSync(work)
    for (const id of ['docx', 'pdf']) makeSkill(join(work, id), { 'scripts/x.py': 'x' }, SKILL_MD(id, 'incluida'))
    store = new PersonalizacionStore(join(tmp, 'personalizacion.json'))
    picked = null
    changes = 0
    now = 1_000
  })

  it('lista las incluidas (sin _shared) como encendidas', () => {
    expect(bundledSkillIds(bundled)).toEqual(['docx', 'pdf'])
    expect(make().list()).toEqual({
      bundled: [
        { id: 'docx', enabled: true },
        { id: 'pdf', enabled: true }
      ],
      user: []
    })
  })

  it('apagar quita la carpeta de trabajo (no la del paquete) y encender la restaura', async () => {
    const svc = make()
    const off = await svc.setEnabled({ id: 'docx', enabled: false })
    expect(off.bundled.find((b) => b.id === 'docx')?.enabled).toBe(false)
    expect(existsSync(join(work, 'docx'))).toBe(false)
    expect(existsSync(join(bundled, 'docx', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(work, 'pdf', 'SKILL.md'))).toBe(true)
    const on = await svc.setEnabled({ id: 'docx', enabled: true })
    expect(on.bundled.find((b) => b.id === 'docx')?.enabled).toBe(true)
    expect(existsSync(join(work, 'docx', 'scripts', 'x.py'))).toBe(true)
    expect(changes).toBe(2)
  })

  it('no deja apagar ni «quitar» lo que no es una incluida o propia (ids ajenos, _shared, rutas)', async () => {
    const svc = make()
    await expect(svc.setEnabled({ id: '_shared', enabled: false })).rejects.toBeInstanceOf(SkillFolderError)
    await expect(svc.setEnabled({ id: 'no-existe', enabled: false })).rejects.toBeInstanceOf(SkillFolderError)
    await expect(svc.remove({ name: 'docx' })).rejects.toBeInstanceOf(SkillFolderError) // las incluidas se apagan, no se quitan
    expect(existsSync(join(work, 'docx', 'SKILL.md'))).toBe(true)
  })

  it('instalar: vista previa sin escribir; solo la confirmación copia; la ficha es de un solo uso', async () => {
    const src = makeSkill(join(tmp, 'mia'), { 'scripts/run.py': 'print(1)\n' })
    picked = src
    const svc = make()
    const p = await svc.pick()
    expect(p).toMatchObject({
      name: 'mi-habilidad',
      description: 'Hace algo útil',
      fileCount: 2,
      scripts: ['scripts/run.py'],
      bodyTruncated: false
    })
    expect(p?.bodyPreview).toContain('Mi habilidad')
    expect(existsSync(join(work, 'mi-habilidad'))).toBe(false) // nada se copió todavía
    const st = await svc.install({ token: p!.token })
    expect(st.user.map((u) => u.name)).toEqual(['mi-habilidad'])
    expect(st.user[0]).toMatchObject({ hasScripts: true, fileCount: 2, modified: false })
    expect(readFileSync(join(work, 'mi-habilidad', 'scripts', 'run.py'), 'utf8')).toBe('print(1)\n')
    expect(readdirSync(work).filter((n) => n.startsWith('.instalando'))).toEqual([])
    await expect(svc.install({ token: p!.token })).rejects.toBeInstanceOf(SkillFolderError) // un solo uso
  })

  it.skipIf(!posixOnly)('lo copiado no lleva permisos de ejecución', async () => {
    const src = makeSkill(join(tmp, 'mia'), { 'run.sh': '#!/bin/sh\necho hola\n' })
    chmodSync(join(src, 'run.sh'), 0o755)
    picked = src
    const svc = make()
    await svc.install({ token: (await svc.pick())!.token })
    expect((await import('node:fs')).statSync(join(work, 'mi-habilidad', 'run.sh')).mode & 0o111).toBe(0)
  })

  it('cancelar el diálogo no hace nada; una carpeta inválida falla con mensaje y no deja ficha', async () => {
    const svc = make()
    picked = null
    expect(await svc.pick()).toBeNull()
    picked = join(tmp, 'vacia')
    mkdirSync(picked)
    await expect(svc.pick()).rejects.toThrow(/SKILL\.md/)
  })

  it('rechaza nombres que pisan una incluida o una ya instalada (nunca sobrescribe)', async () => {
    picked = makeSkill(join(tmp, 'pisa'), {}, SKILL_MD('docx'))
    const svc = make()
    await expect(svc.pick()).rejects.toMatchObject({ code: 'reserved' })
    picked = makeSkill(join(tmp, 'mia'))
    await svc.install({ token: (await svc.pick())!.token })
    await expect(svc.pick()).rejects.toMatchObject({ code: 'exists' })
  })

  it('si la carpeta cambia entre la vista previa y la confirmación, no se instala', async () => {
    const src = makeSkill(join(tmp, 'mia'), { 'a.txt': 'uno' })
    picked = src
    const svc = make()
    const p = await svc.pick()
    writeFileSync(join(src, 'a.txt'), 'dos')
    await expect(svc.install({ token: p!.token })).rejects.toMatchObject({ code: 'changed' })
    expect(existsSync(join(work, 'mi-habilidad'))).toBe(false)
  })

  it('la ficha caduca a los 10 minutos y una ficha ajena no sirve', async () => {
    picked = makeSkill(join(tmp, 'mia'))
    const svc = make()
    const p = await svc.pick()
    await expect(svc.install({ token: 'f'.repeat(32) })).rejects.toMatchObject({ code: 'changed' })
    const p2 = await svc.pick()
    now += SKILL_TOKEN_TTL_MS + 1
    await expect(svc.install({ token: p2!.token })).rejects.toMatchObject({ code: 'changed' })
    expect(p?.token).not.toBe(p2?.token)
  })

  it('quitar borra solo la carpeta de esa habilidad propia y la del registro; detecta cambios a mano', async () => {
    picked = makeSkill(join(tmp, 'mia'), { 'a.txt': 'uno' })
    const svc = make()
    await svc.install({ token: (await svc.pick())!.token })
    writeFileSync(join(work, 'mi-habilidad', 'a.txt'), 'tocado')
    expect(svc.list().user[0].modified).toBe(true)
    const st = await svc.remove({ name: 'mi-habilidad' })
    expect(st.user).toEqual([])
    expect(existsSync(join(work, 'mi-habilidad'))).toBe(false)
    expect(existsSync(join(work, 'docx', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(tmp, 'mia', 'SKILL.md'))).toBe(true) // el original de la persona no se toca
    expect(store.read().userSkills).toEqual({})
  })
})

describe('refresco de las habilidades incluidas (opencode-config)', () => {
  it('conserva las propias, no restaura las apagadas y borra lo que ya no existe en el paquete', () => {
    const src = join(tmp, 'src')
    const dest = join(tmp, 'dest')
    for (const id of ['docx', 'pdf', 'xlsx']) makeSkill(join(src, id), {}, SKILL_MD(id))
    for (const id of ['docx', 'mia', 'vieja']) makeSkill(join(dest, id), {}, SKILL_MD(id))
    syncDirRecursive(src, dest, { keep: new Set(['mia']), skip: new Set(['docx']) })
    expect(readdirSync(dest).sort()).toEqual(['mia', 'pdf', 'xlsx'])
  })
  it('sin opciones se comporta como antes (espejo exacto)', () => {
    const src = join(tmp, 'src')
    const dest = join(tmp, 'dest')
    makeSkill(join(src, 'a'))
    makeSkill(join(dest, 'b'))
    syncDirRecursive(src, dest)
    expect(readdirSync(dest)).toEqual(['a'])
  })
})
