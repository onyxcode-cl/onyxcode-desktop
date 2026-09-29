/**
 * Detección de servidor de desarrollo (Lote D, B.10): sondeo TCP a 127.0.0.1 de los puertos
 * inferidos de los scripts de `package.json` más los comunes (3000/3001/4200/4321/5000/5173/
 * 5174/6006/8000/8080). Puro sondeo local: nunca sale a la red real.
 */
import { existsSync, readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'
import type { DevServerCandidate } from '@shared/ipc-browser'

const COMMON_PORTS = [3000, 3001, 4200, 4321, 5000, 5173, 5174, 6006, 8000, 8080]
const PROBE_TIMEOUT_MS = 300

function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    const finish = (ok: boolean): void => {
      if (done) return
      done = true
      socket.destroy()
      resolve(ok)
    }
    const socket = connect({ host: '127.0.0.1', port })
    socket.setTimeout(PROBE_TIMEOUT_MS)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function scriptsOf(directory: string): Record<string, string> {
  try {
    const file = join(directory, 'package.json')
    if (!existsSync(file)) return {}
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as { scripts?: unknown }
    return pkg.scripts && typeof pkg.scripts === 'object' ? (pkg.scripts as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/** Puertos mencionados en los scripts (`--port 5173`, `:4200`…). */
function inferredPorts(scripts: Record<string, string>): number[] {
  const found = new Set<number>()
  for (const cmd of Object.values(scripts)) {
    const matches = String(cmd).matchAll(/(?:--port[= ]|:)(\d{2,5})\b/g)
    for (const m of matches) {
      const n = Number(m[1])
      if (n > 0 && n < 65536) found.add(n)
    }
  }
  return [...found]
}

function scriptFor(scripts: Record<string, string>, port: number): string | undefined {
  const entry = Object.entries(scripts).find(([, cmd]) => String(cmd).includes(String(port)))
  return entry?.[0]
}

export async function findDevServers(directory: string): Promise<DevServerCandidate[]> {
  const scripts = scriptsOf(directory)
  const scriptPorts = inferredPorts(scripts)
  const allPorts = [...new Set([...scriptPorts, ...COMMON_PORTS])]
  const running = new Set<number>()
  await Promise.all(
    allPorts.map(async (port) => {
      if (await probePort(port)) running.add(port)
    })
  )

  const out: DevServerCandidate[] = []
  for (const port of scriptPorts) {
    if (!running.has(port)) continue
    const url = `http://localhost:${port}`
    out.push({ url, label: `Servidor de desarrollo detectado · ${url}`, source: 'script', running: true, script: scriptFor(scripts, port) })
  }
  for (const port of COMMON_PORTS) {
    if (!running.has(port) || scriptPorts.includes(port)) continue
    const url = `http://localhost:${port}`
    out.push({ url, label: `Servidor detectado · ${url}`, source: 'port', running: true })
  }
  return out
}
