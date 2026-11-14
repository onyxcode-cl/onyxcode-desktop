/**
 * V27: aprobación de terminal de Código y Overdrive «Automático». El motor conserva `bash * ask`;
 * se comprueba la orden COMPLETA antes de responder una vez. No es un sandbox: npm, scripts y
 * hooks del proyecto ejecutan código. Se permite por defecto salvo los patrones delicados.
 */
type Part = { words: string[]; literals: boolean[]; separator: string }

/** Léxico común de bash/zsh, PowerShell y cmd para buscar patrones delicados, sin ejecutar el shell. */
function parse(command: string): Part[] | null {
  const parts: Part[] = []
  let words: string[] = []
  let literals: boolean[] = []
  let word = ''
  let started = false
  let literal = false
  let quote = ''
  const flush = (): void => {
    if (started) {
      words.push(word)
      literals.push(literal)
    }
    word = ''
    started = false
    literal = false
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(c)) return null
    // Llaves, sustituciones y bloques no son un riesgo por sí mismos. Sus órdenes se revisan igual.
    if (!quote && /[{}()]/.test(c)) {
      flush()
      if (/[{}]/.test(c) && words.length) {
        parts.push({ words, literals, separator: ';' })
        words = []
        literals = []
      }
      continue
    }
    if (!quote && c === '\\' && /[;{}]/.test(command[i + 1] ?? '')) continue
    if (quote) {
      if (c === quote) quote = ''
      else {
        if (c === '\\' && command[i + 1] === quote) {
          word += command[++i]
          continue
        }
        word += c
      }
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      started = true
      literal = true
    } else if ((/\s/.test(c) && c !== '\n') || c === ',') flush()
    else if (/[|;&\n]/.test(c)) {
      flush()
      let separator = c
      if (command[i + 1] === c && /[|&]/.test(c)) separator += command[++i]
      if (!words.length) continue
      parts.push({ words, literals, separator })
      words = []
      literals = []
    } else if (/[<>]/.test(c)) {
      // Redirecciones, incluso sin espacios; duplicar fd no añade una ruta.
      flush()
      if (command[i + 1] === '&') {
        i++
        if (/\d/.test(command[i + 1] ?? '')) i++
        continue
      }
      words.push(c)
      literals.push(false)
      if (command[i + 1] === c) i++
    } else {
      word += c
      started = true
    }
  }
  if (quote) return null
  flush()
  if (words.length) parts.push({ words, literals, separator: '' })
  else if (![';', '\n', '&'].includes(parts.at(-1)?.separator ?? '')) return null
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
  if (value.startsWith('~') || /\$(?:HOME|env:)|%[a-z_][\w]*%/i.test(value) || sensitive(value)) return false
  // Miembros e índices numéricos de variables de PowerShell son expresiones, no comodines de una ruta.
  if (/^\$(?:[a-z_]\w*)(?:\.\w+|\[\d+\])*$/.test(value)) return true
  value = value.replace(/\\/g, '/')
  // Formatos y métodos de PowerShell no son rutas ni proveedores.
  if (/^\{.*\}$/.test(value) || /^\[[\w.]+\]::[\w.]+$/.test(value)) return true
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

