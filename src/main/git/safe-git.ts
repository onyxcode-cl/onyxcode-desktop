/** Git de la app: sin shell ni ejecución de configuración activa del repositorio. */
import { execFile, type ExecFileException } from 'node:child_process'
import { devNull } from 'node:os'

export interface SafeGitOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  input?: string | Buffer
  timeout?: number
  maxBuffer?: number
  allowHooks?: boolean
}
export interface SafeGitResult {
  error: ExecFileException | null
  stdout: Buffer
  stderr: Buffer
}

const CONFIG = [
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.sshCommand=',
  '-c',
  'core.pager=cat',
  '-c',
  'diff.external=',
  '-c',
  'core.askPass=',
  '-c',
  'core.quotepath=off',
  '-c',
  'submodule.recurse=false'
]
function environment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...source,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_OPTIONAL_LOCKS: '0',
    LC_ALL: 'C',
    LANG: 'C'
  }
  delete env.GIT_EXTERNAL_DIFF
  return env
}
function raw(args: string[], opts: SafeGitOptions, env: NodeJS.ProcessEnv, input?: string | Buffer): Promise<SafeGitResult> {
  return new Promise((resolve) => {
    const child = execFile(
      'git',
      args,
      {
        cwd: opts.cwd,
        env,
        shell: false,
        windowsHide: true,
        encoding: 'buffer',
        timeout: opts.timeout ?? 60_000,
        maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024
      },
      (error, stdout, stderr) => resolve({ error, stdout: stdout ?? Buffer.alloc(0), stderr: stderr ?? Buffer.alloc(0) })
    )
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(input)
  })
}
/** Primer subcomando después de las opciones globales que usan los llamadores de la app. */
function command(args: readonly string[]): { index: number; name: string } {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-c' || args[i] === '-C') {
      i++
      continue
    }
    if (!args[i].startsWith('-')) return { index: i, name: args[i] }
  }
  return { index: -1, name: '' }
}
function records(out: Buffer): Array<[string, string]> {
  return out
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((item) => {
      const i = item.indexOf('\n')
      return [item.slice(0, i), item.slice(i + 1)]
    })
}
/** Lee solo filtros, sin volcar otras opciones del repositorio ni sus posibles credenciales. */
async function localFilters(opts: SafeGitOptions, env: NodeJS.ProcessEnv, base: string[]): Promise<string[]> {
  const result = await raw(
    [
      ...base,
      'config',
      '--local',
      '--includes',
      '--null',
      '--get-regexp',
      '^(filter\\..*\\.(clean|smudge|process)|merge\\..*\\.driver|diff\\..*\\.(command|textconv)|mergetool\\..*\\.cmd|difftool\\..*\\.cmd|core\\.(editor|gitproxy|alternaterefscommand)|sequence\\.editor|credential\\.helper|uploadpack\\.packobjectshook|gpg\\.(program|ssh\\.program)|alias\\..*)$'
    ],
    opts,
    env
  )
  const code = result.error?.code
  if (result.error && code !== 1) throw new Error('No se pudo revisar la configuración local de filtros de Git')
  const names = new Set<string>()
  const active: string[] = []
  for (const [key] of records(result.stdout)) {
    const match = /^filter\.([a-zA-Z0-9][a-zA-Z0-9._-]*)\.(?:clean|smudge|process)$/i.exec(key)
    if (match) {
      names.add(match[1])
      continue
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(key)) throw new Error('No se pudo verificar una opción local de Git')
    const value = /^(merge\..*\.driver|mergetool\..*\.cmd|difftool\..*\.cmd|gpg\..*program)$/i.test(key)
      ? 'false'
      : /^(core\.editor|sequence\.editor)$/i.test(key)
        ? 'true'
        : ''
    active.push('-c', `${key}=${value}`)
  }
  if (!names.size) return active
  // El filtro global de LFS tiene prioridad explícita frente a cualquier redefinición local.
  let globalLfs = new Map<string, string>()
  if (names.has('lfs')) {
    const global = await raw(
      [...base, 'config', '--global', '--null', '--get-regexp', '^filter\\.lfs\\.(clean|smudge|process|required)$'],
      opts,
      env
    )
    if (!global.error) globalLfs = new Map(records(global.stdout))
    else if (global.error.code !== 1 && global.error.code !== 128) throw new Error('No se pudo revisar Git LFS global')
  }
  const args: string[] = [...active]
  for (const name of names) {
    for (const key of ['clean', 'smudge', 'process', 'required']) {
      const fallback = key === 'required' ? 'false' : ''
      args.push('-c', `filter.${name}.${key}=${name === 'lfs' ? (globalLfs.get(`filter.lfs.${key}`) ?? fallback) : fallback}`)
    }
  }
  return args
}
/** Única entrada de producción para ejecutar Git. Los filtros locales se neutralizan antes de comandos que pueden activarlos. */
export async function execSafeGit(args: readonly string[], opts: SafeGitOptions): Promise<SafeGitResult> {
  const env = environment(opts.env ?? process.env)
  const base = [...CONFIG, ...(opts.allowHooks ? [] : ['-c', `core.hooksPath=${devNull}`])]
  const sub = command(args)
  // Lista explícita de comandos reales: nunca se despacha un alias del repositorio.
  const builtins = new Set([
    'add',
    'commit',
    'status',
    'diff',
    'checkout',
    'switch',
    'worktree',
    'apply',
    'reset',
    'merge',
    'restore',
    'stash',
    'push',
    'pull',
    'rebase',
    'cherry-pick',
    'revert',
    'am',
    'archive',
    'clone',
    'fetch',
    'submodule',
    'read-tree',
    'checkout-index',
    'rev-parse',
    'config',
    'remote',
    'branch',
    'log',
    'show',
    'for-each-ref',
    'ls-remote',
    'version',
    'show-ref',
    'check-ref-format',
    'rev-list',
    'ls-files',
    'rm',
    'update-index'
  ])
  if (sub.name && !builtins.has(sub.name)) throw new Error('Subcomando de Git no permitido')
  if (sub.name === 'submodule') throw new Error('La app no actualiza submódulos')
  const filters = sub.name && !['config', 'version', 'rev-parse'].includes(sub.name) ? await localFilters(opts, env, base) : []
  const adjusted = [...args]
  if (['fetch', 'pull', 'clone'].includes(sub.name)) adjusted.splice(sub.index + 1, 0, '--no-recurse-submodules')
  if (['diff', 'log', 'show'].includes(sub.name)) adjusted.splice(sub.index + 1, 0, '--no-ext-diff', '--no-textconv')
  return raw([...base, ...filters, ...adjusted], opts, env, opts.input)
}
