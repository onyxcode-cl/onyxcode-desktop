// Ayudantes de `lotes.e2e.ts` (Lotes B y D): fake fuera del userData, carpetas de trabajo bajo el home,
// servidor de páginas en loopback y cliente JSON-RPC del MCP del navegador integrado.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROOT } from './launch'

/**
 * Copia del OpenCode falso FUERA del userData tmp. El sandbox Seatbelt de Tareas deniega leer el userData de la app
 * (por eso el `opencode` copiado por `startApp` dentro de él da `code=126`); el resto (`/private/var/...`) se lee bien.
 * Devuelve `OPENCODE_BIN` y un limpiador.
 */
export function fakeOutsideUserData(): { bin: string; dispose: () => void } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-fakebin-')))
  for (const f of ['opencode', 'server.mjs']) cpSync(join(ROOT, 'e2e', 'fake-opencode', f), join(dir, f))
  return {
    bin: join(dir, 'opencode'),
    // El harness limpia por «argv menciona el userData tmp», pero este falso vive fuera: si la app muere (crash), el sidecar
    // queda huérfano. Se mata por la ruta única de esta copia.
    dispose: () => {
      killByPath(dir)
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

/** Mata (SIGKILL) todo proceso cuyo argv mencione `path`. */
export function killByPath(path: string): void {
  try {
    execFileSync('pkill', ['-KILL', '-f', path])
  } catch {
    /* pkill sale 1 si no hay coincidencias */
  }
}

/**
 * Carpeta de trabajo de Tareas. Tiene que estar bajo el home y fuera de `~/Library`/`/private`: la política de carpetas
 * (folder-policy.ts) rechaza `/private/var/...` (el tmp de macOS). Se crea en `~/onyx-e2e-cw-XXXXXX`.
 */
export function makeCoworkDir(): { dir: string; dispose: () => void } {
  const dir = realpathSync(mkdtempSync(join(homedir(), 'onyx-e2e-cw-')))
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}

export interface PageServer {
  port: number
  origin: string
  hits: string[]
  close: () => Promise<void>
}

/** Servidor HTTP en 127.0.0.1 (puerto libre). `routes` mapea ruta → cuerpo HTML; `hits` registra cada petición. */
export async function servePages(routes: Record<string, string | ((req: IncomingMessage) => string)>): Promise<PageServer> {
  const hits: string[] = []
  const server: Server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`)
    const path = (req.url ?? '/').split('?')[0]
    const body = routes[path]
    if (body === undefined) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(typeof body === 'function' ? body(req) : body)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as AddressInfo).port
  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r())))
  }
}

export interface McpResult {
  text: string
  isError: boolean
  raw: unknown
}

/** Cliente mínimo del MCP HTTP JSON-RPC del navegador integrado (Bearer por servidor, sin `Origin`). */
export class BrowserMcp {
  private n = 0
  constructor(
    readonly url: string,
    readonly token: string
  ) {}

  private async rpc(method: string, params?: unknown): Promise<any> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.n, method, params })
    })
    if (!res.ok) throw new Error(`mcp ${method} -> HTTP ${res.status}`)
    return res.json()
  }

  initialize(): Promise<any> {
    return this.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } })
  }
  async tools(): Promise<string[]> {
    const r = await this.rpc('tools/list')
    return (r.result?.tools ?? []).map((t: { name: string }) => t.name)
  }
  async call(sessionId: string, name: string, args: Record<string, unknown> = {}): Promise<McpResult> {
    const r = await this.rpc('tools/call', { name, arguments: { ...args, onyxcode_session: sessionId } })
    if (r.error) throw new Error(`mcp ${name}: ${JSON.stringify(r.error)}`)
    const content = (r.result?.content ?? []) as { type: string; text?: string }[]
    return { text: content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'), isError: r.result?.isError === true, raw: r.result }
  }
}

export { mkdirSync }

import type { Page } from 'playwright-core'
import { FakeClient } from './fake'

/** Cliente del OpenCode falso que sirve la carpeta de Tareas abierta (conexión leída del store `useCowork`). */
export async function coworkFake(page: Page): Promise<FakeClient> {
  await page.waitForFunction(() => Boolean((window as any).__onyxE2E?.useCowork.getState().conn), undefined, { timeout: 60_000 })
  const conn = await page.evaluate(() => {
    const c = (window as any).__onyxE2E.useCowork.getState().conn
    return { baseUrl: c.baseUrl as string, authorization: c.authorization as string }
  })
  return new FakeClient(conn)
}

import { setMode, storeCall } from './stores'
import type { E2EApp } from './launch'

/**
 * Deja Code listo para hablar con el MCP del navegador: proyecto + sesión en el falso, MCP leído de `/__e2e/config`,
 * navegador del agente activado por IPC (sin pasar por Ajustes), panel Navegador abierto (⌘4) y una pestaña humana para
 * que main tenga anfitrión visible (si no, la aprobación cae al diálogo nativo bloqueante).
 */
/**
 * Neutraliza el diálogo nativo de respaldo de las aprobaciones (`dialog.showMessageBox`, approvals.ts): main lo abre EN
 * PARALELO a la tarjeta cuando aún no hay anfitrión visible y, en un test, un diálogo real bloquearía o respondería solo.
 * Con esta promesa que no se resuelve, la única vía de respuesta es la tarjeta de la ventana.
 */
export async function neutralizeNativeApprovalDialog(app: E2EApp): Promise<void> {
  await app.electronApp.evaluate(({ dialog }) => {
    dialog.showMessageBox = (() => new Promise(() => undefined)) as unknown as typeof dialog.showMessageBox
  })
}

export async function prepareCodeBrowser(app: E2EApp, dir: string): Promise<{ mcp: BrowserMcp; sessionId: string }> {
  const { page } = app
  await neutralizeNativeApprovalDialog(app)
  await setMode(page, 'code')
  // El E2E abre el proyecto por el store (sin pasar por el selector): se marca de confianza para que `CodeWorkspace` no abra el diálogo de trust (F7-G4) al reconectar.
  await storeCall(page, 'useCode', 'trustFolder', dir)
  await storeCall(page, 'useCode', 'openProject', dir)
  const sessionId = (await storeCall<string | null>(page, 'useCode', 'newSessionAt', dir)) ?? ''
  if (!sessionId) throw new Error('no se pudo crear la sesión de Code')
  const cfg = await app.fake.config()
  const b = (cfg.content as { mcp?: { browser?: { url: string; headers: { Authorization: string } } } }).mcp?.browser
  if (!b) throw new Error('mcp.browser ausente de la config del OpenCode falso')
  await page.evaluate(async () => {
    const w = window as unknown as { api: { browser: { invoke: (c: string, r: unknown) => Promise<unknown> } } }
    await w.api.browser.invoke('browser:sites:setPrefs', { agentEnabled: { code: true } })
  })
  await page.keyboard.press('Meta+4')
  await page.getByTitle('Nueva pestaña').click()
  await page.waitForFunction(
    async (d) => {
      const w = window as unknown as { api: { browser: { invoke: (c: string, r: unknown) => Promise<{ tabs: unknown[] }> } } }
      return (await w.api.browser.invoke('browser:state', { owner: { kind: 'code', directory: d } })).tabs.length > 0
    },
    dir,
    { timeout: 15_000 }
  )
  return { mcp: new BrowserMcp(b.url, b.headers.Authorization.slice('Bearer '.length)), sessionId }
}

/**
 * Espera a que el navegador del owner de Code deje de estar «en uso por el usuario» (`userActive`, ventana de 3 s tras la
 * última entrada humana en la pestaña). Un Escape o un clic mío recién hechos cuentan como humano: mientras dure, las
 * acciones de entrada del agente se rechazan y las navegaciones del agente se atribuyen al usuario (sin tarjeta).
 */
export async function waitUserIdle(page: Page, directory: string, timeout = 15_000): Promise<void> {
  await page.waitForFunction(
    async (d) => {
      const w = window as unknown as { api: { browser: { invoke: (c: string, r: unknown) => Promise<{ userActive?: boolean }> } } }
      return (await w.api.browser.invoke('browser:state', { owner: { kind: 'code', directory: d } })).userActive === false
    },
    directory,
    { timeout, polling: 250 }
  )
}
