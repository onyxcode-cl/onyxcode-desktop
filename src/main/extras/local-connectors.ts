/**
 * Conectores LOCALES del catálogo (F8-B186): programas de terceros (el servidor de Google Workspace y el de Microsoft 365) que la
 * app descarga e instala en una carpeta propia y que el motor lanza como servidor MCP local. Esto CAMBIA a propósito el contrato
 * «añadir un conector no ejecuta nada» de los remotos; por eso todo aquí es cerrado:
 *
 * - Nada que escriba la persona entra en un comando, argumento o variable de entorno: el nombre del servidor se valida con
 *   `MCP_NAME_RE` y solo nombra una carpeta; todo lo demás viene del catálogo empaquetado (`validateCatalog` lo exige).
 * - Sin shell: `execFile` con una lista de argumentos. El instalador (`uv` o `npm`) corre con entorno mínimo y sin la configuración
 *   del usuario (`--no-config`, `.npmrc` vacío), `--require-hashes`/`npm ci` (cada paquete se comprueba contra el hash del archivo
 *   de bloqueo), solo ruedas ya compiladas (`--only-binary :all:`) y `--ignore-scripts` (ninguna instalación ejecuta código de
 *   terceros). Los archivos de bloqueo viajan dentro de la app y su SHA-256 se comprueba antes de usarlos.
 * - Todo vive en `userData/conectores-locales/<nombre>/` (programa, caché, registros, el acceso que guarde el servidor y el archivo
 *   del cliente OAuth): quitar el conector borra esa carpeta entera y no queda nada más.
 * - El archivo del cliente OAuth de la persona se elige con el diálogo del sistema; el contenido NO pasa por la pantalla ni por el
 *   chat. Se valida y se reescribe normalizado con las direcciones de Google fijas (un archivo manipulado no puede desviar el
 *   token), con permiso 0600.
 *
 * Honestidad sobre el aislamiento: estos programas corren con los permisos de tu usuario, FUERA del sandbox de Overdrive (Seatbelt en
 * Mac, WSL2 en Windows). Nunca se ofrecen en Overdrive (ver `tasks/mcp-tasks.ts`). Ver `docs/SEGURIDAD.md` §3 (F8-B186).
 */
import { t } from '@shared/i18n'
import type { AppMcpConfig, McpLocalEntry } from '@shared/ipc-extras'
import type { CatalogLocalConnector, LocalRuntime } from '@shared/catalogo'
import type { LocalConnectorReadiness, McpCatalogProvenance } from '@shared/mcp-catalog'
import { MCP_NAME_RE } from '@shared/mcp-catalog'
import { buildLocalEntry, launchCommand, localPermissionKeys, localPermissions, LOCAL_MCP_TIMEOUT_MS } from '@shared/local-connector'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { delimiter, join, resolve, sep } from 'node:path'
import { augmentedPath, minimalEnv } from '../process/child-env'

/** Tiempo máximo de la instalación (descarga de ~100 paquetes) y de cada paso. */
const INSTALL_TIMEOUT_MS = 15 * 60_000
/** Cuánto vale el archivo del cliente elegido antes de instalar. */
const STAGED_TTL_MS = 30 * 60_000
const CLIENT_FILE_MAX_BYTES = 64 * 1024

export interface RunResult {
  code: number | null
  output: string
}
export type Runner = (
  file: string,
  args: string[],
  opts: { cwd: string; env: Record<string, string>; timeoutMs: number }
) => Promise<RunResult>

/** Ejecuta un programa SIN shell, con límite de tiempo, y junta su salida (se corta a la cola para los errores). */
export const defaultRunner: Runner = (file, args, opts) =>
  new Promise((done) => {
    execFile(
      file,
      args,
      { cwd: opts.cwd, env: opts.env, timeout: opts.timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const output = `${stdout ?? ''}${stderr ?? ''}`
        const raw = err ? (err as { code?: unknown }).code : 0
        done({ code: typeof raw === 'number' ? raw : 1, output })
      }
    )
  })

/** Busca un programa en el PATH ampliado (apps abiertas desde el Finder traen un PATH mínimo). */
export function findExecutable(name: string, pathValue: string = augmentedPath()): string | null {
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, name)
    try {
      accessSync(candidate, constants.X_OK)
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // siguiente carpeta
    }
  }
  return null
}

