/**
 * V29: clasificador de terminal de «Automático» (Código y Overdrive), en tres salidas:
 *  - `allow`: lecturas (también fuera del proyecto, salvo credenciales) y trabajo inofensivo; se responde «una vez».
 *  - `hard`: siempre tarjeta, sin IA: borrar la raíz, la carpeta personal o el proyecto, o un destino con variable que
 *    puede quedar vacía; escribir en `.git`; leer o escribir credenciales; la configuración y los datos de Lazunox;
 *    cambios del sistema; descargar y ejecutar.
 *  - `doubt`: lo delicado que puede ser legítimo (borrar o matar procesos, `git push`/`reset`, escribir o borrar fuera
 *    del proyecto) y lo que no se entiende: lo revisa la IA (`POST /permission/{id}/review`).
 *
 * No es un sandbox: npm, scripts y hooks del proyecto ejecutan código. Ya no se revisa cada argumento como si fuera una
 * ruta (`safeArgument`, origen de las rondas 2 a 7): se distinguen lecturas, destinos de escritura y entradas de código
 * o configuración. Las credenciales se buscan también en el texto. En Windows el comando se normaliza antes (envoltorios de PowerShell y cmd,
 * `\` y `/`, unidades, mayúsculas y nombres cortos 8.3).
 */

export type AutoCommandVerdict = 'allow' | 'hard' | 'doubt'
export interface AutoCommandResult {
  verdict: AutoCommandVerdict
  /** Motivo corto (registro y pruebas; no se muestra a la persona). */
  reason: string
}
export interface AutoCommandOptions {
  /** Carpeta de trabajo de la herramienta (absoluta o relativa al proyecto). */
  workdir?: unknown
  /** Carpetas exteriores que el motor detectó con su analizador (contrato V29 §1). */
  externalDirectories?: readonly unknown[]
  /** Motor viejo: carpetas exteriores que la persona aprobó para ESTA llamada y este comando. */
  approvedDirectories?: readonly string[]
  /** Carpeta personal; si falta se deduce de la raíz del proyecto (/Users/x, /home/x, C:\Users\x). */
  home?: string
  /** Shell que usará el motor (`metadata.shell`): decide si `\` escapa. Sin él, escapa salvo en un proyecto de Windows. */
  shell?: string
  /** El motor marcó el comando como ilegible para su analizador real: nunca se aprueba sin más (`doubt` como mínimo). */
  unparsed?: boolean
}

// ───────────────────────────── Léxico ─────────────────────────────

interface Word {
  text: string
  /** Llevaba comillas (simples o dobles) en alguna parte. */
  quoted: boolean
  /** Tiene expansiones que no se pueden resolver ($VAR, $(…), %VAR%, `…`). */
  dynamic: boolean
}
interface Part {
  words: Word[]
  redirects: Array<{ op: string; target: Word }>
  /** Separador que sigue a la orden: `|`, `&&`, `||`, `;`, `&`, salto de línea o ''. */
  separator: string
  heredocs: Array<{ body: string; quoted: boolean }>
  /** Sustituciones de comando `$(…)`, `` `…` `` y `<(…)`: se clasifican aparte. */
  substs: string[]
  group?: 'open' | 'close'
  /** PowerShell: la orden empieza con el operador de llamada `&` (`& $exe args`). */
  call?: boolean
}

/** Marca de una sustitución de comando ya extraída. */
const SUBST = '\u0001'

function matchClose(s: string, start: number, open: string, close: string): number {
  let depth = 0
  let quote = ''
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === quote) quote = ''
      else if (c === '\\' && quote === '"') i++
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === open) depth++
    else if (c === close && --depth === 0) return i
  }
  return -1
}

const emptyPart = (): Part => ({ words: [], redirects: [], separator: '', heredocs: [], substs: [] })

/** Lector común de bash/zsh, PowerShell y cmd. `null` si no se puede leer con seguridad. */
function parse(command: string, escapes = true): Part[] | null {
  const parts: Part[] = []
  let part = emptyPart()
  let word = ''
  let started = false
  let quoted = false
  let dynamic = false
  let redirect = ''
  const pending: Array<{ delim: string; quoted: boolean; strip: boolean; owner: Part }> = []
  const flush = (): void => {
    if (started) {
      const w = { text: word, quoted, dynamic }
      if (redirect) part.redirects.push({ op: redirect, target: w })
      else part.words.push(w)
      redirect = ''
    }
    word = ''
    started = false
    quoted = false
    dynamic = false
  }
  const end = (separator: string): void => {
    flush()
    if (part.words.length || part.redirects.length || part.heredocs.length || part.substs.length || pending.some((h) => h.owner === part)) {
      part.separator = separator
      parts.push(part)
    } else if (separator && parts.length && !parts.at(-1)!.group && parts.at(-1)!.separator !== '\n') parts.at(-1)!.separator ||= separator
    part = emptyPart()
  }
  const marker = (group: 'open' | 'close'): void => {
    end(';')
    parts.push({ ...emptyPart(), group })
  }
  /** `$…` en `i` (fuera de comillas simples). Devuelve el último índice consumido, o -2 si no se puede leer. */
  const dollar = (i: number): number => {
    const next = command[i + 1] ?? ''
    if (next === '(') {
      const close = matchClose(command, i + 1, '(', ')')
      if (close < 0) return -2
      const inner = command.slice(i + 2, close)
      // $(pwd) y $(Get-Location) son la carpeta actual, no un comando que revisar.
      if (/^\s*(?:pwd|get-location|gl)\s*$/i.test(inner)) word += '$PWD'
      else {
        part.substs.push(inner.replace(/^\((.*)\)$/s, '$1'))
        word += SUBST
        dynamic = true
      }
      started = true
      return close
    }
    if (next === '{') {
      const close = command.indexOf('}', i + 2)
      if (close < 0) return -2
      word += command.slice(i, close + 1)
      started = true
      dynamic = true
      return close
    }
    const name = /^(?:env:\w+|[A-Za-z_]\w*|[?!_$@*#0-9])/.exec(command.slice(i + 1))
    started = true
    if (!name) {
      word += '$'
      return i
    }
    word += '$' + name[0]
    dynamic = true
    return i + name[0].length
  }
  /** Tilde invertida: escape de PowerShell (`n, `t…) o sustitución de bash si se cierra en la misma línea. */
  const backtick = (i: number, inDouble: boolean): number => {
    const next = command[i + 1] ?? ''
    if (next === '\n') return i + 1
    if (
      /[ntr0abfv"$'`]/.test(next) &&
      (inDouble ||
        !command
          .slice(i + 2)
          .split('\n')[0]
          .includes('`'))
    ) {
      word += next
      started = true
      return i + 1
    }
    const close = command.indexOf('`', i + 1)
    started = true
    if (close < 0 || command.slice(i + 1, close).includes('\n')) return i
    part.substs.push(command.slice(i + 1, close))
    word += SUBST
    dynamic = true
    return close
  }
  /** `i` es el salto de línea que cierra la línea con heredocs: lee sus cuerpos. */
  const heredocBodies = (i: number): number => {
    let pos = i + 1
    for (const h of pending.splice(0)) {
      const lines: string[] = []
      let found = false
      while (pos <= command.length) {
        const eol = command.indexOf('\n', pos)
        const raw = command.slice(pos, eol < 0 ? command.length : eol).replace(/\r$/, '')
        pos = eol < 0 ? command.length + 1 : eol + 1
        if ((h.strip ? raw.replace(/^\t+/, '') : raw) === h.delim) {
          found = true
          break
        }
        lines.push(raw)
        if (eol < 0) break
      }
      if (!found) return -2
      h.owner.heredocs.push({ body: lines.join('\n'), quoted: h.quoted })
    }
    return pos - 1
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(c)) return null
    if (c === "'") {
      const close = command.indexOf("'", i + 1)
      if (close < 0) return null
      word += command.slice(i + 1, close)
      started = quoted = true
      i = close
      continue
    }
    if (c === '"') {
      started = quoted = true
      let j = i + 1
      for (; j < command.length && command[j] !== '"'; j++) {
        const d = command[j]
        if (d === '\\' && escapes && /["\\$`]/.test(command[j + 1] ?? '')) word += command[++j]
        else if (d === '$') {
          j = dollar(j)
          if (j === -2) return null
        } else if (d === '`') j = backtick(j, true)
        else word += d
      }
      if (j >= command.length) return null
      i = j
      continue
    }
    if (c === '$') {
      i = dollar(i)
      if (i === -2) return null
      continue
    }
    if (c === '`') {
      i = backtick(i, false)
      continue
    }
    if (c === '\\' && escapes) {
      const next = command[i + 1] ?? ''
      if (next === '\n') {
        i++
        continue
      }
      // bash/zsh: `\x` fuera de comillas es la letra tal cual (así `r\m` es `rm`, no un programa `m`). G2.
      if (next) {
        word += next
        started = true
        i++
        continue
      }
      word += c
      started = true
      continue
    }
    if (c === '#' && !started) {
      const eol = command.indexOf('\n', i)
      if (eol < 0) break
      i = eol - 1
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === ',') {
      flush()
      continue
    }
    if (c === '^') continue
    if (c === '\n') {
      end('\n')
      if (pending.length) {
        const next = heredocBodies(i)
        if (next === -2) return null
        i = next
      }
      continue
    }
    if (c === ';') {
      end(';')
      continue
    }
    if (c === '|') {
      if (command[i + 1] === '|') {
        end('||')
        i++
      } else {
        if (command[i + 1] === '&') i++
        end('|')
      }
      continue
    }
    if (c === '&') {
      if (command[i + 1] === '&') {
        end('&&')
        i++
      } else if (command[i + 1] === '>') {
        flush()
        i++
        redirect = command[i + 1] === '>' ? '>>' : '>'
        if (redirect === '>>') i++
      } else if (!started && !part.words.length && !part.redirects.length) part.call = true
      else end('&')
      continue
    }
    if (c === '<' || c === '>') {
      if (command[i + 1] === '(' && !started) {
        const close = matchClose(command, i + 1, '(', ')')
        if (close < 0) return null
        part.substs.push(command.slice(i + 2, close))
        word += SUBST
        started = dynamic = true
        i = close
        continue
      }
      // Un número o `*` justo delante es el descriptor, no un argumento.
      if (started && !quoted && /^(?:\d|\*)$/.test(word)) {
        word = ''
        started = false
      } else flush()
      if (c === '<' && command[i + 1] === '<' && command[i + 2] !== '<') {
        let j = i + 2
        const strip = command[j] === '-'
        if (strip) j++
        while (command[j] === ' ' || command[j] === '\t') j++
        let delim = ''
        let q = false
        for (; j < command.length && !/[\s;|&<>()]/.test(command[j]); j++) {
          if (command[j] === "'" || command[j] === '"') {
            const close = command.indexOf(command[j], j + 1)
            if (close < 0) return null
            delim += command.slice(j + 1, close)
            q = true
            j = close
          } else if (command[j] === '\\') q = true
          else delim += command[j]
        }
        if (!delim) return null
        pending.push({ delim, quoted: q, strip, owner: part })
        i = j - 1
        continue
      }
      let op: string = c
      if (command[i + 1] === c) {
        op += c
        i++
        if (c === '<' && command[i + 1] === '<') {
          op = '<<<'
          i++
        }
      } else if (command[i + 1] === '|') i++
      if (command[i + 1] === '&') {
        // Duplicar o cerrar un descriptor (2>&1, >&2, >&-) no añade una ruta.
        i++
        while (/[\d-]/.test(command[i + 1] ?? '')) i++
        continue
      }
      redirect = op
      continue
    }
    if (c === '@' && !started && /[({]/.test(command[i + 1] ?? '')) continue
    if (c === '(') {
      marker('open')
      continue
    }
    if (c === ')') {
      marker('close')
      continue
    }
    if (c === '{' && !started) {
      if (command[i + 1] === '}') {
        word = '{}'
        started = true
        i++
        continue
      }
      end(';')
      continue
    }
    if (c === '}' && !word.includes('{')) {
      end(';')
      continue
    }
    word += c
    started = true
  }
  if (pending.length) return null
  flush()
  if (redirect) return null
  const last = part
  end('')
  if (!last.words.length && parts.length && ['|', '&&', '||'].includes(parts.at(-1)!.separator)) return null
  return parts.some((p) => !p.group) ? parts : null
}

// ───────────────────────────── Windows: normalizar antes de clasificar ─────────────────────────────

function decodeUtf16Base64(text: string): string | null {
  try {
    const bin = atob(text)
    if (bin.length % 2) return null
    let out = ''
    for (let i = 0; i < bin.length; i += 2) out += String.fromCharCode(bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8))
    return out
  } catch {
    return null
  }
}

const PS = /^(?:powershell|pwsh)$/
const CMD = /^cmd$/

const basename = (p: string): string =>
  (p.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? '').toLowerCase().replace(/\.(?:exe|com|cmd|bat)$/, '')

function powershellScript(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i].toLowerCase()
    if (/^-(?:c|co|com|comm|comma|comman|command)$/.test(a)) return args.slice(i + 1).join(' ')
    if (/^-(?:e|ec|en|enc|enco|encod|encode|encoded\w*)$/.test(a)) return decodeUtf16Base64(args[i + 1] ?? '')
    if (/^-(?:f|file)$/.test(a)) return null
    if (
      /^-(?:executionpolicy|ep|ex|exec\w*|windowstyle|w|workingdirectory|wd|configurationname|outputformat|inputformat|of|if|psconsolefile|version|v)$/.test(
        a
      )
    )
      i++
    else if (!a.startsWith('-')) return args.slice(i).join(' ')
  }
  return null
}

function cmdScript(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i].toLowerCase()
    if (a === '/c' || a === '/k' || a === '/r') return args.slice(i + 1).join(' ')
    if (!/^\/[a-z](?::\w+)?$/.test(a)) return null
  }
  return null
}

function unwrapOnce(command: string, escapes: boolean): string | null {
  const parsed = parse(command, escapes)
  if (!parsed) return null
  const real = parsed.filter((p) => !p.group)
  if (real.length !== 1 || real[0].redirects.length || real[0].substs.length) return null
  const words = real[0].words.map((w) => w.text)
  const name = basename(words[0] ?? '')
  if (PS.test(name)) return powershellScript(words.slice(1))
  if (CMD.test(name)) return cmdScript(words.slice(1))
  return null
}

/**
 * Desenvuelve los envoltorios de fuera (`powershell -Command "…"`, `pwsh -EncodedCommand …`, `cmd /c …`) para clasificar
 * lo que de verdad se ejecuta. Un envoltorio con algo más (tuberías, otra orden) se deja tal cual: lo revisa el análisis.
 */
export function normalizeShellCommand(command: string, escapes = true): string {
  let current = command.trim()
  for (let round = 0; round < 4; round++) {
    const inner = unwrapOnce(current, escapes)
    if (inner === null || inner.trim() === current) break
    current = inner.trim().replace(/^"(.*)"$/s, '$1')
  }
  return current
}

// ───────────────────────────── Rutas ─────────────────────────────

interface Ctx {
  windows: boolean
  /** cmd ejecuta un nombre entre comillas; PowerShell sin `&` lo evalúa como cadena. */
  cmdShell: boolean
  /** La barra invertida escapa (bash/zsh); en PowerShell y cmd es parte de la ruta. */
  escapes: boolean
  root: string
  home: string
  approved: string[]
  depth: number
  hard: string[]
  doubt: string[]
  /** Nombres (en minúsculas) de archivos que este comando descarga. */
  downloads: Set<string>
  /** Archivos que este mismo comando escribe y su contenido literal (si se conoce): si luego se ejecutan, se revisan. */
  written: Map<string, { download: boolean; content: string | null }>
  /** R7: vio una redirección de escritura o una asignación delante de la orden (las causas benignas de `unparsed`). */
  sawRedirectOrAssign: boolean
  /** R7 exige además una gramática explícita para cada orden, incluso en ramas antiguas. */
  strictUnparsed: boolean
}

const HOME_MARK = '/\u0002home'
const TEMP_MARK = '/\u0002temp'

/** Nombres largos conocidos para resolver un nombre corto 8.3 (`PROGRA~1`, `APPDAT~1`, `SSH~1`). */
const LONG_NAMES = [
  'appdata',
  'roaming',
  'local',
  'lazunox',
  'opencode',
  'program files',
  'programdata',
  'microsoft',
  'credentials',
  'application data',
  '.ssh',
  '.aws',
  '.azure',
  '.config',
  '.gnupg',
  '.docker',
  '.kube',
  '.netrc',
  '.npmrc',
  '.git-credentials',
  '.git',
  '.env'
]

function expandShortName(segment: string): string {
  const m = /^([^~]{1,6})~\d+(?:\.[^.]{0,3})?$/.exec(segment)
  if (!m) return segment
  const prefix = m[1].toLowerCase().replace(/[^a-z0-9]/g, '')
  return LONG_NAMES.find((n) => n.replace(/[^a-z0-9]/g, '').startsWith(prefix)) ?? segment
}

/** Windows ignora puntos y espacios al final de un nombre y los flujos alternativos (`a.txt:oculto`). */
const cleanSegment = (s: string): string => (s === '.' || s === '..' ? s : expandShortName(s.replace(/:[^/]*$/, '').replace(/[. ]+$/, '')))

function normalizePath(raw: string, windows: boolean): string {
  let p = raw.replace(/\\/g, '/')
  if (/^\/\/[?.]\//.test(p)) p = p.slice(4)
  if (windows) p = p.toLowerCase()
  const unc = p.startsWith('//')
  const drive = /^[a-z]:/i.exec(p)?.[0] ?? ''
  const rest = drive ? p.slice(2) : p
  const out: string[] = []
  for (const raw of rest.split('/')) {
    const s = windows ? cleanSegment(raw) : raw
    if (!s || s === '.') continue
    if (s === '..') out.pop()
    else out.push(s)
  }
  return (unc ? '//' : drive ? drive.toLowerCase() + '/' : rest.startsWith('/') ? '/' : '') + out.join('/')
}

const isAbsolute = (p: string): boolean => /^(?:\/|[a-z]:\/)/i.test(p)
const within = (p: string, dir: string): boolean => p === dir || p.startsWith(dir.endsWith('/') ? dir : dir + '/')

function inferHome(root: string): string {
  const m = /^(?:\/users\/[^/]+|\/home\/[^/]+|[a-z]:\/users\/[^/]+|\/mnt\/[a-z]\/users\/[^/]+)/i.exec(root)
  return m ? m[0] : HOME_MARK
}

/** Sustituye las variables que sí se conocen. Lo que queda con `$`/`%`/sustitución es dinámico. */
function expandKnown(text: string, ctx: Ctx, cwd: string | null): string {
  const home = ctx.home
  let t = text
  if (/^~(?:[\\/]|$)/.test(t)) t = home + t.slice(1)
  else if (/^~[A-Za-z]/.test(t)) t = '/\u0002users/' + t.slice(1)
  const map: Array<[RegExp, string]> = [
    [/\$\{HOME\}|\$HOME\b|\$env:(?:USERPROFILE|HOME)\b|%USERPROFILE%|%HOMEDRIVE%%HOMEPATH%/gi, home],
    [/\$env:APPDATA\b|%APPDATA%/gi, home + '/appdata/roaming'],
    [/\$env:LOCALAPPDATA\b|%LOCALAPPDATA%/gi, home + '/appdata/local'],
    [/\$\{TMPDIR\}|\$TMPDIR\b|\$env:(?:TEMP|TMP)\b|%TEMP%|%TMP%/gi, TEMP_MARK],
    [/\$\{XDG_CONFIG_HOME\}|\$XDG_CONFIG_HOME\b/g, home + '/.config'],
    [/\$\{XDG_DATA_HOME\}|\$XDG_DATA_HOME\b/g, home + '/.local/share'],
    [/\$env:(?:SystemRoot|windir)\b|%SystemRoot%|%windir%/gi, 'c:/windows'],
    [/\$env:ProgramData\b|%ProgramData%/gi, 'c:/programdata'],
    [/\$env:ProgramFiles\b|%ProgramFiles%/gi, 'c:/program files']
  ]
  for (const [re, value] of map) t = t.replace(re, value)
  if (cwd) t = t.replace(/\$\{PWD\}|\$PWD\b/gi, cwd)
  return t
}

const DYNAMIC_RE = /\$\{[^}]*\}|\$env:\w+|\$[A-Za-z_]\w*(?:\.\w+|\[[^\]]*\])*|\$[?!_$@*#0-9]|%[A-Za-z_]\w*%|\u0001/g
const hasDynamic = (t: string): boolean => new RegExp(DYNAMIC_RE.source).test(t)

type Target =
  | { kind: 'path'; path: string }
  | { kind: 'unknown' }
  | { kind: 'device' }
  /** Depende de una variable: `empty` es la ruta si la variable queda vacía ('' sin ruta; null si nunca queda vacía). */
  | { kind: 'dynamic'; empty: string | null }

function resolveTarget(raw: string, cwd: string | null, ctx: Ctx): Target {
  const value = raw.replace(/^@/, '')
  if (/^(?:\/dev\/(?:null|stdout|stderr|tty|fd\/\d+)|nul|\$null|con)$/i.test(value)) return { kind: 'device' }
  if (/^[a-z][\w+.-]*:\/\//i.test(value)) return { kind: 'device' }
  const expanded = expandKnown(value, ctx, cwd)
  if (hasDynamic(expanded)) {
    if (/\$\{\w+:\?/.test(expanded)) return { kind: 'dynamic', empty: null }
    const emptied = expanded.replace(/\$\{\w+:[-=]([^}]*)\}/g, '$1').replace(DYNAMIC_RE, '')
    if (!emptied) return { kind: 'dynamic', empty: '' }
    const resolved = resolveTarget(emptied, cwd, ctx)
    return { kind: 'dynamic', empty: resolved.kind === 'path' ? resolved.path : '' }
  }
  if (!expanded) return { kind: 'unknown' }
  let p = expanded.replace(/\\/g, '/')
  if (ctx.windows && /^\/(?!\/)/.test(p) && !p.startsWith('/\u0002')) p = (ctx.root.slice(0, 2) || 'c:') + p
  if (!isAbsolute(p) && !p.startsWith('//')) {
    if (!cwd) return { kind: 'unknown' }
    p = `${cwd}/${p}`
  }
  return { kind: 'path', path: normalizePath(p, ctx.windows) }
}

const segmentsOf = (p: string): string[] => p.split('/').filter(Boolean)
const insideProject = (p: string, ctx: Ctx): boolean => !!ctx.root && within(p, ctx.root)

/** Carpeta de configuración/datos con credenciales (Application Support, AppData, ~/.config, ~/.local): leerla o copiarla entera es `doubt`. R5. */
function sensitiveConfigRoot(raw: string, ctx: Ctx): boolean {
  const path = raw.toLowerCase()
  const home = ctx.home.toLowerCase()
  return (
    path === `${home}/library` ||
    path === `${home}/library/application support` ||
    path === `${home}/appdata` ||
    path === `${home}/appdata/roaming` ||
    path === `${home}/appdata/local` ||
    path === `${home}/.config` ||
    path === `${home}/.local` ||
    path === `${home}/.local/share`
  )
}

/** Raíz, unidad, carpetas de primer nivel, la carpeta personal o el proyecto (y sus ancestros). */
function critical(path: string, ctx: Ctx): boolean {
  const segs = segmentsOf(path).filter((s, i) => !(i === 0 && /^[a-z]:$/i.test(s)))
  if (segs.length <= 1 && !path.startsWith(TEMP_MARK) && !path.startsWith('/\u0002users')) return true
  if (within(ctx.home, path)) return true
  return !!ctx.root && within(ctx.root, path)
}

/** Si el último tramo es un comodín puro (`*`, `.*`, `*.*`), el destino real es la carpeta que lo contiene. */
function globParent(path: string): string | null {
  const segs = path.split('/')
  if (!/^(?:\*+|\.\*|\*\.\*|\.\[!.\]\*|\.\?\*)$/.test(segs.at(-1) ?? '')) return null
  return segs.slice(0, -1).join('/') || '/'
}

/** Archivos y carpetas de credenciales que delatan su nombre en cualquier texto. */
const SECRET_STRONG =
  /^(?:\.ssh|\.aws|\.azure|\.gnupg|\.netrc|_netrc|\.git-credentials|\.npmrc|\.pypirc|\.envrc|\.codex|\.claude\.json|\.credentials\.json|\.pgpass|\.my\.cnf|\.vault-token|auth\.json|\.?(?:bash|zsh|sh|python|node|mysql|psql|rediscli)_history|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|keychains|[^/]*\.(?:keychain|keychain-db))$/
/** Solo cuentan como archivo cuando el texto tiene forma de ruta (`a.key` en código es una propiedad). */
const SECRET_FILE =
  /^(?:credentials(?:\.\w+)?|[^/]*\.(?:pem|key|p12|pfx|keystore|jks)|cookies(?:\.sqlite)?|logins\.json|key[34]\.db|signons\.sqlite|cert9\.db|chat\.db)$/
/** Nombres de credenciales de ejemplo para comparar un comodín (`.env*`, `~/.ss?/id_r*`): si el patrón puede coincidir, cuenta. */
const SECRET_EXAMPLES = [
  '.env',
  '.ssh',
  '.aws',
  '.azure',
  '.gnupg',
  '.netrc',
  '.npmrc',
  '.codex',
  '.git-credentials',
  'id_rsa',
  'id_ed25519',
  'credentials.json',
  'server.pem',
  'server.key',
  'keychains',
  'login.keychain-db'
]

/** `seg` (con comodines) podría coincidir con alguno de `names`, exigiendo al menos dos caracteres literales fijos. */
function globCouldBe(seg: string, names: readonly string[]): boolean {
  if (!/[*?[]/.test(seg)) return false
  if ((seg.replace(/\[[^\]]*\]|[*?]/g, '').match(/[a-z0-9.]/g)?.length ?? 0) < 2) return false
  let re = '^'
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]
    if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else if (c === '[') {
      const close = seg.indexOf(']', i + 1)
      re += '[^/]'
      i = close < 0 ? seg.length : close
    } else re += c.replace(/[.+^${}()|\\]/g, '\\$&')
  }
  const rx = new RegExp(re + '$')
  return names.some((name) => rx.test(name))
}

