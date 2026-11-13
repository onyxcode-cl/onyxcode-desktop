/** Borrado acotado de lo creado en una tarea. Nunca interpreta un programa de shell. */
import { lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmdirSync, unlinkSync, type Stats } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ensureRealDir } from './no-follow'

export interface DeleteBaseline {
  version: 1
  /** Solo se acepta para sesiones nacidas durante la instancia que tomó el registro. */
  notBefore: number
  paths: string[]
  unknown: string[]
}
export interface DeleteCommand {
  paths: string[]
  recursive: boolean
  directory: boolean
  force: boolean
}

/** Lista cerrada: una sola orden rm/rmdir/unlink, opciones conocidas y nombres literales. */
export function parseOwnDelete(command: string): DeleteCommand | null {
  if (!command || command.length > 16000 || /[\x00-\x1f\x7f;&|`$<>\\*?\[\]{}~#]/.test(command)) return null
  const tokens: string[] = []
  const re = /"([^"\n]*)"|'([^'\n]*)'|([^\s"']+)/gy
  let at = 0
  while (at < command.length) {
    while (at < command.length && /\s/.test(command[at])) at++
    if (at === command.length) break
    re.lastIndex = at
    const m = re.exec(command)
    if (!m) return null
    at = re.lastIndex
    if (at < command.length && !/\s/.test(command[at])) return null
    tokens.push(m[1] ?? m[2] ?? m[3])
  }
  const verb = tokens.shift()
  if (!verb || !['rm', 'rmdir', 'unlink', '/bin/rm', '/bin/rmdir', '/usr/bin/rm', '/usr/bin/rmdir', '/usr/bin/unlink'].includes(verb))
    return null
  const kind = verb.slice(verb.lastIndexOf('/') + 1)
  let recursive = false
  let force = false
  let options = true
  const paths: string[] = []
  for (const token of tokens) {
    if (options && token === '--') {
      options = false
      continue
    }
    if (options && token.startsWith('-')) {
      if (kind !== 'rm' || !/^-[rfR]+$/.test(token)) return null
      recursive ||= /[rR]/.test(token)
      force ||= token.includes('f')
    } else {
      if (!token || token.endsWith('/') || token.split('/').includes('..')) return null
      paths.push(token)
    }
  }
  if (!paths.length || paths.length > 100 || (kind === 'unlink' && paths.length !== 1)) return null
  return { paths, recursive, directory: kind === 'rmdir', force }
}

/**
 * Solo para el servidor aislado SIN permiso de borrar. Sus directorios no se pueden renombrar.
 * El scratch sí es mutable: primero se aparta su primer tramo a una carpeta aleatoria en la raíz,
 * fuera de la excepción de borrado del kernel. rename mueve el enlace mismo, jamás su destino.
 * Después se valida TODO antes de unlink/rmdir individuales, sin await ni shell ni rm recursivo.
 */
export function deleteOwnPaths(
  root: string,
  command: DeleteCommand,
  baseline: DeleteBaseline,
  excluded: string[] = [],
  onDeleted?: (path: string, isDirectory: boolean) => void
): boolean {
  const canonical = realpathSync(root)
  // APFS y NTFS suelen ser insensibles a caja; APFS también admite equivalencias NFC/NFD.
  // En un volumen sensible esto solo puede negar de más, nunca convertir un previo en nuevo.
  const fold = (p: string): string => p.normalize('NFD').toLowerCase()
  const known = new Set(baseline.paths.map(fold))
  const unknown = baseline.unknown.map(fold)
  const inside = (p: string, dir: string): boolean => p === dir || p.startsWith(dir + '/')
  const toRel = (p: string): string => relative(canonical, p).split(sep).join('/')
  const scratch = '.lazunox/trabajo'
  const excludedRel = excluded.map((p) => fold(toRel(p)))
  const plans: Array<{ path: string; original: string; stat: Stats }> = []
  const seen = new Map<string, string>()
  const staged = new Map<string, { dest: string; original: string }>()
  let stageDir: string | null = null
  const ownership = (rel: string): void => {
    const key = fold(rel)
    if (!rel || isAbsolute(rel) || rel.split('/').includes('..')) throw new Error('outside')
    const inScratch = key.startsWith(scratch + '/')
    if (!inScratch) {
      if (
        rel
          .split('/')
          .some(
            (s) =>
              ['.git', 'node_modules', '.lazunox'].includes(fold(s)) ||
              fold(s) === '.ds_store' ||
              fold(s).startsWith('._') ||
              /^\..+\.icloud$/.test(fold(s))
          )
      )
        throw new Error('untracked')
      if (known.has(key) || unknown.some((p) => inside(key, p))) throw new Error('previous')
    }
    if (excludedRel.some((e) => inside(key, e) || inside(e, key))) throw new Error('extra')
  }
  const checkParent = (path: string): void => {
    if (realpathSync(root) !== canonical) throw new Error('root changed')
    if (dirname(path) !== canonical) ensureRealDir(canonical, dirname(path))
  }
  const walk = (path: string, rel: string): void => {
    const key = fold(rel)
    if (seen.has(key)) {
      if (realpathSync(seen.get(key)!) !== realpathSync(path)) throw new Error('ambiguous alias')
      return
    }
    ownership(rel)
    seen.set(key, path)
    if (seen.size > 20000) throw new Error('limit')
    checkParent(path)
    let st: Stats
    try {
      st = lstatSync(path)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' && command.force) return
      throw err
    }
    if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile()) || (st.isFile() && st.nlink !== 1)) throw new Error('link')
    if (st.isDirectory()) {
      if (!command.directory && !command.recursive) throw new Error('directory')
      const names = readdirSync(path)
      if (command.directory && names.length) throw new Error('not empty')
      for (const name of names) walk(join(path, name), rel + '/' + name)
    } else if (command.directory) throw new Error('not directory')
    plans.push({ path, original: join(canonical, rel), stat: st })
  }
  let validated = false
  try {
    const targets = command.paths.map((p) => {
      const path = resolve(canonical, p)
      const rel = toRel(path)
      ownership(rel)
      return { path, rel }
    })
    // Apartar solo el primer tramo bajo el scratch fijo: ningún padre mutable se sigue.
    for (const { rel } of targets) {
      if (!fold(rel).startsWith(scratch + '/')) continue
      ensureRealDir(canonical, join(canonical, '.lazunox', 'trabajo'))
      const top = rel.split('/').slice(0, 3).join('/')
      if (staged.has(fold(top))) continue
      if (excludedRel.some((e) => inside(e, fold(top)) || inside(fold(top), e))) throw new Error('extra')
      const scratchRoot = join(canonical, '.lazunox', 'trabajo')
      const names = readdirSync(scratchRoot).filter((name) => fold(name) === fold(top.split('/')[2]))
      if (names.length !== 1) {
        if (!names.length && command.force) continue
        throw new Error('ambiguous scratch name')
      }
      const original = join(scratchRoot, names[0])
      if (!stageDir) {
        stageDir = join(canonical, '.lazunox-own-delete-' + randomBytes(16).toString('hex'))
        mkdirSync(stageDir, { mode: 0o700 })
      }
      const dest = join(stageDir, String(staged.size))
      try {
        renameSync(original, dest)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT' && command.force) continue
        throw err
      }
      staged.set(fold(top), { dest, original })
    }
    for (const { path, rel } of targets) {
      const parts = rel.split('/')
      const stagedTop = staged.get(fold(parts.slice(0, 3).join('/')))
      walk(stagedTop ? join(stagedTop.dest, ...parts.slice(3)) : path, rel)
    }
    for (const p of plans) {
      checkParent(p.path)
      const st = lstatSync(p.path)
      if (st.isSymbolicLink() || st.dev !== p.stat.dev || st.ino !== p.stat.ino || st.isDirectory() !== p.stat.isDirectory())
        throw new Error('changed')
    }
    validated = true
    for (const p of plans) {
      checkParent(p.path)
      if (p.stat.isDirectory()) rmdirSync(p.path)
      else unlinkSync(p.path)
      onDeleted?.(p.original, p.stat.isDirectory())
    }
    return true
  } catch (err) {
    // Tras empezar el borrado no presentar el intento como «sin hacer»: el plugin devuelve error.
    if (validated) throw err
    return false
  } finally {
    for (const { original, dest } of staged.values()) {
      try {
        lstatSync(dest)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw err
      }
      ensureRealDir(canonical, join(canonical, '.lazunox', 'trabajo'))
      // No sobrescribir lo que otro proceso haya creado mientras estaba apartado.
      try {
        lstatSync(original)
        throw new Error('scratch changed; retained at ' + dest)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
      renameSync(dest, original)
    }
    if (stageDir) rmdirSync(stageDir)
  }
}