export interface LocalDeps {
  /** `userData/conectores-locales`. */
  baseDir: string
  platform: NodeJS.Platform
  /** Archivos de bloqueo (`local-connector-files.ts`). */
  files: Readonly<Record<string, string>>
  run: Runner
  find: (name: string) => string | null
  now: () => number
}

const sha256 = (text: string): string => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')

/** Carpeta de un conector; el nombre solo puede nombrar una carpeta directa de `baseDir`. */
export function localDir(baseDir: string, name: string): string {
  if (!MCP_NAME_RE.test(name)) throw new Error(t('merr.mcp.invalidName'))
  return join(baseDir, name)
}

/** ¿`dir` está dentro de `baseDir` (sin symlinks que lo saquen)? */
export function isInside(baseDir: string, dir: string): boolean {
  const base = resolve(baseDir) + sep
  const target = resolve(dir)
  if (!target.startsWith(base) || target === resolve(baseDir)) return false
  try {
    const real = realpathSync(target)
    return real.startsWith(realpathSync(baseDir) + sep)
  } catch {
    return true // aún no existe: ya se comprobó el prefijo
  }
}

export function localReadiness(item: CatalogLocalConnector, deps: Pick<LocalDeps, 'platform' | 'find'>): LocalConnectorReadiness {
  const rt = item.runtime
  const need = rt.manager === 'uv' ? ['uv'] : ['npm', 'node']
  return {
    platformOk: rt.platforms.includes(deps.platform),
    manager: rt.manager,
    managerFound: need.every((n) => deps.find(n) !== null)
  }
}

/** Lee del paquete los archivos de bloqueo y comprueba su SHA-256 contra la ficha. Lanza si no coinciden. */
export function verifiedLockFiles(
  item: CatalogLocalConnector,
  files: Readonly<Record<string, string>>
): Array<{ name: string; text: string }> {
  return item.runtime.files.map((f) => {
    const text = files[`${item.runtime.dir}/${f.name}`]
    if (typeof text !== 'string') throw new Error(t('merr.local.lockMissing', { file: f.name }))
    if (sha256(text) !== f.sha256) throw new Error(t('merr.local.lockHash', { file: f.name }))
    return { name: f.name, text }
  })
}

// ---- archivo del cliente OAuth de Google ----

export interface StagedClient {
  /** JSON normalizado listo para escribir (contiene el secreto del cliente: nunca sale de main). */
  json: string
  /** Primeros caracteres del identificador del cliente (no es secreto) para que la persona reconozca cuál eligió. */
  hint: string
  at: number
}

const GOOGLE_CLIENT_ID_RE = /^[0-9]{6,20}-[a-z0-9]{8,64}\.apps\.googleusercontent\.com$/
const GOOGLE_CLIENT_SECRET_RE = /^[A-Za-z0-9_-]{8,128}$/

/**
 * Valida el archivo «client_secret_….json» que descarga la consola de Google y devuelve una versión normalizada con las
 * direcciones de Google FIJAS. Solo clientes de tipo «Aplicación de escritorio» («installed»): los de tipo web exigen registrar
 * direcciones de retorno que este programa no usa.
 */
export function normalizeGoogleClientFile(text: string): StagedClient {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(t('merr.local.clientBadJson'))
  }
  const root = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  if (root && 'web' in root && !('installed' in root)) throw new Error(t('merr.local.clientIsWeb'))
  const inst =
    root && root.installed && typeof root.installed === 'object' && !Array.isArray(root.installed)
      ? (root.installed as Record<string, unknown>)
      : null
  if (!inst) throw new Error(t('merr.local.clientNoInstalled'))
  const id = inst.client_id
  const secret = inst.client_secret
  if (typeof id !== 'string' || !GOOGLE_CLIENT_ID_RE.test(id)) throw new Error(t('merr.local.clientBadId'))
  if (typeof secret !== 'string' || !GOOGLE_CLIENT_SECRET_RE.test(secret)) throw new Error(t('merr.local.clientBadSecret'))
  const normalized = {
    installed: {
      client_id: id,
      client_secret: secret,
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
      auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
      redirect_uris: ['http://localhost']
    }
  }
  return { json: JSON.stringify(normalized, null, 2) + '\n', hint: `${id.slice(0, 8)}…`, at: 0 }
}