/** El código de Python/JS no es una ruta ni sintaxis de shell. Sí se revisan sus literales de ruta. */
function safeInlineScript(script: string, cwd: string, root: string): boolean {
  if (
    /https?:\/\/|\b(?:urlopen|fetch)\s*\(|\b(?:requests|https?)\./i.test(script) &&
    /\b(?:exec|eval|compile|system|spawn|execSync|spawnSync|subprocess|child_process|Function)\b/.test(script)
  )
    return false
  const literals = script.matchAll(/(["'`])(.*?)\1/gs)
  for (const match of literals) {
    const value = match[2]
    // Etiquetas HTML usadas por split/parse no son rutas absolutas.
    if (/^<\/?[a-z][^>]*>$/i.test(value)) continue
    for (const word of value.split(/\s+/)) {
      if (sensitive(word)) return false
      if (/[\/\\]/.test(word) || /^(?:~|\.\.|\$HOME|\$env:|%\w+%)/i.test(word)) {
        if (!safeArgument(word, cwd, root)) return false
      }
    }
  }
  return true
}

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
  if (/\b(?:os\.(?:remove|unlink|rmdir)|shutil\.rmtree|fs(?:\.promises)?\.(?:rm|rmdir|unlink)(?:Sync)?)\s*\(|\.unlink\s*\(/i.test(command))
    return false
  if (
    /\bdefaults\s+(?:write|delete|import)\b|\blaunchctl\s+(?:setenv|unsetenv|load|unload|bootstrap|bootout|enable|disable|kickstart)\b|\b(?:systemctl|netsh|networksetup|scutil|set-service|start-service|stop-service)\b/i.test(
      command
    )
  )
    return false
  if (/r\^m\b/i.test(command)) return false
  const literalOutput = command
    .replace(/\b(?:echo|printf)\s+(['"])([^$`]*?)\1/g, 'echo')
    .replace(/\b(?:print|console\.log)\(\s*(['"])([^$`]*?)\1/g, 'print(')
  const atoms = literalOutput
    .replace(/[`^]/g, '')
    .split(/[\s;|&{}()"'`]+/)
    .filter(Boolean)
  if (atoms.some((a) => sensitive(a))) return false
  if (atoms.some((a) => delicateName(a.toLowerCase().replace(/\.exe$/, '')))) return false
  const parsed = parse(command)
  if (!parsed) return false
  const parts = parsed.map((part) =>
    /^(?:do|then|else)$/.test(part.words[0]) && part.words.length > 1
      ? { ...part, words: part.words.slice(1), literals: part.literals.slice(1) }
      : part
  )
  const downloads = atoms.some((a) => /^(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)(?:\.exe)?$/i.test(a))
  if (
    downloads &&
    parts.some(
      (p) =>
        SCRIPTING.test(p.words[0].toLowerCase().replace(/\.exe$/, '')) ||
        INTERPRETERS.test(p.words[0].toLowerCase().replace(/\.exe$/, '')) ||
        /^(?:iex|invoke-expression|eval)$/i.test(p.words[0]) ||
        /^(?:\.\/|\.\\)/.test(p.words[0])
    )
  )
    return false
  if (downloads) {
    const outputs = new Set<string>()
    for (const part of parts) {
      if (!/^(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)(?:\.exe)?$/i.test(part.words[0])) continue
      part.words.forEach((word, index) => {
        const previous = part.words[index - 1] ?? ''
        if (/^(?:-o|-outfile|--output|--output-document)$/i.test(previous))
          outputs.add(word.replace(/\\/g, '/').split('/').at(-1)!.toLowerCase())
        const option = /^--(?:output|output-document)=(.+)$/i.exec(word)
        if (option) outputs.add(option[1].replace(/\\/g, '/').split('/').at(-1)!.toLowerCase())
        if (/^https?:\/\//i.test(word)) outputs.add(word.split(/[/?#]/).filter(Boolean).at(-1)!.toLowerCase())
      })
    }
    if (
      parts.some((part) => {
        const name = part.words[0].replace(/\\/g, '/').split('/').at(-1)!.toLowerCase()
        return (
          outputs.has(name) ||
          (/^(?:start|start-process|nohup|exec|env|xargs)$/i.test(name) &&
            part.words.slice(1).some((word) => outputs.has(word.replace(/\\/g, '/').split('/').at(-1)!.toLowerCase())))
        )
      })
    )
      return false
  }
  let directories = [cwd]
  for (const part of parts) {
    const [first, ...args] = part.words
    const name = first.toLowerCase().replace(/\.exe$/, '')
    const inlineIndex = SCRIPTING.test(name) ? args.findIndex((_, i) => i > 0 && /^(?:-[ec])$/.test(args[i - 1])) : -1
    // Start-Process usa el runtime instalado fuera del proyecto, pero su cwd y sus scripts/argumentos
    // siguen sujetos a la política de carpeta. Un ejecutable arbitrario exterior no recibe esta excepción.
    const runtimeIndex = name === 'start-process' ? part.words.findIndex((_w, i) => i > 0 && /^-filepath$/i.test(part.words[i - 1])) : -1
    const runtime = part.words[runtimeIndex] ?? ''
    const runtimeName = runtime
      .replace(/\\/g, '/')
      .split('/')
      .at(-1)!
      .toLowerCase()
      .replace(/\.exe$/, '')
    const workingIndex =
      name === 'start-process' ? part.words.findIndex((_w, i) => i > 0 && /^-workingdirectory$/i.test(part.words[i - 1])) : -1
    if (name === 'start-process' && args.some((a, i) => /^-work/i.test(a) && (!args[i + 1] || /[$%`*?\[\]]/.test(args[i + 1]))))
      return false
    const localRuntime =
      runtimeIndex > 0 &&
      absolute(runtime) &&
      SCRIPTING.test(runtimeName) &&
      !sensitive(runtime) &&
      workingIndex > 0 &&
      !/[$%`*?\[\]]/.test(part.words[workingIndex]) &&
      directories.every((dir) => safeArgument(windows ? part.words[workingIndex].toLowerCase() : part.words[workingIndex], dir, root))
    // Se inspeccionan todos los argumentos: también el programa de xargs/find -exec.
    if (delicateName(name) || ((absolute(first) || first.startsWith('.')) && !safeArgument(first, cwd, root))) return false
    if (
      args.some((a, i) => {
        if (i === inlineIndex) return directories.some((dir) => !safeInlineScript(a, dir, root))
        if (a === '/' && part.words.some((w) => /^\[math\]::/i.test(w))) return false
        if (name === 'cmd' && /^\/[cdsq]$/i.test(a)) return false
        if (localRuntime && i + 1 === runtimeIndex) return false
        // El segundo argumento literal de Matches es el patrón regex, no una ruta del proyecto.
        // No se extiende a cadenas que parecen rutas ni a variables que puedan ocultar una ruta sensible.
        if (part.literals[i + 1] && /^\[regex\]::matches$/i.test(part.words[i - 1] ?? '') && !/[\\/$`]/.test(a) && !sensitive(a))
          return false
        return directories.some((dir) => !safeArgument(windows ? a.toLowerCase() : a, dir, root))
      })
    )
      return false
    const lower = args.map((a) => a.toLowerCase())
    // También se revisan las órdenes explícitas pasadas a envoltorios (npx, npm exec…).
    if (
      !['echo', 'printf'].includes(name) &&
      lower.some((a) => (a !== '.' && delicateName(a.replace(/\.exe$/, ''))) || /^--(?:delete|remove-files)$/.test(a))
    )
      return false
    if (name === 'find' && lower.some((a) => a === '-delete')) return false
    if (INTERPRETERS.test(name) || ['eval', 'invoke-command', 'iex', 'invoke-expression'].includes(name)) {
      const script = ['eval', 'iex', 'invoke-expression'].includes(name)
        ? args.join(' ')
        : args.find((_, i) => i > 0 && /^(?:-[ec]|-command|\/c)$/i.test(args[i - 1]))
      if (script && !isAutoApprovableCodeCommand(script, projectRoot, cwd)) return false
    }
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