/** El tramo tiene un comodín que podría coincidir con un nombre de credencial (`.env*`, `.ss?`, `id_r*`, `.[e]nv`). */
function globMatchesSecret(seg: string): boolean {
  return globCouldBe(seg, SECRET_EXAMPLES)
}

/**
 * Credenciales o datos de Lazunox en un texto con forma de ruta. `fileLike`: el texto es un nombre de archivo (palabra de
 * shell), así que también cuentan `server.key` o `credentials.json` sin barra. `includeEnv` false (solo el barrido global)
 * deja fuera `.env`, que se trata por comando para no marcar un mensaje de commit o `git log -- .env`.
 */
function secretIn(raw: string, fileLike = true, includeEnv = true): string | null {
  const text = raw
    .replace(/^@/, '')
    .replace(/\\/g, '/')
    .toLowerCase()
    .replace(/\$env:appdata|%appdata%/g, '/appdata/roaming')
    .replace(/\$env:localappdata|%localappdata%/g, '/appdata/local')
  const pathy = fileLike || text.includes('/')
  const segs = text.split('/').map(cleanSegment)
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    if (includeEnv && /^\.env(?:\.[\w.-]+)?$/.test(s) && !/^\.env\.(?:example|sample|template|dist|defaults)$/.test(s))
      return 'credenciales (.env)'
    if (SECRET_STRONG.test(s) || (pathy && SECRET_FILE.test(s)) || globMatchesSecret(s)) return `credenciales (${s})`
    const next = segs[i + 1] ?? ''
    if (s === '.config' && /^(?:gh|gcloud|hub)$/.test(next)) return `credenciales (.config/${next})`
    if (s === '.docker' && next === 'config.json') return 'credenciales (.docker)'
    if (s === '.kube' && next === 'config') return 'credenciales (.kube)'
    if (/^(?:chrome|firefox|brave|edge|chromium)$/.test(s) && /^(?:cookies|logins\.json|login data|key[34]\.db|web data)$/.test(next))
      return 'cookies o contraseñas del navegador'
    if (s === 'messages' && next === 'chat.db') return 'el historial de Mensajes'
    if (s === 'microsoft' && /^(?:credentials|protect|vault)$/.test(next)) return 'el almacén de credenciales de Windows'
    // Carpeta de Lazunox en cualquier parte, también tras un comodín (`~/Library/App*/Lazunox`, `~/Library/*/Laz*`). R5.
    if ((s === 'lazunox' || s === 'opencode' || globCouldBe(s, ['lazunox', 'opencode'])) && !/^(?:runtimes|bin)$/.test(next))
      return 'la configuración o los datos de Lazunox'
  }
  return null
}

/** Carpetas del sistema y de arranque automático: escribir ahí es cambiar el sistema. */
function systemPath(path: string, ctx: Ctx): boolean {
  if (/^\/(?:etc|private\/etc|system|library|usr\/(?!local)|bin|sbin|private\/var\/db|var\/db)(?:\/|$)/.test(path)) return true
  if (/^[a-z]:\/(?:windows|program files|program files \(x86\)|programdata\/microsoft)(?:\/|$)/.test(path)) return true
  return (
    within(path, `${ctx.home}/library/launchagents`) ||
    within(path, `${ctx.home}/Library/LaunchAgents`) ||
    within(path, `${ctx.home}/appdata/roaming/microsoft/windows/start menu/programs/startup`) ||
    within(path, `${ctx.home}/.config/autostart`)
  )
}

// ───────────────────────────── Hallazgos ─────────────────────────────

type Cwds = Array<string | null>
const hard = (ctx: Ctx, reason: string): void => void ctx.hard.push(reason)
const doubt = (ctx: Ctx, reason: string): void => void ctx.doubt.push(reason)

/** Crear o sobrescribir un `.env` (p. ej. `cp .env.example .env`) es montaje corriente: `doubt`, no `hard`. */
const envOnly = (s: string | null): boolean => s === 'credenciales (.env)'

function checkWrite(raw: string, cwds: Cwds, ctx: Ctx, what = 'escribe'): void {
  const secret = secretIn(raw)
  if (secret) return void (envOnly(secret) ? doubt(ctx, `${what} un archivo .env`) : hard(ctx, `${what} ${secret}`))
  for (const cwd of cwds) {
    const t = resolveTarget(raw, cwd, ctx)
    if (t.kind === 'device') continue
    if (t.kind === 'unknown') {
      doubt(ctx, `${what} en una carpeta que no se conoce`)
      continue
    }
    if (t.kind === 'dynamic') {
      doubt(ctx, `${what} en una ruta que depende de una variable`)
      continue
    }
    const segs = segmentsOf(t.path)
    const secretPath = secretIn(t.path)
    // `.git/index.lock` y demás candados son un arreglo corriente: `doubt`, no `hard`. M1.
    const gitLock = segs.includes('.git') && /(?:\.lock|_head|merge_msg|commit_editmsg|orig_head)$/i.test(segs.at(-1) ?? '')
    if (segs.includes('.git')) void (gitLock ? doubt(ctx, `${what} dentro de .git`) : hard(ctx, `${what} dentro de .git`))
    else if (secretPath) void (envOnly(secretPath) ? doubt(ctx, `${what} un archivo .env`) : hard(ctx, `${what} ${secretPath}`))
    else if (systemPath(t.path, ctx)) hard(ctx, `${what} en una carpeta del sistema`)
    else if (insideProject(t.path, ctx) && (segs.includes('.opencode') || /^opencode\.jsonc?$/.test(segs.at(-1) ?? '')))
      hard(ctx, `${what} la configuración de Lazunox del proyecto`)
    else if (!insideProject(t.path, ctx) && !ctx.approved.some((d) => within(t.path, d))) doubt(ctx, `${what} fuera del proyecto`)
  }
}

/** Comandos que solo nombran un archivo (no leen su contenido): un secreto ahí es `doubt`, no `hard`. */
const NAME_ONLY = new Set([
  'test',
  '[',
  '[[',
  'touch',
  'stat',
  'file',
  'ls',
  'll',
  'mkdir',
  'realpath',
  'readlink',
  'dirname',
  'basename',
  'rmdir'
])
/** Copias y movimientos: su último operando es el destino de escritura (lo revisa `analyzeWrites`), no una lectura. */
const COPY_CMDS = /^(?:cp|copy|copy-item|cpi|mv|move|move-item|mi|ln|install|ditto|xcopy|robocopy|rsync|scp)$/
/** Comandos cuyo operando es un destino de escritura o un patrón, no un archivo que se lea. */
const DEST_OR_PATTERN =
  /^(?:set-content|add-content|ac|out-file|clear-content|clc|export-csv|export-clixml|tee|tee-object|sc|dd|truncate|new-item|ni|mkfifo|tar|bsdtar|zip|unzip|7z|7za|expand-archive|compress-archive)$/
const SECRET_ENV_RE =
  /(?:^|_)(?:secret|token|passwd|password|api[_-]?key|access[_-]?key|private[_-]?key|credential|session[_-]?token|aws_)/i

/** Credenciales que un comando de lectura toca, resueltas también contra la carpeta de trabajo (tras un `cd`). G5/G6/I3. */
function checkReadSecrets(part: Part, cwds: Cwds, ctx: Ctx): void {
  const { name, index } = programOf(part)
  const after = part.words.slice(index + 1)
  if (/^(?:echo|printf|write-output|write-host|print|puts)$/.test(name)) {
    // echo/printf de una variable con nombre de secreto saca su valor.
    if (after.some((w) => /^\$\{?\w+/.test(w.text) && SECRET_ENV_RE.test(w.text))) doubt(ctx, 'muestra una variable con credenciales')
    return
  }
  if (name === 'printenv') {
    if (after.some((w) => SECRET_ENV_RE.test(w.text))) doubt(ctx, 'muestra una variable con credenciales')
    return
  }
  // find/git tienen su propio análisis (`analyzeFind`/`analyzeGit`) y la lectura recursiva de la carpeta personal.
  if (name === 'git' || name === 'find' || DEST_OR_PATTERN.test(name)) return
  const nameOnly = NAME_ONLY.has(name)
  const report = (reason: string): boolean => (nameOnly ? (doubt(ctx, `nombra ${reason}`), true) : (hard(ctx, `toca ${reason}`), true))
  const patternCmd = /^(?:grep|egrep|fgrep|rg|ag|ack|findstr|awk|gawk|nawk|mawk|sed)$/.test(name)
  const psSelect = /^(?:select-string|sls)$/.test(name)
  const positionals = after.filter((w) => !(w.text.startsWith('-') && !/[\\/]/.test(w.text) && w.text !== '-'))
  // Los archivos de `-Path`/`-LiteralPath`/`-Include` siempre se revisan (Select-String los lleva ahí, no como posicional).
  const pathValues = optionValues(after, /^-(?:path|literalpath|lp|file|include|destination)$/i)
  // cp/mv: el último operando es el destino; el primero de grep/sed es el patrón; Select-String lleva el archivo en -Path.
  const posScan = psSelect ? [] : COPY_CMDS.test(name) ? positionals.slice(0, -1) : patternCmd ? positionals.slice(1) : positionals
  for (const w of [...pathValues, ...posScan]) {
    if (/(?:^|[\\/])rclone[\\/]rclone\.conf$|(?:^|[\\/])(?:login data|cookies|web data)$/i.test(w.text))
      hard(ctx, 'lee credenciales de una aplicación')
    const lit = secretIn(w.text)
    if (lit && report(lit)) return
    if (
      /^\/(?:private\/)?etc\/(?:sudoers|master\.passwd|shadow|gshadow)\b/i.test(w.text.replace(/\\/g, '/')) &&
      report('un archivo sensible del sistema')
    )
      return
    if (/[\\/]/.test(w.text) || w.text.startsWith('~'))
      for (const cwd of cwds) {
        const t = resolveTarget(w.text, cwd, ctx)
        const res = t.kind === 'path' && secretIn(t.path)
        if (res && report(res)) return
      }
  }
}

function checkDelete(raw: string, cwds: Cwds, ctx: Ctx, recursive: boolean): void {
  for (const cwd of cwds) {
    const t = resolveTarget(raw, cwd, ctx)
    if (t.kind === 'device') continue
    if (t.kind === 'dynamic') {
      if (t.empty && critical(globParent(t.empty) ?? t.empty, ctx)) hard(ctx, 'borra un destino con una variable que puede quedar vacía')
      else doubt(ctx, 'borra una ruta que depende de una variable')
      continue
    }
    if (t.kind === 'unknown') {
      // Carpeta desconocida (cd con variable): un comodín o «.» podría ser la carpeta personal.
      if (/^(?:\.|\.\/|\*|\.\/\*|\.\*|\*\/)$/.test(raw.replace(/\\/g, '/'))) hard(ctx, 'borra todo en una carpeta que no se conoce')
      else doubt(ctx, 'borra en una carpeta que no se conoce')
      continue
    }
    const base = globParent(t.path) ?? t.path
    if (critical(base, ctx) && (recursive || base !== t.path)) hard(ctx, 'borra la raíz, la carpeta personal o el proyecto entero')
  }
  checkWrite(raw, cwds, ctx, 'borra')
  doubt(ctx, 'borra archivos')
}

// ───────────────────────────── Programas ─────────────────────────────

const DELETE = new Set(['rm', 'rmdir', 'unlink', 'del', 'erase', 'rd', 'remove-item', 'ri', 'trash', 'rimraf', 'shred', 'srm', 'deltree'])
const KILL = new Set(['kill', 'pkill', 'killall', 'taskkill', 'stop-process', 'spps', 'tskill', 'skill'])
const ELEVATE = new Set(['sudo', 'su', 'doas', 'runas', 'pkexec', 'gsudo', 'chroot'])
const SHELLS = /^(?:bash|sh|zsh|dash|ksh|fish|csh|tcsh|ash)$/
const SCRIPTING = /^(?:node|nodejs|python[\d.]*|py|ruby|perl|php|bun|deno|rscript|lua|tsx|ts-node)$/
const DOWNLOADERS = /^(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|start-bitstransfer|bitsadmin|certutil)$/
const WRAPPERS = new Set([
  'nohup',
  'time',
  'nice',
  'timeout',
  'gtimeout',
  'command',
  'builtin',
  'exec',
  'caffeinate',
  'stdbuf',
  'unbuffer',
  'busybox',
  'watch',
  'env',
  'strace',
  'ltrace',
  'arch',
  'setarch',
  'taskset',
  'ionice',
  'chrt',
  'proxychains',
  'proxychains4',
  'catchsegv',
  'setsid',
  'eatmydata'
])
/** Programas que corren una orden en una posición poco clara (o la toman de stdin): se revisan sin intentar leerla. G9. */
const RUN_COMMAND = new Set(['script', 'screen', 'tmux', 'expect', 'unshare', 'flock', 'setpriv', 'ed', 'ex', 'parallel'])

/**
 * R6: `allow` solo se devuelve cuando CADA orden es un programa conocido e inofensivo. Esta es la lista de los que, al no
 * encajar en ninguna rama peligrosa, se dan por seguros (lecturas, utilidades de texto, escrituras con el destino ya
 * revisado y las herramientas de desarrollo habituales). Todo lo que no esté aquí (y no lo maneje otra rama) va a `doubt`.
 */
const KNOWN_SAFE = new Set([
  // Lecturas e información del sistema.
  'ls',
  'll',
  'la',
  'l',
  'dir',
  'vdir',
  'cat',
  'bat',
  'tac',
  'nl',
  'head',
  'tail',
  'more',
  'less',
  'most',
  'wc',
  'stat',
  'file',
  'du',
  'df',
  'tree',
  'realpath',
  'readlink',
  'basename',
  'dirname',
  'pwd',
  'echo',
  'printf',
  'print',
  'which',
  'whereis',
  'type',
  'whatis',
  'whoami',
  'id',
  'hostname',
  'uname',
  'date',
  'cal',
  'uptime',
  'sw_vers',
  'locale',
  'tty',
  'groups',
  'w',
  'who',
  'ps',
  'pgrep',
  'jobs',
  'true',
  'false',
  ':',
  'sleep',
  'seq',
  'clear',
  'tput',
  'man',
  'help',
  'getconf',
  'lsof',
  'ulimit',
  'test',
  '[',
  '[[',
  'command',
  'builtin',
  'return',
  'exit',
  'read',
  'wait',
  'nproc',
  // Utilidades de texto.
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'ag',
  'ack',
  'cut',
  'paste',
  'join',
  'comm',
  'uniq',
  'tr',
  'rev',
  'fold',
  'fmt',
  'column',
  'expand',
  'unexpand',
  'col',
  'strings',
  'xxd',
  'od',
  'hexdump',
  'base32',
  'base64',
  'jq',
  'yq',
  'xmllint',
  'diff',
  'cmp',
  'shasum',
  'md5',
  'md5sum',
  'sha1sum',
  'sha256sum',
  'sha512sum',
  'cksum',
  'sum',
  'b2sum',
  'pandoc',
  'pdftotext',
  'csvlook',
  'sort',
  'tee',
  'look',
  'tsort',
  'awk',
  'gawk',
  'nawk',
  'mawk',
  'sed',
  'ministat',
  'tabs',
  // Escritura y archivado (el destino lo revisa `analyzeWrites`/`checkWrite`).
  'cp',
  'copy',
  'mv',
  'move',
  'ln',
  'link',
  'mkdir',
  'md',
  'touch',
  'truncate',
  'mkfifo',
  'mktemp',
  'install',
  'dd',
  'split',
  'csplit',
  'tar',
  'bsdtar',
  'zip',
  'unzip',
  '7z',
  '7za',
  'gzip',
  'gunzip',
  'bzip2',
  'bunzip2',
  'xz',
  'unxz',
  'zstd',
  'zcat',
  'compress',
  'chmod',
  'chown',
  'chgrp',
  'chflags',
  'setfacl',
  'xattr',
  'attrib',
  'icacls',
  'takeown',
  'ditto',
  'xcopy',
  'robocopy',
  'patch',
  'mklink',
  // Herramientas de desarrollo habituales (ejecutan código del proyecto, igual que `npm test`).
  'eslint',
  'prettier',
  'tsc',
  'jest',
  'vitest',
  'mocha',
  'ava',
  'jasmine',
  'pytest',
  'ruff',
  'black',
  'flake8',
  'mypy',
  'isort',
  'tox',
  'nox',
  'biome',
  'oxlint',
  'stylelint',
  'webpack',
  'vite',
  'rollup',
  'esbuild',
  'parcel',
  'babel',
  'swc',
  'rspack',
  'turbo',
  'nx',
  'gulp',
  'grunt',
  'rake',
  'rspec',
  'phpunit',
  'ctest',
  'tsx',
  'cypress',
  'playwright',
  'storybook',
  'tidy',
  'shellcheck',
  'hadolint',
  'yamllint',
  'markdownlint',
  'htmlhint',
  'jsonlint',
  'tflint',
  'golangci-lint',
  // PowerShell: lecturas, listas y escrituras de contenido (alias incluidos).
  'get-childitem',
  'gci',
  'get-content',
  'gc',
  'select-string',
  'sls',
  'where-object',
  'where',
  'foreach-object',
  'foreach',
  'select-object',
  'select',
  'sort-object',
  'measure-object',
  'measure',
  'format-table',
  'ft',
  'format-list',
  'fl',
  'format-wide',
  'format-custom',
  'out-string',
  'out-host',
  'out-null',
  'out-default',
  'get-item',
  'gi',
  'get-itemproperty',
  'gp',
  'get-location',
  'gl',
  'test-path',
  'resolve-path',
  'join-path',
  'split-path',
  'convert-path',
  'get-date',
  'convertfrom-json',
  'convertto-json',
  'convertfrom-csv',
  'convertto-csv',
  'convertfrom-stringdata',
  'get-command',
  'gcm',
  'get-member',
  'gm',
  'group-object',
  'compare-object',
  'write-output',
  'write-host',
  'write-verbose',
  'write-information',
  'measure-command',
  'set-content',
  'add-content',
  'ac',
  'out-file',
  'clear-content',
  'export-csv',
  'export-clixml',
  'tee-object',
  'new-item',
  'ni',
  'copy-item',
  'cpi',
  'move-item',
  'mi',
  'rename-item',
  'rni',
  'select-xml',
  'get-random',
  'measure-object',
  'import-csv',
  'import-clixml',
  'get-help',
  'get-unique',
  'format-hex',
  // cmd de lectura.
  'findstr',
  'fc',
  'comp',
  'ver',
  'vol',
  'ren',
  'tasklist',
  'netstat',
  'start-sleep',
  'get-process',
  'get-filehash',
  'get-nettcpconnection',
  'sysctl'
])
const KEYWORDS = new Set([
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'do',
  'done',
  'while',
  'until',
  'for',
  'select',
  'case',
  'esac',
  'in',
  '!',
  'time',
  'elseif',
  'try',
  'catch',
  'finally',
  'coproc',
  'begin',
  'process',
  'end'
])
/** Operadores de PowerShell que quedan sueltos al cerrar un grupo (`(expr) -replace …`): son expresión, no un programa. */
const PS_OPERATOR =
  /^-(?:c|i)?(?:not)?(?:eq|ne|gt|ge|lt|le|like|match|replace|split|contains|in|is|isnot|band|bor|bxor|bnot|shl|shr|and|or|xor|join|f|as|ireplace|csplit)$/i
/** Cmdlets delicados; PowerShell también acepta prefijos únicos, así que se reconocen por prefijo. */
const CMDLETS = [
  'remove-item',
  'stop-process',
  'set-executionpolicy',
  'set-itemproperty',
  'new-itemproperty',
  'remove-itemproperty',
  'restart-computer',
  'stop-computer',
  'format-volume',
  'invoke-expression',
  'invoke-webrequest',
  'invoke-restmethod',
  'start-process',
  'set-content',
  'add-content',
  'out-file',
  'copy-item',
  'move-item',
  'rename-item',
  'new-item',
  'clear-content',
  'set-service',
  'new-service',
  'start-service',
  'stop-service',
  'restart-service',
  'remove-service'
]
function canonical(name: string): string {
  if (name.includes('-') && !CMDLETS.includes(name)) {
    // Ante un prefijo ambiguo (`Remove-It`) se toma el más corto: el más común y el que se quería decir.
    const matches = CMDLETS.filter((c) => c.startsWith(name) && name.length >= c.indexOf('-') + 3).sort((a, b) => a.length - b.length)
    if (matches.length) return matches[0]
  }
  return name
}

/** Argumentos que no son opciones (`-x`, `--x`, `/x` de cmd). `valued`: opciones que consumen el siguiente. */
function positional(args: Word[], valued: RegExp | null, cmdFlags = false): Word[] {
  const out: Word[] = []
  let rest = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i].text
    if (rest || (args[i].quoted && !a.startsWith('-')) || args[i].dynamic) {
      out.push(args[i])
      continue
    }
    if (a === '--') {
      rest = true
      continue
    }
    if (a.startsWith('-') && a !== '-') {
      if (valued && valued.test(a.toLowerCase()) && !a.includes('=')) i++
      continue
    }
    if (cmdFlags && /^\/[a-z?]{1,2}(?::\S*)?$/i.test(a)) continue
    out.push(args[i])
  }
  return out
}

