/**
 * Backend Windows del MCP de Control del PC (plan C, C3): habla con `cu-helper.exe` por el MISMO protocolo de línea de comandos +
 * JSON que el helper de macOS (`resources/computer-use/protocol.json`), con las extensiones de Windows (`version`, `session`,
 * `screenshot`, `list-apps`, `release-input`, banderas de `window-shot`). NADA de esto se ha probado en un Windows real: el
 * helper de Windows aún no existe; se prueba con el helper falso `e2e/fake-cu-helper/fake.mjs`.
 *
 * Qué aporta frente a macOS (todo falla CERRADO):
 *   - Versión del protocolo: `version` → `{protocol: 1}`; otra versión o un helper que no conoce el comando = «incompatible».
 *   - Consentimiento propio de la app (versionado y revocable): `GET <canal>/consent` → `{consent, version}` antes de CADA herramienta.
 *   - Sesión: `session` → `{interactive, secureDesktop, elevatedTarget}` (salida 12 = sin escritorio interactivo / SSH / bloqueada).
 *     Ratón y teclado reales se rechazan si la ventana de destino es de administrador (`elevatedTarget`).
 *   - Capturas: no hay exclusión del compositor; el helper enmascara por orden Z las apps sin concesión (`--mask-keys`) y las
 *     bloqueadas/elevadas por sí mismo. Si no se puede enmascarar (sin canal, sin lista de apps, salida 11/12, respuesta o archivo
 *     inválidos, o cambió el conjunto de apps sin concesión mientras se capturaba) NO hay captura y se borra el archivo.
 *   - Política de teclas (`policy/win-keys.ts`): `cmd` rechazado, combinaciones del sistema bloqueadas, atajo de parada propio.
 *   - Parada ordenada: `STOP\n` por stdin, a los 300 ms `taskkill /PID <pid> /T /F` y SIEMPRE `release-input` después. Si el MCP
 *     muere, el EOF de stdin hace que el helper suelte la entrada y salga con 3 (contrato).
 *   - Tiempo (15 s) y tamaño de salida (4 MiB) del contrato; excederlos mata el árbol de procesos y suelta la entrada.
 *
 * Solo builtins de Node y módulos puros de `policy/` (parte del bundle `computer-mcp`: no importa `electron`).
 */
import { execFile as nodeExecFile, type ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import type { AppRef, HelperResult, PlatformBackend, PlatformHost, Screen } from './mcp-platform'
import { aumidKey, exeBaseName, exeKey, parseAppKey } from './policy/app-key'
import { checkKeys } from './policy/win-keys'

/** Límites del contrato del helper (`protocol.json` → `io`); una prueba los compara con el JSON. */
export const WIN_HELPER_LIMITS = {
  protocol: 1,
  timeoutMs: 15_000,
  maxOutputBytes: 4 * 1024 * 1024,
  /** Tiempo entre `STOP` y el `taskkill`. */
  stopGraceMs: 300
} as const

/** Apps que nunca se enmascaran por no tener concesión (Lazunox y el shell). `explorer.exe` NO está: sus carpetas piden concesión. */
const DEFAULT_EXEMPT_EXES = [
  'lazunox.exe',
  'electron.exe',
  'dwm.exe',
  'shellexperiencehost.exe',
  'startmenuexperiencehost.exe',
  'searchhost.exe',
  'textinputhost.exe'
]

const MSG = {
  consent:
    'Control del PC no está activado: el usuario debe activarlo en Ajustes › Control del PC (consentimiento de la app). ' +
    'No se puede actuar hasta entonces; explícaselo y detente.',
  consentUnverified: 'No se pudo verificar el consentimiento de Control del PC con Lazunox; acción rechazada',
  stopped: 'Control detenido por el usuario',
  noDesktop:
    'No hay un escritorio interactivo disponible (sesión bloqueada, aviso de seguridad de Windows, sesión remota desconectada o ' +
    'Lazunox lanzado sin pantalla). Control del PC en pausa: pide al usuario que vuelva a su escritorio.',
  elevated: 'La ventana pertenece a un programa con permisos de administrador; Lazunox no puede ni debe controlarla. Hazlo tú.',
  blocked:
    'Esa ventana o acción no está permitida: pertenece a un programa bloqueado o con permisos de administrador. Lazunox no puede ni debe controlarla. Hazlo tú.',
  incompatible: (found: string): string =>
    `El helper de Control del PC es de una versión incompatible (${found}; se esperaba el protocolo ${WIN_HELPER_LIMITS.protocol}). ` +
    'Reinstala Lazunox.'
}

/** Mensaje de captura rechazada: nunca se envía una imagen sin poder enmascarar lo que no tiene concesión. */
const noCapture = (why: string): Error =>
  new Error(
    `No se hace la captura porque no se puede garantizar que las apps sin acceso queden ocultas (${why}). ` +
      'Reintenta; si persiste, díselo al usuario.'
  )

/** Mensajes de los códigos de salida del contrato (Windows). `null` = sin mensaje propio (se usa stderr). */
function exitMessage(code: number): string | null {
  switch (code) {
    case 2:
      return MSG.consent
    case 3:
      return MSG.stopped
    case 7:
      return 'Esa app no está en ejecución.'
    case 8:
      return 'El elemento cambió (el rol o el título esperados no coinciden): vuelve a pedir app_tree/app_find y usa la referencia (ref) actual.'
    case 9:
      return 'Ese campo es seguro (contraseña u otra entrada protegida): el agente nunca escribe ahí.'
    case 10:
      return 'Ese valor no se puede editar.'
    case 11:
      return MSG.blocked
    case 12:
      return MSG.noDesktop
    default:
      return null
  }
}

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Cada elemento de `--mask-keys` va con `%` y `,` codificados (una ruta de Windows puede llevar comas). */
export const encodeKeyItem = (k: string): string => k.replace(/%/g, '%25').replace(/,/g, '%2C')

/** Tamaño de un PNG o JPEG por su cabecera (solo para la captura falsa de pruebas). */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null
      const marker = buf[i + 1]
      const len = buf.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
      }
      i += 2 + len
    }
  }
  return null
}

