// Arnés para comprobar el motor OpenCode REAL sin modelo ni red: un proveedor falso compatible con OpenAI en 127.0.0.1 que pide UNA
// llamada a herramienta y luego termina, y un MCP de prueba (`probe-mcp.mjs`) que devuelve los argumentos que recibe.
// El motor corre aislado: entorno mínimo, HOME/XDG temporales (nunca la config real), carpeta de config propia y proceso en su grupo.
// Uso: `runEngine(bin, escenario)` desde `run.mjs`. Manual: no lo corre `npm test`.
import { spawn, spawnSync } from 'node:child_process'
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
 * @param {{ mcpMany?: number, decide?: Function, plugins?: Record<string,string>, mcpServers?: string[], env?: Record<string,string>, file?: object, inline?: object,
 *   call: { name: string, args: object }, agent?: string, reply?: 'once'|'reject', settleMs?: number, agentsDir?: string }} sc
 */
export async function runEngine(bin, sc) {
  // `sc.root`: carpeta fija (para probar que algo sobrevive al reinicio del motor); en ese caso quien llama la borra.
  const root = sc.root ?? mkdtempSync(join(tmpdir(), 'lz-engine-probe-'))
  mkdirSync(root, { recursive: true })
  const home = join(root, 'home')
  const proj = join(root, 'proj')
  const cfgdir = join(root, 'cfgdir')
  mkdirSync(home, { recursive: true })
  mkdirSync(proj, { recursive: true })
  mkdirSync(join(cfgdir, 'plugins'), { recursive: true })
  for (const [n, t] of Object.entries(sc.plugins ?? {})) writeFileSync(join(cfgdir, 'plugins', n), t)
  if (sc.agentsDir) cpSync(sc.agentsDir, join(cfgdir, 'agents'), { recursive: true })
  const seen = { toolsOffered: null, toolMessages: [], userTexts: [], requests: 0, toolsBytes: [], requestTools: [] }
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
      // Peso de la lista de herramientas de ESTA petición (0 si no lleva): base de las mediciones de `medir-herramientas.mjs` y de A-2.
      seen.toolsBytes.push(j.tools ? JSON.stringify(j.tools).length : 0)
      seen.requestTools.push(tools)
      const toolMsgs = (j.messages ?? []).filter((m) => m.role === 'tool')
      if (tools.length && !seen.toolsOffered) seen.toolsOffered = tools
      seen.requests += 1
      seen.userTexts = (j.messages ?? [])
        .filter((m) => m.role === 'user')
        .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      if (!seen.system)
        seen.system = (j.messages ?? [])
          .filter((m) => m.role === 'system')
          .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
          .join('\n---\n')
      seen.toolMessages.push(...toolMsgs.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))))
      // `sc.steps`: varias llamadas encadenadas; cada paso recibe los textos de los resultados anteriores y devuelve la siguiente llamada.
      // `sc.decide({ tools, toolTexts, userTexts })`: decisión libre por petición (p. ej. un subagente que hace algo distinto del padre).
      const toolTexts = toolMsgs.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      const step = sc.decide
        ? sc.decide({ tools, toolTexts, userTexts: seen.userTexts })
        : sc.steps
        ? toolMsgs.length < sc.steps.length
          ? sc.steps[toolMsgs.length](toolMsgs.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))))
          : null
        : tools.includes(sc.call.name) && !toolMsgs.length
          ? sc.call
          : null
      // `step.force`: pide la herramienta aunque el motor no la ofrezca (para probar que NO se ejecuta).
      if (step && (step.force || tools.includes(step.name))) {
        const tc = {
          index: 0,
          id: `call_${seen.requests}_${toolMsgs.length + 1}`,
          type: 'function',
          function: { name: step.name, arguments: JSON.stringify(step.args) }
        }
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
        (sc.mcpServers ?? []).map((n) => [
          n,
          {
            type: 'local',
            command: [process.execPath, join(here, 'probe-mcp.mjs')],
            enabled: true,
            // `sc.mcpMany`: n herramientas extra realistas (~800 caracteres) por conector.
            ...(sc.mcpMany ? { environment: { PROBE_MCP_MANY: String(sc.mcpMany) } } : {})
          }
        ])
      )
    }
  }
  const fileCfg = join(root, 'file.json')
  writeFileSync(fileCfg, JSON.stringify(sc.file ?? {}))
  // En Windows el motor necesita el entorno mínimo del sistema (PATH con System32 y Git, ComSpec, SystemRoot) para encontrar un shell.
  const winEnv =
    process.platform === 'win32'
      ? {
          PATH: [process.env.SystemRoot + '\\System32', process.env.SystemRoot, 'C:\\Program Files\\Git\\cmd', 'C:\\Program Files\\Git\\usr\\bin'].join(';'),
          SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
          ComSpec: process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe',
          USERPROFILE: home,
          // Los alias de la Tienda (pwsh.exe) y muchos programas necesitan estas variables para arrancar.
          ...Object.fromEntries(['LOCALAPPDATA', 'APPDATA', 'ProgramFiles', 'ProgramData', 'windir', 'PATHEXT', 'OS'].filter((k) => process.env[k]).map((k) => [k, process.env[k]])),
          TEMP: root,
          TMP: root
        }
      : {}
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
    ...winEnv,
    ...(process.env.PROBE_SHELL ? { SHELL: process.env.PROBE_SHELL } : {}),
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
  // Cada llamada al motor tiene tope propio (antes, una que no recibía respuesta esperaba los 300 s de undici y la comprobación
  // seguía en silencio): ahora falla pronto y dice QUÉ ruta se quedó sin respuesta.
  const q = async (p, init = {}) => {
    const t0 = Date.now()
    try {
      return await fetch(url + p + (p.includes('?') ? '&' : '?') + 'directory=' + encodeURIComponent(proj), {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(90_000)
      })
    } catch (e) {
      throw new Error(`motor sin respuesta: ${init.method ?? 'GET'} ${p.split('?')[0]} tras ${Math.round((Date.now() - t0) / 1000)} s (${e?.name ?? e})`)
    }
  }
  const post = (o) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) })
  const out = { ok: false, asked: [], toolParts: [] }
  const events = new AbortController()
  try {
    for (let i = 0; i < 150 && !out.ok; i++) {
      try {
        out.ok = (await fetch(url + '/global/health', { signal: AbortSignal.timeout(5_000) })).ok
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
    if (out.promptStatus !== 200) out.log = log.slice(-3000) // un 500/timeout sin explicación: se adjunta la salida del motor
    const msgs = await (await q(`/session/${s.id}/message`)).json()
    out.toolParts = msgs.flatMap((m) =>
      m.parts
        .filter((p) => p.type === 'tool')
        .map((p) => ({ tool: p.tool, status: p.state.status, input: p.state.input, output: String(p.state.output ?? p.state.error ?? '') }))
    )
    // `sc.http`: llamadas HTTP propias al motor (rutas de trabajos) con la sesión ya usada.
    if (sc.http) out.http = await sc.http({ q, post, sessionID: s.id })
    out.toolsOffered = seen.toolsOffered
    out.system = seen.system
    if (sc.settleMs) await sleep(sc.settleMs)
    out.requests = seen.requests
    out.toolsBytes = seen.toolsBytes // bytes de `tools` por petición, en orden
    out.toolsBytesFirst = seen.toolsBytes.find((b) => b > 0) ?? 0 // la primera petición que lleva herramientas
    out.requestTools = seen.requestTools // nombres ofrecidos en cada petición
    out.toolMessages = seen.toolMessages // resultados de herramientas vistos por el modelo (de cualquier sesión, con repetidos)
    out.userTexts = seen.userTexts
  } catch (e) {
    out.error = String(e?.stack ?? e)
    out.log = log.slice(-3000)
  } finally {
    events.abort()
    try {
      // En Windows no existen los grupos de procesos con pid negativo: taskkill /T mata el árbol (el motor y sus hijos).
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      else process.kill(-child.pid, 'SIGKILL')
    } catch {
      /* ya terminó */
    }
    provider.close()
    // Windows suelta los archivos del motor (.node extraídos) unos instantes después de morir: se reintenta y, si no se puede,
    // la comprobación ya tiene su resultado y la carpeta temporal queda para el sistema.
    try {
      if (!sc.root) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
    } catch {
      /* temporal: no debe tumbar la corrida */
    }
  }
  return out
}