/** Lee el archivo elegido (regular, pequeño) y lo normaliza. */
export function stageClientFileFromDisk(path: string, now: number): StagedClient {
  const st = lstatSync(path)
  if (!st.isFile() || st.size === 0 || st.size > CLIENT_FILE_MAX_BYTES) throw new Error(t('merr.local.clientBadFile'))
  return { ...normalizeGoogleClientFile(readFileSync(path, 'utf8')), at: now }
}

// ---- entrada de opencode.json (la construcción vive en `@shared/local-connector`, la misma que usa la pantalla) ----

export { buildLocalEntry, launchCommand, localPermissionKeys, localPermissions, LOCAL_MCP_TIMEOUT_MS }

/** ¿La entrada de `opencode.json` sigue siendo EXACTAMENTE la que escribió la app? (si no, el conector está «modificado»). */
export function localEntryDrifted(item: CatalogLocalConnector, prov: McpCatalogProvenance, cfg: AppMcpConfig, name: string): boolean {
  const entry = cfg.servers[name]
  if (!prov.local || !entry || entry.type !== 'local') return true
  const nodeBin = item.runtime.manager === 'npm' ? prov.local.bin : null
  const expected = buildLocalEntry(item, prov.local.dir, nodeBin)
  const strip = (e: typeof entry): unknown => ({ command: e.command, environment: e.environment ?? {}, cwd: e.cwd ?? null })
  return JSON.stringify(strip(entry)) !== JSON.stringify(strip(expected))
}

// ---- instalación ----

function tail(output: string, max = 1200): string {
  const clean = output.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').trim()
  return clean.length > max ? '…' + clean.slice(clean.length - max) : clean
}

async function step(deps: LocalDeps, label: string, file: string, args: string[], cwd: string, env: Record<string, string>): Promise<void> {
  const r = await deps.run(file, args, { cwd, env, timeoutMs: INSTALL_TIMEOUT_MS })
  if (r.code !== 0) throw new Error(t('merr.local.stepFailed', { step: label, detail: tail(r.output) }))
}

/** `workspace-mcp` → `workspace_mcp` (nombre de la carpeta `.dist-info` de Python). */
const pyDistName = (pkg: string): string => pkg.replace(/[-.]+/g, '_').toLowerCase()

/** Comprueba que lo instalado es la versión fijada (no cualquier otra que hubiera en la carpeta). */
export function installedVersionOk(rt: LocalRuntime, dir: string): boolean {
  try {
    if (rt.manager === 'npm') {
      const pkg = JSON.parse(readFileSync(join(dir, 'node_modules', ...rt.package.split('/'), 'package.json'), 'utf8')) as {
        version?: unknown
      }
      return pkg.version === rt.version
    }
    const lib = join(dir, 'venv', 'lib')
    for (const py of readdirSync(lib)) {
      const site = join(lib, py, 'site-packages')
      if (existsSync(join(site, `${pyDistName(rt.package)}-${rt.version}.dist-info`))) return true
    }
    return false
  } catch {
    return false
  }
}

export interface LocalInstallResult {
  dir: string
  /** Programa con el que se lanza (ruta de `node` para npm; el ejecutable del entorno para uv). */
  bin: string
  entry: McpLocalEntry
}

/**
 * Instala el conector en su carpeta. Si algo falla, borra la carpeta entera (no queda nada a medias). NO escribe `opencode.json`
 * ni la procedencia: eso lo hace quien llama, después, y deshace con `removeLocalFiles` si falla.
 */
