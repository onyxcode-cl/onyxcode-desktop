/**
 * Backend macOS del MCP de Control del PC: el comportamiento de SIEMPRE, movido de `mcp-server.ts` sin cambios de
 * comportamiento (helper Swift `cu-helper`, `screencapture` + ScreenCaptureKit, `sips`, Spotlight, bundle ids). Los comandos,
 * argumentos y textos son los mismos; `mcp-server.equivalence.test.ts` y `mcp-platform-darwin.test.ts` lo vigilan.
 *
 * Solo builtins de Node (es parte del bundle `computer-mcp`).
 */
import { execFile as nodeExecFile, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { AppRef, CaptureRequest, HelperResult, PlatformBackend, PlatformHost } from './mcp-platform'

/** Dependencias sustituibles en pruebas (por defecto, las reales de Node). */
export interface DarwinDeps {
  execFile: typeof nodeExecFile
  existsSync: (p: string) => boolean
  readdirSync: (p: string) => string[]
  statSync: (p: string) => { isDirectory(): boolean }
  homedir: () => string
}

const REAL_DEPS: DarwinDeps = {
  execFile: nodeExecFile,
  existsSync,
  readdirSync: (p) => readdirSync(p),
  statSync,
  homedir
}

/** Mensaje legible para los códigos de salida nuevos del helper (B.1 del plan Lote C). */
function axExitMessage(code: number): string | null {
  switch (code) {
    case 2:
      return 'Falta el permiso de Accesibilidad para Lazunox (aparece como Lazunox en Ajustes del Sistema).'
    case 6:
      return 'Reconocimiento de voz no autorizado.'
    case 7:
      return 'Esa app no está en ejecución.'
    case 8:
      return 'El elemento cambió (el rol o el título esperados no coinciden): vuelve a pedir app_tree/app_find y usa la referencia (ref) actual.'
    case 9:
      return 'Ese campo es seguro (contraseña u otra entrada protegida): el agente nunca escribe ahí.'
    case 10:
      return 'Ese valor no se puede editar.'
    case 11:
      return 'Esa acción no está permitida.'
    case 12:
      return 'Recurso no disponible.'
    default:
      return null
  }
}

const BUNDLE_ID_RE = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/

/** Minúsculas y sin acentos, para comparar nombres ("Música" ≈ "musica"). */
const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Valor entre comillas simples para un predicado de Spotlight (escapa \ y '). */
const mdQuote = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

interface AppEntry {
  path: string
  /** Nombres con los que se puede pedir: el localizado ("Música") y el del archivo ("Music"). */
  names: string[]
}

export function createDarwinBackend(host: PlatformHost, overrides: Partial<DarwinDeps> = {}): PlatformBackend {
  const deps: DarwinDeps = { ...REAL_DEPS, ...overrides }
  const { config: cfg, log } = host
  const HELPER = cfg.helper
  const MAX_LONG = cfg.maxLong
  const APP_DIRS = [
    '/Applications',
    '/Applications/Utilities',
    '/System/Applications',
    '/System/Applications/Utilities',
    join(deps.homedir(), 'Applications')
  ]

  // ───────────────────────────── helper nativo ─────────────────────────────

  /** Procesos del helper en vuelo (para matarlos si se pulsa Detener a mitad de una acción). */
  const children = new Set<ChildProcess>()

  /** SIGTERM (el helper suelta el botón del ratón si lo tenía pulsado) y SIGKILL a los 300 ms. */
  function killChildren(): void {
    for (const c of children) {
      c.kill('SIGTERM')
      setTimeout(() => c.exitCode === null && c.signalCode === null && c.kill('SIGKILL'), 300).unref()
    }
  }

  function run(cmd: string, args: string[], timeout = 15_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = deps.execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        children.delete(child)
        if (err) reject(new Error((stderr || err.message).toString().trim()))
        else resolve(stdout.toString())
      })
      children.add(child)
    })
  }

  async function helper(...args: string[]): Promise<string> {
    if (!HELPER || !deps.existsSync(HELPER)) throw new Error(`Helper nativo no encontrado (${HELPER || 'CU_HELPER vacío'})`)
    const flags: string[] = []
    if (cfg.instant) flags.push('--instant')
    if (cfg.typeDelay && Number.isFinite(Number(cfg.typeDelay))) flags.push('--char-delay', String(Number(cfg.typeDelay)))
    return run(HELPER, [...flags, ...args], 30_000)
  }

  /** `cu-keys` vive junto a `cu-helper` (binario aparte: recompilar `cu-helper` cambiaría su firma y macOS olvidaría los permisos). */
  const KEYS_BIN = HELPER ? join(dirname(HELPER), 'cu-keys') : ''

  function keysTool(args: string[], stdin?: string): Promise<string> {
    if (!KEYS_BIN || !deps.existsSync(KEYS_BIN))
      return Promise.reject(new Error(`Herramienta de teclado remoto no encontrada (${KEYS_BIN || 'CU_HELPER vacío'})`))
    return new Promise((resolve, reject) => {
      const child = deps.execFile(KEYS_BIN, args, { timeout: 60_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        children.delete(child)
        if (err) reject(new Error((stderr || err.message).toString().trim()))
        else resolve(stdout.toString())
      })
      children.add(child)
      if (stdin !== undefined) child.stdin?.end(stdin, 'utf8')
    })
  }

  /** Ejecuta un comando del sistema con `stdin` (para `pbcopy`). */
  function runWithStdin(cmd: string, args: string[], stdin: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = deps.execFile(cmd, args, { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        children.delete(child)
        if (err) reject(new Error((stderr || err.message).toString().trim()))
        else resolve(stdout.toString())
      })
      children.add(child)
      child.stdin?.end(stdin, 'utf8')
    })
  }

  /**
   * Pega `text` por el portapapeles. Los clientes remotos (Windows App, AnyDesk…) sincronizan el portapapeles del Mac con RETRASO (sondeo
   * de ~1 s): si se pega o se restaura enseguida, el equipo remoto recibe el texto ANTERIOR. Por eso: se espera `SYNC_MS` tras copiar, se
   * pega, y la restauración del texto previo ocurre más tarde y SOLO si el portapapeles sigue siendo el nuestro (no pisa un pegado posterior).
   * Si no había texto (una imagen, por ejemplo) no se toca al final: vaciarlo la destruiría.
   */
  const PASTE_SYNC_MS = 1000
  const PASTE_RESTORE_MS = 4000
  async function pasteText(text: string, combo: string): Promise<{ restored: boolean }> {
    const before = await run('/usr/bin/pbpaste', [], 5_000).catch(() => '')
    await runWithStdin('/usr/bin/pbcopy', [], text)
    await new Promise((r) => setTimeout(r, PASTE_SYNC_MS))
    await keysTool(['key', combo])
    if (before && before !== text) {
      const t = setTimeout(() => {
        void run('/usr/bin/pbpaste', [], 5_000)
          .then((now) => (now === text ? runWithStdin('/usr/bin/pbcopy', [], before) : undefined))
          .catch(() => undefined)
      }, PASTE_RESTORE_MS)
      t.unref?.()
    }
    return { restored: before.length > 0 && before !== text }
  }

  /** Como `helper()`, pero devuelve también el código de salida (para los mensajes de `axExitMessage`). */
  function helperExit(...args: string[]): Promise<HelperResult> {
    if (!HELPER || !deps.existsSync(HELPER))
      return Promise.reject(new Error(`Helper nativo no encontrado (${HELPER || 'CU_HELPER vacío'})`))
    const flags: string[] = []
    if (cfg.instant) flags.push('--instant')
    if (cfg.typeDelay && Number.isFinite(Number(cfg.typeDelay))) flags.push('--char-delay', String(Number(cfg.typeDelay)))
    return new Promise((resolve, reject) => {
      const child = deps.execFile(HELPER, [...flags, ...args], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        children.delete(child)
        const code = err && typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code as number) : err ? -1 : 0
        if (code < 0) {
          reject(new Error((stderr || err?.message || '').toString().trim()))
          return
        }
        resolve({ stdout: stdout.toString(), code })
      })
      children.add(child)
    })
  }

  // ───────────────────────────── resolver el nombre de una app ─────────────────────────────
  //
  // `request_access` recibe nombres en lenguaje natural ("Discord", "discord", "Música", o incluso un bundle
  // id). El helper nativo solo conoce las apps EN EJECUCIÓN (y su respaldo con Spotlight falla: filtra por
  // `kMDItemKind == 'Application'`, que en un macOS en español vale "Aplicación", y `==[cd]` no coincide).
  // Aquí se completa, sin recompilar el helper (recompilarlo cambia su firma y macOS olvidaría los permisos
  // TCC): 1) helper (apps abiertas) → 2) bundle id → 3) Spotlight por tipo de contenido (independiente del
  // idioma) → 4) recorrido de las carpetas de aplicaciones. Así también se encuentran apps CERRADAS.

  /** Rutas `.app` que devuelve una consulta de Spotlight (vacío si Spotlight no responde). */
  async function spotlightPaths(query: string): Promise<string[]> {
    try {
      const out = await run('/usr/bin/mdfind', [query], 8_000)
      return out
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.endsWith('.app'))
    } catch {
      return []
    }
  }

  /** Todas las apps que Spotlight conoce, con su nombre localizado (una sola consulta, ~30 ms). */
  async function spotlightApps(): Promise<AppEntry[]> {
    try {
      const out = await run(
        '/usr/bin/mdfind',
        ['-attr', 'kMDItemDisplayName', "kMDItemContentType == 'com.apple.application-bundle'"],
        8_000
      )
      const entries: AppEntry[] = []
      for (const line of out.split('\n')) {
        const m = /^(.+?\.app)\s+kMDItemDisplayName = (.+)$/.exec(line.trim())
        if (m) entries.push({ path: m[1], names: [m[2].trim(), basename(m[1], '.app')] })
      }
      return entries
    } catch {
      return []
    }
  }

  /** Apps instaladas en las carpetas habituales (un nivel de subcarpetas incluido). */
  function scanAppDirs(): AppEntry[] {
    const found: AppEntry[] = []
    const add = (full: string): void => void found.push({ path: full, names: [basename(full, '.app')] })
    for (const dir of APP_DIRS) {
      let entries: string[] = []
      try {
        entries = deps.readdirSync(dir)
      } catch {
        continue
      }
      for (const e of entries) {
        const full = join(dir, e)
        if (e.endsWith('.app')) add(full)
        else if (!e.startsWith('.')) {
          try {
            if (deps.statSync(full).isDirectory()) {
              for (const inner of deps.readdirSync(full)) if (inner.endsWith('.app')) add(join(full, inner))
            }
          } catch {
            // sin permiso o no es carpeta
          }
        }
      }
    }
    return found
  }

  /** Elige la app cuyo nombre coincide: exacto, luego "empieza por", luego "contiene". Prefiere las carpetas habituales. */
  function pickByName(entries: AppEntry[], name: string): string | null {
    const want = fold(name.replace(/\.app$/i, ''))
    if (want.length < 2) return null
    const rank = (p: string): number => (APP_DIRS.some((d) => p.startsWith(`${d}/`)) ? 0 : 1)
    const sorted = [...entries].sort((a, b) => rank(a.path) - rank(b.path))
    const names = (e: AppEntry): string[] => e.names.map(fold)
    return (
      sorted.find((e) => names(e).includes(want))?.path ??
      sorted.find((e) => names(e).some((n) => n.startsWith(want)))?.path ??
      sorted.find((e) => names(e).some((n) => n.includes(want)))?.path ??
      null
    )
  }

  /** Bundle id de un `.app` leyendo su Info.plist. */
  async function appRefFromPath(appPath: string): Promise<AppRef | null> {
    try {
      const id = (
        await run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', join(appPath, 'Contents', 'Info.plist')], 5_000)
      ).trim()
      return id ? { bundleId: id, name: basename(appPath, '.app') } : null
    } catch {
      return null
    }
  }

  async function resolveApp(name: string): Promise<AppRef & { found: boolean }> {
    const query = name.trim()
    const notFound = { bundleId: '', name: query || name, found: false }
    if (!query) return notFound

    // 1) Apps en ejecución (nombre exacto o parcial), vía el helper nativo.
    try {
      const j = JSON.parse(await helper('resolve-app', query)) as { name?: string; bundleId?: string; found?: boolean }
      if (j.found && j.bundleId) return { bundleId: j.bundleId, name: j.name || query, found: true }
    } catch (err) {
      log('resolve-app:', err instanceof Error ? err.message : err)
    }

    // 2) Bundle id explícito ("com.hnc.Discord").
    if (BUNDLE_ID_RE.test(query)) {
      const [path] = await spotlightPaths(`kMDItemCFBundleIdentifier == ${mdQuote(query)}`)
      const byId = path ? await appRefFromPath(path) : null
      if (byId) return { ...byId, found: true }
    }

    // 3) Spotlight (nombre localizado, sin distinguir mayúsculas ni tildes) y, si no responde,
    // 4) recorrido directo de las carpetas de aplicaciones.
    const path = pickByName(await spotlightApps(), query) ?? pickByName(scanAppDirs(), query)
    const ref = path ? await appRefFromPath(path) : null
    return ref ? { ...ref, found: true } : notFound
  }

  // ───────────────────────────── capturas ─────────────────────────────

  /**
   * Apps relevantes para la tarea ACTUAL de esa sesión (F8-B149), o `null` si no se pudo saber
   * (sin sesión — respaldo legado global, o el canal lateral falló). `null` hace que
   * `nonGrantedBundleIds` vuelva al criterio viejo ("cualquier concesión de siempre").
   */
  async function currentTaskApps(session?: string): Promise<Set<string> | null> {
    if (!session) return null
    try {
      const j = (await host.sideGet(`/task-apps?session=${encodeURIComponent(session)}`)) as { apps?: string[] }
      return new Set(Array.isArray(j.apps) ? j.apps : [])
    } catch {
      return null
    }
  }

  /**
   * Bundle ids de apps con ventana visible que NO quedan visibles: se excluyen de la captura
   * (ScreenCaptureKit las quita del compositor; el modelo nunca las ve). Best-effort: sin canal
   * lateral o si el helper falla, no excluye nada (mejor que romper la captura).
   *
   * Con sesión conocida, "visible" = app de la TAREA ACTUAL (`taskApps`) — no cualquier concesión
   * de siempre: antes, una app concedida en una tarea de hace semanas (p.ej. Discord) quedaba
   * visible SIEMPRE, aunque la tarea de ahora no tuviera nada que ver con ella. Sin sesión (respaldo
   * legado), se mantiene el criterio viejo porque no hay "tarea actual" que consultar.
   */
  async function nonGrantedBundleIds(session?: string): Promise<string[]> {
    if (!cfg.eventsUrl) return []
    try {
      const apps = JSON.parse(await helper('running-apps')) as Array<{ bundleId?: string; name?: string }>
      const taskApps = await currentTaskApps(session)
      const results = await Promise.all(
        apps
          .filter((a) => a.bundleId && !cfg.neverExclude.has(a.bundleId))
          .map(async (a) => {
            if (taskApps) return taskApps.has(a.bundleId!) ? null : a.bundleId!
            const tier = await host.tierOf({ bundleId: a.bundleId!, name: a.name || a.bundleId! }, session).catch(() => null)
            return tier === null ? a.bundleId! : null
          })
      )
      return results.filter((b): b is string => !!b)
    } catch (err) {
      log('nonGrantedBundleIds:', err instanceof Error ? err.message : err)
      return []
    }
  }

  async function captureScreen(req: CaptureRequest): Promise<{ width: number; height: number }> {
    const { raw, out, session, screen } = req
    // F8-B150: si la app en primer plano está en OTRA pantalla, `screen` la trae — sin esto, "-m"
    // capturaba siempre la principal y el modelo se quedaba mirando el escritorio o lo que haya
    // detrás, aunque el sistema diga bien que esa app está en primer plano (confirmado con una tarea
    // real: Notas en un monitor secundario, captura mostrando Brave/el escritorio de la principal).
    const notMain = screen && screen.main !== true && screen.x !== undefined && screen.y !== undefined
    if (cfg.fakeShot) {
      await run('/bin/cp', [cfg.fakeShot, raw])
    } else {
      const exclude = await nonGrantedBundleIds(session)
      let sckOk = false
      if (exclude.length) {
        try {
          // Se pasa SIEMPRE el id de la pantalla elegida, también si es la principal: sin id el helper captura
          // `SCShareableContent.displays.first`, que no tiene por qué ser la principal (con un monitor vertical a
          // la izquierda, SCK devolvía ESE y la imagen no mostraba ninguna ventana: solo el fondo de pantalla, con
          // la escala de la principal — coordenadas erróneas incluidas).
          const sckArgs = screen?.displayID !== undefined ? [raw, exclude.join(','), String(screen.displayID)] : [raw, exclude.join(',')]
          await helper('screenshot-sck', ...sckArgs)
          sckOk = true
        } catch (err) {
          log('ScreenCaptureKit no disponible, uso screencapture + enmascarado:', err instanceof Error ? err.message : err)
        }
      }
      if (!sckOk) {
        // -x sin sonido, -C incluye el cursor; -m solo la principal, o -R<x,y,w,h> para otra pantalla.
        const regionFlags = notMain ? ['-R', `${screen!.x},${screen!.y},${screen!.width},${screen!.height}`] : ['-m']
        try {
          await run('/usr/sbin/screencapture', ['-x', '-C', ...regionFlags, '-t', 'png', raw])
        } catch (err) {
          throw new Error(
            `No se pudo capturar la pantalla (${err instanceof Error ? err.message : err}). ` +
              'Falta el permiso de Grabación de pantalla para Lazunox (aparece como Lazunox en Ajustes del Sistema).'
          )
        }
        if (!deps.existsSync(raw)) throw new Error('No se pudo capturar la pantalla (¿permiso de Grabación de pantalla?)')
        // Fallback sin ScreenCaptureKit (macOS < 14 o SCK falló): enmascarar a mano las ventanas de
        // las apps no concedidas con un rectángulo negro (mejor que enseñarlas).
        if (exclude.length) {
          try {
            const s = notMain ? screen! : await host.mainScreen()
            const scale = s.scale || 1
            const originX = notMain ? (screen!.x ?? 0) : 0
            const originY = notMain ? (screen!.y ?? 0) : 0
            const windows = JSON.parse(await helper('windows-of', exclude.join(','))) as Array<{
              x: number
              y: number
              width: number
              height: number
            }>
            // Las ventanas vienen en coordenadas GLOBALES; la imagen capturada arranca en el origen
            // de `s` (0,0 si es la principal) — hay que restarlo antes de escalar a píxeles.
            if (windows.length) {
              const rects = windows.map(
                (w) => `${(w.x - originX) * scale},${(w.y - originY) * scale},${w.width * scale},${w.height * scale}`
              )
              await run(HELPER, ['mask-regions', raw, raw, ...rects])
            }
          } catch (err) {
            log('enmascarado de apps no concedidas:', err instanceof Error ? err.message : err)
          }
        }
      }
    }
    await run('/usr/bin/sips', ['-Z', String(MAX_LONG), '-s', 'format', 'jpeg', '-s', 'formatOptions', '70', raw, '--out', out])
    const dims = await run('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', out])
    const width = Number(/pixelWidth:\s*(\d+)/.exec(dims)?.[1] ?? 0)
    const height = Number(/pixelHeight:\s*(\d+)/.exec(dims)?.[1] ?? 0)
    return { width, height }
  }

  async function windowShot(
    appKey: string,
    raw: string,
    out: string,
    windowIndex: number
  ): Promise<{ width: number; height: number; title?: string }> {
    const { stdout, code } = await helperExit('window-shot', appKey, raw, String(windowIndex))
    if (code !== 0) throw new Error(axExitMessage(code) ?? `window-shot falló (código ${code})`)
    const info = JSON.parse(stdout) as { width: number; height: number; title?: string }
    await run('/usr/bin/sips', ['-Z', String(MAX_LONG), '-s', 'format', 'jpeg', '-s', 'formatOptions', '70', raw, '--out', out])
    return info
  }

  async function zoomImage(req: {
    inPath: string
    outPath: string
    x: number
    y: number
    width: number
    height: number
    scale: number
  }): Promise<{ width: number; height: number }> {
    const { stdout, code } = await helperExit(
      'zoom-image',
      req.inPath,
      req.outPath,
      String(req.x),
      String(req.y),
      String(req.width),
      String(req.height),
      String(req.scale)
    )
    if (code !== 0) throw new Error(axExitMessage(code) ?? `zoom-image falló (código ${code})`)
    return JSON.parse(stdout) as { width: number; height: number }
  }

  async function insertAxText(bundleId: string, ref: string, text: string): Promise<void> {
    const { code } = await helperExit('ax-insert-text', bundleId, ref, text)
    if (code !== 0) throw new Error(axExitMessage(code) ?? `ax-insert-text falló (código ${code})`)
  }

  return {
    id: 'darwin',
    helper,
    helperExit,
    // Solo si `cu-keys` existe junto a `cu-helper`: sin él (build sin swiftc, paquete antiguo) todo sigue como antes, con `cu-helper type`.
    ...(KEYS_BIN && deps.existsSync(KEYS_BIN)
      ? {
          typeKeys: (text: string, layout?: 'mac' | 'us') => keysTool(['type', ...(layout === 'us' ? ['--layout', 'us'] : [])], text),
          pasteText,
          pressKeys: (combos: string, layout?: 'mac' | 'us') => keysTool(['key', ...(layout === 'us' ? ['--layout', 'us'] : []), combos])
        }
      : {}),
    exitMessage: axExitMessage,
    killChildren,
    shutdown: async () => undefined,
    preflight: async () => undefined,
    checkKeys: async (keys) => keys,
    failClosedOnUnknownApp: false,
    parseApp: (json) => {
      const j = (json ?? {}) as { name?: string; bundleId?: string }
      return { bundleId: j.bundleId ?? '', name: j.name || j.bundleId || '' }
    },
    normalizeScreen: (s) => s,
    captureScreen,
    windowShot,
    zoomImage,
    insertAxText,
    resolveApp,
    text: {
      instructions: 'Controla el Mac del usuario. Empieza siempre con screenshot; las coordenadas son píxeles de la última captura.',
      toolDescriptions: {},
      appNotFound: (name) =>
        `No se pudo identificar la app "${name}". Usa el nombre tal como aparece en /Applications (sin ".app") o su bundle id.`,
      noAppsFound: (missing) =>
        `No se pudo identificar ninguna app instalada con esos nombres: ${missing.join(', ')}. ` +
        'Prueba con el nombre tal como aparece en /Applications (sin ".app") o con su bundle id ' +
        '(p.ej. com.apple.Safari, com.hnc.Discord). No hace falta que la app esté abierta. ' +
        'Si de verdad no está instalada, díselo al usuario.'
    }
  }
}
