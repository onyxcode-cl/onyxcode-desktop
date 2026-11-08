/**
 * Qué trae una carpeta de proyecto (Lazunox 1.8.12, W-A2). SOLO lectura de disco: nunca arranca el motor, no ejecuta nada y no
 * importa nada de la carpeta. Se usa ANTES de que el motor la cargue (el motor arranca los conectores `local` del proyecto en cuanto
 * la carga, motor `mcp/index.ts`), para que la persona vea qué viene y las herramientas de esos conectores pregunten.
 *
 * Todo lo que se lee es un DATO NO CONFIABLE:
 *  - tamaño máximo por archivo (256 KB) y por lista (200 entradas) y tope total; lo que no cabe se informa como «no revisado»;
 *  - JSONC con tolerancia (`stripJsonc`); un archivo que no se puede leer o interpretar NUNCA se ignora en silencio: queda como
 *    «no revisado» y `complete = false` (el motor podría interpretarlo distinto);
 *  - un enlace simbólico (o unión de Windows) que sale de la carpeta no se sigue, pero se informa;
 *  - solo archivos regulares (una tubería o un dispositivo colgaría la lectura);
 *  - los nombres que se devuelven van saneados (sin saltos de línea, controles ni marcas de dirección de texto).
 *
 * Qué carpetas recorre: igual que el motor (`config/paths.ts`, `FSUtil.up`): desde la carpeta hacia arriba hasta la raíz del repositorio
 * git; SIN git el motor usa la raíz del disco como tope (`worktree: "/"`, `project/project.ts`), así que se recorren TODAS las carpetas
 * superiores. Las mayúsculas las decide el sistema de archivos (APFS y NTFS no las distinguen por defecto): se pregunta por el nombre
 * exacto y el sistema responde igual que al motor; dentro de `.opencode/` se compara sin distinguir mayúsculas.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, open, opendir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import type { ProjectScanItem, ProjectScanKind, ProjectScanReason, ProjectScanResult } from '@shared/ipc-code'
import { mcpServerPermissionKey } from '@shared/mcp-permissions'
import { stripJsonc } from '../opencode/code-mcp-permission'

/** Tope de bytes de un archivo JSON/JSONC que se interpreta. */
export const MAX_JSON_BYTES = 256 * 1024
/** Tope de entradas por lista (conectores, complementos, ayudantes…). */
export const MAX_ENTRIES = 200
/** Tope de elementos devueltos en total. */
export const MAX_ITEMS = 400
/** Tope de entradas que se leen de una carpeta. */
const MAX_DIR_ENTRIES = 1000
/** Tope de bytes que se leen para sacar la huella de un archivo de código. */
const MAX_HASH_BYTES = 16 * 1024 * 1024
/** Tope de niveles hacia arriba. */
const MAX_LEVELS = 64
const NAME_MAX = 80
/** Nombre de conector más largo del que se calcula una regla exacta. */
const KEY_NAME_MAX = 200

const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'])

export interface ScanOptions {
  /** Nombres de conectores que la app o la persona ya tienen (app, config global, internos): se compara por la clave saneada. */
  known?: readonly string[]
  /** Instante (`Date.now()`) a partir del cual se corta y se informa lo que falte como no revisado. */
  deadline?: number
}

// ── utilidades ─────────────────────────────────────────────────────────────────────────────────────────────────

// Controles y marcas de dirección de texto / espacios de ancho cero / separadores de línea: podrían disfrazar un nombre en el diálogo.
// Se construyen con `new RegExp` y escapes de texto para que ningún separador de línea quede dentro del literal.
const CTRL_RE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f]', 'g')
const BIDI_RE = new RegExp('[\\u061c\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]', 'g')

