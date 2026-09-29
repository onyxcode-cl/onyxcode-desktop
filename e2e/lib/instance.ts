// Helpers de instancia única / Quick Entry (spec instance.e2e.ts).
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'
import { ROOT } from './launch'

const require = createRequire(import.meta.url)

export interface SecondRun {
  code: number | null
  signal: NodeJS.Signals | null
  ms: number
  timedOut: boolean
}

/** Lanza una SEGUNDA instancia con el mismo binario, entrypoint y `--user-data-dir` y espera a que termine sola. */
export function spawnSecondInstance(userData: string, timeoutMs = 15_000): Promise<SecondRun> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v
  delete env.ELECTRON_RUN_AS_NODE
  // Si por un fallo del lock arrancara de verdad, que al menos no abra ventanas visibles.
  env.ONYXCODE_E2E_HEADLESS = '1'
  const t0 = Date.now()
  return new Promise((resolve, reject) => {
    const child = spawn(require('electron') as string, [join(ROOT, 'out/main/index.js'), `--user-data-dir=${userData}`], {
      cwd: ROOT,
      env,
      stdio: 'ignore'
    })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, ms: Date.now() - t0, timedOut })
    })
  })
}

export interface WinInfo {
  id: number
  url: string
  visible: boolean
  minimized: boolean
  destroyed: boolean
}

/** Estado de las ventanas de main (no destruidas). */
export function listWindows(electronApp: ElectronApplication): Promise<WinInfo[]> {
  return electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({
      id: w.id,
      url: w.webContents.getURL(),
      visible: w.isVisible(),
      minimized: w.isMinimized(),
      destroyed: w.isDestroyed()
    }))
  )
}

export const isQuickUrl = (u: string): boolean => /quick\/index\.html/.test(u)
export const isMainUrl = (u: string): boolean => u !== '' && !isQuickUrl(u) && !/^devtools:/.test(u) && /(index\.html|onyxcode:\/\/app\/?$|localhost|127\.0\.0\.1)/.test(u)

/** Página Playwright de Quick Entry (si existe). */
export function findQuickPage(electronApp: ElectronApplication): Page | undefined {
  return electronApp.windows().find((p) => isQuickUrl(p.url()))
}
