/**
 * Navegador propio de Cowork (Lote C, B.10): `chrome-devtools-mcp` delante de una `gateway.ts`
 * propia que controla a qué sitios se navega. Solo existe en Control total; lo inyecta
 * `cowork/manager.ts` como `mcp.browser` (config `local`, ver `mcpConfig`).
 *
 * Persistencia (`userData/cowork-browser.json`): `{ enabled, sites, denied }`. `chromePath`,
 * `runtime`, `available`, `reason`, `profileDir` y `policyDisabled` de `BrowserState` se calculan
 * en cada llamada (con caché corta para no relanzar `node --version` en cada consulta).
 *
 * Perfil dedicado: `userData/cowork-browser/profile` (nunca el Chrome personal del usuario). Antes
 * del primer arranque se escribe `Default/Preferences` una sola vez (si no existe) para que las
 * descargas vayan a `userData/cowork-browser/downloads` sin preguntar.
 *
 * Aprobación por sitio: canal lateral HTTP con token en 127.0.0.1 (`POST /site-check/<token>`, lo
 * llama `gateway.ts`). Decisión, en orden: denegado → no; en "sites" (permitir siempre) → sí; "una
 * vez" en memoria para esa carpeta → sí; si no, `dialog.showMessageBox` nativo (sin ventana padre:
 * en Control total la ventana principal puede estar minimizada) con la URL literal.
 */
import { app, dialog } from 'electron'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { EventEmitter } from 'node:events'
import { delimiter, dirname, join } from 'node:path'
import type { BrowserSite, BrowserState } from '@shared/ipc-cowork'
import { minimalEnv } from '../process/child-env'
import { findOpencodeBinary } from '../opencode/server'
import { MCP_ENV_WRAPPER } from '../cowork/mcp-cowork'
import { loadManagedPolicy } from '../cowork/policy'
import { checkUrl, hostOf, matchesSite, siteOf } from './sites'

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
]

/** Reemplaza `app.asar` por `app.asar.unpacked` (el script y `chrome-devtools-mcp` van desempaquetados). */
function unpacked(p: string): string {
  return p.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1')
}

interface Persisted {
  enabled: boolean
  sites: BrowserSite[]
  denied: string[]
}

const DEFAULT_PERSISTED: Persisted = { enabled: false, sites: [], denied: [] }

interface Detected {
  chromePath: string | null
  runtime: 'node' | 'bun' | null
  /** Ruta del binario del runtime elegido (node o el de opencode), o null si no hay ninguno. */
  runtimeBin: string | null
  reason?: string
}

const DETECT_TTL_MS = 30_000

/** Confía en `dialog.showMessageBox` para encolar una petición a la vez (evita diálogos superpuestos). */
type DialogChoice = 'once' | 'always' | 'deny'

export class BrowserService extends EventEmitter<{ changed: [BrowserState] }> {
  private data: Persisted | null = null
  private detectCache: { at: number; value: Detected } | null = null
  private siteCheckServer: Server | null = null
  private siteCheckUrl: string | null = null
  private siteCheckStarting: Promise<string> | null = null
  /** `"<folder>\u0000<site>"` con "permitir una vez" ya concedido, solo en memoria (se pierde al reiniciar). */
  private readonly onceGrants = new Set<string>()
  private dialogQueue: Promise<unknown> = Promise.resolve()

  private file(): string {
    return join(app.getPath('userData'), 'cowork-browser.json')
  }

  profileDir(): string {
    return join(app.getPath('userData'), 'cowork-browser', 'profile')
  }

  downloadsDir(): string {
    return join(app.getPath('userData'), 'cowork-browser', 'downloads')
  }

  private read(): Persisted {
    if (this.data) return this.data
    let out = DEFAULT_PERSISTED
    try {
      const file = this.file()
      if (existsSync(file)) {
        const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Persisted>
        out = {
          enabled: raw.enabled === true,
          sites: Array.isArray(raw.sites)
            ? raw.sites
                .filter((s): s is BrowserSite => !!s && typeof s === 'object' && typeof s.site === 'string')
                .map((s) => ({ site: s.site.toLowerCase(), addedAt: typeof s.addedAt === 'number' ? s.addedAt : Date.now() }))
            : [],
          denied: Array.isArray(raw.denied) ? raw.denied.filter((s): s is string => typeof s === 'string').map((s) => s.toLowerCase()) : []
        }
      }
    } catch (err) {
      console.error('[browser] cowork-browser.json inválido:', err)
    }
    this.data = out
    return out
  }