function optionValues(args: Word[], names: RegExp): Word[] {
  const out: Word[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i].text
    const eq = /^(-{1,2}[\w-]+)[=:](.+)$/.exec(a)
    if (eq && names.test(eq[1].toLowerCase())) out.push({ ...args[i], text: eq[2] })
    else if (names.test(a.toLowerCase()) && args[i + 1]) out.push(args[++i])
  }
  return out
}

const hasFlag = (args: Word[], re: RegExp): boolean => args.some((a) => re.test(a.text))
const firstPositional = (args: Word[], n = 0): string => positional(args, null)[n]?.text.toLowerCase() ?? ''

/** Ejecuta un archivo: descargado en este mismo comando → hard; programa de fuera del proyecto y desconocido → doubt. */
function checkExecutable(raw: string, cwds: Cwds, ctx: Ctx): void {
  if (/^https?:\/\//i.test(raw)) return hard(ctx, 'ejecuta código descargado')
  const name = basename(raw)
  const bare = name.replace(/\.(?:ps1|sh|bash|py|js|mjs|cjs|rb|pl|php|msi|bat|cmd|exe)$/, '')
  if (ctx.downloads.has(name) || ctx.downloads.has(bare)) return hard(ctx, 'ejecuta un archivo recién descargado')
  // Un archivo que este mismo comando escribió y ahora ejecuta (`echo … > x.sh; sh x.sh`). G4.
  const written = ctx.written.get(name) ?? ctx.written.get(bare)
  if (written) {
    if (written.download) return hard(ctx, 'ejecuta un archivo recién descargado')
    if (written.content != null && ctx.depth < 5) return classifyInto(written.content, cwds, { ...ctx, depth: ctx.depth + 1 }, true)
    return doubt(ctx, 'ejecuta un archivo que acaba de crear')
  }
  if (!/[\\/]/.test(raw) && !raw.startsWith('~')) return
  for (const cwd of cwds) {
    const t = resolveTarget(raw, cwd, ctx)
    if (t.kind !== 'path') {
      doubt(ctx, 'ejecuta un programa de una ruta que no se conoce')
      continue
    }
    if (insideProject(t.path, ctx) || ctx.approved.some((d) => within(t.path, d))) continue
    const known =
      SCRIPTING.test(name) ||
      SHELLS.test(name) ||
      /^(?:git|npm|npx|pnpm|yarn|pip[\d.]*|uv|cargo|go|java|dotnet|make|cmake|code|open|xcrun|swift|rustc|gcc|clang|tsc)$/.test(name)
    const toolDir =
      /^\/(?:bin|sbin|usr|opt|applications|system|library\/(?:frameworks|developer))(?:\/|$)/i.test(t.path) ||
      /^[a-z]:\/(?:windows|program files|program files \(x86\)|programdata\/chocolatey)(?:\/|$)/.test(t.path) ||
      /\/(?:\.nvm|\.cargo\/bin|\.local\/bin|\.pyenv|\.bun\/bin|\.deno\/bin|\.volta|\.rbenv|\.sdkman|go\/bin|appdata\/local\/programs|scoop\/shims|\.dotnet)(?:\/|$)/i.test(
        t.path
      )
    if (!known && !toolDir) doubt(ctx, 'ejecuta un programa de fuera del proyecto')
  }
}

// ───────────────────────────── Código en línea (python -c, node -e, heredocs) ─────────────────────────────

function literalsOf(code: string): string[] {
  return [...code.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*?)\1/gs)].map((m) => m[2])
}

