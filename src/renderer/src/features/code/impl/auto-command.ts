/**
 * V27: aprobación de terminal exclusiva de Código «Automático». El motor conserva `bash * ask`;
 * se comprueba la orden COMPLETA antes de responder una vez. No es un sandbox: npm, scripts y
 * hooks del proyecto ejecutan código. Sintaxis dinámica o ambigua conserva la tarjeta.
 */
type Part = { words: string[]; separator: string }

/** Léxico común conservador de bash/zsh, PowerShell y cmd. No interpreta expansiones ni scripts. */
function parse(command: string): Part[] | null {
  const parts: Part[] = []
  let words: string[] = []
  let word = ''
  let started = false
  let quote = ''
  const flush = (): void => {
    if (started) words.push(word)
    word = ''
    started = false
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    // Expansiones, escapes de cmd/PowerShell, bloques, comentarios y sustituciones: preguntar.
    if (/[$`^%{}()\u0000-\u0008\u000b-\u001f\u007f\u2018-\u201f]/.test(c)) return null
    if (quote) {
      if (c === quote) quote = ''
      else {
        if (c === '\\' && /["'\\]/.test(command[i + 1] ?? '')) return null
        word += c
      }
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      started = true
    } else if (/\s/.test(c) && c !== '\n') flush()
    else if (/[|;&\n]/.test(c)) {
      flush()
      let separator = c
      if (command[i + 1] === c && /[|&]/.test(c)) separator += command[++i]
      if (!words.length || separator === '&') return null
      parts.push({ words, separator })
      words = []
    } else if (/[<>]/.test(c)) {
      // Redirecciones sencillas, incluso sin espacios. Los duplicados de fd se preguntan.
      flush()
      if (command[i + 1] === '&' || command[i + 1] === '<') return null
      words.push(c)
      if (command[i + 1] === c) i++
    } else {
      if (c === '#' || c === '!' || (c === '\\' && /[\s;|&"']/.test(command[i + 1] ?? ''))) return null
      word += c
      started = true
    }
  }
  if (quote) return null
  flush()
  if (words.length) parts.push({ words, separator: '' })
  else if (parts.at(-1)?.separator !== ';' && parts.at(-1)?.separator !== '\n') return null
  return parts.length ? parts : null
}

function normalize(path: string): string {
  const slash = path.replace(/\\/g, '/')
  const out: string[] = []
  for (const s of slash.split('/')) {
    if (!s || s === '.') continue
    if (s === '..') out.pop()
    else out.push(s)
  }
  return (slash.startsWith('/') ? '/' : '') + out.join('/')
}

const absolute = (p: string): boolean => /^(?:\/|[a-z]:[\\/])/i.test(p)
const inside = (p: string, root: string): boolean => p === root || p.startsWith(root + '/')
const pathFor = (p: string, cwd: string): string => normalize(absolute(p) ? p : `${cwd}/${p}`)

function sensitive(value: string): boolean {
  const segments = value.replace(/\\/g, '/').toLowerCase().split('/')
  return segments.some((s) => {
    const p = s.replace(/[. ]+$/, '').replace(/::?\$data$/i, '')
    return (
      /(?:^|\.)env(?:[.\w-]*$)/.test(p) ||
      /^(?:\.git|\.gitattributes|\.gitmodules|\.ssh|\.aws|\.azure|\.gnupg|\.kube|\.config|\.npmrc|\.netrc|\.gitconfig|\.mcp.json|\.opencode|\.claude|\.vscode|\.idea|\.husky)$/.test(
        p
      ) ||
      /^(?:opencode\.jsonc?|auth\.json|credentials(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?)$/.test(p) ||
      /\.(?:pem|key|p12|pfx|keystore)$/.test(p) ||
      /~\d/.test(p)
    )
  })
}

/** Un argumento puede ser una ruta, una opción con ruta o un fichero de respuesta (@archivo). */
function safeArgument(arg: string, cwd: string, root: string): boolean {
  let value = arg.replace(/^[^=]+=|^@/, '')
  if (/^https?:\/\//i.test(value)) return true
  if (/^(?:~|[a-z]:[^\\/]|[a-z]+:)/i.test(value) && !absolute(value)) return false
  if (value.startsWith('~') || sensitive(value)) return false
  value = value.replace(/\\/g, '/')
  // Sin flujos alternativos de NTFS ni proveedores del shell ocultos en una ruta.
  if (value.replace(/^[a-z]:\//i, '').includes(':')) return false
  // UNC, proveedores de PowerShell y rutas con expansión ambigua.
  if (value.startsWith('//') || /[\[\]]/.test(value) || /(?:^|\/)\.[^/]*[*?]/.test(value)) return false
  if (/^-[a-z]+(?:\/|[a-z]:[\\/])/i.test(value)) return false
  if (absolute(value) || value.includes('/') || value === '..') {
    const path = pathFor(value, cwd)
    if (!inside(path, root)) return false
    // No aceptar una ruta que sale y después vuelve a entrar al proyecto.
    const abs = absolute(value)
    if (abs && !inside(value, root)) return false
    let depth = abs ? 0 : cwd.slice(root.length).split('/').filter(Boolean).length
    for (const segment of (abs ? value.slice(root.length) : value).split('/')) {
      if (segment === '..' && --depth < 0) return false
      if (segment && segment !== '.' && segment !== '..') depth++
    }
  }
  return true
}

const DELICATE = new Set([
  'rm',
  'rmdir',
  'del',
  'erase',
  'rd',
  'remove-item',
  'ri',
  'unlink',
  'trash',
  'rimraf',
  'sudo',
  'su',
  'doas',
  'runas',
  'set-executionpolicy',
  'reg',
  'regedit',
  'set-itemproperty',
  'new-itemproperty',
  'remove-itemproperty',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'restart-computer',
  'stop-computer',
  'format',
  'format-volume',
  'diskpart',
  'diskutil',
  'mkfs',
  'dd',
  'mount',
  'umount',
  'eval',
  'invoke-expression',
  'iex',
  'source',
  '.',
  'exec',
  'command',
  'env',
  'time',
  'nohup',
  'nice',
  'timeout',
  'watch',
  'stdbuf',
  'ionice',
  'busybox',
  'builtin',
  'start-process',
  'start',
  'pushd',
  'popd',
  'set-alias',
  'new-alias',
  'sal',
  'unalias',
  'export',
  'set',
  'brew',
  'apt',
  'apt-get',
  'yum',
  'winget',
  'choco',
  'scoop',
  'msiexec'
])
const INTERPRETERS = /^(?:ba|z|da|k|c)?sh$|^(?:cmd|powershell|pwsh|wscript|cscript)$/
const SCRIPTING = /^(?:node|nodejs|python[\d.]*|ruby|perl|php|bun|deno)$/
const LOCATION = /^(?:cd|chdir|set-location|sl)$/
const delicateName = (name: string): boolean =>
  DELICATE.has(name) ||
  (!['new-item', 'set-item'].includes(name) && name.includes('-') && [...DELICATE].some((full) => full.startsWith(name)))

/** Sin raíz conocida, cwd exterior o sintaxis que no podamos resolver: preguntar. */
export function isAutoApprovableCodeCommand(command: string | undefined, projectRoot: string | undefined, workdir?: unknown): boolean {
  if (!command?.trim() || command.length > 16000 || !projectRoot || !absolute(projectRoot)) return false
  const windows = /^[a-z]:/i.test(projectRoot)
  const root = normalize(windows ? projectRoot.toLowerCase() : projectRoot)
  if (!root || root === '/' || /^[a-z]:$/i.test(root)) return false
  let cwd = root
  if (workdir !== undefined) {
    if (typeof workdir !== 'string' || !safeArgument(windows ? workdir.toLowerCase() : workdir, cwd, root)) return false
    cwd = pathFor(windows ? workdir.toLowerCase() : workdir, cwd)
  }
  const parts = parse(command)
  if (!parts) return false
  const downloads = parts.some((p) => /^(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)(?:\.exe)?$/i.test(p.words[0]))
  if (downloads && parts.some((p) => SCRIPTING.test(p.words[0].toLowerCase().replace(/\.exe$/, '')))) return false
  let directories = [cwd]
  for (const [index, part] of parts.entries()) {
    const [first, ...args] = part.words
    const name = first.toLowerCase().replace(/\.exe$/, '')
    // Envoltorios y ejecutables con ruta no permiten identificar con certeza la orden efectiva.
    if (!/^[a-z][a-z0-9_-]*$/.test(name) || delicateName(name) || INTERPRETERS.test(name)) return false
    if (args.some((a) => directories.some((dir) => !safeArgument(windows ? a.toLowerCase() : a, dir, root)))) return false
    const lower = args.map((a) => a.toLowerCase())
    // También se revisan las órdenes explícitas pasadas a envoltorios (npx, npm exec…).
    if (lower.some((a) => (a !== '.' && delicateName(a.replace(/\.exe$/, ''))) || /^--(?:delete|remove-files)$/.test(a))) return false
    if (name === 'find' && lower.some((a) => /^-(?:delete|exec|ok)/.test(a))) return false
    if (name === 'xargs' || name === 'forfiles' || name === 'invoke-command') return false
    // sed también puede ejecutar programas o cargar un programa desde un archivo.
    if (name === 'sed' && lower.some((a) => /^-[^-]*[ef]|^--(?:expression|file)|^(?:[\d,$]+)?e\s|^s(.).*\1[a-z]*[ew]/.test(a))) return false
    if (SCRIPTING.test(name) && (parts[index - 1]?.separator === '|' || lower.some((a) => /^-(?:[ec]|command|encodedcommand)/.test(a))))
      return false
    if (name === 'get-content' && parts[index - 1]?.separator === '|') return false
    if (/^(?:npm|pnpm|yarn|bun|pip[\d.]*|uv)$/.test(name) && lower.some((a) => /^(?:-g|--global|--system|--user)$/.test(a))) return false
    if (name === 'git') {
      if (args.some((a) => /^-[cC]|^--(?:git-dir|work-tree|exec-path|config-env|namespace)/.test(a))) return false
      const gitArgs = [...lower]
      while (/^--(?:no-pager|paginate|literal-pathspecs|no-optional-locks)$/.test(gitArgs[0] ?? '')) gitArgs.shift()
      const sub = gitArgs.shift()
      // Una opción global desconocida puede cambiar la interpretación del subcomando.
      if (!sub || sub.startsWith('-')) return false
      if (['clean', 'restore', 'config', 'gc', 'prune', 'reflog'].includes(sub)) return false
      if (sub === 'reset' && gitArgs.some((a) => /^--h/.test(a))) return false
      if (sub === 'checkout' && (gitArgs.length > 1 || gitArgs.some((a) => /^-/.test(a)))) return false
      if (sub === 'push' && gitArgs.some((a) => /^--(?:f|d|m)|^-[^-]*[fd]/.test(a) || a.startsWith('+') || a.startsWith(':'))) return false
      if ((sub === 'branch' || sub === 'tag') && args.some((a) => /^-[dD]|^--delete/.test(a))) return false
      if (sub === 'rebase' && gitArgs.some((a) => /^-x|^--exec/.test(a))) return false
    }
    if (LOCATION.test(name)) {
      const target = args.filter((a) => !/^-(?:path|literalpath)$/i.test(a))
      if (target.length !== 1 || /[*?<>]/.test(target[0]) || part.separator === '|' || part.separator === '||') return false
      const next = directories.map((dir) => pathFor(windows ? target[0].toLowerCase() : target[0], dir))
      // Con «;» también puede continuar si `cd` falla: ambos cwd deben seguir siendo seguros.
      directories = [...new Set(part.separator === '&&' ? next : [...directories, ...next])]
      if (directories.length > 8) return false
    }
  }
  return true
}