  private write(data: Persisted): void {
    this.data = data
    const file = this.file()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2), 'utf8')
    renameSync(`${file}.tmp`, file)
  }

  private emitChanged(): void {
    this.emit('changed', this.state())
  }

  /** Política gestionada: la organización puede apagar el navegador propio por completo. */
  private policyDisabled(): boolean {
    return loadManagedPolicy()?.disableBrowser === true
  }

  /** Busca `node` ≥20.19 en `minimalEnv().PATH`. */
  private findNode(): string | null {
    const dirs = (minimalEnv().PATH ?? '').split(delimiter).filter(Boolean)
    for (const dir of dirs) {
      const candidate = join(dir, 'node')
      if (!existsSync(candidate)) continue
      try {
        const out = execFileSync(candidate, ['--version'], { encoding: 'utf8', timeout: 3000 }).trim()
        const m = /^v(\d+)\.(\d+)/.exec(out)
        if (!m) continue
        const major = Number(m[1])
        const minor = Number(m[2])
        if (major > 20 || (major === 20 && minor >= 19)) return candidate
      } catch {
        // binario roto o ilegible: seguir buscando en el resto del PATH
      }
    }
    return null
  }

  /** Chrome/Brave instalados + runtime disponible (node ≥20.19 o, si no, `opencode` con `BUN_BE_BUN=1`). */
  private detect(): Detected {
    const now = Date.now()
    if (this.detectCache && now - this.detectCache.at < DETECT_TTL_MS) return this.detectCache.value
    const chromePath = CHROME_PATHS.find((p) => existsSync(p)) ?? null
    let value: Detected
    if (!chromePath) {
      value = { chromePath: null, runtime: null, runtimeBin: null, reason: 'No se encontró Google Chrome ni Brave en /Applications.' }
    } else {
      const node = this.findNode()
      if (node) {
        value = { chromePath, runtime: 'node', runtimeBin: node }
      } else {
        const bun = findOpencodeBinary()
        if (bun) {
          value = { chromePath, runtime: 'bun', runtimeBin: bun }
        } else {
          value = {
            chromePath,
            runtime: null,
            runtimeBin: null,
            reason: 'No se encontró Node ≥20.19 ni el binario de OpenCode para ejecutar el navegador.'
          }
        }
      }
    }
    this.detectCache = { at: now, value }
    return value
  }

  state(): BrowserState {
    const persisted = this.read()
    const policyDisabled = this.policyDisabled()
    const d = this.detect()
    const available = !policyDisabled && !!d.chromePath && !!d.runtime
    return {
      enabled: persisted.enabled,
      available,
      reason: policyDisabled ? 'Tu organización desactivó el navegador propio.' : d.reason,
      chromePath: d.chromePath,
      runtime: d.runtime,
      sites: persisted.sites,
      denied: persisted.denied,
      profileDir: this.profileDir(),
      policyDisabled
    }
  }

  set(req: { enabled: boolean }): BrowserState {
    if (req.enabled && this.policyDisabled()) throw new Error('Tu organización desactivó el navegador propio.')
    this.write({ ...this.read(), enabled: req.enabled === true })
    this.emitChanged()
    return this.state()
  }

  removeSite(req: { site: string }): BrowserState {
    const site = req.site.toLowerCase()
    const cur = this.read()
    this.write({ ...cur, sites: cur.sites.filter((s) => s.site !== site) })
    this.emitChanged()
    return this.state()
  }

  undeny(req: { site: string }): BrowserState {
    const site = req.site.toLowerCase()
    const cur = this.read()
    this.write({ ...cur, denied: cur.denied.filter((s) => s !== site) })
    this.emitChanged()
    return this.state()
  }

  /** true si hay un Chrome vivo usando nuestro perfil (lock de Chromium: enlace simbólico). */
  private profileLocked(): boolean {
    try {
      lstatSync(join(this.profileDir(), 'SingletonLock'))
      return true
    } catch {
      return false
    }
  }

  /** Borra el perfil y las descargas del navegador propio. Rechaza si Chrome sigue abierto con él. */
  clearData(): BrowserState {
    if (this.profileLocked()) {
      throw new Error('Cierra las tareas que usan el navegador antes de borrar sus datos.')
    }
    rmSync(this.profileDir(), { recursive: true, force: true })
    rmSync(this.downloadsDir(), { recursive: true, force: true })
    this.onceGrants.clear()
    this.emitChanged()
    return this.state()
  }

  /** Escribe `Default/Preferences` una sola vez (si no existe) antes del primer arranque de Chrome. */
  private ensureProfile(): void {
    const downloads = this.downloadsDir()
    mkdirSync(downloads, { recursive: true })
    const defaultDir = join(this.profileDir(), 'Default')
    const prefsFile = join(defaultDir, 'Preferences')
    if (existsSync(prefsFile)) return
    mkdirSync(defaultDir, { recursive: true })
    const prefs = {
      download: { default_directory: downloads, prompt_for_download: false, directory_upgrade: true },
      savefile: { default_directory: downloads },
      browser: { show_home_button: false }
    }
    writeFileSync(prefsFile, JSON.stringify(prefs), 'utf8')
  }

  /** Servidor HTTP local (canal lateral) para `POST /site-check/<token>`. Devuelve la URL con token. */
  private ensureSiteCheckServer(): Promise<string> {
    if (this.siteCheckUrl) return Promise.resolve(this.siteCheckUrl)
    if (this.siteCheckStarting) return this.siteCheckStarting
    const token = randomBytes(16).toString('hex')
    const path = `/site-check/${token}`
    this.siteCheckStarting = new Promise((resolve, reject) => {
      const srv = createServer((req, res) => {
        if (req.method !== 'POST' || req.url !== path) {
          res.statusCode = 404
          res.end()
          return
        }
        let body = ''
        req.setEncoding('utf8')
        req.on('data', (c: string) => {
          body += c
          if (body.length > 8192) req.destroy()
        })
        req.on('end', () => {
          let url = ''
          let folder = ''
          try {
            const o = JSON.parse(body) as { url?: unknown; folder?: unknown }
            if (typeof o.url === 'string') url = o.url.slice(0, 4000)
            if (typeof o.folder === 'string') folder = o.folder.slice(0, 4000)
          } catch {
            res.statusCode = 400
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ allow: false, reason: 'JSON inválido' }))
            return
          }
          void this.decide(url, folder).then((d) => {
            res.statusCode = 200
            res.setHeader('content-type', 'application/json')
            res.setHeader('cache-control', 'no-store')
            res.end(JSON.stringify(d))
          })
        })
      })
      srv.on('error', (err) => reject(err))
      srv.listen(0, '127.0.0.1', () => {
        const { port } = srv.address() as AddressInfo
        this.siteCheckServer = srv
        this.siteCheckUrl = `http://127.0.0.1:${port}${path}`
        resolve(this.siteCheckUrl)
      })
    })
    return this.siteCheckStarting
  }

  /** Decisión para una URL (llamada por el canal lateral). No confía en el esquema: lo revalida. */
  private async decide(url: string, folder: string): Promise<{ allow: boolean; reason?: string }> {
    if (!checkUrl(url)) return { allow: false, reason: 'Esquema no permitido.' }
    if (url === 'about:blank') return { allow: true }
    const host = hostOf(url)
    if (!host) return { allow: false, reason: 'URL sin host.' }
    const site = siteOf(host)
    const data = this.read()
    if (data.denied.includes(site)) return { allow: false, reason: 'El usuario denegó este sitio.' }
    if (data.sites.some((s) => matchesSite(host, s.site))) return { allow: true }
    if (this.onceGrants.has(`${folder}\u0000${site}`)) return { allow: true }
    return this.askUser(url, site, folder)
  }

  /** Encola el diálogo nativo (uno a la vez) y aplica la respuesta del usuario. */
  private askUser(url: string, site: string, folder: string): Promise<{ allow: boolean; reason?: string }> {
    const task = this.dialogQueue.then(() => this.showDialog(url)).then((choice) => {
      if (choice === 'once') {
        this.onceGrants.add(`${folder}\u0000${site}`)
        return { allow: true }
      }
      if (choice === 'always') {
        const cur = this.read()
        if (!cur.sites.some((s) => s.site === site)) {
          this.write({ ...cur, sites: [...cur.sites, { site, addedAt: Date.now() }] })
          this.emitChanged()
        }
        return { allow: true }
      }
      const cur = this.read()
      if (!cur.denied.includes(site)) {
        this.write({ ...cur, denied: [...cur.denied, site] })
        this.emitChanged()
      }
      return { allow: false, reason: 'El usuario denegó este sitio.' }
    })
    this.dialogQueue = task.then(
      () => undefined,
      () => undefined
    )
    return task
  }

  private async showDialog(url: string): Promise<DialogChoice> {
    try {
      const res = await dialog.showMessageBox({
        type: 'warning',
        message: `¿Permitir que el agente abra esta página?\n${url}`,
        detail: 'Las páginas pueden contener instrucciones maliciosas.',
        buttons: ['Permitir una vez', 'Permitir siempre', 'Denegar'],
        defaultId: 2,
        cancelId: 2,
        noLink: true
      })
      if (res.response === 0) return 'once'
      if (res.response === 1) return 'always'
      return 'deny'
    } catch (err) {
      console.error('[browser] no se pudo mostrar el diálogo de aprobación:', err)
      return 'deny'
    }
  }

  /**
   * Bloque `mcp.browser` (config `local` de OpenCode) o `null` si no aplica: desactivado, política,
   * o sin Chrome/runtime disponibles. Arranca el canal lateral y prepara el perfil si hace falta.
   */
  /** Cierra el canal lateral de aprobación (si estaba abierto). Para pruebas y el apagado de la app. */
  dispose(): void {
    this.siteCheckServer?.close()
    this.siteCheckServer = null
    this.siteCheckUrl = null
    this.siteCheckStarting = null
  }

  async mcpConfig(folder: string): Promise<Record<string, unknown> | null> {
    const s = this.state()
    if (!s.enabled || s.policyDisabled || !s.chromePath || !s.runtime) return null
    const d = this.detect()
    if (!d.runtimeBin) return null
    try {
      this.ensureProfile()
      const siteCheckUrl = await this.ensureSiteCheckServer()
      const scriptCandidates = [
        unpacked(join(app.getAppPath(), 'out', 'main', 'browser-mcp.js')),
        join(app.getAppPath(), 'out', 'main', 'browser-mcp.js')
      ]
      const gatewayScript = scriptCandidates.find((p) => existsSync(p)) ?? scriptCandidates[0]
      const cdmCandidates = [
        unpacked(join(app.getAppPath(), 'node_modules', 'chrome-devtools-mcp', 'build', 'src', 'bin', 'chrome-devtools-mcp.js')),
        join(app.getAppPath(), 'node_modules', 'chrome-devtools-mcp', 'build', 'src', 'bin', 'chrome-devtools-mcp.js')
      ]
      const cdmBin = cdmCandidates.find((p) => existsSync(p)) ?? cdmCandidates[0]
      return {
        type: 'local',
        enabled: true,
        timeout: 30_000,
        command: [...MCP_ENV_WRAPPER, d.runtimeBin, gatewayScript],
        environment: {
          ONYXCODE_BROWSER_URL: siteCheckUrl,
          ONYXCODE_BROWSER_FOLDER: folder,
          CDM_BIN: cdmBin,
          CDM_RUNTIME: d.runtimeBin,
          CHROME_PATH: s.chromePath,
          ONYXCODE_BROWSER_PROFILE: this.profileDir(),
          ...(d.runtime === 'bun' ? { BUN_BE_BUN: '1' } : {})
        }
      }
    } catch (err) {
      console.error('[browser] no se pudo preparar la config del navegador:', err)
      return null
    }
  }
}

export const browserService = new BrowserService()
