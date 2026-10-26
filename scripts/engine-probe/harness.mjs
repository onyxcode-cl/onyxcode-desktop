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
/** Sustituto mínimo de `rg` (solo `--files`, con `--glob` y `--hidden`) para equipos sin ripgrep ni red (el contenedor del VPS): la herramienta `skill` lista así los archivos de la habilidad. */
const RG_SHIM = (nodeBin) => `#!${nodeBin}
const fs = require('node:fs'), path = require('node:path')
const a = process.argv.slice(2)
if (!a.includes('--files')) { process.stderr.write('rg de pruebas: solo --files\\n'); process.exit(2) }
const hidden = a.includes('--hidden')
const globs = a.filter((x) => x.startsWith('--glob=')).map((x) => x.slice(7))
const roots = a.filter((x) => !x.startsWith('-'))
const rx = (g) => new RegExp('^' + (g.includes('/') ? '' : '(?:.*/)?') + g.replace(/[.+^$()|{}\\[\\]\\\\]/g, '\\\\$&').replace(/\\*\\*\\//g, '\\u0001').replace(/\\*\\*/g, '\\u0002').replace(/\\*/g, '[^/]*').replace(/\\?/g, '[^/]').replace(/\\u0001/g, '(?:.*/)?').replace(/\\u0002/g, '.*') + '$')
const excl = globs.filter((g) => g.startsWith('!')).map((g) => rx(g.slice(1)))
const incl = globs.filter((g) => !g.startsWith('!')).map(rx)
const out = []
const walk = (d, rel) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (!hidden && e.name.startsWith('.')) continue
    const r = rel ? rel + '/' + e.name : e.name
    if (e.isDirectory()) { if (!excl.some((x) => x.test(r + '/')) && e.name !== '.git') walk(path.join(d, e.name), r); continue }
    if (excl.some((x) => x.test(r))) continue
    if (incl.length && !incl.some((x) => x.test(r))) continue
    out.push('./' + r)
  }
}
for (const r of roots.length ? roots : ['.']) walk(r, '')
process.stdout.write(out.join('\\n') + (out.length ? '\\n' : ''))
`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * @param {string} bin binario del motor
 * @param {{ mcpMany?: number, decide?: Function, plugins?: Record<string,string>, mcpServers?: string[], env?: Record<string,string>, file?: object, inline?: object,
 *   call: { name: string, args: object }, agent?: string, reply?: 'once'|'reject', settleMs?: number, agentsDir?: string,
 *   projectFiles?: Record<string,string>, git?: boolean, modelLimit?: { context: number, output: number } }} sc
 *   `sc.projectFiles`: archivos (ruta relativa → texto) escritos en la carpeta del proyecto antes de arrancar el motor.
 *   `sc.git`: `git init` + commit inicial en la carpeta del proyecto (las instantáneas del motor solo existen en proyectos con git).
 *   `sc.usage`: objeto `usage` (tokens) que añade cada respuesta; `sc.reply: 'ninguna'`: no contesta los permisos (quedan pendientes).
 *   `sc.rgShim`: pone un `rg` mínimo (solo `--files`) en el PATH del motor, para la herramienta `skill` en equipos sin ripgrep ni red.
 *   `sc.modelLimit`: límites de contexto del modelo falso (sin ellos el motor no conoce el tamaño y no compacta por tamaño).
 *   `decide` también recibe `messages` (cuerpo completo de la petición) y puede devolver, además de una llamada,
 *   `{ text }` (respuesta de texto), `{ hang: true }` (no contesta nunca: simula un ayudante lento) o `{ delayMs, ... }`.
 *   `sc.http({ q, post, sessionID, prompt, restart, proj, root, home, bodies })`: `prompt(texto, { agent })` manda otro turno y espera
 *   su fin; `restart({ signal })` mata el motor (SIGKILL por defecto) y lo arranca de nuevo con la misma carpeta, puerto y proveedor.
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
  for (const [rel, texto] of Object.entries(sc.projectFiles ?? {})) {
    mkdirSync(dirname(join(proj, rel)), { recursive: true })
    writeFileSync(join(proj, rel), texto)
  }
  if (sc.rgShim) {
    mkdirSync(join(root, 'bin'), { recursive: true })
    writeFileSync(join(root, 'bin', 'rg'), RG_SHIM(process.execPath), { mode: 0o755 })
    // En Windows el motor lanza `rg` sin shell y no ejecuta un script ni un .cmd: allí no se usa el sustituto y el motor descarga ripgrep solo
    // (como en la app real; el PC de pruebas tiene red).
  }
  if (sc.git) {
    // Identidad y fechas fijas: el commit inicial no depende del equipo. Sin la configuración global de la persona.
    const genv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
    const git = (...a) => spawnSync('git', ['-c', 'user.name=probe', '-c', 'user.email=probe@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd: proj, env: genv, stdio: 'ignore' })
    git('init', '-q', '-b', 'main')
    git('add', '-A')
    git('commit', '-q', '-m', 'inicial', '--allow-empty')
  }
  for (const [n, t] of Object.entries(sc.plugins ?? {})) writeFileSync(join(cfgdir, 'plugins', n), t)
  if (sc.agentsDir) cpSync(sc.agentsDir, join(cfgdir, 'agents'), { recursive: true })
  const seen = { toolsOffered: null, toolMessages: [], userTexts: [], requests: 0, toolsBytes: [], requestTools: [], bodies: [] }
  const sse = (res, chunks) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const c of chunks) res.write('data: ' + JSON.stringify(c) + '\n\n')
    // `sc.usage`: la respuesta informa de tokens (la compactación mide el contexto real con esto).
    if (sc.usage) res.write('data: ' + JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [], usage: sc.usage }) + '\n\n')
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
      seen.bodies.push(j)
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
        ? sc.decide({ tools, toolTexts, userTexts: seen.userTexts, messages: j.messages ?? [], body: j, n: seen.requests })
        : sc.steps
          ? toolMsgs.length < sc.steps.length
            ? sc.steps[toolMsgs.length](toolMsgs.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))))
            : null
          : tools.includes(sc.call.name) && !toolMsgs.length
            ? sc.call
            : null
      // `step.hang`: no contesta (un ayudante lento); `step.delayMs`: espera antes de contestar; `step.text`: responde con ese texto.
      const responder = () => {
        if (step?.text !== undefined) return sse(res, [chunk({ role: 'assistant', content: step.text }), chunk({}, step.finish ?? 'stop')])
        return responderLlamada()
      }
      if (step?.hang) {
        req.on('close', () => {})
        return
      }
      if (step?.delayMs) return void setTimeout(responder, step.delayMs)
      return responder()
      function responderLlamada() {
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
      }
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
        models: { m: { name: 'm', tool_call: true, ...(sc.modelLimit ? { limit: sc.modelLimit } : {}) } }
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
            // `sc.mcpTimeout` (ms): tiempo máximo de cada llamada al conector; `sc.mcpEnv`: variables para el proceso del conector.
            ...(sc.mcpTimeout ? { timeout: sc.mcpTimeout } : {}),
            ...(sc.mcpMany || sc.mcpEnv
              ? { environment: { ...(sc.mcpEnv ?? {}), ...(sc.mcpMany ? { PROBE_MCP_MANY: String(sc.mcpMany) } : {}) } }
              : {})
          }
        ])
      )
    }
  }
  const fileCfg = join(root, 'file.json')
  writeFileSync(fileCfg, JSON.stringify(sc.file ?? {}))
  // `sc.globalConfig`: configuración GLOBAL del usuario (XDG_CONFIG_HOME/opencode/opencode.json), la única de la que el motor acepta comandos propios (p. ej. `lsp`).
  if (sc.globalConfig) {
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true })
    writeFileSync(join(home, '.config', 'opencode', 'opencode.json'), JSON.stringify(sc.globalConfig))
  }
  // En Windows el motor necesita el entorno mínimo del sistema (PATH con System32 y Git, ComSpec, SystemRoot) para encontrar un shell.
  const winEnv =
    process.platform === 'win32'
      ? {
          PATH: [
            process.env.SystemRoot + '\\System32',
            process.env.SystemRoot,
            'C:\\Program Files\\Git\\cmd',
            'C:\\Program Files\\Git\\usr\\bin'
          ].join(';'),
          SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
          ComSpec: process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe',
          USERPROFILE: home,
          // Los alias de la Tienda (pwsh.exe) y muchos programas necesitan estas variables para arrancar.
          ...Object.fromEntries(
            ['LOCALAPPDATA', 'APPDATA', 'ProgramFiles', 'ProgramData', 'windir', 'PATHEXT', 'OS']
              .filter((k) => process.env[k])
              .map((k) => [k, process.env[k]])
          ),
          TEMP: root,
          TMP: root
        }
      : {}
  const env = {
    PATH: sc.rgShim ? `${join(root, 'bin')}:/usr/bin:/bin` : '/usr/bin:/bin',
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
  let log = ''
  let child
  const startChild = () => {
    child = spawn(bin, ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
      cwd: proj,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    })
    child.stdout.on('data', (d) => (log += d))
    child.stderr.on('data', (d) => (log += d))
  }
  startChild()
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
      throw new Error(
        `motor sin respuesta: ${init.method ?? 'GET'} ${p.split('?')[0]} tras ${Math.round((Date.now() - t0) / 1000)} s (${e?.name ?? e})`
      )
    }
  }
  const post = (o) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) })
  const out = { ok: false, asked: [], toolParts: [], elicitation: [], elicitReplies: [] }
  let events = new AbortController()
  const t0 = Date.now()
  /**
   * `sc.elicit`: cómo contestar los formularios MCP al verlos (`mcp.elicitation.asked`):
   *   { action: 'accept'|'decline'|'cancel', content?, delayMs? } por las rutas HTTP del motor;
   *   action 'abort' = abortar la sesión (POST /session/{id}/abort) con el formulario abierto; 'none' = dejarlo abierto.
   * Puede ser una función (evento) => especificación. Cada acción queda en `out.elicitReplies`; antes de contestar se lee
   * `GET /mcp/elicitation` y se guarda lo pendiente en `out.elicitList`.
   */
  const responderFormulario = async (ev) => {
    const spec = typeof sc.elicit === 'function' ? sc.elicit(ev) : sc.elicit
    if (!spec || spec.action === 'none') return
    if (spec.delayMs) await sleep(spec.delayMs)
    const list = await q('/mcp/elicitation')
    ;(out.elicitList ??= []).push({ status: list.status, ids: list.ok ? (await list.json()).map((x) => x.id) : [] })
    if (spec.action === 'abort') {
      const r = await q(`/session/${out.sessionID}/abort`, post({}))
      out.elicitReplies.push({ id: ev.id, action: 'abort', status: r.status })
      return
    }
    const r = await q(`/mcp/elicitation/${ev.id}/reply`, post({ action: spec.action, ...(spec.content ? { content: spec.content } : {}) }))
    out.elicitReplies.push({ id: ev.id, action: spec.action, status: r.status })
  }
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
    // `sc.sessionBody`: cuerpo de POST /session (p. ej. `permission` de la sesión o `metadata`).
    const s = await (await q('/session', post(sc.sessionBody ?? {}))).json()
    out.sessionID = s.id // desde ya: un escenario puede abortar la sesión mientras el mensaje sigue en curso
    const subscribe = (signal) =>
      void fetch(url + '/event?directory=' + encodeURIComponent(proj), { signal })
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
              // Formularios MCP: se registran los eventos `mcp.elicitation.*` (sin valores) y, si el escenario lo pide, se responden.
              if (typeof e.type === 'string' && e.type.startsWith('mcp.elicitation.')) {
                out.elicitation.push({ type: e.type.slice('mcp.elicitation.'.length), at: Date.now() - t0, ...e.properties })
                if (e.type === 'mcp.elicitation.asked' && sc.elicit)
                  void responderFormulario(e.properties).catch((err) => (out.elicitError = String(err)))
                continue
              }
              if (e.type === 'session.compacted') (out.compacted ??= []).push(e.properties)
              // `sc.recordEvents`: prefijos de tipos de evento a guardar en `out.events` (con su momento); `sc.onEvent(e, ctx)`: gancho libre (no se espera).
              if (sc.recordEvents?.some((pre) => e.type.startsWith(pre))) (out.events ??= []).push({ type: e.type, at: Date.now() - t0, properties: e.properties })
              if (sc.onEvent) void Promise.resolve(sc.onEvent(e, { q, post, out, sessionID: out.sessionID, proj })).catch((err) => (out.eventError = String(err)))
              if (e.type !== 'permission.asked') continue
              out.asked.push({ permission: e.properties.permission, patterns: e.properties.patterns, callID: e.properties.tool?.callID })
              if (sc.reply === 'ninguna') continue // el permiso queda pendiente (para probar los 409 «pendiente»)
              // `sc.reply` puede ser una función (propiedades del permiso) => 'once' | 'reject' | 'always' | 'ninguna'.
              const resp = typeof sc.reply === 'function' ? await sc.reply(e.properties, { proj, out }) : (sc.reply ?? 'reject')
              if (resp === 'ninguna') continue
              await q(`/permission/${e.properties.id}/reply`, post({ reply: resp }))
            }
          }
        }
      })
      .catch(() => {})
    subscribe(events.signal)
    const body = { agent: sc.agent ?? 'build', model: { providerID: 'fake', modelID: 'm' }, parts: [{ type: 'text', text: sc.firstPrompt ?? 'hola' }] }
    // `sc.pre({ q, post, sessionID, proj, root, home })`: se ejecuta antes del primer mensaje (fijar metadata, crear un objetivo…).
    if (sc.pre) out.pre = await sc.pre({ q, post, sessionID: s.id, proj, root, home, log: () => log })
    // `sc.skipFirst`: no manda el primer mensaje (todo el guion va en `sc.http` con `prompt`).
    out.promptStatus = sc.skipFirst
      ? 200
      : await Promise.race([q(`/session/${s.id}/message`, post(body)).then((x) => x.status), sleep(sc.firstTimeoutMs ?? 25_000).then(() => 'timeout')])
    if (out.promptStatus !== 200) out.log = log.slice(-3000) // un 500/timeout sin explicación: se adjunta la salida del motor
    const msgs = await (await q(`/session/${s.id}/message`)).json()
    out.toolParts = msgs.flatMap((m) =>
      m.parts
        .filter((p) => p.type === 'tool')
        .map((p) => ({ tool: p.tool, status: p.state.status, input: p.state.input, output: String(p.state.output ?? p.state.error ?? '') }))
    )
    // `sc.http`: llamadas HTTP propias al motor (rutas de trabajos) con la sesión ya usada.
    if (sc.http) {
      const prompt = async (texto, o = {}) => {
        const r = await Promise.race([
          q(`/session/${s.id}/message`, post({ ...body, agent: o.agent ?? body.agent, parts: [{ type: 'text', text: texto }] })).then((x) => x.status),
          sleep(o.timeoutMs ?? 40_000).then(() => 'timeout')
        ])
        return r
      }
      const restart = async ({ signal = 'SIGKILL' } = {}) => {
        events.abort()
        try {
          // En Windows no hay grupos de procesos con pid negativo: taskkill /T /F mata el árbol (equivale a SIGKILL).
          if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
          else process.kill(-child.pid, signal)
        } catch {
          /* ya había muerto */
        }
        await sleep(1500)
        startChild()
        let vivo = false
        for (let i = 0; i < 150 && !vivo; i++) {
          try {
            vivo = (await fetch(url + '/global/health', { signal: AbortSignal.timeout(5_000) })).ok
          } catch {
            /* aún no */
          }
          if (!vivo) await sleep(200)
        }
        if (!vivo) throw new Error('el motor no volvió a arrancar tras el reinicio')
        events = new AbortController()
        subscribe(events.signal)
        for (let i = 0; i < 50; i++) {
          const st = await (await q('/mcp')).json()
          if ((sc.mcpServers ?? []).every((n) => st[n]?.status === 'connected')) break
          await sleep(200)
        }
      }
      out.http = await sc.http({ q, post, sessionID: s.id, prompt, restart, proj, root, home, bodies: seen.bodies, seen, log: () => log })
    }
    out.toolsOffered = seen.toolsOffered
    out.system = seen.system
    if (sc.settleMs) await sleep(sc.settleMs)
    out.requests = seen.requests
    out.toolsBytes = seen.toolsBytes // bytes de `tools` por petición, en orden
    out.toolsBytesFirst = seen.toolsBytes.find((b) => b > 0) ?? 0 // la primera petición que lleva herramientas
    out.requestTools = seen.requestTools // nombres ofrecidos en cada petición
    out.toolMessages = seen.toolMessages // resultados de herramientas vistos por el modelo (de cualquier sesión, con repetidos)
    out.userTexts = seen.userTexts
    out.bodies = seen.bodies // cuerpo completo de cada petición al proveedor falso (en orden)
    out.proj = proj
    out.root = root
    out.home = home
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
