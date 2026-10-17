/**
 * Lectura y validación de una carpeta de habilidad (F8-B180). SOLO lee: nunca ejecuta, importa ni interpreta nada de lo que hay
 * dentro. Una habilidad es código de terceros para el agente (instrucciones y, a veces, programas), así que se pide una estructura
 * mínima y cerrada:
 *   - `SKILL.md` en la raíz, con encabezado `name` y `description` (el nombre pasa por la misma regla que las habilidades propuestas);
 *   - solo archivos normales de tipos conocidos (texto, programas en texto, imágenes); sin enlaces simbólicos, sin binarios
 *     ejecutables (Mach-O, ELF, PE), sin claves que parezcan secretos;
 *   - tope de archivos, de profundidad y de tamaño.
 * Devuelve el contenido ya leído para que lo que se muestra en la vista previa sea EXACTAMENTE lo que se copia.
 */
import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { extname, join, sep } from 'node:path'
import { t, type MsgKey } from '@shared/i18n'
import { maskSecretPatterns } from '@shared/redact-patterns'
import { MAX_SKILL_DESCRIPTION, MAX_SKILL_NAME, SKILL_NAME_RE } from '@shared/skill-proposal'

export const SKILL_MAX_FILES = 200
export const SKILL_MAX_DEPTH = 4
export const SKILL_MAX_FILE_BYTES = 2 * 1024 * 1024
export const SKILL_MAX_TOTAL_BYTES = 8 * 1024 * 1024
export const SKILL_MAX_SKILLMD_BYTES = 100 * 1024
/** Cuánto del `SKILL.md` se muestra en la vista previa. */
export const SKILL_PREVIEW_CHARS = 4000

/** Códigos de rechazo; el texto lo pone `merr.pers.skill.<código>`. Nunca llevan contenido del archivo. */
export type SkillFolderCode =
  | 'not-folder'
  | 'symlink'
  | 'no-skill-md'
  | 'bad-frontmatter'
  | 'bad-name'
  | 'bad-description'
  | 'too-many-files'
  | 'too-deep'
  | 'too-big'
  | 'file-type'
  | 'executable'
  | 'secret'
  | 'special-file'
  | 'unreadable'
  | 'changed'
  | 'reserved'
  | 'exists'

export class SkillFolderError extends Error {
  constructor(readonly code: SkillFolderCode) {
    super(t(`merr.pers.skill.${code}` as MsgKey))
  }
}

const TEXT_EXT = new Set([
  '.md',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.csv',
  '.tsv',
  '.html',
  '.css',
  '.xml',
  '.ini',
  '.cfg',
  '.rst',
  '.tex'
])
/** Programas en texto: se permiten (muchas habilidades los traen) pero se avisan una por una. */
const SCRIPT_EXT = new Set(['.py', '.sh', '.bash', '.zsh', '.js', '.mjs', '.cjs', '.ts', '.ps1', '.bat', '.cmd', '.rb', '.pl'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])
const IGNORED = new Set(['.DS_Store', 'Thumbs.db', '.gitignore', '.git'])

export interface SkillFile {
  /** Ruta relativa con `/`. */
  path: string
  bytes: number
  script: boolean
  data: Buffer
}

export interface ScannedSkill {
  name: string
  description: string
  body: string
  files: SkillFile[]
  bytes: number
  /** Huella de todo el contenido (rutas + bytes): detecta que la carpeta cambió entre la vista previa y la confirmación. */
  digest: string
}

/** Lee `name` y `description` del encabezado YAML simple de un `SKILL.md`. Solo texto en una línea o bloque `>`/`|`. */
export function parseFrontmatter(text: string): { name: string; description: string; body: string } | null {
  const norm = text.replace(/^﻿/, '').replace(/\r\n/g, '\n')
  if (!norm.startsWith('---\n')) return null
  const end = norm.indexOf('\n---', 4)
  if (end < 0) return null
  const head = norm.slice(4, end).split('\n')
  const after = norm.slice(end + 4)
  if (after.length > 0 && !after.startsWith('\n')) return null
  const body = after.replace(/^\n+/, '')
  const out: Record<string, string> = {}
  for (let i = 0; i < head.length; i++) {
    const m = /^([A-Za-z_-]+):\s*(.*)$/.exec(head[i])
    if (!m) continue
    let v = m[2].trim()
    if (v === '>' || v === '|' || v === '>-' || v === '|-') {
      const parts: string[] = []
      while (i + 1 < head.length && /^\s+\S/.test(head[i + 1])) parts.push(head[++i].trim())
      v = parts.join(' ')
    } else if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) {
      v = v.slice(1, -1).replace(/\\"/g, '"')
    }
    out[m[1]] = v
  }
  if (!out.name || !out.description) return null
  return { name: out.name, description: out.description, body }
}