export interface Win32Deps {
  execFile: typeof nodeExecFile
  existsSync: (p: string) => boolean
  statSize: (p: string) => number
  copyFileSync: (from: string, to: string) => void
  readFile: (p: string) => Buffer
  rm: (p: string) => void
  /** `taskkill /PID <pid> /T /F` (árbol de procesos). */
  killTree: (pid: number) => void
  env: Record<string, string | undefined>
  timeoutMs: number
}

function realDeps(): Win32Deps {
  return {
    execFile: nodeExecFile,
    existsSync,
    statSize: (p) => statSync(p).size,
    copyFileSync,
    readFile: (p) => readFileSync(p),
    rm: (p) => rmSync(p, { force: true }),
    killTree: (pid) => {
      nodeExecFile('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 5000, windowsHide: true }, () => undefined)
    },
    env: process.env,
    timeoutMs:
      Number(process.env.COMPUTER_HELPER_TIMEOUT_MS) > 0 ? Number(process.env.COMPUTER_HELPER_TIMEOUT_MS) : WIN_HELPER_LIMITS.timeoutMs
  }
}

interface AppListEntry {
  key: string
  name: string
}

export function createWin32Backend(host: PlatformHost, overrides: Partial<Win32Deps> = {}): PlatformBackend {
  const deps: Win32Deps = { ...realDeps(), ...overrides }
  const { config: cfg, log } = host
  const HELPER = cfg.helper
  const exempt = new Set(
    (deps.env.COMPUTER_SELF_EXES ? deps.env.COMPUTER_SELF_EXES.split(',') : DEFAULT_EXEMPT_EXES)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  )
  // Solo se acepta `node` como intérprete del helper falso (la variable la fija `main` y solo en desarrollo; defensa en profundidad).
  const argv0 = /^node(\.exe)?$/i.test(deps.env.CU_HELPER_ARGV0 ?? '') ? (deps.env.CU_HELPER_ARGV0 as string) : ''

  // ───────────────────────────── helper nativo ─────────────────────────────

  const children = new Set<ChildProcess>()
  let pendingRelease: Promise<void> | null = null

  const globalFlags = (): string[] => {
    const flags: string[] = []
    if (cfg.instant) flags.push('--instant')
    if (cfg.typeDelay && Number.isFinite(Number(cfg.typeDelay))) flags.push('--char-delay', String(Number(cfg.typeDelay)))
    return flags
  }
  const launch = (args: string[]): { cmd: string; argv: string[] } =>
    argv0 ? { cmd: argv0, argv: [HELPER, ...args] } : { cmd: HELPER, argv: args }

  function ensureHelper(): void {
    if (!HELPER || !deps.existsSync(HELPER)) {
      throw new Error(`Helper nativo no encontrado (${HELPER || 'CU_HELPER vacío'}). Puede que el antivirus lo haya puesto en cuarentena.`)
    }
  }

  /** Mata un helper y todo su árbol (`taskkill /T`) si sigue vivo. */
  function terminate(c: ChildProcess): void {
    if (c.exitCode === null && c.signalCode === null && c.pid) deps.killTree(c.pid)
  }

  /** Suelta botones y modificadores (`release-input`). No va en `children`: un nuevo Detener no debe matarlo. */
  function releaseInput(): Promise<void> {
    if (!HELPER || !deps.existsSync(HELPER)) return Promise.resolve()
    const { cmd, argv } = launch(['release-input'])
    return new Promise<void>((resolve) => {
      try {
        deps.execFile(cmd, argv, { timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true }, (err) => {
          if (err) log('release-input:', err.message)
          resolve()
        })
      } catch (err) {
        log('release-input:', err instanceof Error ? err.message : err)
        resolve()
      }
    })
  }

  /** El helper actual deja `open-app` / `open-app-bg` diferidos (salida 12): se atienden con el menú Inicio (`openStartApp`). */
  async function helperExit(...args: string[]): Promise<HelperResult> {
    const out = await runHelper(...args)
    if (out.code === 12 && (args[0] === 'open-app' || args[0] === 'open-app-bg'))
      return openStartApp(args[1] ?? '', args[0] === 'open-app-bg')
    return out
  }

  function runHelper(...args: string[]): Promise<HelperResult> {
    try {
      ensureHelper()
    } catch (err) {
      return Promise.reject(err)
    }
    const { cmd, argv } = launch([...globalFlags(), ...args])
    return new Promise((resolve, reject) => {
      const child = deps.execFile(
        cmd,
        argv,
        { timeout: deps.timeoutMs, maxBuffer: WIN_HELPER_LIMITS.maxOutputBytes, windowsHide: true },
        (err, stdout, stderr) => {
          children.delete(child)
          if (!err) return resolve({ stdout: stdout.toString(), code: 0 })
          const e = err as NodeJS.ErrnoException & { killed?: boolean }
          // Salida normal con código ≠ 0 (el MCP no lo mató: `killed` solo es true por tiempo agotado o exceso de salida).
          if (typeof e.code === 'number' && !e.killed) return resolve({ stdout: stdout.toString(), code: e.code })
          // Tiempo agotado o salida excesiva: el árbol de procesos puede seguir vivo y con un botón pulsado.
          terminate(child)
          pendingRelease = releaseInput()
          if (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
            return reject(
              new Error(`El helper devolvió demasiada salida (más de ${WIN_HELPER_LIMITS.maxOutputBytes} bytes); acción abortada.`)
            )
          }
          if (e.killed) {
            return reject(
              new Error(`El helper no respondió en ${Math.round(deps.timeoutMs / 1000)} s; acción abortada y entrada liberada.`)
            )
          }
          reject(new Error((stderr || e.message || '').toString().trim()))
        }
      )
      children.add(child)
    })
  }

  async function helper(...args: string[]): Promise<string> {
    const { stdout, code } = await helperExit(...args)
    if (code === 0) return stdout
    throw new Error(exitMessage(code) ?? `${args[0]} falló (código ${code})`)
  }

  /** `STOP` por stdin → a los 300 ms `taskkill /T /F` → SIEMPRE `release-input`. */
  function killChildren(): void {
    const victims = [...children]
    if (!victims.length) return
    for (const c of victims) {
      try {
        c.stdin?.write('STOP\n')
      } catch {
        // stdin ya cerrado: el helper sale solo por EOF
      }
    }
    const gone = victims.map(
      (c) =>
        new Promise<void>((resolve) => {
          if (c.exitCode !== null || c.signalCode !== null) return resolve()
          c.once('exit', () => resolve())
          setTimeout(() => {
            terminate(c)
            setTimeout(resolve, 200).unref()
          }, WIN_HELPER_LIMITS.stopGraceMs).unref()
        })
    )
    pendingRelease = Promise.all(gone).then(() => releaseInput())
  }

  async function shutdown(): Promise<void> {
    await pendingRelease?.catch(() => undefined)
  }

  // ───────────────────────────── puertas propias ─────────────────────────────

  let protocolOk = false
  async function ensureProtocol(): Promise<void> {
    if (protocolOk) return
    let out: HelperResult
    try {
      out = await helperExit('version')
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err))
    }
    if (out.code !== 0) throw new Error(MSG.incompatible('no responde al comando version'))
    let v: { protocol?: unknown }
    try {
      v = JSON.parse(out.stdout) as { protocol?: unknown }
    } catch {
      throw new Error(MSG.incompatible('respuesta ilegible'))
    }
    if (v.protocol !== WIN_HELPER_LIMITS.protocol) throw new Error(MSG.incompatible(`protocolo ${String(v.protocol)}`))
    protocolOk = true
  }

  let consentCache: { at: number; ok: boolean } | null = null
  async function ensureConsent(): Promise<void> {
    if (consentCache && Date.now() - consentCache.at <= 200) {
      if (!consentCache.ok) throw new Error(MSG.consent)
      return
    }
    let j: { consent?: unknown }
    try {
      j = (await host.sideGet('/consent')) as { consent?: unknown }
    } catch (err) {
      log('consentimiento no verificable:', err instanceof Error ? err.message : err)
      throw new Error(MSG.consentUnverified)
    }
    const ok = j?.consent === true
    consentCache = { at: Date.now(), ok }
    if (!ok) throw new Error(MSG.consent)
  }

  async function preflight(info: { tool: string; realInput: boolean }): Promise<void> {
    await ensureProtocol()
    await ensureConsent()
    const { stdout, code } = await helperExit('session')
    if (code !== 0) throw new Error(exitMessage(code) ?? `session falló (código ${code})`)
    let s: { interactive?: unknown; secureDesktop?: unknown; elevatedTarget?: unknown }
    try {
      s = JSON.parse(stdout) as typeof s
    } catch {
      throw new Error(MSG.noDesktop)
    }
    if (s.interactive !== true || s.secureDesktop !== false) throw new Error(MSG.noDesktop)
    if (info.realInput && s.elevatedTarget !== false) throw new Error(MSG.elevated)
  }

  const isSelf = (a: AppRef): boolean => {
    const exe = exeBaseName(a.bundleId)
    return !!exe && exempt.has(exe)
  }

  async function checkKeysPolicy(keys: string): Promise<string> {
    // Solo hace falta saber qué ventana tiene el foco si la combinación podría cerrar Lazunox (alt+f4, ctrl+w).
    let lazunoxFrontmost = false
    if (/f4|(^|[+\s])w(\s|$)/i.test(keys)) {
      try {
        lazunoxFrontmost = isSelf(parseApp(JSON.parse(await helper('frontmost'))))
      } catch {
        lazunoxFrontmost = true // sin saber quién tiene el foco, se asume lo más restrictivo
      }
    }
    const verdict = checkKeys(keys, { lazunoxFrontmost })
    if (!verdict.ok) throw new Error(verdict.reason)
    return verdict.combos.join(' ')
  }

  function parseApp(json: unknown): AppRef {
    const j = (json ?? {}) as { name?: string; appKey?: string; bundleId?: string }
    const raw = typeof j.appKey === 'string' && j.appKey ? j.appKey : typeof j.bundleId === 'string' ? j.bundleId : ''
    // Una clave que no es válida equivale a «no identificada» (el MCP falla cerrado ante eso en Windows).
    const key = raw && parseAppKey(raw) ? raw : ''
    return { bundleId: key, name: j.name || key }
  }

  // ───────────────────────────── apps ─────────────────────────────

  interface StartApp {
    name: string
    appId: string
  }
  let startAppsCache: { at: number; apps: StartApp[] } | null = null
  /** Id de app del menú Inicio que se acepta para lanzar (sin comillas, `&`, `;`…: el destino va a `shell:AppsFolder\<id>`). */
  const SAFE_APP_ID = /^[\w.!{}\-\\ :()]+$/

  /** Apps del menú Inicio (`Get-StartApps`): nombre localizado + AppID. Cacheadas 60 s; vacío si PowerShell falla. */
  function startApps(): Promise<StartApp[]> {
    if (startAppsCache && Date.now() - startAppsCache.at < 60_000) return Promise.resolve(startAppsCache.apps)
    const root = deps.env.SystemRoot ?? deps.env.SYSTEMROOT ?? 'C:\\Windows'
    const ps = `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    return new Promise((resolve) => {
      try {
        deps.execFile(
          ps,
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | ConvertTo-Json -Compress'
          ],
          { timeout: 15_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
          (err, stdout) => {
            if (err) {
              log('Get-StartApps:', err.message)
              return resolve([])
            }
            try {
              const j = JSON.parse(stdout.toString().replace(/^\uFEFF/, '')) as unknown
              const arr = Array.isArray(j) ? j : j ? [j] : []
              const apps = arr
                .map((r) => r as { Name?: unknown; AppID?: unknown })
                .filter((r): r is { Name: string; AppID: string } => typeof r.Name === 'string' && typeof r.AppID === 'string')
                .map((r) => ({ name: r.Name, appId: r.AppID }))
              startAppsCache = { at: Date.now(), apps }
              resolve(apps)
            } catch {
              resolve([])
            }
          }
        )
      } catch {
        resolve([])
      }
    })
  }

  /** Mejor coincidencia por nombre localizado: exacto → empieza por → contiene (mínimo 2 letras). */
  async function findStartApp(query: string): Promise<StartApp | null> {
    const want = fold(query.replace(/\.exe$/i, ''))
    if (want.length < 2) return null
    const apps = await startApps()
    return (
      apps.find((a) => fold(a.name) === want) ??
      apps.find((a) => fold(a.name).startsWith(want)) ??
      apps.find((a) => fold(a.name).includes(want)) ??
      null
    )
  }

  /** `open-app`: lanza una app del menú Inicio con `explorer.exe shell:AppsFolder\<AppID>` (sin shell, id validado). */
  async function openStartApp(name: string, background: boolean): Promise<HelperResult> {
    const app = await findStartApp(name)
    if (!app || !SAFE_APP_ID.test(app.appId)) return { stdout: '', code: 7 }
    const root = deps.env.SystemRoot ?? deps.env.SYSTEMROOT ?? 'C:\\Windows'
    await new Promise<void>((resolve) => {
      try {
        // `explorer.exe` devuelve 1 aunque lance bien la app: el éxito no se deduce del código.
        deps.execFile(`${root}\\explorer.exe`, [`shell:AppsFolder\\${app.appId}`], { timeout: 10_000, windowsHide: true }, () => resolve())
      } catch {
        resolve()
      }
    })
    return { stdout: JSON.stringify({ opened: true, name: app.name, ...(background ? { behind: false } : {}) }), code: 0 }
  }

  /** Apps con ventana visible (`list-apps`). Lanza si el helper falla o devuelve una entrada sin clave válida (falla cerrado). */
  async function listApps(): Promise<AppListEntry[]> {
    const arr = JSON.parse(await helper('list-apps')) as unknown
    if (!Array.isArray(arr)) throw new Error('list-apps no devolvió una lista')
    return arr.map((raw) => {
      const e = raw as { name?: string; appKey?: string }
      if (typeof e.appKey !== 'string' || !parseAppKey(e.appKey)) throw new Error('list-apps devolvió una app sin clave válida')
      return { key: e.appKey, name: e.name || e.appKey }
    })
  }

  /**
   * Script de PowerShell (solo lectura, no ejecuta la app) que lleva una entrada del menú Inicio a `{path, publisher}`:
   * la ruta del `.exe` (AppID de ruta o destino del acceso directo `.lnk` de ProgramData/AppData con ese nombre) y el editor
   * igual que el helper: firma válida (WinVerifyTrust, como el helper) → nombre simple del certificado del firmante INCRUSTADO (los archivos solo firmados por catálogo dan vacío); si no, vacío
   * (el helper lo normaliza a «(sin firma)»). Nombre y AppID llegan por entorno, nunca interpolados en el comando.
   */
  const CLASSIC_APP_SCRIPT = [
    "$ErrorActionPreference='Stop'",
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
    '$n=$env:LZX_APP_NAME; $id=$env:LZX_APP_ID; $t=$null',
    "if ($id -match '^[A-Za-z]:\\\\' -and $id -like '*.exe') { $t=$id } else {",
    '$sh=New-Object -ComObject WScript.Shell',
    "foreach ($d in @(($env:ProgramData+'\\Microsoft\\Windows\\Start Menu\\Programs'), ($env:APPDATA+'\\Microsoft\\Windows\\Start Menu\\Programs'))) {",
    'if (-not $t -and (Test-Path -LiteralPath $d)) {',
    "foreach ($f in Get-ChildItem -LiteralPath $d -Filter '*.lnk' -Recurse -File -ErrorAction SilentlyContinue) {",
    "if ($f.BaseName -eq $n) { $x=$sh.CreateShortcut($f.FullName).TargetPath; if ($x -like '*.exe') { $t=$x; break } } } } } }",
    'if (-not $t -or -not (Test-Path -LiteralPath $t -PathType Leaf)) { exit 3 }',
    '$t=(Get-Item -LiteralPath $t).FullName',
    '$s=Get-AuthenticodeSignature -LiteralPath $t',
    "$p=''",
    "if ($s.Status -eq 'Valid') { try { $p=([Security.Cryptography.X509Certificates.X509Certificate2]([Security.Cryptography.X509Certificates.X509Certificate]::CreateFromSignedFile($t))).GetNameInfo('SimpleName',$false) } catch { $p='' } }",
    '@{path=$t;publisher=$p} | ConvertTo-Json -Compress'
  ].join('; ')
  const classicCache = new Map<string, { at: number; key: string | null }>()

  /**
   * Clave `exe:<ruta>|pub:<editor>` de una app CLÁSICA instalada pero cerrada, idéntica a la del helper cuando está en ejecución.
   * Falla cerrado: sin PowerShell, sin destino .exe, ruta no válida (UNC, 8.3, `..`) o editor no válido → null.
   */
  function classicAppKey(app: StartApp): Promise<string | null> {
    const ck = `${app.name}\u0000${app.appId}`
    const hit = classicCache.get(ck)
    if (hit && Date.now() - hit.at < 60_000) return Promise.resolve(hit.key)
    const root = deps.env.SystemRoot ?? deps.env.SYSTEMROOT ?? 'C:\\Windows'
    const ps = `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    return new Promise((resolve) => {
      const done = (key: string | null): void => {
        classicCache.set(ck, { at: Date.now(), key })
        resolve(key)
      }
      try {
        deps.execFile(
          ps,
          ['-NoProfile', '-NonInteractive', '-Command', CLASSIC_APP_SCRIPT],
          {
            timeout: 15_000,
            maxBuffer: 64 * 1024,
            windowsHide: true,
            env: { ...process.env, ...deps.env, LZX_APP_NAME: app.name, LZX_APP_ID: app.appId }
          },
          (err, stdout) => {
            if (err) return done(null)
            try {
              const j = JSON.parse(stdout.toString().replace(/^\uFEFF/, '')) as { path?: unknown; publisher?: unknown }
              if (typeof j.path !== 'string') return done(null)
              const k = exeKey(j.path, typeof j.publisher === 'string' ? j.publisher : '')
              done(k.ok && parseAppKey(k.key) ? k.key : null)
            } catch {
              done(null)
            }
          }
        )
      } catch {
        done(null)
      }
    })
  }

  async function resolveApp(name: string): Promise<AppRef & { found: boolean }> {
    const query = name.trim()
    const notFound = { bundleId: '', name: query || name, found: false }
    if (!query) return notFound
    try {
      const j = JSON.parse(await helper('resolve-app', query)) as { name?: string; found?: boolean }
      const ref = parseApp(j)
      if (j.found && ref.bundleId) return { bundleId: ref.bundleId, name: j.name || query, found: true }
    } catch (err) {
      log('resolve-app:', err instanceof Error ? err.message : err)
    }
    // Respaldo: apps con ventana por nombre localizado o por el del ejecutable (exacto → empieza por → contiene).
    try {
      const want = fold(query.replace(/\.exe$/i, ''))
      if (want.length < 2) return notFound
      const apps = await listApps()
      const names = (a: AppListEntry): string[] => [fold(a.name), fold((exeBaseName(a.key) ?? '').replace(/\.exe$/i, ''))]
      const hit =
        apps.find((a) => names(a).includes(want)) ??
        apps.find((a) => names(a).some((n) => n && n.startsWith(want))) ??
        apps.find((a) => names(a).some((n) => n && n.includes(want)))
      if (hit) return { bundleId: hit.key, name: hit.name, found: true }
    } catch (err) {
      log('list-apps:', err instanceof Error ? err.message : err)
    }
    // App instalada que aún no está abierta: solo las empaquetadas (AppID con «!», como Calculadora o Bloc de notas), cuya clave
    // `aumid:` es la misma que el helper informa cuando están en ejecución. Las clásicas se resuelven por su acceso directo (`classicAppKey`).
    const installed = await findStartApp(query)
    if (installed && installed.appId.includes('!')) {
      const k = aumidKey(installed.appId)
      if (k.ok) return { bundleId: k.key, name: installed.name, found: true }
    } else if (installed) {
      // App clásica cerrada: ruta del .exe y editor leídos del acceso directo, sin ejecutar nada (misma clave que da el helper en ejecución).
      const key = await classicAppKey(installed)
      if (key) return { bundleId: key, name: installed.name, found: true }
    }
    return notFound
  }

  // ───────────────────────────── capturas (FALLAR CERRADO) ─────────────────────────────

  /** Claves de las apps visibles sin concesión (y sin exención). Una consulta que falla cuenta como «sin concesión». */
  async function nonGranted(apps: AppListEntry[], session?: string): Promise<string[]> {
    const r = await Promise.all(
      apps
        .filter((a) => !isSelf({ bundleId: a.key, name: a.name }))
        .map(async (a) => ((await host.tierOf({ bundleId: a.key, name: a.name }, session).catch(() => null)) === null ? a.key : null))
    )
    return [...new Set(r.filter((k): k is string => !!k))]
  }

  async function captureScreen(req: { raw: string; out: string; session?: string }): Promise<{ width: number; height: number }> {
    const { out, session } = req
    if (cfg.fakeShot) {
      // Solo pruebas (`COMPUTER_FAKE_SCREENSHOT` lo pasa `main` únicamente sin empaquetar).
      deps.copyFileSync(cfg.fakeShot, out)
      const size = imageSize(deps.readFile(out))
      if (!size) throw new Error('La captura falsa no es un PNG/JPEG válido')
      return size
    }
    const fail = (why: string): never => {
      deps.rm(out) // nunca queda en disco una captura sin garantías
      throw noCapture(why)
    }
    if (!cfg.eventsUrl) return fail('sin canal con Lazunox para saber qué apps tienen acceso')

    let before: AppListEntry[]
    let masks: string[]
    try {
      before = await listApps()
      masks = await nonGranted(before, session)
    } catch (err) {
      return fail(`no se pudo enumerar las apps abiertas: ${err instanceof Error ? err.message : err}`)
    }

    const args = ['screenshot', out, '--max-long', String(cfg.maxLong), '--quality', '70']
    if (masks.length) args.push('--mask-keys', masks.map(encodeKeyItem).join(','))
    let res: HelperResult
    try {
      res = await helperExit(...args)
    } catch (err) {
      deps.rm(out)
      throw err
    }
    if (res.code !== 0) {
      if (res.code === 12) return fail('el helper no pudo enmascararlas o no hay escritorio interactivo')
      if (res.code === 11) return fail('hay una ventana bloqueada que no se pudo ocultar')
      deps.rm(out)
      throw new Error(exitMessage(res.code) ?? `La captura falló (código ${res.code})`)
    }

    let info: { width?: unknown; height?: unknown; masked?: unknown }
    try {
      info = JSON.parse(res.stdout) as typeof info
    } catch {
      return fail('respuesta ilegible del helper')
    }
    const w = info.width
    const h = info.height
    if (typeof w !== 'number' || typeof h !== 'number' || !(w > 0) || !(h > 0) || !Number.isInteger(w) || !Number.isInteger(h)) {
      return fail('el helper no informó del tamaño de la captura')
    }
    if (typeof info.masked !== 'number' || info.masked < 0) return fail('el helper no informó de cuántas ventanas enmascaró')
    if (!deps.existsSync(out) || deps.statSize(out) <= 0) return fail('el helper no escribió la imagen')

    // Carrera entre la enumeración y la captura: si apareció alguna app sin concesión que no se pidió enmascarar, se descarta.
    try {
      const after = await nonGranted(await listApps(), session)
      if (after.some((k) => !masks.includes(k))) return fail('cambió el conjunto de apps abiertas mientras se capturaba')
    } catch (err) {
      return fail(`no se pudo verificar las apps tras capturar: ${err instanceof Error ? err.message : err}`)
    }
    return { width: w, height: h }
  }

  async function windowShot(
    appKey: string,
    _raw: string,
    out: string,
    windowIndex: number
  ): Promise<{ width: number; height: number; title?: string }> {
    const { stdout, code } = await helperExit(
      'window-shot',
      appKey,
      out,
      String(windowIndex),
      '--max-long',
      String(cfg.maxLong),
      '--quality',
      '70'
    )
    if (code !== 0) throw new Error(exitMessage(code) ?? `window-shot falló (código ${code})`)
    if (!deps.existsSync(out) || deps.statSize(out) <= 0) {
      deps.rm(out)
      throw new Error('window-shot no escribió la imagen')
    }
    return JSON.parse(stdout) as { width: number; height: number; title?: string }
  }

  /** F8-B149: todavía no implementado en Windows (necesitaría WIC — IWICBitmapClipper + scaler — probado
   * en una máquina real antes de declararlo disponible). Falla con un mensaje claro de inmediato, en vez
   * de intentar un comando nativo (`zoom-image`) que no existe en el helper de Windows. */
  async function zoomImage(): Promise<{ width: number; height: number }> {
    throw new Error('zoom no está disponible en Windows todavía — pide una nueva captura completa (screenshot) en su lugar.')
  }

  /** F8-B151: todavía no implementado en Windows (necesitaría UI Automation — `ITextRangeProvider` o
   * similar — probado en una máquina real antes de declararlo disponible). */
  async function insertAxText(): Promise<void> {
    throw new Error('app_insert_text no está disponible en Windows todavía — usa app_set_value (con cuidado) o pide control real.')
  }

  return {
    id: 'win32',
    helper,
    helperExit,
    exitMessage,
    killChildren,
    shutdown,
    preflight,
    checkKeys: checkKeysPolicy,
    failClosedOnUnknownApp: true,
    parseApp,
    // El helper de Windows trabaja en píxeles físicos del escritorio virtual: la relación punto/píxel es 1 (`dpiScale` es informativo).
    normalizeScreen: (s: Screen & Record<string, unknown>): Screen => ({ width: s.width, height: s.height, scale: 1, main: s.main }),
    captureScreen,
    windowShot,
    zoomImage,
    insertAxText,
    resolveApp,
    async openAppKeys() {
      const apps = await listApps()
      return new Set(apps.filter((a) => !isSelf({ bundleId: a.key, name: a.name })).map((a) => a.key))
    },
    text: {
      instructions:
        'Controla el PC con Windows del usuario. Empieza siempre con screenshot; las coordenadas son píxeles de la última captura.',
      toolDescriptions: {
        key:
          'Pulsa una tecla o combinación, p.ej. "enter", "ctrl+c", "ctrl+shift+t", "escape", "tab", "up", "f5". En Windows usa ctrl ' +
          '(no cmd). Varias combinaciones separadas por espacio se pulsan en secuencia. Algunas combinaciones del sistema ' +
          '(Win+R, Ctrl+Alt+Supr, Ctrl+Mayús+Esc…) están bloqueadas: pide al usuario que las haga él.',
        open_application:
          'Abre o trae al frente una aplicación por nombre (p.ej. "Explorador de archivos", "Edge", "Bloc de notas", en el idioma de ' +
          'Windows) o por su clave de app. Si la app queda sin ninguna ventana visible (minimizada o sin ventanas abiertas), ' +
          'intenta mostrar una.'
      },
      appNotFound: (name) =>
        `No se pudo identificar la app "${name}". Usa el nombre tal como aparece en el menú Inicio (en el idioma de Windows) o el de su programa (sin ".exe").`,
      noAppsFound: (missing) =>
        `No se pudo identificar ninguna app instalada con esos nombres: ${missing.join(', ')}. ` +
        'Prueba con el nombre tal como aparece en el menú Inicio (en el idioma de Windows) o el de su programa (sin ".exe"). ' +
        'No hace falta que la app esté abierta. Si de verdad no está instalada, díselo al usuario.'
    }
  }
}