/** Texto seguro para mostrar: una línea, sin controles ni marcas de dirección, acotado. */
export function cleanText(v: unknown, max = NAME_MAX): string {
  let s = typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v)
  s = s.replace(CTRL_RE, ' ').replace(BIDI_RE, '').replace(/\s+/g, ' ').trim()
  if (s.length > max) s = `${s.slice(0, max - 1)}…`
  return s
}

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** JSON con claves ordenadas (la huella no depende del orden en que estén escritas). */
function canon(v: unknown, depth = 0): string {
  if (depth > 8) return '"…"'
  if (Array.isArray(v)) return `[${v.map((x) => canon(x, depth + 1)).join(',')}]`
  if (isPlain(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(v[k], depth + 1)}`)
      .join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

/** Solo el host (con puerto) de una dirección: sin usuario, contraseña, ruta ni consulta (pueden llevar claves). */
function hostOf(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  try {
    return cleanText(new URL(raw.trim()).host, 100)
  } catch {
    return ''
  }
}

/** Primer elemento del comando: el PROGRAMA. Nunca los argumentos. */
function programOf(command: unknown): string {
  if (Array.isArray(command)) return typeof command[0] === 'string' ? cleanText(command[0], 100) : ''
  if (typeof command === 'string') return cleanText(command.trim().split(/\s+/)[0] ?? '', 100)
  return ''
}

const casefold = (p: string): string => (process.platform === 'linux' ? p : p.toLowerCase())
/** ¿`p` está dentro de `base` (o es `base`)? Rutas ya resueltas con `realpath`. */
export function isWithin(base: string, p: string): boolean {
  const b = casefold(base)
  const q = casefold(p)
  return q === b || q.startsWith(b.endsWith(sep) ? b : b + sep)
}

type Fs = { ok: true; real: string; size: number } | { ok: false; reason: ProjectScanReason | 'missing' }

/** Comprueba que `file` existe, es un archivo regular y está (con enlaces resueltos) dentro de `base`. No lee el contenido. */
async function checkRegular(file: string, base: string): Promise<Fs> {
  let l
  try {
    l = await lstat(file)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return { ok: false, reason: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unreadable' }
  }
  let real: string
  try {
    real = await realpath(file)
  } catch {
    // Enlace roto o ilegible: existe pero no se sabe adónde apunta.
    return { ok: false, reason: l.isSymbolicLink() ? 'symlink' : 'unreadable' }
  }
  if (!isWithin(base, real)) return { ok: false, reason: 'symlink' }
  try {
    const st = await stat(real)
    if (!st.isFile()) return { ok: false, reason: 'not-file' }
    return { ok: true, real, size: st.size }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}

async function readCapped(real: string, max: number): Promise<string | null> {
  let fh
  try {
    fh = await open(real, 'r')
    const buf = Buffer.alloc(max + 1)
    const { bytesRead } = await fh.read(buf, 0, max + 1, 0)
    if (bytesRead > max) return null
    return buf.subarray(0, bytesRead).toString('utf8')
  } catch {
    return null
  } finally {
    await fh?.close().catch(() => undefined)
  }
}

/** sha256 del contenido (en flujo, con tope); pasado el tope, tamaño y fecha. Nunca lanza. */
async function hashFile(real: string, size: number, mtimeMs: number): Promise<string> {
  if (size > MAX_HASH_BYTES) return `big:${size}:${Math.trunc(mtimeMs)}`
  return new Promise<string>((res) => {
    const h = createHash('sha256')
    const s = createReadStream(real)
    s.on('data', (c) => h.update(c))
    s.on('end', () => res(h.digest('hex')))
    s.on('error', () => res(`unreadable:${size}:${Math.trunc(mtimeMs)}`))
  })
}

/** Nombres de una carpeta, con tope. `null` si no se puede listar. */
async function listDir(dir: string): Promise<{ names: string[]; more: boolean } | null> {
  const names: string[] = []
  let d
  try {
    d = await opendir(dir)
    let more = false
    for await (const e of d) {
      if (names.length >= MAX_DIR_ENTRIES) {
        more = true
        break
      }
      names.push(e.name)
    }
    return { names, more }
  } catch {
    return null
  } finally {
    await d?.close().catch(() => undefined)
  }
}

// ── el escáner ─────────────────────────────────────────────────────────────────────────────────────────────────

class Scan {
  readonly items: ProjectScanItem[] = []
  readonly instructionFiles: ProjectScanResult['instructionFiles'] = []
  complete = true
  private full = false
  private readonly knownKeys: Set<string>
  private readonly knownByKey = new Map<string, string>()

  constructor(
    readonly start: string,
    private readonly opts: ScanOptions
  ) {
    this.knownKeys = new Set()
    for (const n of opts.known ?? []) {
      if (typeof n !== 'string' || !n) continue
      const k = mcpServerPermissionKey(n)
      this.knownKeys.add(k)
      if (!this.knownByKey.has(k)) this.knownByKey.set(k, cleanText(n))
    }
  }

  expired(): boolean {
    return this.opts.deadline !== undefined && Date.now() > this.opts.deadline
  }

  rel(file: string): string {
    const r = relative(this.start, file).split(sep).join('/')
    return cleanText(r === '' ? '.' : r, 160)
  }

  add(it: Omit<ProjectScanItem, 'id' | 'name'> & { name: string; digest: string; fullName?: string }): void {
    if (this.items.length >= MAX_ITEMS) {
      if (!this.full) {
        this.full = true
        this.complete = false
        this.items.push(this.mk({ kind: 'unreviewed', name: '…', where: '.', risky: true, reason: 'truncated', digest: 'cap' }))
      }
      return
    }
    this.items.push(this.mk(it))
  }

  private mk(it: Omit<ProjectScanItem, 'id' | 'name'> & { name: string; digest: string; fullName?: string }): ProjectScanItem {
    const { digest, fullName, ...rest } = it
    const name = cleanText(rest.name)
    return { ...rest, name, id: sha(`${rest.kind}\0${fullName ?? name}\0${rest.where}\0${digest}`).slice(0, 24) }
  }

  /** Algo que no se pudo revisar. `breaksMcp` = podría esconder conectores (las reglas pasan a ser amplias). */
  unreviewed(file: string, reason: ProjectScanReason, breaksMcp: boolean): void {
    if (breaksMcp) this.complete = false
    const where = this.rel(file)
    this.add({ kind: 'unreviewed', name: basename(file), where, risky: true, reason, digest: reason })
  }

  // ── un archivo JSON/JSONC de configuración ────────────────────────────────────────────────────────────────────

  async configFile(file: string, base: string): Promise<void> {
    const c = await checkRegular(file, base)
    if (!c.ok) {
      if (c.reason !== 'missing') this.unreviewed(file, c.reason, true)
      return
    }
    if (c.size > MAX_JSON_BYTES) return this.unreviewed(file, 'too-big', true)
    const text = await readCapped(c.real, MAX_JSON_BYTES)
    if (text === null) return this.unreviewed(file, 'too-big', true)
    let data: unknown
    try {
      data = JSON.parse(stripJsonc(text.replace(/^﻿/, '')))
    } catch {
      return this.unreviewed(file, 'parse', true)
    }
    if (!isPlain(data)) return this.unreviewed(file, 'parse', true)
    this.configObject(data, this.rel(file), file)
  }

  private keysOf(o: Record<string, unknown>, where: string, file: string, breaksMcp: boolean): string[] {
    const keys = Object.keys(o)
    if (keys.length > MAX_ENTRIES) {
      this.unreviewed(file, 'truncated', breaksMcp)
      void where
      return keys.slice(0, MAX_ENTRIES)
    }
    return keys
  }

  private configObject(o: Record<string, unknown>, where: string, file: string): void {
    // Conectores
    if (o.mcp !== undefined) {
      if (!isPlain(o.mcp)) this.unreviewed(file, 'parse', true)
      else {
        for (const k of this.keysOf(o.mcp, where, file, true)) {
          const e = o.mcp[k]
          const entry = isPlain(e) ? e : {}
          const remote = entry.type === 'remote' || (entry.type !== 'local' && typeof entry.url === 'string' && entry.command === undefined)
          const detail = remote ? hostOf(entry.url) : programOf(entry.command)
          let mcpKey: string | undefined
          if (k.length <= KEY_NAME_MAX && k.length > 0) mcpKey = mcpServerPermissionKey(k)
          else this.complete = false // sin regla exacta posible: las reglas pasan a ser amplias
          if (JSON.stringify(e)?.includes('{file:')) this.unreviewed(file, 'dynamic', true)
          const overrides = mcpKey ? this.knownByKey.get(mcpKey) : undefined
          this.add({
            kind: 'mcp',
            name: k,
            fullName: k,
            detail,
            mcpKey,
            overrides,
            where,
            risky: true,
            digest: sha(canon(e))
          })
        }
      }
    }
    // Complementos de código declarados (paquetes o rutas)
    if (o.plugin !== undefined) {
      if (!Array.isArray(o.plugin)) this.unreviewed(file, 'parse', false)
      else {
        for (const el of o.plugin.slice(0, MAX_ENTRIES)) {
          const spec = Array.isArray(el) ? el[0] : el
          if (JSON.stringify(el)?.includes('{file:')) this.unreviewed(file, 'dynamic', false)
          this.add({ kind: 'plugin', name: typeof spec === 'string' ? spec : '?', where, risky: true, digest: sha(canon(el)) })
        }
        if (o.plugin.length > MAX_ENTRIES) this.unreviewed(file, 'truncated', false)
      }
    }
    // Programas que el motor lanza al editar o abrir archivos
    for (const kind of ['formatter', 'lsp'] as const) {
      const v = o[kind]
      if (!isPlain(v)) continue
      for (const k of this.keysOf(v, where, file, false)) {
        const e = v[k]
        if (!isPlain(e) || e.disabled === true || e.command === undefined) continue
        this.add({ kind, name: k, detail: programOf(e.command), where, risky: true, digest: sha(canon(e)) })
      }
    }
    if (typeof o.shell === 'string' && o.shell.trim()) {
      this.add({ kind: 'shell', name: 'shell', detail: cleanText(o.shell, 100), where, risky: true, digest: sha(o.shell) })
    }
    // Proveedores con dirección propia: las peticiones (con la clave de la persona) irían allí.
    if (isPlain(o.provider)) {
      for (const k of this.keysOf(o.provider, where, file, false)) {
        const e = o.provider[k]
        const opts = isPlain(e) && isPlain(e.options) ? e.options : undefined
        const base = opts && typeof opts.baseURL === 'string' ? opts.baseURL : undefined
        if (base === undefined) continue
        this.add({ kind: 'provider', name: k, detail: hostOf(base), where, risky: true, digest: sha(base) })
      }
    }
    // Reglas de permiso que abren (`allow`)
    if (o.permission !== undefined) {
      const p = o.permission
      const allows: string[] = []
      if (p === 'allow') allows.push('*')
      else if (isPlain(p)) {
        for (const k of Object.keys(p).slice(0, MAX_ENTRIES)) {
          const v = p[k]
          if (v === 'allow' || (isPlain(v) && Object.values(v).includes('allow'))) allows.push(k)
        }
      }
      if (allows.length > 0) {
        this.add({
          kind: 'permission',
          name: allows.slice(0, 6).join(', ') + (allows.length > 6 ? ', …' : ''),
          where,
          risky: true,
          digest: sha(canon(p))
        })
      }
    }
    // Instrucciones que se bajan de internet
    if (Array.isArray(o.instructions)) {
      for (const v of o.instructions.slice(0, MAX_ENTRIES)) {
        if (typeof v !== 'string' || !/^https?:\/\//i.test(v.trim())) continue
        const host = hostOf(v)
        this.add({ kind: 'instructions', name: host || '?', detail: host, where, risky: true, digest: sha(v) })
      }
    }
    // Ayudantes y comandos definidos en la config
    for (const [key, kind] of [
      ['agent', 'agent'],
      ['command', 'command']
    ] as const) {
      const v = o[key]
      if (!isPlain(v)) continue
      for (const k of this.keysOf(v, where, file, false)) this.add({ kind, name: k, where, risky: false, digest: 'cfg' })
    }
  }

  // ── carpetas ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** Carpeta de código (`plugin`, `plugins`, `tool`, `tools`): un elemento por archivo, con la huella de su contenido. */
  private async codeDir(dir: string, base: string): Promise<void> {
    const real = await realpathWithin(dir, base)
    if (real === null) return this.unreviewed(dir, 'symlink', false)
    const l = await listDir(real)
    if (!l) return this.unreviewed(dir, 'unreadable', false)
    if (l.more) this.unreviewed(dir, 'truncated', false)
    for (const n of l.names.slice(0, MAX_ENTRIES)) {
      if (!CODE_EXT.has(extname(n).toLowerCase())) continue
      const file = join(dir, n)
      const c = await checkRegular(file, base)
      if (!c.ok) {
        if (c.reason !== 'missing') {
          this.add({ kind: 'plugin', name: n, where: this.rel(file), risky: true, digest: `x:${c.reason}` })
          this.unreviewed(file, c.reason, false)
        }
        continue
      }
      let mtime = 0
      try {
        mtime = (await stat(c.real)).mtimeMs
      } catch {
        /* sin fecha */
      }
      this.add({ kind: 'plugin', name: n, where: this.rel(file), risky: true, digest: await hashFile(c.real, c.size, mtime) })
    }
  }

  /** Carpeta de ayudantes o comandos (`*.md`, hasta 3 niveles): solo los nombres; el contenido no se lee. */
  private async mdDir(dir: string, base: string, kind: 'agent' | 'command', depth = 0, prefix = ''): Promise<void> {
    if (depth > 2 || this.expired()) return
    const real = await realpathWithin(dir, base)
    if (real === null) return this.unreviewed(dir, 'symlink', false)
    const l = await listDir(real)
    if (!l) return
    for (const n of l.names) {
      if (this.items.length >= MAX_ITEMS) return
      if (n.toLowerCase().endsWith('.md')) {
        this.add({ kind, name: prefix + n.slice(0, -3), where: this.rel(join(dir, n)), risky: false, digest: 'md' })
      } else if (depth < 2 && !n.startsWith('.')) {
        try {
          const st = await lstat(join(dir, n))
          if (st.isDirectory()) await this.mdDir(join(dir, n), base, kind, depth + 1, `${prefix}${n}/`)
        } catch {
          /* se ignora */
        }
      }
    }
  }

  /** Una carpeta `.opencode`. */
  private async dotOpencode(dir: string, base: string): Promise<void> {
    const real = await realpathWithin(dir, base)
    if (real === null) return this.unreviewed(dir, 'symlink', true)
    const l = await listDir(real)
    if (!l) return this.unreviewed(dir, 'unreadable', true)
    if (l.more) this.unreviewed(dir, 'truncated', true)
    for (const n of l.names) {
      const low = n.toLowerCase()
      const p = join(dir, n)
      if (low === 'opencode.json' || low === 'opencode.jsonc') await this.configFile(p, base)
      else if (low === 'package.json') await this.packageFile(p, base)
      else if (low === 'plugin' || low === 'plugins' || low === 'tool' || low === 'tools') await this.codeDir(p, base)
      else if (low === 'agent' || low === 'agents' || low === 'mode' || low === 'modes') await this.mdDir(p, base, 'agent')
      else if (low === 'command' || low === 'commands') await this.mdDir(p, base, 'command')
    }
  }

  /** `.opencode/package.json`: el motor instala sus dependencias y los complementos las cargan. Solo se calcula su huella. */
  private async packageFile(file: string, base: string): Promise<void> {
    const c = await checkRegular(file, base)
    if (!c.ok) {
      if (c.reason !== 'missing') this.unreviewed(file, c.reason, false)
      return
    }
    let mtime = 0
    try {
      mtime = (await stat(c.real)).mtimeMs
    } catch {
      /* sin fecha */
    }
    this.add({ kind: 'package', name: 'package.json', where: this.rel(file), risky: true, digest: await hashFile(c.real, c.size, mtime) })
  }

  /** Ayudantes del ayudante externo que el motor también lee (ver `ConfigAgent.loadClaude` en el motor): solo nombres. */
  private async externalAgentsDir(dir: string, base: string): Promise<void> {
    const real = await realpathWithin(dir, base)
    if (real === null) return this.unreviewed(dir, 'symlink', false)
    const l = await listDir(real)
    if (!l) return
    for (const n of l.names) {
      if (n.toLowerCase() === 'agents') await this.mdDir(join(dir, n), base, 'agent')
    }
  }

  private async docFile(dir: string, name: string): Promise<void> {
    try {
      const st = await stat(join(dir, name))
      if (st.isFile()) this.instructionFiles.push({ name, bytes: st.size, where: this.rel(join(dir, name)) })
    } catch {
      /* no existe */
    }
  }

  async level(dir: string, base: string): Promise<void> {
    for (const n of ['opencode.json', 'opencode.jsonc']) await this.configFile(join(dir, n), base)
    const dot = join(dir, '.opencode')
    if (await exists(dot)) await this.dotOpencode(dot, base)
    const cl = join(dir, '.claude')
    if (await exists(cl)) await this.externalAgentsDir(cl, base)
    await this.docFile(dir, 'AGENTS.md')
    await this.docFile(dir, 'CLAUDE.md')
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p)
    return true
  } catch {
    return false
  }
}

/** `realpath` si queda dentro de `base`; si no (enlace que sale) o falla, `null`. */
async function realpathWithin(p: string, base: string): Promise<string | null> {
  try {
    const r = await realpath(p)
    return isWithin(base, r) ? r : null
  } catch {
    return null
  }
}

/** Orden total y estable de los elementos (para la huella). */
const byId = (a: ProjectScanItem, b: ProjectScanItem): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Lista lo que trae la carpeta `dir` y las superiores que el motor también lee. Nunca lanza: lo que falla queda como «no revisado».
 */
export async function scanProjectConfig(dir: string, opts: ScanOptions = {}): Promise<ProjectScanResult> {
  const start = resolve(dir)
  const scan = new Scan(start, opts)
  try {
    // Carpetas a recorrer: desde `start` hacia arriba hasta la raíz del repositorio (con `.git`, carpeta o archivo); sin git, hasta la raíz del disco.
    const chain: string[] = []
    let hasGit = false
    for (let cur = start, i = 0; i < MAX_LEVELS; i++) {
      chain.push(cur)
      if (await exists(join(cur, '.git'))) {
        hasGit = true
        break
      }
      const up = dirname(cur)
      if (up === cur) break
      cur = up
    }
    if (!hasGit && chain.length >= MAX_LEVELS) scan.complete = false
    let gitBase: string | null = null
    if (hasGit) {
      try {
        gitBase = await realpath(chain[chain.length - 1]!)
      } catch {
        gitBase = null
      }
    }
    for (const d of chain) {
      if (scan.expired()) {
        scan.unreviewed(d, 'truncated', true)
        break
      }
      let base = gitBase
      if (base === null) {
        try {
          base = await realpath(d)
        } catch {
          scan.unreviewed(d, 'unreadable', true)
          continue
        }
      }
      await scan.level(d, base)
    }
  } catch {
    scan.complete = false
    scan.items.push({
      id: sha('scan-failed').slice(0, 24),
      kind: 'unreviewed',
      name: basename(start),
      where: '.',
      risky: true,
      reason: 'unreadable'
    })
  }
  const items = scan.items.slice().sort(byId)
  const huella = sha(`${scan.complete ? 'c' : 'i'}\n${items.map((i) => i.id).join('\n')}`)
  return { items, huella, complete: scan.complete, instructionFiles: scan.instructionFiles }
}

export type { ProjectScanItem, ProjectScanKind, ProjectScanResult }