const INLINE_DELETE =
  /\b(?:os\.(?:remove|unlink|rmdir|removedirs)|shutil\.rmtree|send2trash|fs(?:\.promises)?\.(?:rm|rmdir|unlink)(?:Sync)?|rimraf|unlinkSync|rmSync|FileUtils\.rm\w*|File\.delete|Directory\.Delete|File\.Delete)\s*\(|\.(?:unlink|rmdir|rmtree)\s*\(|\bunlink\b|\brmtree\b/
const INLINE_SHELL =
  /\b(?:os\.(?:system|popen|exec\w*|spawn\w*)|subprocess|child_process|execSync|spawnSync|execFileSync|execa|Popen|pty\.spawn|Runtime\.getRuntime|shell_exec|passthru|proc_open)\b|\bsystem\s*\(|`[^`\n]+`|%x[({[!/]|\bqx[({[!/]|\b(?:exec|eval)\s*\(|\bexec\s+(?:["']|qw)/
const INLINE_WRITE =
  /\bopen\s*\([^,]*,\s*(?:mode\s*=\s*)?['"][^'"]*[wax+][^'"]*['"]|\.write_(?:text|bytes)\s*\(|\bfs(?:\.promises)?\.(?:writeFile|appendFile|createWriteStream|mkdir|copyFile|cp|rename|symlink|chmod|chown)\w*\s*\(|\b(?:writeFileSync|appendFileSync|mkdirSync|copyFileSync|cpSync|renameSync)\s*\(|\bos\.(?:makedirs|mkdir|rename|replace|symlink|chmod|chown)\s*\(|\bshutil\.(?:copy\w*|move)\s*\(|\.(?:mkdir|touch|symlink_to)\s*\(|::(?:WriteAll\w*|AppendAll\w*)\s*\(/

function analyzeInline(code: string, cwds: Cwds, ctx: Ctx): void {
  if (
    /https?:\/\/|\b(?:urlopen|fetch|urlretrieve|DownloadString|DownloadFile)\s*\(|\b(?:requests|https?|axios|urllib)\./i.test(code) &&
    /\b(?:exec|eval|compile|system|spawn|execSync|spawnSync|subprocess|child_process|Function|popen|Invoke-Expression|iex)\b/.test(code)
  )
    return hard(ctx, 'descarga y ejecuta código')
  const literals = literalsOf(code)
  // Un literal con nombre de credencial dentro de una lectura (`open('.env')`, `Get-Content ~/.ssh/id_rsa`). G5.
  if (
    /\bopen\s*\(|\.read(?:lines|_text|_bytes)?\s*\(|readFileSync|\breadFile\s*\(|File\.read|get-content|Get-Content|File\.ReadAll/i.test(
      code
    )
  )
    for (const l of literals) {
      const s = secretIn(l)
      if (s) return hard(ctx, `el script lee ${s}`)
    }
  const pathLiterals = literals.filter((l) => !/[\n<>]/.test(l) && !/^[a-z][\w+.-]*:\/\//i.test(l) && l.length <= 400)
  if (INLINE_DELETE.test(code)) {
    const wipes = pathLiterals.some(
      (l) =>
        /^(?:\/|~|[a-z]:[\\/]|\.\.?$)/i.test(l) &&
        cwds.some((cwd) => {
          const t = resolveTarget(l, cwd, ctx)
          return t.kind === 'path' && critical(globParent(t.path) ?? t.path, ctx)
        })
    )
    if (wipes) hard(ctx, 'el script borra la raíz, la carpeta personal o el proyecto')
    else doubt(ctx, 'el script borra archivos')
  }
  // Abrir una URL y además leer archivos o el entorno puede sacar datos (exfiltración por GET). I1.
  if (
    /https?:\/\/|\b(?:urlopen|urlretrieve|fetch|requests|axios|urllib|http\.client|Net::HTTP|net\/http|HttpClient|DownloadString)\b/i.test(
      code
    ) &&
    /\bopen\s*\(|\.read(?:lines|_text|_bytes)?\s*\(|readFileSync|process\.env\b|os\.environ\b|getenv|File\.read/i.test(code)
  )
    doubt(ctx, 'el script puede enviar datos por la red')
  // Volcado completo del entorno (`process.env`, `os.environ` sin una clave concreta). I3.
  if (/\bprocess\.env\b(?!\s*[.[])|\bos\.environ\b(?!\s*[.[]|\.get)|\bENV\.(?:to_h|inspect)|\bGetEnvironmentVariables\b/.test(code))
    doubt(ctx, 'muestra el entorno')
  if (/\b(?:os\.(?:kill|killpg)|process\.kill|Process\.Kill)\b/.test(code)) doubt(ctx, 'el script mata procesos')
  if (INLINE_SHELL.test(code)) {
    doubt(ctx, 'el script ejecuta otros comandos')
    // Mejor esfuerzo: las cadenas del script juntas suelen ser el comando (os.system('sudo reboot'), ['rm','-rf','/']).
    const inner = literals.filter((l) => !l.includes('\n')).join(' ')
    if (inner.trim() && ctx.depth < 4) classifyInto(inner, cwds, { ...ctx, depth: ctx.depth + 1 }, true)
  }
  if (
    /\b(?:requests\.(?:post|put|patch|delete)|smtplib|ftplib|paramiko|socket\.(?:socket|create_connection))\b|method\s*[:=]\s*['"](?:post|put|patch|delete)['"]/i.test(
      code
    )
  )
    doubt(ctx, 'el script envía datos por la red')
  if (!INLINE_WRITE.test(code)) return
  // Escribe en una ruta que depende de la carpeta personal o del entorno, sin un literal que se pueda situar. G7.
  if (/\b(?:expanduser|Path\.home|os\.environ|getenv|homedir|process\.env|ENV\[|Dir\.home)\b/.test(code))
    doubt(ctx, 'el script escribe en la carpeta personal')
  for (const l of pathLiterals) {
    if (!/[\\/]/.test(l) && !l.startsWith('~')) continue
    for (const cwd of cwds) {
      const t = resolveTarget(l, cwd, ctx)
      if (t.kind !== 'path') continue
      if (segmentsOf(t.path).includes('.git')) hard(ctx, 'el script escribe dentro de .git')
      else if (systemPath(t.path, ctx)) hard(ctx, 'el script escribe en una carpeta del sistema')
      else if (!insideProject(t.path, ctx) && !ctx.approved.some((d) => within(t.path, d)))
        doubt(ctx, 'el script escribe fuera del proyecto')
    }
  }
}

// ───────────────────────────── git y gestores de paquetes ─────────────────────────────

const READ_GIT = new Set([
  'status',
  'log',
  'diff',
  'show',
  'blame',
  'rev-parse',
  'ls-files',
  'ls-tree',
  'ls-remote',
  'describe',
  'shortlog',
  'grep',
  'cat-file',
  'show-ref',
  'for-each-ref',
  'name-rev',
  'merge-base',
  'count-objects',
  'fsck',
  'version',
  'help',
  'whatchanged',
  'rev-list',
  'var',
  'check-ignore',
  'check-attr'
])
const GIT_CONFIG_WRITE = /^(?:--add|--unset.*|--replace-all|--rename-section|--remove-section|-e|--edit)$/

/** Ronda 4: las opciones se reconocen antes de las ramas que podrían terminar en allow.
 * Los valores se consumen por separado: una opción citada o con `=` sigue siendo una opción.
 * `--` solo termina las opciones para los programas que lo admiten, nunca valida código.
 */
function strictOptions(args: Word[], flags: string, values: string, ctx: Ctx): void {
  const allowedFlags = new Set(flags.split(' '))
  const allowedValues = new Set(values.split(' '))
  for (let i = 0; i < args.length; i++) {
    const a = args[i].text
    if (a === '--') break
    if (!a.startsWith('-') || a === '-' || /^-\d+$/.test(a)) continue
    const key = a.split('=')[0]
    if (allowedValues.has(key)) {
      if (!a.includes('=') && !args[++i]) doubt(ctx, 'opción sin valor')
    } else if (!allowedFlags.has(key) || a.includes('=')) doubt(ctx, `opción no reconocida como segura: ${key}`)
  }
}

/** Configuración/código debe pertenecer al proyecto; las lecturas corrientes pueden salir de él. */
function checkProjectInput(raw: string, cwds: Cwds, ctx: Ctx): void {
  for (const cwd of cwds) {
    const t = resolveTarget(raw, cwd, ctx)
    if (t.kind !== 'path' || !insideProject(t.path, ctx)) doubt(ctx, 'carga código o configuración de fuera del proyecto')
  }
}

const DEV_TOOLS =
  /^(?:eslint|prettier|tsc|jest|vitest|mocha|ava|jasmine|pytest|ruff|black|flake8|mypy|isort|tox|nox|biome|oxlint|stylelint|webpack|vite|rollup|esbuild|parcel|babel|swc|rspack|turbo|nx|gulp|grunt|rake|rspec|phpunit|ctest|tsx|cypress|playwright|storybook|tidy|shellcheck|hadolint|yamllint|markdownlint|htmlhint|jsonlint|tflint|golangci-lint)$/
const CONFIG_OPTION =
  /^(?:--(?:config(?:-file)?|configuration|rcfile|rulesdir|plugin|plugins|loader|experimental-loader|experimental-policy|import|require|bootstrap|globalSetup|globalTeardown|setupFiles|setupFilesAfterEnv|filter|lua-filter|pdf-engine|defaults|template|reference-doc|resource-path|include-before-body|include-after-body|include-in-header|manifest-path|project|tsconfig|gulpfile|makefile|file|cwd|dir|directory|project-directory|package-path|init-script|init-file|rootDir|root-dir|prefix)|-(?:c|C|r|R|I|L|F|S|f|t|p))$/i
const OUTPUT_OPTION =
  /^(?:--(?:outdir|outfile|out-dir|out-file|output|output-file|outputfile|junitxml|log-file|report-file|reporter-output|destination|dest|target|output-dir|output-directory|output-path|declarationDir|declaration-dir|tsBuildInfoFile|cache-location|out|prefix)|-(?:o|out|output|outfile|filepath))$/i

/** Revisión de argumentos de TODAS las ramas, incluidas las que retornan antes de KNOWN_SAFE. */
function checkArguments(name: string, args: Word[], cwds: Cwds, ctx: Ctx): void {
  const dev = DEV_TOOLS.test(name)
  const codeTool =
    dev ||
    SCRIPTING.test(name) ||
    SHELLS.test(name) ||
    /^(?:npm|yarn|pnpm|make|gmake|go|cargo|pip[\d.]*|uv|swift|xcodebuild|gradle|mvn|bundle|flutter|dotnet|docker|podman)$/.test(name)
  for (let i = 0; i < args.length; i++) {
    const a = args[i].text
    // Las formas pegadas (-o../x, -C/tmp, -r/tmp) conservan el rol de la opción.
    if (/^-o.+/.test(a) && /^(?:pandoc|sort|xmllint|eslint|tsc|rollup|esbuild|go|base64|base32)$/.test(name))
      checkWrite(a.slice(2), cwds, ctx)
    if (codeTool && /^-[CfrI].+/.test(a)) checkProjectInput(a.slice(2), cwds, ctx)
    const eq = /^(-[^=]+)=(.*)$/s.exec(a)
    const key = eq?.[1] ?? a
    const val = eq?.[2] ?? args[i + 1]?.text
    if (val !== undefined && OUTPUT_OPTION.test(key)) checkWrite(val, cwds, ctx)
    // `-c` es patrón para grep/lectura para git, no configuración universal.
    if (
      val !== undefined &&
      CONFIG_OPTION.test(key) &&
      (key.startsWith('--') || codeTool || /^(?:pandoc|awk|gawk|nawk|mawk|sed|less)$/.test(name))
    ) {
      // Cargo --config acepta también código en línea; nunca se interpreta como nombre de archivo.
      if (name === 'cargo' && key === '--config') doubt(ctx, 'cargo con configuración en línea')
      if (/^\s*[{[]|[\r\n]/.test(val)) doubt(ctx, 'configuración en línea en vez de un archivo del proyecto')
      checkProjectInput(val, cwds, ctx)
    }
    if (codeTool && /^(?:~(?:[\\/]|$)|\.{1,2}[\\/]|[a-z]:[\\/]|\/)/i.test(a) && !a.startsWith('--')) {
      // Los argumentos que son código, configuración o directorios de trabajo no son lecturas arbitrarias.
      // La salida tiene su comprobación de escritura (y compatibilidad con aprobaciones del motor viejo).
      if (i === 0 || !OUTPUT_OPTION.test(args[i - 1].text.split('=')[0])) checkProjectInput(a, cwds, ctx)
    }
    if (
      /^(?:~|\/|[a-z]:[\\/]|\.{1,2}[\\/]|(?:\$\{?\w+\}?|%[^%]+%)[\\/])/i.test(a) &&
      !/^[a-z][\w+.-]*:\/\//i.test(a) &&
      !/^[A-Za-z_]\w*=/.test(a) &&
      hasDynamic(a) &&
      cwds.some((cwd) => hasDynamic(expandKnown(a, ctx, cwd)))
    )
      doubt(ctx, 'ruta que depende de una variable desconocida')
  }
  if (codeTool && args.some((a) => /^https?:\/\//i.test(a.text))) doubt(ctx, 'carga código de una URL')
  if (
    args.some((a) =>
      /^--(?:script-shell|toolexec|rsh-command|compress-program|pager|exec|execute|command|to-command|checkpoint-action|unzip-command)(?:=|$)/.test(
        a.text
      )
    )
  )
    doubt(ctx, 'una opción ejecuta otro programa')
  if (dev) {
    // También aquí una opción nueva cuesta una revisión: añadir un nombre al catálogo no abre toda su CLI.
    strictOptions(
      args,
      '--help -h --version -v --watch -w --check --write --fix --fix-only --noEmit --strict --pretty --json --verbose --quiet -q --silent --run --runInBand --coverage --no-coverage --passWithNoTests --bail --updateSnapshot -u --listTests --clearCache --no-cache --cache --no-error-on-unmatched-pattern --no-eslintrc --no-config-lookup --no-ignore --with-deps --headed --debug --emptyOutDir --build --force --color --no-color --no-pretty --dry-run --collect-only --exitfirst -x --disable-warnings --maxfail --no-header --no-summary -e -s -i --stats --diff --in-place --typecheck --no-fix --strictNullChecks --declaration --emitDeclarationOnly --sourceMap --incremental --composite --esModuleInterop --resolveJsonModule --skipLibCheck --allowJs --checkJs',
      '--config -c --rulesdir --plugin --plugins --loader --require -r --import --bootstrap --globalSetup --globalTeardown --setupFiles --setupFilesAfterEnv --project -p --tsconfig --gulpfile --file -f --output -o --outDir --outFile --out-dir --out-file --outputFile --output-file --outfile --outdir --junitxml --declarationDir --tsBuildInfoFile --cache-location --rootDir --module --moduleResolution --target --lib --jsx --types --port --host --mode --base --format --reporter --reporter-output --testNamePattern -t --testPathPattern --testPathPatterns --testTimeout --maxWorkers --workers --timeout --browser --grep -g --filter --match --include --exclude --ignore --ignore-path --line-length --print-width --tab-width --log-level --log-file --logfile --cov --cov-report --junit-xml --max-warnings --output-path --destination --dest --prefix --compiler-options -F -S -k -n -j -J',
      ctx
    )
    if (args.some((a) => /(?:^|[:/ -])(?:deploy|publish|release|migrate|destroy|db:drop)(?:[:/ -]|$)/i.test(a.text)))
      doubt(ctx, 'tarea de despliegue o que pierde trabajo')
    if (name === 'nx' && args.some((a) => a.text === 'exec')) doubt(ctx, 'nx ejecuta otro programa')
    if (/^(?:pytest)$/.test(name) && args.some((a) => /^-p/.test(a.text))) doubt(ctx, 'carga un complemento de pytest')
    if (args.some((a) => /^(?:--plugin|--require|-r)(?:=|$)/.test(a.text))) doubt(ctx, 'carga un complemento ejecutable')
    if (/^(?:black|isort)$/.test(name) || args.some((a) => /^(?:--write|--fix|--fix-only|-m)$/.test(a.text))) {
      for (const a of positional(args, /^(?:--config|-c|--plugin|--rulesdir|--cache-location|--reporter|-o)$/))
        checkWrite(a.text, cwds, ctx)
    }
    // Una extensión de código también es un argumento de ejecución aunque no lleve `/`.
    for (const a of args)
      if (/\.(?:[cm]?[jt]sx?|py|rb|php|cmake)$/i.test(a.text) && !a.text.startsWith('-')) checkProjectInput(a.text, cwds, ctx)
  }
  const launches = /^(?:rg|ag|ack)$/.test(name)
    ? /^(?:--pre|--pager)(?:=|$)/
    : /^(?:split|csplit)$/.test(name)
      ? /^--filter(?:=|$)/
      : name === 'diff'
        ? /^--diff-program(?:=|$)/
        : name === 'rsync'
          ? /^(?:-e|--rsh|--rsync-path)(?:=|$)/
          : null
  if (launches && args.some((a) => launches.test(a.text))) doubt(ctx, 'la utilidad ejecuta otro programa')
  // Utilidades de permisos/configuración con muchas formas de mutación: solo lectura conocida sin revisión.
  if (/^(?:setfacl|icacls|takeown|chflags)$/.test(name)) doubt(ctx, 'cambia permisos o atributos del sistema')
  if (name === 'ulimit' && args.some((a) => !/^(?:-[a-zA-Z]+)$/.test(a.text))) doubt(ctx, 'cambia límites de recursos')
  if (name === 'xattr' && args.some((a) => /^-[a-z]*[wdc]/i.test(a.text))) {
    for (const a of positional(args, /^(?:-w|-p)$/).slice(1)) checkWrite(a.text, cwds, ctx)
  }
  if (name === 'sysctl' && !args.every((a) => /^-n$|^-a$|^[\w.]+$/.test(a.text))) doubt(ctx, 'modifica parámetros del sistema')
  if (name === 'install' && args.some((a) => /^-(?:[a-zA-Z]*d)|^--directory/.test(a.text)))
    for (const a of positional(args, /^(?:-m|--mode|-o|--owner|-g|--group)$/)) checkWrite(a.text, cwds, ctx)
  const write = (xs: Word[]): void => xs.forEach((a) => checkWrite(a.text, cwds, ctx))
  const pos = positional(args, /^(?:-b|-l|-n|--bytes|--lines|--number|--output|-o|--encoding)$/)
  if (/^(?:uniq|pdftotext|xxd|split)$/.test(name)) write(pos.slice(1))
  if (name === 'patch') {
    write(pos)
    for (const a of optionValues(args, /^(?:-d|--directory|-o|--output)$/)) checkWrite(a.text, cwds, ctx)
  }
  if (name === 'mktemp') write(pos)
  if (name === 'mktemp') {
    if (!pos.length || args.some((a) => /^(?:-t|-p|--tmpdir)(?:=|$)/.test(a.text)))
      doubt(ctx, 'crea un archivo temporal fuera del proyecto')
  }
  if (name === 'link') write(pos.slice(1))
  if (/^(?:jq|yq)$/.test(name)) {
    for (const a of optionValues(args, /^(?:-f|--from-file|-L|--library-path)$/)) checkProjectInput(a.text, cwds, ctx)
    for (const a of args) if (/^-[fL].+/.test(a.text)) checkProjectInput(a.text.slice(2), cwds, ctx)
  }
  if (name === 'patch') for (const a of optionValues(args, /^(?:-i|--input)$/)) checkProjectInput(a.text, cwds, ctx)
  if (name === 'xmllint' && args.some((a) => /^--shell$/.test(a.text))) doubt(ctx, 'interpreta órdenes XML de la entrada')
  if (name === 'zip') write(pos.slice(0, 1))
  if (name === 'zip') for (const a of optionValues(args, /^(?:-b|--temp-path|--out)$/)) checkWrite(a.text, cwds, ctx)
  if (/^(?:7z|7za)$/.test(name)) {
    const action = pos[0]?.text ?? ''
    if (!/^(?:a|u|x|e|l|t)$/.test(action)) doubt(ctx, 'acción de archivado no reconocida o destructiva')
    if (/^(?:a|u|d|r)$/.test(action)) write(pos.slice(1, 2))
  }
  if (name === 'yq' && args.some((a) => /^-\w*i|^--inplace/.test(a.text))) write(pos.slice(1))
  if (/^(?:gzip|bzip2|xz|zstd|compress|gunzip|bunzip2|unxz)$/.test(name) && !args.some((a) => /^(?:-c|--stdout|-dc|-cd)$/.test(a.text)))
    write(pos)
  if (/^(?:man|less|more|most)$/.test(name)) doubt(ctx, 'paginador interactivo')
  if (name === 'bat' && args.some((a) => /^--(?:pager|paging|map-syntax|config-file)(?:=|$)/.test(a.text)))
    doubt(ctx, 'paginador configurable')
  if (
    /^(?:awk|gawk|nawk|mawk)$/.test(name) &&
    args.some((a) => /\||\b(?:system|getline)\b|@(?:load|include)|^-[fliE]|^--(?:file|source|load|include)(?:=|$)/.test(a.text))
  )
    doubt(ctx, 'awk carga o ejecuta código')
  if (/^(?:awk|gawk|nawk|mawk)$/.test(name) && args.some((a) => />/.test(a.text))) doubt(ctx, 'awk escribe un destino calculado')
  if (name === 'sed' && args.some((a) => /^-f|^--file/.test(a.text))) doubt(ctx, 'sed carga un guion')
  if (name === 'sed' && args.some((a) => /(?:^|[;/}\n])\s*(?:\d+)?[ew](?:\s|$)|\/[a-z\d]*[ew](?:\s|$)/i.test(a.text)))
    doubt(ctx, 'sed ejecuta o escribe desde su guion')
  if (name === 'pandoc' && args.some((a) => /^(?:-F|--(?:filter|lua-filter|pdf-engine))(?:=|.|$)/.test(a.text)))
    doubt(ctx, 'pandoc ejecuta filtros')
  if (/^(?:tar|bsdtar)$/.test(name) && args.some((a) => /^--(?:absolute-names|remove-files|rsh-command)|^-?[a-zA-Z]*P/.test(a.text)))
    doubt(ctx, 'tar usa rutas absolutas, borra o ejecuta')
  if (/^(?:tar|bsdtar)$/.test(name) && args.some((a) => /^--(?:transform|xform|strip-components)|^-s.+/.test(a.text)))
    doubt(ctx, 'transforma los destinos de extracción')
  if (/^7z/.test(name) && args.some((a) => /^-spf/.test(a.text))) doubt(ctx, 'extrae con rutas absolutas')
  if (name === 'unzip' && args.some((a) => a.text === '-:')) doubt(ctx, 'permite salir de la carpeta al extraer')
  if (name === 'zip' && args.some((a) => /^-[a-zA-Z]*m|^--move/.test(a.text))) doubt(ctx, 'zip borra los originales')
  if (/^7z/.test(name) && args.some((a) => /^-sdel/.test(a.text))) doubt(ctx, 'borra los originales del archivo')
  if (name === 'fc' && ctx.escapes) doubt(ctx, 'repite órdenes del historial')
  if (name === 'hostname' && args.length) doubt(ctx, 'cambia el nombre del equipo')
  if (name === 'date' && args.some((a) => !/^\+|^-u$|^-I/.test(a.text))) doubt(ctx, 'puede cambiar la fecha del equipo')
  if (name === 'chmod' && args.some((a) => /[ugoa]*[+=].*s|^[2467][0-7]{3}$/.test(a.text))) doubt(ctx, 'añade permisos especiales')
  if (name === 'jq' && args.some((a) => /\benv\b/.test(a.text))) doubt(ctx, 'muestra el entorno')
  if (name === 'ps' && args.some((a) => /^-?[a-zA-Z]*e[a-zA-Z]*$/.test(a.text))) doubt(ctx, 'puede mostrar variables del entorno')
  if (/^(?:foreach-object|foreach|%)$/.test(name) && args.some((a) => /^(?:delete|remove|moveto|kill|stop|clear|dispose)$/i.test(a.text)))
    doubt(ctx, 'llama un método que modifica objetos')
  if (/^(?:get-itemproperty|gp)$/.test(name) && args.some((a) => /(?:HKLM|HKEY_LOCAL_MACHINE):[\\/]+(?:SAM|SECURITY)/i.test(a.text)))
    hard(ctx, 'lee credenciales del registro')
}

/** Los programas con gramática propia tampoco aprueban subcomandos u opciones desconocidos. */
function strictProgram(name: string, args: Word[], cwds: Cwds, ctx: Ctx): void {
  const sub = firstPositional(args)
  if (/^(?:npm|cnpm|pnpm|yarn|bun)$/.test(name)) {
    const pos = positional(args, /^(?:--prefix|--cwd|--dir|-C|--filter|-w|--workspace)$/)
    const action = pos[0]?.text ?? ''
    if (
      !/^(?:install|i|ci|add|remove|uninstall|update|upgrade|test|t|run|run-script|start|dev|build|lint|list|ls|outdated|view|info|explain|why|dedupe|prune|audit|help|version|exec|x|config|pkg|cache|link|rebuild|node)$/.test(
        action
      ) &&
      action
    )
      doubt(ctx, 'subcomando de paquetes no reconocido')
    // Los argumentos tras -- son opciones del guion del proyecto, no del gestor.
    strictOptions(
      args,
      '--version -v --help -h --silent --save --save-dev -D -S --no-save --package-lock-only --ignore-scripts --legacy-peer-deps --frozen-lockfile --offline --prefer-offline --json --all --fix --production',
      '--prefix --cwd --dir -C --filter -w --workspace --registry --cache --reporter',
      ctx
    )
    if (action === 'node')
      analyzeWords(pos.slice(1).length ? [{ text: 'node', quoted: false, dynamic: false }, ...pos.slice(1)] : [], cwds, ctx)
    if (/^(?:x|exec)$/.test(action)) doubt(ctx, 'ejecuta un paquete o una orden')
    if (action === 'config') doubt(ctx, 'accede a configuración del registro')
    if (action === 'pkg' && !/^(?:get)$/.test(pos[1]?.text ?? '')) doubt(ctx, 'modifica configuración de paquetes')
  } else if (/^(?:make|gmake)$/.test(name)) {
    strictOptions(
      args,
      '--help --version -n --dry-run -s --silent -B --always-make -k --keep-going',
      '-C --directory -f --file --makefile -j --jobs',
      ctx
    )
    if (args.some((a) => a.text.includes('=') || /^--eval/.test(a.text))) doubt(ctx, 'make con variables o código en línea')
    for (const a of positional(args, /^(?:-C|--directory|-f|--file|--makefile|-j|--jobs)$/))
      if (!/^(?:all|build|test|check|lint|format|fmt|dev|run|clean|help)$/.test(a.text)) doubt(ctx, 'objetivo de make no reconocido')
  } else if (name === 'go') {
    if (!/^(?:build|test|run|fmt|vet|list|version|help|env|mod|work|generate)$/.test(sub)) doubt(ctx, 'subcomando de go no reconocido')
    if (/^(?:generate|env|work)$/.test(sub) && args.length > 1) doubt(ctx, 'go puede ejecutar o cambiar configuración')
    if (sub === 'mod' && !/^(?:download|tidy|verify|graph|why)$/.test(firstPositional(args, 1))) doubt(ctx, 'go mod no reconocido')
    strictOptions(
      args,
      '-v -race -short -json -n -x -modcacherw -cover -work --help',
      '-o -p -tags -mod -modfile -overlay -run -count -timeout -coverprofile -cpuprofile -memprofile -bench -benchtime',
      ctx
    )
    if (sub === 'run' && args.some((a) => /@|^[\w.-]+\.[a-z]+\//i.test(a.text))) doubt(ctx, 'go run carga código remoto')
    for (const a of optionValues(args, /^(?:-modfile|-overlay)$/)) checkProjectInput(a.text, cwds, ctx)
    for (const a of optionValues(args, /^(?:-coverprofile|-cpuprofile|-memprofile)$/)) checkWrite(a.text, cwds, ctx)
  } else if (name === 'cargo') {
    if (!/^(?:build|test|run|check|fmt|clippy|doc|tree|metadata|version|help|fetch|update|generate-lockfile|bench|clean)$/.test(sub))
      doubt(ctx, 'subcomando de cargo no reconocido')
    strictOptions(
      args,
      '--version -V --help -h --release --locked --frozen --offline --all --all-targets --all-features --no-default-features --workspace -q --quiet -v --verbose --no-deps',
      '--manifest-path --target-dir --target --features -p --package -j --jobs --bin --example --test --profile',
      ctx
    )
    for (const a of optionValues(args, /^--target-dir$/)) checkWrite(a.text, cwds, ctx)
  } else if (/^pip[\d.]*$/.test(name)) {
    if (!/^(?:install|list|show|freeze|check|download|wheel|help|index)$/.test(sub) && sub) doubt(ctx, 'subcomando de pip no reconocido')
    strictOptions(
      args,
      '--version --help -h --no-deps --upgrade -U --pre --quiet -q --verbose -v --disable-pip-version-check --no-cache-dir',
      '-r --requirement -c --constraint -t --target --prefix --root --src -d --dest -w --wheel-dir',
      ctx
    )
    for (const a of args)
      if (/^(?:https?:|git\+|--index-url|--extra-index-url|--trusted-host|--find-links)/.test(a.text))
        doubt(ctx, 'pip usa una fuente de código alternativa')
    for (const a of optionValues(args, /^(?:-r|--requirement|-c|--constraint)$/)) checkProjectInput(a.text, cwds, ctx)
    for (const a of optionValues(args, /^(?:-d|--dest|-w|--wheel-dir)$/)) checkWrite(a.text, cwds, ctx)
  } else if (name === 'uv') {
    if (sub === 'pip') strictProgram('pip', args.slice(1), cwds, ctx)
    else if (!/^(?:sync|lock|tree|version|help)$/.test(sub)) doubt(ctx, 'subcomando de uv requiere revisión')
    strictOptions(args, '--help --version --locked --frozen --offline --no-dev', '--project --directory', ctx)
  } else if (/^(?:docker|podman)$/.test(name)) {
    if (!/^(?:ps|images|logs|inspect|stats|version|info|help|build|compose)$/.test(sub))
      doubt(ctx, 'subcomando de contenedores requiere revisión')
    strictOptions(
      args,
      '--help --version -a --all -q --quiet --no-cache --pull --rm --no-stream --tail',
      '-t --tag -f --file --format --since --until --progress --target --build-arg',
      ctx
    )
    if (
      sub === 'compose' &&
      !/^(?:ps|logs|build|config|version|ls)$/.test(
        positional(args, /^(?:-f|--file|--project-directory|-p|--project-name)$/)[1]?.text ?? ''
      )
    )
      doubt(ctx, 'acción de compose requiere revisión')
  } else if (/^(?:swift|dotnet|flutter|gradle|mvn|bundle|xcodebuild)$/.test(name)) {
    const safe =
      name === 'swift'
        ? /^(?:build|test|run|package|--version)$/
        : name === 'dotnet'
          ? /^(?:build|test|run|restore|format|list|--version)$/
          : name === 'flutter'
            ? /^(?:test|run|build|analyze|format|--version)$/
            : name === 'bundle'
              ? /^exec$/
              : name === 'gradle'
                ? /^(?:build|test|check|assemble|clean|classes|tasks|help)$/
                : name === 'mvn'
                  ? /^(?:test|compile|package|verify|validate|clean|test-compile)$/
                  : /^(?:build|test|clean|analyze|archive)$/
    const pos = positional(
      args,
      /^(?:-scheme|-project|-workspace|-configuration|-destination|-sdk|-derivedDataPath|-archivePath|--package-path|--scratch-path|-c|--configuration|--project|--output|-o|-f|--file)$/
    )
    if (name !== 'xcodebuild' && !safe.test(sub)) doubt(ctx, 'acción de compilación no reconocida')
    if (name === 'xcodebuild' && pos.some((a) => !safe.test(a.text))) doubt(ctx, 'acción de xcodebuild requiere revisión')
    if (/^(?:gradle|mvn)$/.test(name) && pos.some((a) => !safe.test(a.text))) doubt(ctx, 'tarea de compilación no reconocida')
    if (name === 'bundle' && !/^(?:rspec|rake)$/.test(pos[1]?.text ?? '')) doubt(ctx, 'bundle ejecuta otra orden')
    if (name === 'bundle') analyzeWords(args.slice(1), cwds, ctx)
    strictOptions(
      args,
      '--version --help -h --release --debug --no-restore --no-build --offline --quiet -q -v --verbose',
      '-c --configuration --project --output -o --package-path --scratch-path -scheme -project -workspace -configuration -destination -sdk -derivedDataPath -archivePath -f --file',
      ctx
    )
    for (const a of optionValues(args, /^(?:--project|--package-path|-project|-workspace|-f|--file)$/)) checkProjectInput(a.text, cwds, ctx)
    for (const a of optionValues(args, /^(?:--scratch-path|-deriveddatapath|-archivepath)$/i)) checkWrite(a.text, cwds, ctx)
  }
}

function analyzeGit(args: Word[], cwds: Cwds, ctx: Ctx): void {
  const unsafe = args.some(
    (a) =>
      /^(?:--(?:exec|upload-pack|receive-pack|open-files-in-pager|ext-diff|textconv|tool|prefix|directory|remote|unsafe-paths|config|exec-path|config-env)|-O|-c)(?:=|$)/.test(
        a.text
      ) || /^-O.+|^(?:ext|fd)::/.test(a.text)
  )
  if (unsafe) doubt(ctx, 'git ejecuta código o usa configuración o transporte alternativo')
  if (args.some((a) => a.dynamic && /https?:|ssh:|\u0001/.test(a.text))) doubt(ctx, 'git puede enviar datos a un remoto dinámico')
  strictOptions(
    args,
    '--version --help -h --no-pager --paginate -p --bare --no-optional-locks --oneline --stat --shortstat --numstat --name-only --name-status --cached --staged -S --worktree -W --check --quiet -q --verbose -v --all -a --porcelain --short -s --branch -b --show-toplevel --abbrev-ref --verify --is-inside-work-tree --show-current --decorate --graph --no-color --color --no-ext-diff --no-textconv --exit-code -z --null -n --count --reverse --date-order --topo-order --first-parent --follow --no-merges --no-commit --no-edit --continue --abort --skip --ff-only --no-ff --ff --squash --rebase --prune --tags --dry-run --get --get-all --get-regexp --list -l --global --local --system --show-origin --show-scope --force -f -d -D -M --delete --hard --soft --mixed --amend --allow-empty --check --recurse-submodules',
    '-C -c -m --message -b -B --format --pretty --max-count --since --until --author --grep --date --output -o --depth --branch --origin --filter --pathspec-from-file --file --default --type --set-upstream-to',
    ctx
  )
  const list = [...args]
  let gitCwds = cwds
  while (list.length && list[0].text.startsWith('-')) {
    const a = list.shift()!.text
    if (a === '-C') {
      const dir = list.shift()?.text ?? ''
      gitCwds = gitCwds.map((cwd) => {
        const t = resolveTarget(dir, cwd, ctx)
        return t.kind === 'path' ? t.path : null
      })
    } else if (a === '-c' || /^--(?:exec-path|upload-pack|receive-pack|config-env)/.test(a)) {
      if (a === '-c') list.shift()
      doubt(ctx, 'git con configuración en línea')
    } else if (/^--(?:git-dir|work-tree|namespace)$/.test(a)) {
      list.shift()
      doubt(ctx, 'git sobre otro repositorio')
    } else if (/^--(?:git-dir|work-tree)=/.test(a)) doubt(ctx, 'git sobre otro repositorio')
  }
  const sub = list.shift()?.text.toLowerCase() ?? ''
  const rest = list
  const flag = (re: RegExp): boolean => hasFlag(rest, re)
  // `git show HEAD:.env`, `git cat-file -p :.env`: leer un secreto guardado en el repositorio. G5.
  if (rest.some((w) => w.text.includes(':') && secretIn(w.text.split(':').pop() ?? '', false)))
    return hard(ctx, 'lee un secreto del repositorio')
  // `--output`/`-o` escribe un archivo: se revisa aun en subcomandos de lectura (`git log --output=~/.zshrc`). G7.
  for (const out of optionValues(rest, /^(?:-o|--output)$/)) checkWrite(out.text, gitCwds, ctx)
  const known = new Set([
    ...READ_GIT,
    'add',
    'commit',
    'fetch',
    'pull',
    'merge',
    'am',
    'apply',
    'cherry-pick',
    'revert',
    'push',
    'reset',
    'clean',
    'restore',
    'checkout',
    'switch',
    'stash',
    'branch',
    'tag',
    'rebase',
    'gc',
    'prune',
    'filter-branch',
    'filter-repo',
    'rm',
    'reflog',
    'worktree',
    'submodule',
    'remote',
    'config',
    'bundle',
    'init',
    'clone',
    'credential',
    'credential-store',
    'credential-cache'
  ])
  if (!known.has(sub) && sub) doubt(ctx, 'subcomando o alias de git no reconocido')
  if (sub === 'submodule' && !/^(?:status|summary)$/.test(rest[0]?.text ?? 'status'))
    doubt(ctx, 'git submodule ejecuta o modifica submódulos')
  if (sub === 'worktree' && !/^(?:list)$/.test(rest[0]?.text ?? '')) doubt(ctx, 'git worktree cambia carpetas')
  if (sub === 'stash' && !/^(?:list|show|push|save|apply|pop)$/.test(rest[0]?.text ?? 'list'))
    doubt(ctx, 'subcomando de stash no reconocido')
  if (sub === 'remote' && !/^(?:|show|get-url)$/.test(rest[0]?.text.startsWith('-') ? '' : (rest[0]?.text ?? '')))
    doubt(ctx, 'acción de remote requiere revisión')
  if (sub === 'bundle' && !/^(?:create|verify|list-heads)$/.test(rest[0]?.text ?? '')) doubt(ctx, 'acción de bundle no reconocida')
  if (sub === 'reflog' && !/^(?:|show|exists)$/.test(rest[0]?.text ?? '')) doubt(ctx, 'acción de reflog no reconocida')
  if (sub === 'apply') for (const a of positional(rest, null)) checkProjectInput(a.text, gitCwds, ctx)
  if (READ_GIT.has(sub)) return
  if (gitCwds.some((cwd) => !cwd || !insideProject(cwd, ctx)) && !['clone', 'fetch', 'init'].includes(sub))
    doubt(ctx, 'git en otra carpeta')
  const first = rest[0]?.text ?? ''
  switch (sub) {
    case 'push':
      return doubt(
        ctx,
        flag(/^(?:-f|--force.*|--delete|-d|--mirror|--prune)$/) || rest.some((w) => /^\+|^:/.test(w.text))
          ? 'git push forzado o que borra'
          : 'git push'
      )
    case 'reset':
      return doubt(ctx, 'git reset')
    case 'clean':
      return doubt(ctx, 'git clean borra archivos')
    case 'restore':
      if (flag(/^(?:--staged|-S)$/) && !flag(/^(?:--worktree|-W)$/)) return
      return doubt(ctx, 'git restore descarta cambios')
    case 'checkout':
      if (rest.some((w) => w.text === '--' || w.text === '.') || flag(/^(?:-f|--force|-p|--patch)$/))
        doubt(ctx, 'git checkout descarta cambios')
      return
    case 'switch':
      if (flag(/^(?:-f|--force|--discard-changes)$/)) doubt(ctx, 'git switch descarta cambios')
      return
    case 'stash':
      if (/^(?:drop|clear)$/.test(first)) doubt(ctx, 'git stash borra cambios guardados')
      return
    case 'branch':
    case 'tag':
      if (flag(/^(?:-d|-D|--delete|-f|--force|-m|-M|--move)$/)) doubt(ctx, `git ${sub} borra o reemplaza`)
      return
    case 'rebase':
      if (flag(/^(?:-x|--exec.*)$/)) doubt(ctx, 'git rebase --exec')
      return
    case 'gc':
      if (flag(/^--prune/)) doubt(ctx, 'git gc --prune')
      return
    case 'prune':
    case 'filter-branch':
    case 'filter-repo':
    case 'rm':
      return doubt(ctx, `git ${sub}`)
    case 'reflog':
      if (/^(?:expire|delete)$/.test(first)) doubt(ctx, 'git reflog borra historial')
      return
    case 'update-ref':
      if (flag(/^-d$/)) doubt(ctx, 'git update-ref -d')
      return
    case 'worktree':
      if (/^(?:remove|prune)$/.test(first)) doubt(ctx, 'git worktree borra')
      return
    case 'submodule':
      if (first === 'deinit') doubt(ctx, 'git submodule deinit')
      return
    case 'remote':
      if (/^(?:add|set-url|remove|rm|rename|set-head|prune)$/.test(first)) doubt(ctx, 'git remote cambia remotos')
      return
    case 'difftool':
    case 'mergetool':
      if (flag(/^(?:-x|--extcmd)$/) || rest.some((w) => /^--extcmd=/.test(w.text) || /^-[tx]/.test(w.text)))
        doubt(ctx, 'git difftool con un comando externo')
      return
    case 'credential':
    case 'credential-store':
    case 'credential-cache':
      return hard(ctx, 'credenciales de git')
    case 'config': {
      if (rest.some((w) => /credential|token|password/i.test(w.text))) return hard(ctx, 'credenciales de git')
      const keys = positional(rest, /^(?:--file|-f|--blob|--type|--default)$/)
      const read = flag(/^(?:--get.*|--list|-l|--show-origin|--show-scope|--name-only|-z|--null)$/) || keys.length === 1
      if (read && !flag(GIT_CONFIG_WRITE)) return
      // Claves que hacen que git ejecute un programa (hooks, editor, filtros, alias, insteadOf…): siempre tarjeta.
      if (
        /^(?:core\.(?:hookspath|fsmonitor|sshcommand|editor|pager|gitproxy|askpass)|sequence\.editor|diff\.external|.*\.textconv|filter\..+|credential\..*|url\..*\.insteadof|alias\..+|uploadpack\..+|receivepack\..+|.*\.command)$/i.test(
          keys[0]?.text ?? ''
        )
      )
        return hard(ctx, 'git config que ejecuta programas')
      if (flag(/^(?:--global|--system|--file|-f)$/)) return doubt(ctx, 'git config fuera del proyecto')
      // Escribir la configuración local corriente (`user.email`, `color.ui`…) es habitual: lo revisa la IA. M1.
      return doubt(ctx, 'git config del proyecto')
    }
    case 'bundle':
      // `git bundle create <archivo>` escribe ese archivo.
      if (first === 'create' && rest[1]) checkWrite(rest[1].text, gitCwds, ctx)
      return
    case 'init':
      // `git init <ruta>` crea un repo en esa ruta (si la nombra).
      for (const p of positional(rest, /^(?:-b|--initial-branch|--template|--separate-git-dir|--object-format)$/))
        checkWrite(p.text, gitCwds, ctx)
      return
    case 'clone': {
      if (flag(/^(?:-c|--config|-u|--upload-pack|--template)$/)) doubt(ctx, 'git clone con configuración')
      const pos = positional(
        rest,
        /^(?:-b|--branch|-o|--origin|--depth|--reference|-c|--config|--template|-u|--upload-pack|--separate-git-dir|--filter|-j|--jobs)$/
      )
      checkWrite(pos[1]?.text ?? '.', gitCwds, ctx)
      return
    }
  }
}

function analyzePackageManager(name: string, args: Word[], cwds: Cwds, ctx: Ctx): void {
  // Si este mismo comando escribió `package.json`, un `npm test`/`run` ejecuta un guion que acaba de ponerse. R4.
  if (ctx.written.has('package.json')) doubt(ctx, 'ejecuta un guion de un package.json recién escrito')
  const pos = positional(args, /^(?:--prefix|-c|--cwd|--dir|-C|--filter|-w|--workspace)$/)
  const sub = pos[0]?.text.toLowerCase() ?? ''
  if (hasFlag(args, /^(?:-g|--global|--location=global|--location=user)$/)) doubt(ctx, 'instala o cambia algo fuera del proyecto')
  if (/^(?:publish|unpublish|deprecate|dist-tag|owner|access|adduser|login|logout|team|org|star|unstar|hook)$/.test(sub))
    return doubt(ctx, 'publica o cambia el registro de paquetes')
  if (sub === 'token') return hard(ctx, 'credenciales del registro de paquetes')
  // `npm run deploy|publish|release|migrate`: guion del proyecto que despliega o pierde trabajo. I2.
  if (
    /^(?:run|run-script)$/.test(sub) &&
    /(?:^|[:-])(?:deploy|publish|release|migrate|reset|prod|destroy)(?:[:-]|$)/i.test(pos[1]?.text ?? '')
  )
    doubt(ctx, 'guion de despliegue o publicación')
  if (sub === 'pkg' && /^(?:set|delete)$/.test(pos[1]?.text ?? '')) doubt(ctx, 'cambia package.json (puede añadir un guion)')
  if (/^(?:config|c)$/.test(sub) && /^(?:set|delete|rm|edit)$/.test(pos[1]?.text ?? '')) return doubt(ctx, 'cambia la configuración de npm')
  if (sub === 'link' && !pos[1]) doubt(ctx, 'npm link instala fuera del proyecto')
  // `yarn deploy`, `pnpm deploy`, `bun run deploy`: atajo de guion que despliega o pierde trabajo. I2/R6.
  if (/^(?:yarn|pnpm|bun)$/.test(name) && /(?:^|[:-])(?:deploy|publish|release|migrate|reset|prod|destroy)(?:[:-]|$)/i.test(sub))
    doubt(ctx, 'guion de despliegue o publicación')
  if ((name === 'npm' && /^(?:exec|x)$/.test(sub)) || (/^(?:pnpm|yarn|bun)$/.test(name) && /^(?:dlx|x|exec)$/.test(sub))) {
    const after = args.slice(args.indexOf(pos[0]) + 1)
    // `npm exec -c '…'` también ejecuta texto. R2.
    for (const call of optionValues(after, /^(?:-c|--call)$/)) classifyInto(call.text, cwds, { ...ctx, depth: ctx.depth + 1 })
    const inner = positional(after, /^(?:-p|--package|-c|--call)$/)
    if (inner.length) analyzeWords(after.slice(after.indexOf(inner[0])), cwds, ctx)
  }
}

function analyzePip(args: Word[], cwds: Cwds, ctx: Ctx): void {
  const sub = firstPositional(args)
  if (hasFlag(args, /^(?:--user|--system|--break-system-packages)$/)) return doubt(ctx, 'instala fuera del proyecto')
  for (const dir of optionValues(args, /^(?:-t|--target|--prefix|--root|--src)$/)) checkWrite(dir.text, cwds, ctx)
  for (const glued of args.filter((a) => /^-t.+/.test(a.text))) checkWrite(glued.text.slice(2), cwds, ctx)
  if (sub === 'uninstall') return doubt(ctx, 'desinstala paquetes')
  if (sub === 'config' && /^(?:set|unset|edit)$/.test(firstPositional(args, 1))) return doubt(ctx, 'cambia la configuración de pip')
}

function analyzeFind(args: Word[], cwds: Cwds, ctx: Ctx): void {
  const starts: string[] = []
  let i = 0
  while (i < args.length && !/^[-(!]/.test(args[i].text)) starts.push(args[i++].text)
  const expr = args.slice(i)
  const filtered = expr.some((a) =>
    /^-(?:name|iname|path|ipath|regex|iregex|type|mtime|mmin|newer|size|user|perm|empty|wholename)$/.test(a.text)
  )
  if (expr.some((a) => a.text === '-delete')) {
    for (const r of starts.length ? starts : ['.'])
      for (const cwd of cwds) {
        const t = resolveTarget(r, cwd, ctx)
        if (t.kind === 'path' && critical(t.path, ctx) && (!filtered || segmentsOf(t.path).length <= 1 || within(ctx.home, t.path)))
          hard(ctx, 'find -delete sobre la raíz, la carpeta personal o el proyecto')
      }
    doubt(ctx, 'find borra archivos')
  }
  for (let j = 0; j < expr.length; j++) {
    const a = expr[j].text
    if (/^-(?:exec|execdir|ok|okdir)$/.test(a)) {
      const inner: Word[] = []
      for (j++; j < expr.length && expr[j].text !== ';' && expr[j].text !== '+'; j++) inner.push(expr[j])
      if (!inner.length) continue
      const prog = canonical(basename(inner[0].text))
      if (DELETE.has(prog)) doubt(ctx, 'find borra lo que encuentra')
      else if (KILL.has(prog)) doubt(ctx, 'find mata procesos')
      else
        analyzeWords(
          inner.map((w) => (w.text.includes('{}') ? { ...w, text: w.text.replace(/\{\}/g, '$f'), dynamic: true } : w)),
          cwds,
          ctx
        )
    }
    if (/^-(?:fprint|fprint0|fprintf|fls)$/.test(a) && expr[j + 1]) checkWrite(expr[j + 1].text, cwds, ctx)
  }
}

// ───────────────────────────── Escrituras ─────────────────────────────

const CONTENT_CMDLETS = /^(?:set-content|add-content|ac|out-file|clear-content|clc|export-csv|export-clixml|tee-object|sc)$/

/** Copiar o mover un archivo escrito/descargado por este comando, o traído de fuera del proyecto, pasa la marca al destino. R4. */
function propagateMark(sources: Word[], dests: Word[], cwds: Cwds, ctx: Ctx): void {
  for (const d of dests) {
    const destBase = basename(d.text)
    if (!destBase || /^(?:\.|\.\.)$/.test(d.text)) continue
    for (const s of sources) {
      const sBase = basename(s.text)
      const mark = ctx.written.get(sBase) ?? (ctx.downloads.has(sBase) ? { download: true, content: null } : undefined)
      if (mark) {
        ctx.written.set(destBase, { download: mark.download, content: mark.content ?? null })
        continue
      }
      // Copiar algo de fuera del proyecto y luego ejecutarlo es arriesgado: se marca el destino para revisarlo.
      if (
        cwds.some((cwd) => {
          const t = resolveTarget(s.text, cwd, ctx)
          return t.kind === 'path' && !insideProject(t.path, ctx)
        })
      )
        ctx.written.set(destBase, { download: false, content: null })
    }
  }
}

function analyzeWrites(name: string, args: Word[], cwds: Cwds, ctx: Ctx): void {
  const w = (list: Word[]): void => list.forEach((t) => checkWrite(t.text, cwds, ctx))
  switch (name) {
    case 'cp':
    case 'copy':
    case 'copy-item':
    case 'cpi':
    case 'ln':
    case 'install':
    case 'ditto':
    case 'xcopy':
    case 'robocopy': {
      const dest = optionValues(args, /^(?:-t|--target-directory|-destination)$/i)
      if (dest.length) return w(dest)
      const pos = positional(
        args,
        /^(?:-t|--target-directory|-s|--suffix|-m|--mode|-o|--owner|-g|--group|-filter|-include|-exclude|-credential|-path|-literalpath)$/i,
        ctx.windows
      )
      if (name === 'robocopy') return w(pos.slice(1, 2))
      if (pos.length >= 2) {
        w(pos.slice(-1))
        propagateMark(pos.slice(0, -1), dest.length ? dest : pos.slice(-1), cwds, ctx)
      } else if (pos.length === 1 && /^(?:copy|xcopy|copy-item|cpi)$/.test(name)) checkWrite('.', cwds, ctx)
      if (dest.length) propagateMark(pos, dest, cwds, ctx)
      return
    }
    case 'mv':
    case 'move':
    case 'move-item':
    case 'mi':
    case 'rename-item':
    case 'ren':
    case 'rni': {
      const dest = optionValues(args, /^(?:-t|--target-directory|-destination)$/i)
      const pos = positional(
        args,
        /^(?:-t|--target-directory|-s|--suffix|-destination|-newname|-path|-literalpath|-filter|-include|-exclude)$/i,
        ctx.windows
      )
      const renaming = /^(?:rename-item|ren|rni)$/.test(name)
      const sources = [...optionValues(args, /^-(?:path|literalpath)$/i), ...(dest.length || renaming ? pos.slice(0, 1) : pos.slice(0, -1))]
      // Mover también quita el origen: la raíz o la carpeta personal cuentan como borrado.
      for (const s of sources)
        for (const cwd of cwds) {
          const t = resolveTarget(s.text, cwd, ctx)
          if (t.kind === 'path' && critical(t.path, ctx)) hard(ctx, 'mueve la raíz, la carpeta personal o el proyecto')
        }
      w(sources)
      const mvDest = dest.length ? dest : !renaming && pos.length >= 2 ? pos.slice(-1) : renaming ? pos.slice(1, 2) : []
      if (dest.length) w(dest)
      else if (!renaming && pos.length >= 2) w(pos.slice(-1))
      propagateMark(sources, mvDest, cwds, ctx)
      return
    }
    case 'mkdir':
    case 'md':
    case 'touch':
    case 'truncate':
    case 'mkfifo':
    case 'new-item':
    case 'ni':
    case 'set-content':
    case 'add-content':
    case 'ac':
    case 'out-file':
    case 'clear-content':
    case 'clc':
    case 'export-csv':
    case 'export-clixml':
    case 'tee-object':
    case 'gunzip':
    case 'unxz':
    case 'bunzip2':
    case 'sc': {
      const values = optionValues(args, /^-(?:path|literalpath|filepath|lp)$/i)
      const pos = positional(
        args,
        /^(?:-m|--mode|-s|--size|-r|--reference|-d|--date|-t|-itemtype|-type|-value|-name|-encoding|-delimiter|-inputobject|-width|-variable|-stream|-filter|-include|-exclude|-credential|-path|-literalpath|-filepath|-lp)$/i
      )
      w(CONTENT_CMDLETS.test(name) ? (values.length ? values : pos.slice(0, 1)) : [...values, ...pos])
      const names = optionValues(args, /^-name$/i)
      if (names.length && /^(?:new-item|ni)$/.test(name)) {
        const bases = (values.length ? values.map((v) => v.text) : ['.']).flatMap((v) =>
          cwds.map((cwd) => {
            const t = resolveTarget(v, cwd, ctx)
            return t.kind === 'path' ? t.path : null
          })
        )
        for (const n of names) checkWrite(n.text, bases, ctx)
      }
      return
    }
    case 'chmod':
    case 'chown':
    case 'chgrp':
    case 'chflags':
    case 'setfacl':
    case 'icacls':
    case 'takeown':
    case 'attrib':
    case 'xattr': {
      if (name === 'xattr' && !hasFlag(args, /^-[wdc]$/)) return
      const pos = positional(args, name === 'xattr' ? /^(?:-w|-p)$/ : /^(?:--reference|-m|-x|-M|-X)$/, ctx.windows)
      const dashMode = args.some((a) => !a.quoted && /^-[rwxXst]+$/.test(a.text) && name === 'chmod')
      const targets =
        /^(?:chmod|chown|chgrp|chflags)$/.test(name) && !dashMode
          ? pos.slice(1)
          : name === 'xattr' && hasFlag(args, /^-[dw]$/)
            ? pos.slice(1)
            : pos
      const recursive = hasFlag(args, /^(?:-[a-zA-Z]*R[a-zA-Z]*|--recursive|\/t|\/s)$/)
      for (const t of targets)
        for (const cwd of cwds) {
          const r = resolveTarget(t.text, cwd, ctx)
          if (r.kind === 'path' && recursive && critical(r.path, ctx))
            hard(ctx, 'cambia permisos de la raíz, la carpeta personal o el proyecto')
        }
      if (name === 'xattr' && args.some((a) => /quarantine/.test(a.text))) doubt(ctx, 'quita la cuarentena de un archivo')
      return w(targets)
    }
    case 'tee':
      return w(positional(args, null))
    case 'sed':
      if (hasFlag(args, /^(?:-i\S*|--in-place\S*|-[a-zA-Z]*i)$/)) {
        const pos = positional(args, /^(?:-e|--expression|-f|--file|-l)$/)
        w(hasFlag(args, /^(?:-e|--expression|-f|--file)/) ? pos : pos.slice(1))
      }
      return
    case 'tar':
    case 'bsdtar': {
      // tar puede ejecutar un programa por cada archivo o en un punto de control. Punto 4 de la revisión.
      if (args.some((a) => /^--to-command|^--checkpoint-action=.*\bexec|^--use-compress-program|^-I\b/.test(a.text)))
        doubt(ctx, 'tar ejecuta un comando externo')
      const flags = args.filter((a) => !a.quoted).map((a) => a.text)
      const mode = flags[0] ?? ''
      const extract = /^-?[a-zA-Z]*x/.test(mode) || flags.some((f) => /^(?:--extract|--get|-x[a-zA-Z]*|-[a-zA-Z]+x[a-zA-Z]*)$/.test(f))
      const create = /^-?[a-zA-Z]*[cr]/.test(mode) || flags.some((f) => /^(?:--create|--append|-c[a-zA-Z]*|-[a-zA-Z]+c[a-zA-Z]*)$/.test(f))
      if (extract) {
        // `-C` (mayúscula) es la carpeta de destino; `-c` es crear.
        const glued = args.find((a) => /^-C.+/.test(a.text))
        const dirs = [...optionValues(args, /^--directory$/), ...args.filter((_a, i) => args[i - 1]?.text === '-C')]
        if (glued) checkWrite(glued.text.slice(2), cwds, ctx)
        if (dirs.length) w(dirs)
        if (!glued && !dirs.length) checkWrite('.', cwds, ctx)
      }
      if (create) {
        const file = optionValues(args, /^(?:--file)$/)
        const glued = args.find((a) => !a.quoted && /^-?[a-zA-Z]*f$/.test(a.text) && args.indexOf(a) <= 1)
        if (file.length) w(file)
        else if (glued) {
          const next = args[args.indexOf(glued) + 1]
          if (next) checkWrite(next.text, cwds, ctx)
        }
      }
      return
    }
    case 'zip': {
      // `zip -TT cmd` ejecuta un programa para «probar» el zip. Punto 4 de la revisión.
      if (args.some((a) => /^-TT$|^--unzip-command/.test(a.text))) doubt(ctx, 'zip ejecuta un comando externo')
      return
    }
    case 'unzip':
    case '7z':
    case '7za':
    case 'expand-archive':
    case 'compress-archive': {
      const glued = args.find((a) => /^-o.+/.test(a.text))
      if (glued && name.startsWith('7z')) return checkWrite(glued.text.slice(2), cwds, ctx)
      const dir = optionValues(args, /^(?:-d|-destinationpath)$/i)
      if (dir.length) return w(dir)
      if (name === 'expand-archive' || name === 'unzip' || (name.startsWith('7z') && /^(?:x|e)$/.test(args[0]?.text ?? '')))
        checkWrite('.', cwds, ctx)
      return
    }
    case 'mklink':
      return w(positional(args, null, true).slice(0, 1))
    case 'dd': {
      const of = args.find((a) => /^of=/i.test(a.text))
      if (!of) return
      const target = of.text.slice(3)
      // Escribir directo en un disco (no en /dev/null) es destrucción de datos.
      if (/^\/dev\//.test(target) && !/^\/dev\/(?:null|stdout|stderr|zero|tty)/.test(target)) return hard(ctx, 'dd escribe en un disco')
      return checkWrite(target, cwds, ctx)
    }
    case 'sort':
      return optionValues(args, /^(?:-o|--output)$/).forEach((o) => checkWrite(o.text, cwds, ctx))
    case 'split':
    case 'csplit':
      // El destino es un prefijo; su carpeta importa.
      return optionValues(args, /^(?:-f|--filter|--additional-suffix|-b|-l|-n)$/).forEach((o) => checkWrite(o.text, cwds, ctx))
  }
}

function downloadIn(text: string): boolean {
  return /\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|DownloadString|DownloadFile|urlopen)\b/i.test(text)
}

function analyzeDownload(name: string, args: Word[], cwds: Cwds, ctx: Ctx): void {
  const lower = args.map((a) => a.text.toLowerCase())
  // Una sustitución en la URL o los argumentos puede sacar datos (`curl "https://x/?d=$(cat … | base64)"`). I1.
  if (
    args.some(
      (a) =>
        a.text.includes(SUBST) ||
        (a.dynamic && /https?:/.test(a.text) && !/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(a.text))
    )
  )
    doubt(ctx, 'puede sacar datos por la red')
  const outputs = [
    ...optionValues(args, /^(?:-o|--output|-outfile|--output-document|-destination)$/i).filter((o) => !(name === 'wget' && o.text === '-')),
    ...(name === 'curl' ? args.filter((a) => !a.quoted && /^-o[^-]/.test(a.text)).map((a) => ({ ...a, text: a.text.slice(2) })) : [])
  ]
  for (const out of outputs) {
    if (out.text === '-') continue
    ctx.downloads.add(basename(out.text))
    checkWrite(out.text, cwds, ctx)
  }
  if (name === 'wget') for (const dir of optionValues(args, /^(?:-p|--directory-prefix)$/i)) checkWrite(dir.text, cwds, ctx)
  const remoteName =
    name === 'wget' ? !outputs.length : name === 'curl' && hasFlag(args, /^(?:--remote-name(?:-all)?|-[a-zA-Z]*O[a-zA-Z]*)$/)
  if (remoteName)
    for (const a of args)
      if (/^https?:\/\//i.test(a.text)) {
        const file = a.text.split(/[?#]/)[0].split('/').filter(Boolean).at(-1)
        if (file && !/^https?:$/i.test(file) && a.text.split(/[?#]/)[0].split('/').filter(Boolean).length > 2)
          ctx.downloads.add(basename(file))
        checkWrite('.', cwds, ctx)
      }
  const sends = /^(?:post|put|patch|delete)$/
  // Enviar datos a `localhost`/`127.0.0.1` es desarrollo normal; solo se revisa si va a un servidor de fuera. R6.
  const local = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|host\.docker\.internal)(?::\d+)?(?:[/?#]|$)/i
  const urls = args.filter((a) => /^https?:\/\//i.test(a.text) || local.test(a.text))
  const toExternal = urls.length === 0 || urls.some((a) => !local.test(a.text))
  if (name === 'curl') {
    if (
      toExternal &&
      (hasFlag(args, /^(?:-d|--data.*|-F|--form.*|-T|--upload-file|--json|-u|--user)$/) ||
        (hasFlag(args, /^(?:-X|--request)$/) && lower.some((a) => sends.test(a))) ||
        args.some((a) => /^-X(?:post|put|patch|delete)$/i.test(a.text)))
    )
      doubt(ctx, 'envía datos por la red')
  }
  if (name === 'wget' && toExternal && hasFlag(args, /^--(?:post|method|body)/)) doubt(ctx, 'envía datos por la red')
  if (/^(?:iwr|irm|invoke-webrequest|invoke-restmethod)$/.test(name)) {
    if (toExternal && ((hasFlag(args, /^-method$/i) && lower.some((a) => sends.test(a))) || hasFlag(args, /^-(?:body|infile|form)$/i)))
      doubt(ctx, 'envía datos por la red')
  }
  // certutil/bitsadmin guardan la descarga en un operando, no en `-o`: el archivo queda marcado como «descargado». G4.
  if (name === 'certutil' || name === 'bitsadmin' || name === 'start-bitstransfer') {
    const pos = positional(args, /^(?:\/\w+|-\w+|-source|-destination|-priority)$/i)
    for (const p of pos) if (!/^https?:\/\//i.test(p.text) && /[\\/.]/.test(p.text)) ctx.downloads.add(basename(p.text))
  }
}

// ───────────────────────────── Análisis por orden ─────────────────────────────

/** Cambios del sistema y almacenes de credenciales que no dependen de los argumentos. */
const SYSTEM_ALWAYS = new Set([
  'launchctl',
  'regedit',
  'set-executionpolicy',
  'register-scheduledtask',
  'unregister-scheduledtask',
  'new-scheduledtask',
  'set-scheduledtask',
  'reagentc',
  'bcdedit',
  'diskpart',
  'format',
  'format-volume',
  'fdisk',
  'gdisk',
  'parted',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'restart-computer',
  'stop-computer',
  'set-service',
  'new-service',
  'start-service',
  'stop-service',
  'restart-service',
  'suspend-service',
  'resume-service',
  'remove-service',
  'csrutil',
  'tccutil',
  'kextload',
  'kextunload',
  'kmutil',
  'systemextensionsctl',
  'profiles',
  'setx',
  'chsh',
  'passwd',
  'sysadminctl',
  'dseditgroup',
  'useradd',
  'usermod',
  'userdel',
  'new-localuser',
  'set-localuser',
  'remove-localuser',
  'add-localgroupmember',
  'set-mppreference',
  'add-mppreference',
  'pfctl',
  'iptables',
  'ufw',
  'firewall-cmd',
  'set-netfirewallrule',
  'new-netfirewallrule',
  'set-netfirewallprofile',
  'cmdkey',
  'vaultcmd',
  'get-storedcredential',
  'ssh-add',
  'ssh-keygen',
  'ssh-copy-id'
])

/** Cambios del sistema según el subcomando. Devuelve true si ya decidió. */
function analyzeSystem(name: string, args: Word[], ctx: Ctx): boolean {
  if (SYSTEM_ALWAYS.has(name) || /^mkfs/.test(name)) return (hard(ctx, `${name}: cambio del sistema o credenciales`), true)
  const sub = firstPositional(args)
  const lower = args.map((a) => a.text.toLowerCase())
  switch (name) {
    case 'defaults':
      if (/^(?:write|delete|import|rename)$/.test(sub)) hard(ctx, 'defaults write cambia el sistema')
      return true
    case 'reg':
      if (sub && !/^(?:query|compare|export)$/.test(sub)) hard(ctx, 'cambia el registro de Windows')
      return true
    case 'schtasks':
      if (!hasFlag(args, /^\/query$/i)) hard(ctx, 'cambia tareas programadas')
      return true
    case 'crontab':
      if (!hasFlag(args, /^-l$/)) hard(ctx, 'cambia tareas programadas')
      return true
    case 'systemctl':
      if (!/^(?:status|show|list-\w+|is-\w+|cat|help)$/.test(sub) && !hasFlag(args, /^--version$/))
        hard(ctx, 'cambia servicios del sistema')
      return true
    case 'service':
      if (!/^(?:status|--status-all)$/.test(firstPositional(args, 1) || sub)) hard(ctx, 'cambia servicios del sistema')
      return true
    case 'sc':
      if (/^(?:create|config|delete|start|stop|pause|continue|failure|sdset|privs|control|description)$/.test(sub))
        return (hard(ctx, 'cambia servicios del sistema'), true)
      return /^(?:query|queryex|qc|qdescription|getdisplayname|getkeyname|enumdepend)$/.test(sub)
    case 'net':
      if (/^(?:start|stop|user|localgroup|share|use|accounts|pause|continue)$/.test(sub)) hard(ctx, 'cambia servicios o usuarios')
      return true
    case 'netsh':
      if (lower.some((a) => /^key=clear$/.test(a))) hard(ctx, 'muestra contraseñas de wifi')
      else if (!lower.includes('show') || lower.some((a) => /^(?:set|add|delete|reset)$/.test(a))) hard(ctx, 'cambia la red del sistema')
      return true
    case 'networksetup':
      if (lower.some((a) => a.startsWith('-') && !/^-(?:get|list|print|version|help)/.test(a))) hard(ctx, 'cambia la red del sistema')
      return true
    case 'scutil':
      if (hasFlag(args, /^--set$/)) hard(ctx, 'cambia el sistema')
      return true
    case 'spctl':
      if (!hasFlag(args, /^(?:--assess|-a|--status)$/)) hard(ctx, 'cambia la seguridad del sistema')
      return true
    case 'nvram':
      if (args.some((a) => a.text.includes('=') || a.text === '-d' || a.text === '-c')) hard(ctx, 'cambia el firmware')
      return true
    case 'pmset':
      if (!hasFlag(args, /^-g$/)) hard(ctx, 'cambia la energía del sistema')
      return true
    case 'diskutil':
      if (!/^(?:list|info|activity)$/.test(sub) && !(sub === 'apfs' && /^list/.test(firstPositional(args, 1)))) hard(ctx, 'cambia discos')
      return true
    case 'mount':
    case 'umount':
      return (doubt(ctx, 'monta o desmonta discos'), true)
    case 'hdiutil':
      if (/^(?:attach|detach|eject|mount|unmount)$/.test(sub)) doubt(ctx, 'monta o desmonta discos')
      return true
    case 'dscl':
      if (lower.some((a) => /^-(?:create|delete|passwd|append|merge|change)/.test(a))) hard(ctx, 'cambia usuarios del sistema')
      return true
    case 'mdutil':
      if (!hasFlag(args, /^-s$/)) hard(ctx, 'cambia el índice del sistema')
      return true
    case 'security':
      if (
        /^(?:find-generic-password|find-internet-password|dump-keychain|export|unlock-keychain|add-generic-password|add-internet-password|delete-\w+|set-key-partition-list|import|set-keychain-password|create-keychain|default-keychain|login-keychain)$/.test(
          sub
        )
      )
        hard(ctx, 'el llavero (credenciales)')
      else doubt(ctx, 'security toca el llavero')
      return true
    case 'gpg':
    case 'gpg2':
      if (lower.some((a) => /^--(?:export-secret|delete|import|gen-key|full-gen|quick-gen|edit-key|passwd)/.test(a)))
        hard(ctx, 'llaves GPG')
      else doubt(ctx, 'gpg usa llaves privadas')
      return true
    case 'gh':
      if (sub === 'auth' && /^(?:token|login|refresh|setup-git)$/.test(firstPositional(args, 1)))
        return (hard(ctx, 'credenciales de GitHub'), true)
      return false
    case 'aws':
      if (
        sub === 'configure' ||
        lower.some((a) => /^(?:get-secret-value|get-session-token|get-login-password|export-credentials)$/.test(a))
      )
        return (hard(ctx, 'credenciales de AWS'), true)
      return false
    case 'gcloud':
      if (lower.some((a) => /^(?:print-access-token|print-identity-token)$/.test(a)))
        return (hard(ctx, 'credenciales de Google Cloud'), true)
      return false
    case 'az':
      if (lower.includes('get-access-token')) return (hard(ctx, 'credenciales de Azure'), true)
      return false
  }
  return false
}

/** `docker run -v ~:/h` / `--mount src=/` monta la carpeta personal, la raíz o algo de fuera del proyecto en el contenedor. R6. */
function dangerousDockerMount(args: Word[], cwds: Cwds, ctx: Ctx): boolean {
  const mounts = [
    ...optionValues(args, /^(?:-v|--volume|--mount)$/i),
    ...args.filter((a) => /^-v.+/.test(a.text)).map((a) => ({ ...a, text: a.text.slice(2) }))
  ]
  return mounts.some((v) => {
    const src = /\b(?:src|source)=([^,]+)/i.exec(v.text)?.[1] ?? v.text.split(':')[0]
    if (/^(?:~|\$HOME|%USERPROFILE%)/.test(src)) return true
    const t = resolveTarget(src, cwds[0] ?? null, ctx)
    return t.kind === 'path' && !insideProject(t.path, ctx)
  })
}

/** Herramientas que publican, despliegan o cambian algo fuera del equipo. Devuelve true si ya decidió. */
function analyzeRemote(name: string, args: Word[], cwds: Cwds, ctx: Ctx): boolean {
  const sub = firstPositional(args)
  const lower = args.map((a) => a.text.toLowerCase())
  if (/^(?:docker|podman)$/.test(name)) {
    if (/^(?:push|login|logout)$/.test(sub)) doubt(ctx, 'publica o inicia sesión en un registro')
    else if (
      /^(?:rm|rmi|kill|stop)$/.test(sub) ||
      (/^(?:system|volume|image|container|builder|network)$/.test(sub) && lower.some((a) => /^(?:prune|rm|remove)$/.test(a)))
    )
      doubt(ctx, 'borra o detiene contenedores')
    else if (sub === 'run' && (lower.includes('--privileged') || dangerousDockerMount(args, cwds, ctx)))
      doubt(ctx, 'contenedor con acceso al equipo')
    return true
  }
  if (name === 'gh' || name === 'glab') {
    const action = firstPositional(args, 1)
    if (sub === 'api') {
      if (
        (hasFlag(args, /^(?:-X|--method)$/) && lower.some((a) => /^(?:post|put|patch|delete)$/.test(a))) ||
        hasFlag(args, /^(?:-f|-F|--field|--raw-field|--input)$/)
      )
        doubt(ctx, 'cambia algo en GitHub')
      return true
    }
    if (
      !/^(?:list|view|status|diff|checks|ls|show|search|browse|version|help)$/.test(action) &&
      !/^(?:status|search|browse|help|version|auth|--version)$/.test(sub)
    )
      doubt(ctx, `${name} ${sub} cambia algo en el servidor`)
    return true
  }
  if (
    /^(?:vercel|netlify|firebase|fly|flyctl|heroku|wrangler|railway|surge|amplify|eb|serverless|cdk|sam|pulumi|terraform|tofu|kubectl|helm|ansible|ansible-playbook)$/.test(
      name
    )
  ) {
    if (
      !/^(?:version|help|whoami|list|ls|get|describe|logs|status|plan|show|validate|fmt|init|template|lint|diff|output|providers|graph|top|explain)$/.test(
        sub
      ) &&
      !hasFlag(args, /^(?:--version|-v|--help)$/)
    )
      doubt(ctx, `${name} despliega o cambia infraestructura`)
    return true
  }
  if (/^(?:aws|gcloud|az|gsutil|s3cmd|rclone)$/.test(name)) {
    const reads = lower.some((a) => /^(?:describe|list|get|ls|show|lsjson|lsd|version|help|whoami)(?:-|$)/.test(a) || a === '--version')
    const writes = lower.some((a) =>
      /^(?:rm|delete|put|create|update|terminate|deploy|sync|cp|mv|remove|purge|start|stop|set|attach|detach|copy|move)(?:-|$)/.test(a)
    )
    if (!reads || writes) doubt(ctx, `${name} cambia algo en la nube`)
    return true
  }
  if (/^(?:ssh|scp|sftp|ftp|nc|ncat|netcat|socat|telnet|mosh)$/.test(name)) return (doubt(ctx, 'se conecta a otro equipo'), true)
  if (/^(?:nslookup|dig|host|drill)$/.test(name)) {
    // Una sustitución en la consulta puede sacar datos por DNS. I1.
    if (args.some((a) => a.text.includes(SUBST))) doubt(ctx, 'puede sacar datos por DNS')
    return true
  }
  if (name === 'rsync') {
    if (args.some((a) => /^[\w.-]+(?:@[\w.-]+)?:/.test(a.text) && !/^[a-z]:[\\/]/i.test(a.text)))
      return (doubt(ctx, 'copia a otro equipo'), true)
    if (hasFlag(args, /^--(?:delete|remove-source-files)/)) doubt(ctx, 'rsync borra archivos')
    const pos = positional(
      args,
      /^(?:-e|--rsh|--exclude|--include|--filter|-f|--files-from|--log-file|--backup-dir|--rsync-path|-t|--temp-dir|--chmod|--chown)$/
    )
    if (pos.length >= 2) checkWrite(pos.at(-1)!.text, cwds, ctx)
    return true
  }
  if (name === 'twine' || (/^(?:poetry|uv|cargo|gem)$/.test(name) && /^(?:publish|yank|owner|push|signin|login)$/.test(sub)))
    return (doubt(ctx, 'publica un paquete'), true)
  return false
}

/** Clientes de bases de datos y herramientas que pierden trabajo. Devuelve true si ya decidió. I2. */
function analyzeData(name: string, args: Word[], cwds: Cwds, ctx: Ctx, part?: Part): boolean {
  if (/^(?:psql|mysql|mariadb|mongo|mongosh|cockroach|clickhouse-client|cqlsh|influx)$/.test(name)) {
    if (
      hasFlag(args, /^(?:-c|--command|-e|--execute|--eval|-f|--file)$/) ||
      optionValues(args, /^(?:-c|--command|-e|--execute|--eval)$/).length ||
      args.some((a) => /\b(?:drop|truncate|delete\s+from|update\s+)/i.test(a.text)) ||
      // `psql < x.sql`: la orden SQL llega por la entrada estándar.
      part?.redirects.some((r) => r.op === '<' || r.op === '<<<')
    )
      doubt(ctx, 'ejecuta una orden en la base de datos')
    return true
  }
  if (name === 'redis-cli' || name === 'valkey-cli') {
    if (args.some((a) => /^(?:flushall|flushdb|shutdown|debug|config)$/i.test(a.text))) doubt(ctx, 'borra o cambia la base de datos')
    return true
  }
  if (name === 'sqlite3' || name === 'sqlite') {
    const pos = positional(args, null)
    if (pos[0] && !/^:memory:$/i.test(pos[0].text)) checkWrite(pos[0].text, cwds, ctx)
    if (
      args.some((a) => /\.(?:shell|system|import|load|output|once|excel|backup|clone)\b/i.test(a.text)) ||
      args.some((a) => /\b(?:drop|truncate|delete\s+from|update\s+|alter\s+)/i.test(a.text)) ||
      part?.redirects.some((r) => r.op === '<' || r.op === '<<<')
    )
      doubt(ctx, 'sqlite3 ejecuta comandos o escribe archivos')
    return true
  }
  if (name === 'prisma') {
    const sub = firstPositional(args)
    if (
      (sub === 'migrate' && /^(?:reset|deploy)$/.test(firstPositional(args, 1))) ||
      (sub === 'db' && /^(?:push|execute|drop)$/.test(firstPositional(args, 1)))
    )
      doubt(ctx, 'cambia o reinicia la base de datos')
    return true
  }
  return false
}

/** Instaladores del sistema y de herramientas globales. Devuelve true si ya decidió. */
function analyzeInstallers(name: string, args: Word[], cwds: Cwds, ctx: Ctx): boolean {
  const sub = firstPositional(args)
  if (/^(?:pip[\d.]*)$/.test(name)) return (analyzePip(args, cwds, ctx), true)
  if (name === 'uv') {
    if (sub === 'pip') analyzePip(args.slice(1), cwds, ctx)
    else if (sub === 'tool' && /^(?:install|uninstall|upgrade)$/.test(firstPositional(args, 1))) doubt(ctx, 'instala fuera del proyecto')
    return true
  }
  if (/^(?:pipx|conda|mamba)$/.test(name)) {
    if (/^(?:install|uninstall|remove|upgrade|inject|create|update)$/.test(sub)) doubt(ctx, 'instala fuera del proyecto')
    return true
  }
  if (/^(?:install-module|install-package|uninstall-module|uninstall-package|install-script|update-module|msiexec)$/.test(name))
    return (doubt(ctx, 'instala o quita programas'), true)
  if (name === 'cargo') {
    if (/^(?:install|uninstall)$/.test(sub)) doubt(ctx, 'instala fuera del proyecto')
    return true
  }
  if (name === 'go') {
    if (sub === 'install' || (sub === 'clean' && hasFlag(args, /^-(?:cache|modcache)$/))) doubt(ctx, 'instala o borra fuera del proyecto')
    return true
  }
  if (/^(?:brew|port|apt|apt-get|yum|dnf|pacman|zypper|snap|flatpak|winget|choco|scoop|gem)$/.test(name)) {
    if (
      /^(?:install|uninstall|remove|rm|purge|upgrade|update|reinstall|link|unlink|tap|untap|cleanup|autoremove|services|switch|pin|unpin|clean|-s|-r|-u|-syu|-rns)$/i.test(
        sub
      )
    )
      doubt(ctx, 'instala o quita programas del sistema')
    return true
  }
  return false
}

/** Variables de entorno que hacen que git o el shell ejecuten un programa (`GIT_SSH_COMMAND`, `PAGER`, `BASH_ENV`…). G9. */
const EXEC_ENV =
  /^(?:GIT_SSH|GIT_SSH_COMMAND|GIT_EXTERNAL_DIFF|GIT_PAGER|GIT_EDITOR|GIT_SEQUENCE_EDITOR|GIT_PROXY_COMMAND|GIT_ASKPASS|SSH_ASKPASS|PAGER|MANPAGER|EDITOR|VISUAL|FCEDIT|BASH_ENV|ENV|PROMPT_COMMAND|LESSOPEN|BAT_PAGER|LESSEDIT|MANOPT|PYTHONSTARTUP|PYTHONPATH|PERL5OPT|RUBYOPT|.*_COMMAND)$/i

/** Revisa `NOMBRE=valor` delante de una orden: variables que ejecutan, un PATH sospechoso o `LD_PRELOAD`. */
function checkEnvAssignment(assign: string, dynamic: boolean, cwds: Cwds, ctx: Ctx): void {
  const eq = assign.indexOf('=')
  const varName = assign.slice(0, eq).replace(/\+$/, '')
  const value = assign.slice(eq + 1)
  if (
    EXEC_ENV.test(varName) ||
    /^(?:LD_PRELOAD|LD_LIBRARY_PATH|DYLD_INSERT_LIBRARIES|DYLD_LIBRARY_PATH|DYLD_FRAMEWORK_PATH|NODE_OPTIONS)$/i.test(varName)
  ) {
    if (value && !dynamic) {
      if (/[\\/]/.test(value)) doubt(ctx, 'variable que carga código o configuración')
      classifyInto(value, cwds, { ...ctx, depth: ctx.depth + 1 })
    } else doubt(ctx, 'una variable de entorno ejecuta un programa')
  } else if (/^(?:PATH|NODE_PATH)$/i.test(varName)) {
    // R7: extender el PATH con una carpeta del proyecto (`$PWD/node_modules/.bin`) o una de herramientas conocida es normal;
    // una carpeta de fuera (`/tmp`, `.`, una variable) → `doubt`. El propio `$PATH`/`%PATH%` al final no cuenta.
    const dirs = value.split(/[:;]/).filter((d) => d && !/^\$\{?PATH\}?$|^%PATH%$/i.test(d))
    if (dirs.some((d) => !safePathDir(d, cwds, ctx))) doubt(ctx, 'antepone una carpeta sospechosa al PATH')
  }
}

/** ¿Es una carpeta de confianza para el PATH? (dentro del proyecto o una de herramientas conocida). */
function safePathDir(raw: string, cwds: Cwds, ctx: Ctx): boolean {
  const dir = raw.replace(/\$\{?PWD\}?/gi, cwds[0] ?? '.')
  if (/\$|%|\u0001/.test(dir)) return false
  if (/^(?:\.|\.\/|~|\/tmp(?:\/|$)|\/private\/tmp)/.test(dir.replace(/\\/g, '/'))) return false
  const t = resolveTarget(dir, cwds[0] ?? null, ctx)
  if (t.kind !== 'path') return false
  if (insideProject(t.path, ctx)) return true
  return (
    /^(?:\/usr\/(?:local\/)?bin|\/bin|\/opt\/homebrew\/bin|\/opt\/local\/bin|[a-z]:\/program files)/i.test(t.path) ||
    /\/(?:\.cargo\/bin|\.local\/bin|\.nvm|go\/bin|\.rbenv|\.pyenv|\.bun\/bin|\.deno\/bin|node_modules\/\.bin)(?:\/|$)/i.test(t.path)
  )
}

/** Analiza una orden simple ya separada. Devuelve las carpetas de trabajo que quedan después (`cd`). */
function analyzeWords(words: Word[], cwds: Cwds, ctx: Ctx, part?: Part, afterCall = false): Cwds | void {
  let list = [...words]
  // Palabras clave y asignaciones delante de la orden.
  while (list.length && !list[0].quoted && KEYWORDS.has(list[0].text.toLowerCase())) list.shift()
  // Cabecera de un bucle (`for f in a b c`, `case $x in`): no es un comando, solo nombres.
  if (list.length >= 2 && list[1].text.toLowerCase() === 'in' && !list[1].quoted) return
  // Variables de entorno delante de la orden (`FOO=1 npm test`, `GIT_SSH_COMMAND='…' git fetch`). Algunas ejecutan su valor. G9.
  while (list.length && /^[A-Za-z_]\w*\+?=/.test(list[0].text)) {
    const a = list.shift()!
    ctx.sawRedirectOrAssign = true // R7: causa benigna de `unparsed`.
    checkEnvAssignment(a.text, a.dynamic, cwds, ctx)
  }
  if (
    !ctx.escapes &&
    !ctx.cmdShell &&
    list.length >= 2 &&
    /^\$[\w:.[\]]+$/.test(list[0].text) &&
    /^(?:[+\-*/]?=|\?\?=)$/.test(list[1].text)
  ) {
    list = list.slice(2)
    if (list.length === 1 && /^(?:-?\d+(?:\.\d+)?|\$true|\$false|\$null)$/.test(list[0].text)) return
  } else if (!ctx.escapes && !ctx.cmdShell && list.length && /^\$[\w:]+(?:\.\w+|\[[^\]]*\])*\+?=/.test(list[0].text)) {
    // Asignación de PowerShell (`$x=…`, `$env:NODE_ENV='test'`): asignar un valor es inofensivo; solo una variable de
    // entorno que ejecuta (GIT_SSH_COMMAND, PAGER, PATH…) se revisa. Lo que importa de verdad es `& $x`, que ya es `doubt`.
    const env = /^\$env:(\w+)\+?=(.*)$/s.exec(list[0].text)
    if (env) checkEnvAssignment(`${env[1]}=${env[2]}`, list[0].dynamic, cwds, ctx)
    list = list.slice(1)
  }
  if (!list.length) return
  const first = list[0]
  if (!ctx.escapes && !ctx.cmdShell && !afterCall && list.length === 1 && /^-?\d+(?:\.\d+)?$/.test(first.text)) return
  const args = list.slice(1)
  const subst = (): boolean => !!part?.substs.some(downloadIn)
  // Nombre del programa dinámico (`$X`, `${…}`, `$(…)`, `` `…` ``, `$'…'`, `%VAR%`): siempre `doubt` (G1/G8). Solo se
  // exceptúa una expresión de PowerShell sobre una variable (`$x`, `$x.Prop`, `$x[0]`, seguida de `|`, un operador…), que
  // no ejecuta un programa; nunca con el operador de llamada `&`, una sustitución ni un método que borra o mueve.
  if (/^\$/.test(first.text) || first.text.includes(SUBST) || /^%[A-Za-z_]\w*%/.test(first.text)) {
    // En PowerShell `$x`, `$x.Prop` o `$x[0]` es un valor, no un programa (solo `& $x` ejecuta): no se marca.
    const psExpr =
      !ctx.escapes &&
      !ctx.cmdShell &&
      !afterCall &&
      !first.text.includes(SUBST) &&
      !/\.(?:delete|remove|moveto|clear|kill|stop|encrypt|close|dispose|invokescript)$/i.test(first.text) &&
      /^\$(?:env:)?[A-Za-z_]\w*(?:\.\w+|\[[^\]]*\])*$/.test(first.text)
    if (psExpr) return
    return doubt(ctx, 'ejecuta un programa que depende de una variable')
  }
  // PowerShell: `(expr).Prop` deja un `.Prop` suelto al cerrar el grupo; es un acceso a propiedad, no un programa.
  if (!ctx.escapes && !afterCall && /^\.[A-Za-z]\w*$/.test(first.text)) return
  // PowerShell: un operador suelto tras un grupo (`(Get-Content x) -replace '…'`) es una expresión, no un programa.
  if (!ctx.escapes && PS_OPERATOR.test(first.text)) return
  // Una cadena literal de PowerShell es un valor (`"texto" > a.txt`); con `&` se trata como programa.
  if (
    first.quoted &&
    !afterCall &&
    !ctx.escapes &&
    !ctx.cmdShell &&
    (!ctx.windows || !args.length) &&
    !/^(?:[a-z]:[\\/]|\/|\.{1,2}[\\/]|~)/i.test(first.text) &&
    !/\.(?:exe|cmd|bat|ps1|sh|com|msi)$/i.test(first.text)
  )
    return
  if (first.text.startsWith('[') && first.text !== '[' && first.text !== '[[') {
    if (ctx.escapes || ctx.cmdShell) return doubt(ctx, 'expresión que no pertenece al shell')
    const call = list.map((w) => w.text).join(' ')
    if (/::(?:Delete|Move)\b/i.test(call)) doubt(ctx, 'borra o mueve archivos (.NET)')
    if (/::(?:WriteAll\w*|AppendAll\w*|Copy|Create\w*|Replace)\b/i.test(call)) doubt(ctx, 'escribe archivos (.NET)')
    if (/::SetEnvironmentVariable\b/i.test(call) && /\b(?:Machine|User)\b/.test(call)) hard(ctx, 'cambia variables del sistema')
    if (!/^\[(?:math|datetime|(?:system\.)?io\.(?:path|file))\]::/i.test(first.text)) doubt(ctx, 'expresión de tipo no reconocida')
    return
  }
  const name = canonical(basename(first.text.replace(/^@/, '')))
  const lower = args.map((a) => a.text.toLowerCase())
  checkExecutable(first.text, cwds, ctx)
  checkArguments(name, args, cwds, ctx)
  if (
    ctx.strictUnparsed &&
    !KNOWN_SAFE.has(name) &&
    !WRAPPERS.has(name) &&
    !/^(?:git|npm|pnpm|yarn|bun|cnpm|npx|bunx|pnpx|make|gmake|go|cargo|pip[\d.]*|uv|docker|podman|find|cd|chdir|pushd|popd|set-location|sl|push-location|pop-location|export|setenv|declare|typeset|set|call|swift|dotnet|flutter|gradle|mvn|bundle|xcodebuild)$/.test(
      name
    ) &&
    !SHELLS.test(name) &&
    !SCRIPTING.test(name) &&
    !DOWNLOADERS.test(name)
  )
    doubt(ctx, 'unparsed contiene una orden sin gramática estricta')
  strictProgram(name, args, cwds, ctx)
  if (!ctx.escapes) {
    if (name === 'call') return args.length ? analyzeWords(args, cwds, ctx, part, true) : doubt(ctx, 'call sin orden')
    if (name === 'set' && args.some((a) => /^[A-Za-z_]\w*=/.test(a.text))) {
      for (const a of args) if (a.text.includes('=')) checkEnvAssignment(a.text, a.dynamic, cwds, ctx)
      ctx.sawRedirectOrAssign = true
      return
    }
    if (
      name === 'timeout' &&
      args[0]?.text.toLowerCase() === '/t' &&
      /^\d+$/.test(args[1]?.text ?? '') &&
      args.slice(2).every((a) => /^\/nobreak$/i.test(a.text))
    )
      return
    if (name === 'echo' && args[0]?.text === 'off') return
  }
  // Leer o copiar recursivamente la carpeta personal (o un ancestro) arrastra `.ssh`, `.aws` y todo lo demás. G5.
  if (
    /^(?:ls|dir|get-childitem|gci|findstr|diff|hdiutil|grep|egrep|rg|ag|ack|cp|copy-item|cpi|mv|move-item|mi|rsync|tar|bsdtar|zip|7z|7za|scp|ditto|xcopy|robocopy|find)$/.test(
      name
    )
  ) {
    const recursive = /^(?:tar|bsdtar|zip|7z|7za|ditto|robocopy|hdiutil)$/.test(name)
      ? true
      : name === 'find'
        ? true
        : hasFlag(args, /^(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive|-recurse|-a|--archive|\/s|\/e)$/i)
    if (recursive)
      for (const w of positional(args, null, ctx.windows))
        for (const cwd of cwds) {
          const t = resolveTarget(w.text, cwd, ctx)
          if (
            t.kind === 'path' &&
            !insideProject(t.path, ctx) &&
            (within(ctx.home, globParent(t.path) ?? t.path) || sensitiveConfigRoot(globParent(t.path) ?? t.path, ctx))
          ) {
            doubt(ctx, 'lee o copia recursivamente una carpeta con credenciales')
            break
          }
        }
  }
  // Lo que entra por `<<<` o `<` a un intérprete es su guion: `<<<` se clasifica como comando; `<` ejecuta ese archivo. G3/R3.
  const runStdin = (inline = false): void => {
    for (const r of part?.redirects ?? []) {
      if (r.op === '<<<') {
        if (inline) analyzeInline(r.target.text, cwds, ctx)
        else classifyInto(r.target.text, cwds, { ...ctx, depth: ctx.depth + 1 })
      } else if (r.op === '<') {
        if (r.target.text.includes(SUBST) || r.target.dynamic) doubt(ctx, 'ejecuta lo que llega por la entrada estándar')
        else {
          checkExecutable(r.target.text, cwds, ctx)
          doubt(ctx, 'ejecuta un guion por la entrada estándar')
        }
      }
    }
  }

  // alias y trap guardan un comando para ejecutarlo luego: se clasifica su texto. G3.
  if (name === 'alias') {
    for (const a of args) {
      const eq = a.text.indexOf('=')
      if (eq > 0) classifyInto(a.text.slice(eq + 1), cwds, { ...ctx, depth: ctx.depth + 1 })
    }
    return
  }
  if (name === 'trap') {
    if (args[0] && !args[0].text.startsWith('-')) classifyInto(args[0].text, cwds, { ...ctx, depth: ctx.depth + 1 })
    return
  }
  if (name === 'at' || name === 'batch') {
    for (const h of part?.heredocs ?? []) classifyInto(h.body, cwds, { ...ctx, depth: ctx.depth + 1 })
    runStdin()
    return doubt(ctx, 'programa una tarea para después')
  }
  // Volcado del entorno y variables que ejecutan (`export -p`, `set`, `declare -p`, `export GIT_PAGER=…`). G9/I3.
  if (name === 'export' || name === 'setenv') {
    for (const a of args) if (a.text.includes('=')) checkEnvAssignment(a.text, a.dynamic, cwds, ctx)
    if (!args.length || args.every((a) => /^-p$/.test(a.text))) doubt(ctx, 'muestra todas las variables de entorno')
    return
  }
  if (name === 'declare' || name === 'typeset') {
    for (const a of args) if (a.text.includes('=')) checkEnvAssignment(a.text, a.dynamic, cwds, ctx)
    if (!args.length || hasFlag(args, /^-[xp]+$/)) doubt(ctx, 'muestra variables del entorno')
    return
  }
  if (name === 'set' && ctx.escapes && !args.length) return doubt(ctx, 'muestra todas las variables y funciones')
  // Programas que corren una orden en una posición poco clara o la toman de stdin. G9.
  if (RUN_COMMAND.has(name)) {
    runStdin()
    for (const h of part?.heredocs ?? []) classifyInto(h.body, cwds, { ...ctx, depth: ctx.depth + 1 })
    return doubt(ctx, `${name} ejecuta un comando`)
  }
  // Lanzadores de Windows que ejecutan otra cosa (`start cmd /c …`, `forfiles /c`, `wmic process call create`, `wsl …`). G8.
  if (ctx.windows || !ctx.escapes) {
    if (name === 'forfiles') {
      for (const c of optionValues(args, /^\/c$/i))
        classifyInto(c.text.replace(/^"(.*)"$/s, '$1').replace(/@\w+/g, 'x'), cwds, { ...ctx, depth: ctx.depth + 1, escapes: false })
      return
    }
    if (name === 'wmic') {
      if (lower.includes('call') && lower.includes('create')) {
        const idx = args.findIndex((a) => /^create$/i.test(a.text))
        if (args[idx + 1])
          classifyInto(args[idx + 1].text.replace(/^"(.*)"$/s, '$1'), cwds, { ...ctx, depth: ctx.depth + 1, escapes: false })
        else doubt(ctx, 'wmic crea un proceso')
      }
      return
    }
    if (name === 'wsl' || (name === 'bash' && /wsl/.test(first.text))) {
      // wsl corre un comando dentro de Linux, fuera de lo que ve esta máquina: lo revisa la IA. G8.
      return doubt(ctx, 'ejecuta un comando dentro de WSL')
    }
    if (/^(?:mshta|regsvr32|rundll32|cscript|wscript|msbuild|installutil|mavinject|regsvcs|regasm)$/.test(name)) {
      if (args.some((a) => /^https?:\/\//i.test(a.text) || /:https?:/i.test(a.text))) return hard(ctx, 'descarga y ejecuta código')
      return doubt(ctx, `${name} ejecuta código`)
    }
    if (name === 'vssadmin') {
      if (lower.includes('delete')) return hard(ctx, 'borra las copias de seguridad del sistema')
      return
    }
    if (name === 'wevtutil' && lower.some((a) => /^(?:cl|clear-log|sl)$/.test(a))) return hard(ctx, 'borra los registros de eventos')
    if (name === 'cipher' && hasFlag(args, /^\/w/i)) return hard(ctx, 'borra el espacio libre del disco')
    if (name === 'clear-recyclebin') return doubt(ctx, 'vacía la papelera')
    if (name === 'bcdedit' || name === 'reagentc') return hard(ctx, 'cambia el arranque del sistema')
  }

  if (WRAPPERS.has(name)) {
    let rest = args
    if (name === 'env') {
      while (rest.length && (/^[A-Za-z_]\w*=/.test(rest[0].text) || /^-(?:i|-ignore-environment|0|-null)$/.test(rest[0].text))) {
        if (rest[0].text.includes('=')) checkEnvAssignment(rest[0].text, rest[0].dynamic, cwds, ctx)
        rest = rest.slice(1)
      }
      while (rest.length && /^-(?:u|-unset|C|-chdir)$/.test(rest[0].text)) rest = rest.slice(2)
      if (rest.length && /^-(?:S|-split-string)/.test(rest[0].text)) return doubt(ctx, 'env -S ejecuta texto')
      if (!rest.length) return doubt(ctx, 'muestra todas las variables de entorno')
    } else if (name === 'timeout' || name === 'gtimeout') {
      while (rest.length && rest[0].text.startsWith('-')) rest = rest.slice(/^-(?:k|s|-kill-after|-signal)$/.test(rest[0].text) ? 2 : 1)
      rest = rest.slice(1)
    } else if (name === 'nice') {
      while (rest.length && rest[0].text.startsWith('-')) rest = rest.slice(rest[0].text === '-n' ? 2 : 1)
    } else if (name === 'watch') {
      while (rest.length && rest[0].text.startsWith('-')) rest = rest.slice(/^-(?:n|d|-interval)$/.test(rest[0].text) ? 2 : 1)
    } else while (rest.length && rest[0].text.startsWith('-')) rest = rest.slice(1)
    return rest.length ? analyzeWords(rest, cwds, ctx, part) : undefined
  }
  if (ELEVATE.has(name)) return hard(ctx, `${name}: permisos de administrador`)
  if (name === 'xargs') {
    let rest = args
    while (rest.length && rest[0].text.startsWith('-')) rest = rest.slice(/^-(?:I|n|P|L|d|E|s|a)$/.test(rest[0].text) ? 2 : 1)
    if (!rest.length) return
    const inner = canonical(basename(rest[0].text))
    if (STDIN_RUNNERS(inner) || DOWNLOADERS.test(inner)) doubt(ctx, 'xargs ejecuta o envía datos de la tubería')
    if (DELETE.has(inner)) return doubt(ctx, 'borra lo que llega por la tubería')
    if (KILL.has(inner)) return doubt(ctx, 'mata procesos que llegan por la tubería')
    return analyzeWords(rest, cwds, ctx, part)
  }
  if (name === 'npx' || name === 'bunx' || name === 'pnpx') {
    // `npx -c '…'` ejecuta ese texto en el shell: se clasifica. R2.
    for (const call of optionValues(args, /^(?:-c|--call)$/)) classifyInto(call.text, cwds, { ...ctx, depth: ctx.depth + 1 })
    const inner = positional(args, /^(?:-p|--package|-c|--call)$/)
    return inner.length ? analyzeWords(args.slice(args.indexOf(inner[0])), cwds, ctx, part) : undefined
  }
  if (analyzeSystem(name, args, ctx)) return
  if (name === 'printenv' && !args.length) return doubt(ctx, 'muestra todas las variables de entorno')
  if (/^(?:get-childitem|gci|ls|dir)$/.test(name) && lower.some((a) => /^env:\\?\*?$/.test(a)))
    return doubt(ctx, 'muestra todas las variables de entorno')
  // Registro de Windows con los cmdlets de elementos (incluidos los alias `sp`, `si`, `ri`, `rp`…).
  if (
    /^(?:set-itemproperty|sp|new-itemproperty|remove-itemproperty|rp|new-item|remove-item|ri|set-item|si|rename-itemproperty|copy-itemproperty)$/.test(
      name
    ) &&
    args.some((a) => /^(?:hk(?:lm|cu|cr|u|cc)|hkey_\w+|registry)::?/i.test(a.text))
  )
    return hard(ctx, 'cambia el registro de Windows')
  if (DOWNLOADERS.test(name)) return analyzeDownload(name, args, cwds, ctx)

  // Intérpretes y envoltorios de shell.
  if (SHELLS.test(name)) {
    const c = args.findIndex((a) => /^-[A-Za-z]*c/.test(a.text) || /^--command(?:=|$)/.test(a.text))
    strictOptions(args, '-s -i -l --login --noprofile --norc -x -u -e -n --version --help', '-o +o', ctx)
    if (c >= 0) {
      doubt(ctx, 'intérprete con código en línea')
      const attached = /^(?:-[A-Za-z]*?c|--command=)(.+)$/s.exec(args[c].text)?.[1]
      const script = attached ? { ...args[c], text: attached } : args[c + 1]
      if (!script) return
      if (script.text.includes(SUBST) && subst()) return hard(ctx, 'descarga y ejecuta código')
      return classifyInto(script.text, cwds, { ...ctx, depth: ctx.depth + 1, escapes: true })
    }
    const file = positional(args, /^(?:-o|\+o|--rcfile|--init-file)$/).find((w) => w.text !== '-')
    if (file) {
      if (file.text.includes(SUBST) && subst()) return hard(ctx, 'descarga y ejecuta código')
      return checkExecutable(file.text, cwds, ctx)
    }
    runStdin()
    for (const h of part?.heredocs ?? []) {
      if (!h.quoted && /\$\(|`/.test(h.body)) doubt(ctx, 'heredoc con sustituciones')
      classifyInto(h.body, cwds, { ...ctx, depth: ctx.depth + 1 })
    }
    return
  }
  if (PS.test(name)) {
    if (hasFlag(args, /^-(?:executionpolicy|ep|ex|exec)$/i) && lower.some((a) => /^(?:bypass|unrestricted)$/.test(a)))
      doubt(ctx, 'salta la política de ejecución')
    const file = optionValues(args, /^-(?:f|file)$/)[0]
    if (file) return checkExecutable(file.text, cwds, ctx)
    const script = powershellScript(args.map((a) => a.text))
    if (script === null && args.some((a) => /^-(?:e|ec|enc\w*)$/i.test(a.text)))
      return doubt(ctx, 'comando codificado que no se puede leer')
    if (script) return classifyInto(script, cwds, { ...ctx, depth: ctx.depth + 1, escapes: false })
    return
  }
  if (CMD.test(name)) {
    runStdin()
    const script = cmdScript(args.map((a) => a.text))
    if (script) return classifyInto(script.replace(/^"(.*)"$/s, '$1'), cwds, { ...ctx, depth: ctx.depth + 1, escapes: false })
    return
  }
  if (name === 'source' || name === '.') {
    if (!args[0]) return
    if (args[0].text.includes(SUBST) && subst()) return hard(ctx, 'descarga y ejecuta código')
    if (args[0].dynamic || args[0].text.includes(SUBST)) doubt(ctx, 'carga código calculado')
    return checkExecutable(args[0].text, cwds, ctx)
  }
  if (/^(?:eval|iex|invoke-expression)$/.test(name)) {
    if (subst()) return hard(ctx, 'descarga y ejecuta código')
    if (!args.length) return doubt(ctx, `${name} ejecuta lo que llega por la tubería`)
    if (args.some((a) => a.dynamic)) return doubt(ctx, `${name} ejecuta texto que no se puede leer`)
    return classifyInto(args.map((a) => a.text).join(' '), cwds, { ...ctx, depth: ctx.depth + 1 })
  }
  if (name === 'invoke-command' || name === 'icm') {
    if (hasFlag(args, /^-(?:computername|cn|session|hostname|uri)$/i)) doubt(ctx, 'ejecuta en otro equipo')
    return
  }
  if (name === 'start-process' || name === 'saps' || (name === 'start' && (ctx.windows || !ctx.escapes))) {
    if (hasFlag(args, /^-verb$/i) && lower.includes('runas')) return hard(ctx, 'pide permisos de administrador')
    // cmd `start "titulo" prog …`: el primer operando entre comillas es el título de la ventana, no el programa.
    const sArgs = name === 'start' && args[0]?.quoted && !/[\\/.]/.test(args[0].text) ? args.slice(1) : args
    const prog =
      optionValues(sArgs, /^-(?:filepath|file|path)$/i)[0] ??
      positional(sArgs, /^-(?:argumentlist|args|workingdirectory|wd|windowstyle|verb|redirectstandard\w+|credential|passthru)$/i)[0]
    const argList = optionValues(sArgs, /^-(?:argumentlist|args)$/i).map((a) => a.text)
    // `start cmd /c …` sin -ArgumentList: el resto de los operandos es la orden.
    const rest = argList.length
      ? argList
      : positional(sArgs, /^-\w+$/i)
          .slice(1)
          .map((a) => a.text)
    if (!prog) return
    const innerName = basename(prog.text)
    // Si lanza otro intérprete, se clasifica la orden interior; si no, solo el ejecutable.
    if (/^(?:cmd|powershell|pwsh|wscript|cscript|mshta|rundll32|bash|sh)$/.test(innerName))
      classifyInto([prog.text, ...rest].join(' '), cwds, { ...ctx, depth: ctx.depth + 1, escapes: false })
    else {
      checkExecutable(prog.text, cwds, ctx)
      if (name === 'start' && !/[\\/]/.test(prog.text)) doubt(ctx, 'ejecutable no reconocido de Windows')
      for (const a of rest) if (ctx.downloads.has(basename(a))) hard(ctx, 'ejecuta un archivo recién descargado')
    }
    return
  }
  if (name === 'bun' && !args.some((a) => /^-[A-Za-z]*[ecp]|^--(?:eval|print)(?:=|$)/.test(a.text)))
    return analyzePackageManager(name, args, cwds, ctx)
  if (SCRIPTING.test(name)) {
    if (name === 'php' && args.some((a) => /^-d|^-c/.test(a.text))) doubt(ctx, 'php con configuración ejecutable')
    const codeOption = args.findIndex((a) => /^-[A-Za-z]*[ecpE]|^--(?:eval|print|command)(?:=|$)/.test(a.text))
    // -m es módulo de Python; no es código en línea. Node --check y --inspect tampoco.
    if (codeOption >= 0) {
      doubt(ctx, 'intérprete con código en línea')
      const attached = /^(?:-[A-Za-z]*?[ecpE]|--(?:eval|print|command)=)(.+)$/s.exec(args[codeOption].text)?.[1]
      analyzeInline(attached ?? args[codeOption + 1]?.text ?? '', cwds, ctx)
    }
    strictOptions(
      args,
      '--version -v -V --help -h -u -B -s -S -E -I --check --test --watch --no-warnings',
      '-m -r --require --import --loader --experimental-loader --env-file --inspect-port --directory --bind -b -d -t',
      ctx
    )
    if (name === 'deno' && !/^(?:run|test|check|fmt|lint|task|info|help|version)$/.test(firstPositional(args)))
      doubt(ctx, 'acción de deno requiere revisión')
    // `node -r /tmp/evil.js`, `ruby -r…`: cargar un módulo de fuera del proyecto lo ejecuta (aunque haya también `-e`). R6.
    for (const r of optionValues(args, /^(?:-r|--require|--import|--loader|-I)$/i))
      if (/[\\/]/.test(r.text) || r.text.startsWith('~')) checkExecutable(r.text, cwds, ctx)
    // `php -r 'código'` y `ruby -e`, `node -e`, `python -c`: código en línea (en php, `-r` es ejecutar, no requerir).
    const inlineRe = name === 'php' ? /^(?:-r|-R|-c|-e|-p|--eval|--print)$/ : /^(?:-c|-e|-p|--eval|--print|-E|-pe|-ne|-le|-lne|-pi)$/
    const inline = args.findIndex((a, i) => i < args.length - 1 && !a.quoted && inlineRe.test(a.text))
    if (inline >= 0) {
      const code = args[inline + 1].text
      if (code.includes(SUBST) && subst()) return hard(ctx, 'descarga y ejecuta código')
      analyzeInline(code, cwds, ctx)
      if (name === 'perl' && hasFlag(args, /^-\w*i/))
        for (const f of positional(args.slice(inline + 2), null)) checkWrite(f.text, cwds, ctx)
      return
    }
    if (/^python/.test(name) || name === 'py') {
      const m = args.findIndex((a) => a.text === '-m')
      if (m >= 0) {
        const mod = args[m + 1]?.text ?? ''
        if (!/^(?:http.server|venv|pytest|pip|json.tool|unittest)$/.test(mod)) doubt(ctx, 'módulo de Python no reconocido')
        if (mod === 'pip') {
          strictProgram('pip', args.slice(m + 2), cwds, ctx)
          return analyzePip(args.slice(m + 2), cwds, ctx)
        }
        // `python3 -m http.server --directory ~`: servir una carpeta de fuera del proyecto la publica. R6.
        if (/^(?:http\.server|simplehttpserver|rangehttpserver)$/.test(mod))
          for (const d of [
            ...optionValues(args, /^(?:-d|--directory)$/),
            ...positional(args.slice(m + 2), /^(?:-d|--directory|--bind|-b)$/).slice(1, 2)
          ]) {
            const t = resolveTarget(d.text, cwds[0] ?? null, ctx)
            if (t.kind !== 'path' || !insideProject(t.path, ctx)) doubt(ctx, 'publica una carpeta de fuera del proyecto')
          }
        return
      }
    }
    if (name === 'deno' && args.some((a) => /^https?:\/\//i.test(a.text))) return hard(ctx, 'ejecuta código descargado')
    // stdin hacia el intérprete (`python3 <<< "…"`, `node < x.js`): su contenido es código.
    runStdin(true)
    if (part?.heredocs.length) {
      for (const h of part.heredocs) analyzeInline(h.body, cwds, ctx)
      return
    }
    for (const f of optionValues(args, /^--env-file$/)) if (secretIn(f.text)) hard(ctx, 'lee credenciales (.env)')
    const file = positional(args, /^(?:-w|-x|--require|-r|--import|--loader|--env-file|--inspect-port)$/).find((w) => w.text !== '-')
    if (
      file &&
      !/^(?:run|test|install|i|add|x|build|dev|start|serve|eval|repl|upgrade|fmt|lint|check|compile|task|bundle|init|create)$/.test(
        file.text
      )
    ) {
      checkExecutable(file.text, cwds, ctx)
      checkProjectInput(file.text, cwds, ctx)
    }
    return
  }
  if (name === 'osascript') return doubt(ctx, 'osascript controla otras apps')
  // Editores que pueden lanzar un shell (`vim -c ':!cmd'`, `+'!cmd'`, `-S guion.vim`). G9.
  if (/^(?:vim|vi|nvim|view|rvim|gvim|mvim|neovim)$/.test(name)) {
    if (hasFlag(args, /^(?:-c|--cmd|-S|-u)$/) || args.some((a) => /^\+/.test(a.text))) doubt(ctx, 'el editor puede ejecutar comandos')
    return
  }

  // Borrar y matar procesos.
  if (DELETE.has(name)) {
    const ps = name === 'remove-item' || name === 'ri'
    const targets = ps
      ? [
          ...optionValues(args, /^-(?:path|literalpath|lp|pspath)$/i),
          ...positional(args, /^-(?:path|literalpath|lp|pspath|include|exclude|filter|credential|stream)$/i)
        ]
      : positional(args, null, ctx.windows && /^(?:del|erase|rd|rmdir)$/.test(name))
    if (!targets.length) return doubt(ctx, 'borra lo que llega por la tubería')
    const recursive =
      ps || /^(?:rimraf|rd|rmdir|trash|deltree)$/.test(name) || hasFlag(args, /^(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive|-recurse|\/s)$/i)
    for (const t of targets) checkDelete(t.text, cwds, ctx, recursive)
    return
  }
  if (KILL.has(name)) {
    const jobs = positional(args, null)
    // `kill %1` o `kill $!` solo alcanzan trabajos lanzados por este mismo comando.
    if (name === 'kill' && ((jobs.length && jobs.every((a) => /^%\S*$|^\$!$/.test(a.text))) || hasFlag(args, /^-(?:0|l|L)$/))) return
    return doubt(ctx, 'detiene procesos')
  }
  if (name === 'find') return analyzeFind(args, cwds, ctx)
  if (name === 'git') return analyzeGit(args, cwds, ctx)
  if (/^(?:npm|pnpm|yarn|bun|cnpm)$/.test(name)) return analyzePackageManager(name, args, cwds, ctx)
  if (analyzeRemote(name, args, cwds, ctx)) return
  if (analyzeInstallers(name, args, cwds, ctx)) return
  if (analyzeData(name, args, cwds, ctx, part)) return
  // make: objetivo de despliegue, Makefile o carpeta de fuera del proyecto. I2/R6.
  if (/^(?:make|gmake)$/.test(name)) {
    if (lower.some((a) => /^(?:deploy|publish|release|push|upload)$/.test(a))) doubt(ctx, 'make despliega o publica')
    for (const f of [...optionValues(args, /^(?:-f|--makefile|--file|-c|--directory)$/)]) {
      const t = resolveTarget(f.text, cwds[0] ?? null, ctx)
      if (t.kind !== 'path' || !insideProject(t.path, ctx)) doubt(ctx, 'make usa un Makefile o carpeta de fuera del proyecto')
    }
    return
  }
  analyzeWrites(name, args, cwds, ctx)

  // sed y awk que ejecutan comandos o escriben archivos.
  if (name === 'sed') {
    const scripts = [
      ...optionValues(args, /^(?:-e|--expression)$/),
      ...(hasFlag(args, /^(?:-e|--expression|-f|--file)/) ? [] : positional(args, /^(?:-f|--file|-l|--line-length)$/).slice(0, 1))
    ]
    if (scripts.some((s) => /(?:^|[;\n{}]\s*)\d*,?\d*\s*e(?:\s|$)|\/[gimpI\d]*e[gimpI\d]*\s*(?:;|$)|(?:^|[;\n]\s*)w\s+\S/.test(s.text)))
      doubt(ctx, 'sed ejecuta comandos o escribe archivos')
  }
  if (/^(?:awk|gawk|nawk|mawk)$/.test(name) && args.some((a) => /\bsystem\s*\(|\|\s*getline|print[^;]*>\s*"/.test(a.text)))
    doubt(ctx, 'awk ejecuta comandos o escribe archivos')
  // `base64 -o archivo` / `base32 -o archivo` escriben un archivo.
  if (/^base(?:64|32)$/.test(name)) for (const o of optionValues(args, /^(?:-o|--output)$/)) checkWrite(o.text, cwds, ctx)

  // cd y equivalentes: nuevas carpetas de trabajo.
  if (/^(?:cd|chdir|pushd|set-location|sl|push-location)$/.test(name)) {
    const targets = [
      ...optionValues(args, /^-(?:path|literalpath|lp)$/i),
      ...positional(args, /^-(?:path|literalpath|lp|stackname)$/i, ctx.windows)
    ]
    if (!targets.length) return [ctx.home]
    if (targets[0].text === '-' || targets.length > 1) return [null]
    return cwds.map((cwd) => {
      const t = resolveTarget(targets[0].text, cwd, ctx)
      return t.kind === 'path' ? t.path : null
    })
  }
  if (name === 'popd' || name === 'pop-location') return [null]
  // R6: cualquier programa que no reconocemos como seguro (y que no manejó ninguna rama) se revisa en vez de aprobarse.
  if (/^(?:swift|dotnet|flutter|gradle|mvn|bundle|xcodebuild)$/.test(name)) return
  if ((ctx.windows || !ctx.escapes) && /[\\/]/.test(first.text) && /\.(?:bat|cmd)$/i.test(first.text)) return
  if (!KNOWN_SAFE.has(name)) doubt(ctx, `comando no reconocido como seguro: ${name || '(vacío)'}`)
}

// ───────────────────────────── Clasificación ─────────────────────────────

/** Programa de la orden (primera palabra útil), para reconocer tuberías hacia un intérprete y descargas. */
function programOf(part: Part): { name: string; index: number } {
  const list = part.words
  let i = 0
  while (
    i < list.length &&
    (KEYWORDS.has(list[i].text.toLowerCase()) ||
      /^[A-Za-z_]\w*=/.test(list[i].text) ||
      WRAPPERS.has(basename(list[i].text)) ||
      (i > 0 && list[i].text.startsWith('-')))
  )
    i++
  return { name: canonical(basename(list[i]?.text ?? '')), index: i }
}

const STDIN_RUNNERS = (prog: string): boolean =>
  SHELLS.test(prog) || SCRIPTING.test(prog) || PS.test(prog) || CMD.test(prog) || /^(?:iex|invoke-expression|eval|source|sudo)$/.test(prog)

/** Contenido literal que una orden deja en un archivo (heredoc, `echo`/`printf` literal); `null` si no se conoce. */
function writtenContent(part: Part): string | null {
  if (part.heredocs.length) return part.heredocs.map((h) => h.body).join('\n')
  const { name, index } = programOf(part)
  if (/^(?:echo|printf|write-output|write-host)$/.test(name)) {
    const a = part.words.slice(index + 1).filter((w) => !/^-/.test(w.text))
    if (a.every((w) => !w.dynamic)) return a.map((w) => w.text).join(' ')
  }
  return null
}

/** ¿La orden está aguas abajo de una descarga en la misma tubería? (para `curl … | tee x; sh x`). */
function pipedFromDownload(parts: Part[], i: number): boolean {
  for (let k = i; k >= 0 && !parts[k].group; k--) {
    if (DOWNLOADERS.test(programOf(parts[k]).name) || parts[k].substs.some(downloadIn)) return true
    if (k === 0 || parts[k - 1].separator !== '|') break
  }
  return false
}

function classifyInto(command: string, cwdsIn: Cwds, ctx: Ctx, fromScript = false): void {
  if (ctx.depth > 6) return doubt(ctx, 'demasiados envoltorios')
  const text = normalizeShellCommand(command, ctx.escapes)
  // Credenciales fuertes y datos de Lazunox en cualquier parte del texto (salvo un echo literal o un mensaje de commit).
  // `.env` NO se busca aquí (includeEnv=false): lo trata cada comando, para no marcar `git commit -m "fix .env"`.
  const literalOutput = text
    .replace(/\b(?:echo|printf|write-output|write-host)\s+(['"])([^$`\n]*?)\1/gi, 'echo')
    .replace(/(?:^|\s)(?:-m|--message|-am|--reword|-M)(?:=|\s+)(?:"[^"]*"|'[^']*'|\S+)/g, ' ')
  for (const atom of literalOutput.split(/[\s;|&(){}"'`,=<>@]+/)) {
    // Los comodines (`id_rsa*`, `.env*`) los trata cada comando (una lectura es `hard`; un `find -name` es `doubt`).
    if (!atom || /[*?[]/.test(atom)) continue
    const secret = secretIn(atom, false, false)
    if (secret) return hard(ctx, `toca ${secret}`)
  }
  const spaced = secretIn(literalOutput.replace(/["']/g, ''), false, false)
  if (spaced?.includes('Lazunox')) return hard(ctx, `toca ${spaced}`)
  if (/PasswordVault|CredRead|CredEnumerate|keymgr\.dll|Get-StoredCredential/i.test(text))
    return hard(ctx, 'toca el almacén de credenciales de Windows')
  // PowerShell: `iex (iwr …)`, `[scriptblock]::Create((irm …))`, `. ([scriptblock]…)`: descargar y ejecutar en una línea.
  if (/\b(?:iex|invoke-expression)\b|\[scriptblock\]::create/i.test(text) && downloadIn(text)) hard(ctx, 'descarga y ejecuta código')
  // Las llamadas a métodos no son nombres de programa. El léxico separa sus paréntesis:
  // decidir antes evita que una redirección o una asignación escondan la expresión (R7).
  const methods = [...text.matchAll(/\[([^\]]+)\]\s*::\s*(\w+)\s*\(/g)]
  for (const m of methods) {
    const type = m[1].toLowerCase().replace(/^system\./, '')
    if (type === 'math' && /^(?:round|floor|ceiling|abs|min|max|sqrt|pow)$/i.test(m[2])) continue
    if (type === 'datetime' && /^(?:parse|daysinmonth|isleapyear)$/i.test(m[2])) continue
    if (/^io\.(?:path|file)$/.test(type) && /^(?:exists|readalltext|getfilename|getextension|combine)$/i.test(m[2])) {
      const open = m.index! + m[0].length - 1
      const close = matchClose(text, open, '(', ')')
      const callArgs = close < 0 ? '' : text.slice(open + 1, close)
      if (!callArgs || hasDynamic(callArgs)) doubt(ctx, 'lectura de PowerShell con ruta calculada')
      for (const l of literalsOf(callArgs)) checkProjectInput(l, cwdsIn, ctx)
      continue
    }
    doubt(ctx, 'llamada a un método de PowerShell')
  }
  if (!ctx.escapes && /\$[\w.]+\s*\.\s*\w+\s*\(|(?<!&)&\s*\(/.test(text)) doubt(ctx, 'expresión que puede ejecutar código')
  if (/\.env\{[^}]*\}|\.\?\?\*/.test(text)) doubt(ctx, 'expansión que puede leer credenciales')
  if (
    /\b(?:kubectl\s+get\s+secrets?|aws\s+ssm\s+get-parameters?|az\s+keyvault\s+secret|gh\s+auth\s+status\b.*(?:-t|--show-token))/i.test(
      text
    )
  )
    doubt(ctx, 'puede mostrar credenciales de un servicio')
  let parsedText = text
  if (!ctx.escapes) {
    // Solo se quitan cabeceras con gramática conocida; la orden del cuerpo siempre se clasifica.
    parsedText = parsedText.replace(/(^|[;&|]\s*)@?(?:if\s+(?:not\s+)?exist\s+(?:"[^"]*"|[^\s;&|]+)\s+)/gi, '$1')
    parsedText = parsedText.replace(/(^|[;&|]\s*)@?for\s+(?!\/f\b)%{1,2}\w+\s+in\s*\([^)]*\)\s+do\s+/gi, '$1')
    parsedText = parsedText.replace(/(^|[;&|]\s*)@/g, '$1')
  }
  const parts = parse(parsedText, ctx.escapes)
  if (!parts) return doubt(ctx, fromScript ? 'el script ejecuta comandos que no se pueden leer' : 'no se puede leer el comando')
  // Descargas primero, para reconocer luego la ejecución del archivo bajado.
  for (const p of parts) {
    const { name, index } = programOf(p)
    if (DOWNLOADERS.test(name)) analyzeDownload(name, p.words.slice(index + 1), [null], { ...ctx, hard: [], doubt: [] })
  }
  let cwds: Cwds = cwdsIn.length ? [...cwdsIn] : [null]
  const stack: Cwds[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p.group === 'open') {
      stack.push(cwds)
      continue
    }
    if (p.group === 'close') {
      const before = stack.pop()
      if (before) cwds = [...new Set([...before, ...cwds])]
      continue
    }
    const prog = programOf(p).name
    // ¿Una tubería entra en este intérprete? (saltando los grupos `( … )`, para `curl … | (bash)`).
    let up = i - 1
    while (up >= 0 && parts[up].group) up--
    const pipedIn = up >= 0 && parts[up].separator === '|'
    // Una orden de base de datos que llega por la tubería (`echo 'drop …' | psql`). I2/R6.
    if (pipedIn && /^(?:psql|mysql|mariadb|mongo|mongosh|cockroach|cqlsh|influx|redis-cli|valkey-cli)$/.test(prog))
      doubt(ctx, 'ejecuta una orden en la base de datos que llega por la tubería')
    // Tubería hacia un intérprete (o xargs) con una descarga delante: descargar y ejecutar. G4.
    if (pipedIn && (STDIN_RUNNERS(prog) || prog === 'xargs')) {
      if (pipedFromDownload(parts, up)) hard(ctx, 'descarga y ejecuta código')
      else if (prog !== 'xargs' && !p.words.slice(programOf(p).index + 1).some((w) => !w.text.startsWith('-')) && !p.heredocs.length)
        doubt(ctx, `${prog} ejecuta lo que llega por la tubería`)
    }
    for (const s of p.substs) classifyInto(s, cwds, { ...ctx, depth: ctx.depth + 1 }, fromScript)
    // Archivos que esta orden escribe (redirección, `tee` o un cmdlet de contenido): si luego se ejecutan, se revisan. G4/R4.
    const prog0 = programOf(p).name
    const fromDl = DOWNLOADERS.test(prog0) || p.substs.some(downloadIn) || pipedFromDownload(parts, i)
    // El contenido puede venir de la propia orden (echo/heredoc) o de lo que llega por la tubería si es un literal.
    let up2 = i - 1
    while (up2 >= 0 && parts[up2].group) up2--
    const pipeLiteral =
      up2 >= 0 &&
      parts[up2].separator === '|' &&
      parts[up2].words.length === 1 &&
      parts[up2].words[0].quoted &&
      !parts[up2].words[0].dynamic
        ? parts[up2].words[0].text
        : null
    const content = writtenContent(p) ?? pipeLiteral
    const record = (target: string): void => {
      const base = basename(target)
      if (base && !/^(?:null|stdout|stderr|con)$/.test(base)) ctx.written.set(base, { download: fromDl, content })
    }
    for (const r of p.redirects)
      if (r.op !== '<' && r.op !== '<<<') {
        checkWrite(r.target.text, cwds, ctx)
        if (r.op === '>' || r.op === '>>') {
          record(r.target.text)
          ctx.sawRedirectOrAssign = true // R7: causa benigna de `unparsed`.
        }
      }
    if (prog0 === 'tee') for (const t of positional(p.words.slice(programOf(p).index + 1), null)) record(t.text)
    // Cmdlets de PowerShell que escriben contenido: su destino queda marcado (`'ri …' | Out-File e.ps1; … e.ps1`).
    if (/^(?:set-content|add-content|ac|out-file|clear-content|clc|export-csv|export-clixml|tee-object)$/.test(prog0)) {
      const after = p.words.slice(programOf(p).index + 1)
      const targets = [
        ...optionValues(after, /^-(?:path|literalpath|filepath|lp)$/i),
        ...positional(after, /^-(?:value|encoding|inputobject|name|stream|width|delimiter)$/i).slice(0, 1)
      ]
      for (const t of targets) record(t.text)
    }
    if (!p.words.length) continue
    checkReadSecrets(p, cwds, ctx)
    const next = analyzeWords(p.words, cwds, ctx, p, !!p.call)
    if (next) {
      // Con «&&» sigue solo si cd funcionó; con «;» o «||» también puede seguir en la carpeta anterior.
      const merged = p.separator === '&&' ? next : p.separator === '|' ? cwds : [...cwds, ...next]
      cwds = [...new Set(merged)]
      if (cwds.length > 8) cwds = [null]
    }
  }
}

/**
 * Clasifica el comando COMPLETO de una petición de terminal en «Automático». Sin comando, demasiado largo o ilegible →
 * `doubt`. La raíz del proyecto decide qué es «dentro»; sin raíz, toda escritura es `doubt`.
 */
export function classifyAutoCommand(
  command: string | undefined,
  projectRoot: string | undefined,
  options: AutoCommandOptions = {}
): AutoCommandResult {
  if (typeof command !== 'string' || !command.trim()) return { verdict: 'doubt', reason: 'sin comando' }
  if (command.length > 16000) return { verdict: 'doubt', reason: 'comando demasiado largo' }
  const windows = !!projectRoot && /^[a-z]:/i.test(projectRoot)
  const root = projectRoot && isAbsolute(projectRoot.replace(/\\/g, '/')) ? normalizePath(projectRoot, windows) : ''
  const validRoot = root && root !== '/' && !/^[a-z]:\/?$/i.test(root) ? root : ''
  const home = options.home ? normalizePath(options.home, windows) : inferHome(validRoot)
  const approved = (options.approvedDirectories ?? [])
    .filter((d) => typeof d === 'string' && isAbsolute(d.replace(/\\/g, '/')) && !secretIn(d))
    .map((d) => normalizePath(windows && /^[\\/](?![\\/])/.test(d) ? validRoot.slice(0, 2) + d : d, windows))
    .filter((d) => d !== '/' && !/^[a-z]:\/?$/i.test(d) && d !== home)
  const escapes = options.shell ? /^(?:bash|zsh|sh|dash|ksh|fish|ash)$/.test(basename(options.shell)) : !windows
  const ctx: Ctx = {
    windows,
    cmdShell: CMD.test(basename(options.shell ?? '')) || /^cmd(?:\.exe)?\s/i.test(command),
    escapes,
    root: validRoot,
    home,
    approved,
    depth: 0,
    hard: [],
    doubt: [],
    downloads: new Set(),
    written: new Map(),
    sawRedirectOrAssign: false,
    strictUnparsed: options.unparsed === true
  }
  for (const dir of options.externalDirectories ?? []) {
    const secret = typeof dir === 'string' && secretIn(dir)
    if (secret) return { verdict: 'hard', reason: `toca ${secret}` }
  }
  let cwd: string | null = validRoot || null
  if (options.workdir !== undefined) {
    if (typeof options.workdir !== 'string') return { verdict: 'doubt', reason: 'carpeta de trabajo inválida' }
    const t = resolveTarget(options.workdir, validRoot || null, ctx)
    cwd = t.kind === 'path' ? t.path : null
  }
  classifyInto(command, [cwd], ctx)
  if (ctx.hard.length) return { verdict: 'hard', reason: ctx.hard[0] }
  if (ctx.doubt.length) return { verdict: 'doubt', reason: ctx.doubt[0] }
  // R7: además de resolver la redirección/asignación, strictUnparsed exige una gramática conocida en CADA orden.
  // Cualquier argumento, sustitución, expresión o subcomando dudoso ya dejó un motivo arriba. Una redirección nunca
  // convierte una rama antigua sin gramática estricta en allow.
  if (options.unparsed && !ctx.sawRedirectOrAssign) return { verdict: 'doubt', reason: 'el motor no pudo leer el comando' }
  return { verdict: 'allow', reason: 'inofensivo' }
}
