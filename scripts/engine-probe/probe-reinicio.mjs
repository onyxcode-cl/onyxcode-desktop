// Sonda W-FIX reinicio: ¿qué peticiones sin `directory=` (o con él) cargan los complementos de una carpeta que el motor ya conoce solo por
// sus sesiones guardadas? Fase A crea una sesión en la carpeta (así queda en la base); fase B es un motor NUEVO sobre la misma base.
// Uso: node scripts/engine-probe/probe-reinicio.mjs <ruta-al-motor>
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const bin = process.argv[2]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const freePort = () =>
  new Promise((res) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => res(p))
    })
  })
const root = mkdtempSync(join(tmpdir(), 'w-fix-reinicio-'))
const home = join(root, 'home')
mkdirSync(home, { recursive: true })
const dir = join(root, 'reciente')
const marker = join(root, 'MARCA-PLUGIN')
mkdirSync(join(dir, '.opencode', 'plugin'), { recursive: true })
writeFileSync(join(dir, '.opencode', 'plugin', 'p.js'), `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'x'); export const P = async () => ({})\n`)
const env = {
  PATH: '/usr/bin:/bin',
  HOME: home,
  XDG_CONFIG_HOME: join(home, '.config'),
  XDG_DATA_HOME: join(home, '.local/share'),
  XDG_CACHE_HOME: join(home, '.cache'),
  XDG_STATE_HOME: join(home, '.local/state'),
  TMPDIR: root,
  OPENCODE_DISABLE_AUTOUPDATE: '1',
  OPENCODE_DISABLE_MODELS_FETCH: '1',
  OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
  OPENCODE_DISABLE_CLAUDE_CODE: '1',
  OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
  OPENCODE_DISABLE_SHARE: '1',
  OPENCODE_DISABLE_DEFAULT_PLUGINS: '1'
}
async function boot() {
  const port = await freePort()
  const child = spawn(bin, ['serve', '--port', String(port), '--hostname', '127.0.0.1'], { cwd: home, env, stdio: 'ignore', detached: true })
  const url = `http://127.0.0.1:${port}`
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(url + '/path')
      return { url, stop: () => { try { process.kill(-child.pid, 'SIGKILL') } catch {} } }
    } catch {
      await sleep(200)
    }
  }
  throw new Error('el motor no arrancó')
}
const out = []
// Fase A
let a = await boot()
await fetch(`${a.url}/session?directory=${encodeURIComponent(dir)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
await sleep(2500)
out.push(`fase A (crear sesión en la carpeta): complemento cargado = ${existsSync(marker) ? 'SI' : 'no'}`)
a.stop()
await sleep(1000)
rmSync(marker, { force: true })
// Fase B: motor nuevo, misma base
const b = await boot()
const probe = async (name, path) => {
  rmSync(marker, { force: true })
  const r = await fetch(b.url + path, { signal: AbortSignal.timeout(15000) }).catch(() => null)
  const text = r ? await r.text() : ''
  await sleep(3000)
  out.push(`${name.padEnd(46)} http=${r?.status} complemento_cargado=${existsSync(marker) ? 'SI' : 'no'} ${name.startsWith('GET /experimental') ? 'filas=' + (JSON.parse(text || '[]').length ?? '?') + ' ' + text.slice(0, 160) : ''}`)
}
await probe('GET /experimental/session (sin directory)', '/experimental/session?limit=200&archived=false')
await probe('GET /api/session/active (sin directory)', '/api/session/active')
await probe('GET /session/status (sin directory)', '/session/status')
await probe('GET /session/status?directory=<reciente>', `/session/status?directory=${encodeURIComponent(dir)}`)
// El código real de la app: fetchSessionsIdle con la carpeta reciente NO dada (no debe cargarla) y luego dada (sí la consulta, y la carga).
// Se importa con vite-node (el módulo es TypeScript): `npx vite-node scripts/engine-probe/probe-reinicio.mjs <motor>`.
const { fetchSessionsIdle } = await import('../../src/main/opencode/engine-flags-restart.ts')
rmSync(marker, { force: true })
const idle1 = await fetchSessionsIdle(b.url, '', [home])
await sleep(3000)
out.push(`fetchSessionsIdle(url, [chat]) -> ocioso=${idle1} complemento_cargado=${existsSync(marker) ? 'SI' : 'no'}`)
b.stop()
console.log(out.join('\n'))
rmSync(root, { recursive: true, force: true })
