// Globalsetup del runner E2E: compila main/preload/renderer (electron-vite build) y, en modo dev-renderer,
// levanta UN servidor Vite (solo renderer, con import.meta.env.DEV=true) compartido por todos los specs.
// Variables: E2E_SKIP_BUILD=1 (reutiliza ./out), E2E_MODE=prod (sin servidor Vite).
import { rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfigFromFile } from 'electron-vite'
import { createServer, type ViteDevServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
let vite: ViteDevServer | null = null

export async function setup(): Promise<void> {
  rmSync(join(root, 'e2e', '.artifacts'), { recursive: true, force: true })
  if (process.env.E2E_SKIP_BUILD !== '1') {
    // Con node y el .js del paquete: `.bin/electron-vite` es un script de shell (en Windows, un .cmd que spawnSync no ejecuta).
    const bin = join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
    const r = spawnSync(process.execPath, [bin, 'build', '--logLevel', 'error'], { cwd: root, stdio: 'inherit', env: process.env, timeout: 300_000 })
    if (r.status !== 0) throw new Error('electron-vite build falló')
  }
  if (process.env.E2E_MODE === 'prod') return
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, undefined, root)
  const renderer = loaded?.config?.renderer
  if (!renderer) throw new Error('No se pudo leer la config del renderer')
  vite = await createServer({
    ...renderer,
    configFile: false,
    root: join(root, 'src/renderer'),
    server: { ...(renderer.server ?? {}), host: '127.0.0.1', port: 0 as number, strictPort: false },
    logLevel: 'error'
  })
  await vite.listen()
  const addr = vite.httpServer?.address()
  if (!addr || typeof addr === 'string') throw new Error('Vite sin puerto')
  process.env.E2E_RENDERER_URL = `http://127.0.0.1:${addr.port}`
}

export async function teardown(): Promise<void> {
  await vite?.close()
  vite = null
}