export async function installLocalFiles(
  deps: LocalDeps,
  item: CatalogLocalConnector,
  name: string,
  client: StagedClient | null,
  enable = true
): Promise<LocalInstallResult> {
  const rt = item.runtime
  if (!rt.platforms.includes(deps.platform)) throw new Error(t('merr.local.platform'))
  const dir = localDir(deps.baseDir, name)
  if (!isInside(deps.baseDir, dir)) throw new Error(t('merr.mcp.invalidName'))
  if (existsSync(dir)) throw new Error(t('merr.mcp.exists', { name }))
  const lock = verifiedLockFiles(item, deps.files) // antes de tocar el disco
  if (rt.clientFile) {
    if (!client || deps.now() - client.at > STAGED_TTL_MS) throw new Error(t('merr.local.clientMissing'))
  }
  const tool = rt.manager === 'uv' ? deps.find('uv') : deps.find('npm')
  const nodeBin = rt.manager === 'npm' ? deps.find('node') : null
  if (!tool || (rt.manager === 'npm' && !nodeBin)) throw new Error(t(rt.manager === 'uv' ? 'merr.local.noUv' : 'merr.local.noNode'))

  mkdirSync(deps.baseDir, { recursive: true, mode: 0o700 })
  mkdirSync(dir, { mode: 0o700 })
  try {
    for (const f of lock) writeFileSync(join(dir, f.name), f.text, { encoding: 'utf8', mode: 0o600 })
    for (const sub of [rt.tokenDir, 'registros']) mkdirSync(join(dir, sub), { recursive: true, mode: 0o700 })
    if (rt.clientFile && client) {
      const file = join(dir, rt.clientFile.file)
      writeFileSync(file, client.json, { encoding: 'utf8', mode: 0o600 })
      chmodSync(file, 0o600)
    }
    if (rt.manager === 'uv') {
      const env = minimalEnv({
        UV_PYTHON_INSTALL_DIR: join(dir, 'python'),
        UV_NO_PROGRESS: '1',
        UV_NO_CONFIG: '1',
        UV_CACHE_DIR: join(dir, '.cache')
      })
      const common = ['--no-config', '--no-cache', '--managed-python']
      await step(deps, 'uv venv', tool, [...common, 'venv', '--python', rt.python ?? '3.12', join(dir, 'venv')], dir, env)
      await step(
        deps,
        'uv pip install',
        tool,
        [
          ...common,
          'pip',
          'install',
          '--python',
          join(dir, 'venv', 'bin', 'python'),
          '--require-hashes',
          '--only-binary',
          ':all:',
          '--no-deps',
          '-r',
          join(dir, 'requirements.lock')
        ],
        dir,
        env
      )
    } else {
      // Dos archivos distintos y vacíos (npm no admite el mismo para «user» y «global»): ninguna configuración ajena entra.
      const emptyRc = join(dir, '.npmrc-vacio')
      const emptyGlobalRc = join(dir, '.npmrc-global-vacio')
      writeFileSync(emptyRc, '', { encoding: 'utf8', mode: 0o600 })
      writeFileSync(emptyGlobalRc, '', { encoding: 'utf8', mode: 0o600 })
      const cache = join(dir, '.npm-cache')
      const env = minimalEnv({ npm_config_cache: cache, npm_config_update_notifier: 'false', NO_COLOR: '1' })
      await step(
        deps,
        'npm ci',
        tool,
        [
          'ci',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--registry',
          'https://registry.npmjs.org/',
          '--userconfig',
          emptyRc,
          '--globalconfig',
          emptyGlobalRc,
          '--cache',
          cache,
          '--loglevel',
          'error'
        ],
        dir,
        env
      )
      rmSync(cache, { recursive: true, force: true })
      rmSync(emptyRc, { force: true })
      rmSync(emptyGlobalRc, { force: true })
    }
    if (!existsSync(join(dir, rt.entry)) || !installedVersionOk(rt, dir))
      throw new Error(t('merr.local.versionMismatch', { version: rt.version }))
    // Sin permisos de escritura de grupo/otros en la carpeta del programa.
    chmodSync(dir, 0o700)
    const bin = rt.manager === 'npm' ? (nodeBin as string) : join(dir, rt.entry)
    return { dir, bin, entry: buildLocalEntry(item, dir, nodeBin, enable) }
  } catch (err) {
    rmSync(dir, { recursive: true, force: true })
    throw err
  }
}

/** Borra la carpeta del conector (programa, acceso guardado, secreto del cliente, registros). Devuelve cuántos archivos tenía. */
export function removeLocalFiles(baseDir: string, dir: string): number {
  if (!isInside(baseDir, dir)) return 0
  let count = 0
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name))
      else count++
    }
  }
  try {
    if (existsSync(dir)) walk(dir)
  } catch {
    // se borra igual
  }
  rmSync(dir, { recursive: true, force: true })
  return count
}
