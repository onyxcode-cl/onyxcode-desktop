// Arnés para comprobar el motor OpenCode REAL sin modelo ni red: un proveedor falso compatible con OpenAI en 127.0.0.1 que pide UNA
// llamada a herramienta y luego termina, y un MCP de prueba (`probe-mcp.mjs`) que devuelve los argumentos que recibe.
// El motor corre aislado: entorno mínimo, HOME/XDG temporales (nunca la config real), carpeta de config propia y proceso en su grupo.
// Uso: `runEngine(bin, escenario)` desde `run.mjs`. Manual: no lo corre `npm test`.
import { spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const freePort = () =>
  new Promise((res) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => res(p))
    })
  })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * @param {string} bin binario del motor
 * @param {{ plugins?: Record<string,string>, mcpServers?: string[], env?: Record<string,string>, file?: object, inline?: object,
 *   call: { name: string, args: object }, agent?: string, reply?: 'once'|'reject', settleMs?: number, agentsDir?: string }} sc
 */
export async function runEngine(bin, sc) {
  const root = mkdtempSync(join(tmpdir(), 'lz-engine-probe-'))
  const home = join(root, 'home')
  const proj = join(root, 'proj')
  const cfgdir = join(root, 'cfgdir')
  mkdirSync(home)
  mkdirSync(proj)
  mkdirSync(join(cfgdir, 'plugins'), { recursive: true })
  for (const [n, t] of Object.entries(sc.plugins ?? {})) writeFileSync(join(cfgdir, 'plugins', n), t)
  if (sc.agentsDir) cpSync(sc.agentsDir, join(cfgdir, 'agents'), { recursive: true })
  const seen = { toolsOffered: null, toolMessages: [] }
  const sse = (res, chunks) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const c of chunks) res.write('data: ' + JSON.stringify(c) + '\n\n')
    res.end('data: [DONE]\n\n')
  }
  const chunk = (delta, finish = null) => ({
    id: 'x',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'm',
    choices: [{ index: 0, delta, finish_reason: finish }]
  })
  const provider = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      let j = {}
      try {
        j = JSON.parse(body)
      } catch {
        /* vacío */
      }
      const tools = (j.tools ?? []).map((t) => t.function?.name)
      const toolMsgs = (j.messages ?? []).filter((m) => m.role === 'tool')
      if (tools.length && !seen.toolsOffered) seen.toolsOffered = tools
      seen.toolMessages.push(...toolMsgs.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))))
      if (tools.includes(sc.call.name) && !toolMsgs.length) {
        const tc = { index: 0, id: 'call_1', type: 'function', function: { name: sc.call.name, arguments: JSON.stringify(sc.call.args) } }
        sse(res, [chunk({ role: 'assistant', tool_calls: [tc] }), chunk({}, 'tool_calls')])
      } else sse(res, [chunk({ role: 'assistant', content: 'listo' }), chunk({}, 'stop')])
    })
  })
  const pport = await freePort()
  await new Promise((r) => provider.listen(pport, '127.0.0.1', r))
  const port = await freePort()
  const inline = {
    ...(sc.inline ?? {}),
    provider: {
      fake: {
        npm: '@ai-sdk/openai-compatible',
        name: 'Fake',
        options: { baseURL: `http://127.0.0.1:${pport}/v1`, apiKey: 'no-usado' },
        models: { m: { name: 'm', tool_call: true } }
      }
    },
    model: 'fake/m',
    small_model: 'fake/m',
    mcp: {
      ...(sc.inline?.mcp ?? {}),
      ...Object.fromEntries(
        (sc.mcpServers ?? []).map((n) => [n, { type: 'local', command: [process.execPath, join(here, 'probe-mcp.mjs')], enabled: true }])
      )
    }
  }
  const fileCfg = join(root, 'file.json')
  writeFileSync(fileCfg, JSON.stringify(sc.file ?? {}))
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
    OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
    OPENCODE_CONFIG: fileCfg,
    OPENCODE_CONFIG_DIR: cfgdir,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(inline),
    ...(sc.env ?? {})
  }
  const child = spawn(bin, ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
    cwd: proj,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  })
  let log = ''
  child.stdout.on('data', (d) => (log += d))
  child.stderr.on('data', (d) => (log += d))
  const url = `http://127.0.0.1:${port}`
  const q = (p, init) => fetch(url + p + (p.includes('?') ? '&' : '?') + 'directory=' + encodeURIComponent(proj), init)
  const post = (o) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) })
  const out = { ok: false, asked: [], toolParts: [] }
  const events = new AbortController()
  try {
    for (let i = 0; i < 150 && !out.ok; i++) {
      try {
        out.ok = (await fetch(url + '/global/health')).ok
      } catch {
        /* aún no */
      }
      if (!out.ok) await sleep(200)
    }
    if (!out.ok) throw new Error('el motor no arrancó')
    for (let i = 0; i < 50; i++) {
      const st = await (await q('/mcp')).json()
      if ((sc.mcpServers ?? []).every((n) => st[n]?.status === 'connected')) break
      await sleep(200)
    }
    if (sc.agentsOf) out.agents = await (await q('/agent')).json()
    const s = await (await q('/session', post({}))).json()
    void fetch(url + '/event?directory=' + encodeURIComponent(proj), { signal: events.signal })
      .then(async (r) => {
        const rd = r.body.getReader()
        let buf = ''
        for (;;) {
          const { value, done } = await rd.read()
          if (done) break
          buf += Buffer.from(value).toString()
          let i
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i)
            buf = buf.slice(i + 2)
            for (const l of block.split('\n')) {
              if (!l.startsWith('data: ')) continue
              let e
              try {
                e = JSON.parse(l.slice(6))
              } catch {
                continue
              }
              if (e.type !== 'permission.asked') continue
              out.asked.push({ permission: e.properties.permission, callID: e.properties.tool?.callID })
              await q(`/permission/${e.properties.id}/reply`, post({ reply: sc.reply ?? 'reject' }))
            }
          }
        }
      })
      .catch(() => {})
    const body = { agent: sc.agent ?? 'build', model: { providerID: 'fake', modelID: 'm' }, parts: [{ type: 'text', text: 'hola' }] }
    out.promptStatus = await Promise.race([
      q(`/session/${s.id}/message`, post(body)).then((x) => x.status),
      sleep(25_000).then(() => 'timeout')
    ])
    out.sessionID = s.id
    const msgs = await (await q(`/session/${s.id}/message`)).json()
    out.toolParts = msgs.flatMap((m) =>
      m.parts
        .filter((p) => p.type === 'tool')
        .map((p) => ({ tool: p.tool, status: p.state.status, input: p.state.input, output: String(p.state.output ?? p.state.error ?? '') }))
    )
    out.toolsOffered = seen.toolsOffered
    if (sc.settleMs) await sleep(sc.settleMs)
  } catch (e) {
    out.error = String(e?.stack ?? e)
    out.log = log.slice(-3000)
  } finally {
    events.abort()
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      /* ya terminó */
    }
    provider.close()
    rmSync(root, { recursive: true, force: true })
  }
  return out
}