function isExecutableBinary(buf: Buffer): boolean {
  if (buf.length < 4) return false
  const b = buf.readUInt32BE(0)
  // Mach-O (32/64, ambos órdenes), binario universal / clase Java, ELF.
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0x7f454c46].includes(b)) return true
  // PE/Windows («MZ»).
  return buf[0] === 0x4d && buf[1] === 0x5a
}

function kindOf(file: string): 'text' | 'script' | 'image' | null {
  const ext = extname(file).toLowerCase()
  if (TEXT_EXT.has(ext)) return 'text'
  if (SCRIPT_EXT.has(ext)) return 'script'
  if (IMAGE_EXT.has(ext)) return 'image'
  return null
}

export function scanSkillFolder(folder: string): ScannedSkill {
  let root: string
  try {
    const st = lstatSync(folder)
    if (st.isSymbolicLink()) throw new SkillFolderError('symlink')
    if (!st.isDirectory()) throw new SkillFolderError('not-folder')
    root = realpathSync(folder)
  } catch (err) {
    if (err instanceof SkillFolderError) throw err
    throw new SkillFolderError('unreadable')
  }

  const files: SkillFile[] = []
  let total = 0
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > SKILL_MAX_DEPTH) throw new SkillFolderError('too-deep')
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      throw new SkillFolderError('unreadable')
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of entries) {
      if (IGNORED.has(e.name)) continue
      const abs = join(dir, e.name)
      const relPath = rel ? `${rel}/${e.name}` : e.name
      const st = lstatSync(abs)
      if (st.isSymbolicLink()) throw new SkillFolderError('symlink')
      if (st.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '__pycache__' || e.name.startsWith('.')) throw new SkillFolderError('file-type')
        walk(abs, relPath, depth + 1)
        continue
      }
      if (!st.isFile()) throw new SkillFolderError('special-file')
      const kind = kindOf(e.name)
      if (!kind) throw new SkillFolderError('file-type')
      if (st.size > SKILL_MAX_FILE_BYTES) throw new SkillFolderError('too-big')
      total += st.size
      if (total > SKILL_MAX_TOTAL_BYTES) throw new SkillFolderError('too-big')
      if (files.length >= SKILL_MAX_FILES) throw new SkillFolderError('too-many-files')
      let data: Buffer
      try {
        data = readFileSync(abs)
      } catch {
        throw new SkillFolderError('unreadable')
      }
      if (isExecutableBinary(data)) throw new SkillFolderError('executable')
      let script = kind === 'script'
      if (kind !== 'image') {
        if (data.includes(0)) throw new SkillFolderError('file-type')
        const text = data.toString('utf8')
        if (maskSecretPatterns(text) !== text) throw new SkillFolderError('secret')
        if (text.startsWith('#!')) script = true
      }
      files.push({ path: relPath, bytes: data.length, script, data })
    }
  }
  walk(root, '', 0)

  const main = files.find((f) => f.path === 'SKILL.md')
  if (!main) throw new SkillFolderError('no-skill-md')
  if (main.bytes > SKILL_MAX_SKILLMD_BYTES) throw new SkillFolderError('too-big')
  const fm = parseFrontmatter(main.data.toString('utf8'))
  if (!fm) throw new SkillFolderError('bad-frontmatter')
  if (fm.name.length > MAX_SKILL_NAME || !SKILL_NAME_RE.test(fm.name) || fm.name.includes('--')) throw new SkillFolderError('bad-name')
  if (fm.description.length < 1 || fm.description.length > MAX_SKILL_DESCRIPTION) throw new SkillFolderError('bad-description')

  const h = createHash('sha256')
  for (const f of files) {
    h.update(f.path)
    h.update('\0')
    h.update(createHash('sha256').update(f.data).digest())
  }
  return { name: fm.name, description: fm.description, body: fm.body, files, bytes: total, digest: h.digest('hex') }
}

/** Una ruta relativa de la habilidad nunca sale de su carpeta (defensa en profundidad antes de escribir). */
export function safeRelative(rel: string): boolean {
  return (
    rel.length > 0 &&
    !rel.startsWith('/') &&
    !rel.includes('\\') &&
    !rel.split('/').some((p) => p === '..' || p === '.' || p === '') &&
    !rel.includes(sep + '..')
  )
}
