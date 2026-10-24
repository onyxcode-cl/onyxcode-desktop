#!/usr/bin/env node
// Comprobaciones MANUALES contra el motor OpenCode real (sin modelo, sin red, aislado): ver `harness.mjs`.
// Uso: node scripts/engine-probe/run.mjs [ruta/al/opencode] [--shell-bg ruta/al/shell-bg-mcp.cjs]
//   (motor por defecto: resources/opencode-bin/bin/opencode; el .cjs se genera con `node scripts/build-shell-bg.mjs --out <ruta>`)
// Reverificar al subir de versión del motor (docs/ACTUALIZAR-OPENCODE.md). Sale con código 1 si algo no se cumple.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { runEngine } from './harness.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const sbAt = args.indexOf('--shell-bg')
const shellBgCjs = sbAt >= 0 ? args.splice(sbAt, 2)[1] : null
const bin = args[0] ?? join(repo, 'resources', 'opencode-bin', 'bin', 'opencode')
if (!existsSync(bin)) {
  console.error(`No está el motor en ${bin} (npm run fetch:opencode o pasa la ruta).`)
  process.exit(2)
}

const CODE_MODE = { OPENCODE_EXPERIMENTAL_CODE_MODE: 'true' }
const direct = (tool, args = { command: 'a' }) => ({ name: tool, args })
const viaExecute = (server, tool, args = { command: 'a' }) => ({
  name: 'execute',
  args: { code: `return await tools.${server}.${tool}(${JSON.stringify(args)})` }
})
/** Resultado de la llamada a la herramienta (directa o dentro de execute). */
const outcome = (r) => {
  const p = r.toolParts[0]
  if (!p) return 'oculta'
  if (p.status === 'completed') return 'ejecutada'
  if (/rejected permission/.test(p.output)) return 'preguntó'
  if (/Unknown tool|not available|denied|prevents you/i.test(p.output)) return 'denegada'
  return `error: ${p.output.slice(0, 120)}`
}

const checks = []
const check = (name, sc, expect) => checks.push({ name, sc, expect })
/** Comprobación que arma ella misma varias corridas del motor (`run` devuelve true/false o lanza). */
const checkRun = (name, run) => checks.push({ name, run })

// ── Conectores en Code (F8-B203): el bloque `permission` que arma `buildCodeMcpPermission` ─────────────────────
for (const [mode, env, call] of [
  ['directa', {}, (tool) => direct(`x_${tool}`)],
  ['Code Mode', CODE_MODE, (tool) => viaExecute('x', tool)]
]) {
  check(
    `${mode}: sin regla, build ejecuta el conector SIN preguntar (comportamiento del motor que se corrige)`,
    { env, mcpServers: ['x'], call: call('start') },
    (r) => outcome(r) === 'ejecutada' && r.asked.length === 0
  )
  check(
    `${mode}: x_*: ask → pregunta (conector no confiado)`,
    { env, mcpServers: ['x'], inline: { permission: { 'x_*': 'ask' } }, call: call('start') },
    (r) => r.asked.some((a) => a.permission === 'x_start')
  )
  check(
    `${mode}: x_*: allow → no pregunta (conector de confianza)`,
    { env, mcpServers: ['x'], inline: { permission: { 'x_*': 'allow' } }, call: call('start') },
    (r) => outcome(r) === 'ejecutada' && r.asked.length === 0
  )
  check(
    `${mode}: deny por herramienta del archivo + allow nuevo en la inline → el allow GANA (el hueco)`,
    {
      env,
      mcpServers: ['x'],
      file: { permission: { x_secret: 'deny' } },
      inline: { permission: { 'x_*': 'allow' } },
      call: call('secret')
    },
    (r) => outcome(r) === 'ejecutada'
  )
  check(
    `${mode}: con el alias exacto "x_secret *" la herramienta bloqueada queda denegada`,
    {
      env,
      mcpServers: ['x'],
      file: { permission: { x_secret: 'deny' } },
      inline: { permission: { 'x_*': 'allow', 'x_secret *': 'deny' } },
      call: call('secret')
    },
    (r) => ['oculta', 'denegada'].includes(outcome(r))
  )
  check(
    `${mode}: el alias no afecta a las demás herramientas del conector`,
    {
      env,
      mcpServers: ['x'],
      file: { permission: { x_secret: 'deny' } },
      inline: { permission: { 'x_*': 'allow', 'x_secret *': 'deny' } },
      call: call('start')
    },
    (r) => outcome(r) === 'ejecutada'
  )
}

// Servidor cuyo nombre es prefijo de otro: `p_*: allow` taparía `p_q_*: ask`; el alias `p_q_* *` lo re-afirma (comodín + " *").
check(
  'prefijo: sin alias, confiar en `p` deja pasar `p_q_start` (el hueco)',
  { mcpServers: ['p', 'p_q'], inline: { permission: { 'p_q_*': 'ask', 'p_*': 'allow' } }, call: direct('p_q_start') },
  (r) => outcome(r) === 'ejecutada' && r.asked.length === 0
)
check(
  'prefijo: con el alias `p_q_* *` el conector `p_q` vuelve a preguntar y `p` sigue sin preguntar',
  { mcpServers: ['p', 'p_q'], inline: { permission: { 'p_q_*': 'ask', 'p_*': 'allow', 'p_q_* *': 'ask' } }, call: direct('p_q_start') },
  (r) => r.asked.some((a) => a.permission === 'p_q_start')
)
check(
  'prefijo: con el alias, `p_start` sigue sin preguntar',
  { mcpServers: ['p', 'p_q'], inline: { permission: { 'p_q_*': 'ask', 'p_*': 'allow', 'p_q_* *': 'ask' } }, call: direct('p_start') },
  (r) => outcome(r) === 'ejecutada' && r.asked.length === 0
)

// ── Code Mode del motor propio: pausa y espera (execute_wait) ─────────────────────────────────────────────────────
check(
  'Code Mode: un script lento devuelve «Script en curso» con cell_id y execute_wait queda ofrecido',
  {
    env: CODE_MODE,
    mcpServers: ['x'],
    inline: { permission: { 'x_*': 'allow' } },
    call: { name: 'execute', args: { code: 'return await tools.x.slow({ ms: 5000 })', yield_ms: 1000 } },
    settleMs: 2500
  },
  (r) => {
    const p = r.toolParts[0]
    return (
      !!p &&
      p.status === 'completed' &&
      /Script en curso \(cell_id=cm_\w+\)/.test(p.output) &&
      (r.toolsOffered ?? []).includes('execute_wait')
    )
  }
)
check(
  'Code Mode: un script rápido devuelve el resultado directo, sin pausa',
  {
    env: CODE_MODE,
    mcpServers: ['x'],
    inline: { permission: { 'x_*': 'allow' } },
    call: { name: 'execute', args: { code: 'return await tools.x.slow({ ms: 50 })', yield_ms: 1000 } }
  },
  (r) => {
    const p = r.toolParts[0]
    return !!p && p.status === 'completed' && p.output.includes('LENTO-LISTO') && !p.output.includes('Script en curso')
  }
)

const cellOf = (msgs) => /cell_id=(cm_\w+)/.exec(msgs.join('\n'))?.[1] ?? 'cm_no-encontrado'
const slowCode = (ms) => `return await tools.x.slow({ ms: ${ms} })`
check(
  'Code Mode: execute_wait con el cell_id entrega el resultado final del script lento',
  {
    env: CODE_MODE,
    mcpServers: ['x'],
    inline: { permission: { 'x_*': 'allow' } },
    steps: [
      () => ({ name: 'execute', args: { code: slowCode(3000), yield_ms: 1000 } }),
      (m) => ({ name: 'execute_wait', args: { cell_id: cellOf(m), yield_ms: 8000 } })
    ]
  },
  (r) =>
    r.toolParts.length === 2 &&
    /Script en curso/.test(r.toolParts[0].output) &&
    r.toolParts[1].status === 'completed' &&
    r.toolParts[1].output.includes('LENTO-LISTO')
)
check(
  'Code Mode: execute_wait con terminate: true para el script y avisa que lo hecho no se deshace',
  {
    env: CODE_MODE,
    mcpServers: ['x'],
    inline: { permission: { 'x_*': 'allow' } },
    steps: [
      () => ({ name: 'execute', args: { code: slowCode(30000), yield_ms: 1000 } }),
      (m) => ({ name: 'execute_wait', args: { cell_id: cellOf(m), terminate: true } })
    ]
  },
  (r) => r.toolParts.length === 2 && r.toolParts[1].status === 'completed' && /Script terminado/.test(r.toolParts[1].output)
)
check(
  'Code Mode: execute_wait de una celda que no existe falla con un mensaje claro',
  {
    env: CODE_MODE,
    mcpServers: ['x'],
    inline: { permission: { 'x_*': 'allow' } },
    steps: [() => ({ name: 'execute_wait', args: { cell_id: 'cm_inexistente' } })]
  },
  (r) => r.toolParts.length === 1 && /No existe la celda/.test(r.toolParts[0].output)
)

// ── Gancho de plugin `permission.ask` del motor propio (en OpenCode está tipado pero nunca se dispara) ─────────────
const askPlugin = (decision) => ({
  'ask-hook.js': `export default {
  id: 'ask-hook',
  server: async () => ({
    'permission.ask': async (input, output) => {
      if (input && input.type === 'x_start') output.status = '${decision}'
    }
  })
}
`
})
check(
  'permission.ask: un plugin que responde «deny» rechaza la herramienta sin preguntar a nadie',
  {
    plugins: askPlugin('deny'),
    mcpServers: ['x'],
    inline: { permission: { 'x_*': 'ask' } },
    call: direct('x_start'),
    reply: 'once'
  },
  (r) => r.asked.length === 0 && outcome(r) !== 'ejecutada'
)
check(
  'permission.ask: un plugin que responde «allow» aprueba sin preguntar y la herramienta se ejecuta',
  {
    plugins: askPlugin('allow'),
    mcpServers: ['x'],
    inline: { permission: { 'x_*': 'ask' } },
    call: direct('x_start'),
    reply: 'reject'
  },
  (r) => r.asked.length === 0 && outcome(r) === 'ejecutada'
)
check(
  'permission.ask: sin decisión del plugin («ask») se pregunta a la persona como siempre',
  {
    plugins: askPlugin('ask'),
    mcpServers: ['x'],
    inline: { permission: { 'x_*': 'ask' } },
    call: direct('x_start'),
    reply: 'reject'
  },
  (r) => r.asked.length === 1 && outcome(r) === 'preguntó'
)

// ── Shell en segundo plano del motor propio (`bash` con background + `shell_wait`) ─────────────────────────────────
const shellOf = (msgs) => /shell_id=(sh_\w+)/.exec(msgs.join('\n'))?.[1] ?? 'sh_no-encontrado'
const bg = (command, yield_ms = 1000) => ({ name: 'bash', args: { command, background: true, yield_ms, description: 'prueba' } })
// ¿Hay algún proceso cuya línea de comandos contiene `needle`? (pgrep en Unix; CIM en Windows, sin contarse a sí mismo)
const stillRunning = (needle) =>
  process.platform === 'win32'
    ? Number(
        spawnSync(
          'powershell',
          ['-NoProfile', '-Command', `@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${needle}*' -and $_.ProcessId -ne $PID }).Count`],
          { encoding: 'utf8' }
        ).stdout.trim()
      ) > 0
    : spawnSync('pgrep', ['-f', needle]).status === 0
check(
  'shell en segundo plano: un comando rápido termina dentro de yield_ms y devuelve su salida',
  { steps: [() => bg('echo hola', 5000)], call: { name: 'bash', args: {} } },
  (r) =>
    r.toolParts.length === 1 &&
    r.toolParts[0].status === 'completed' &&
    /hola/.test(r.toolParts[0].output) &&
    /terminó con código 0/.test(r.toolParts[0].output)
)
check(
  'shell en segundo plano: la salida con acentos y eñes llega intacta (UTF-8)',
  { steps: [() => bg('echo "áéíóú ñ Ñ ¿qué? ü"', 5000)], call: { name: 'bash', args: {} } },
  (r) => r.toolParts.length === 1 && r.toolParts[0].status === 'completed' && r.toolParts[0].output.includes('áéíóú ñ Ñ ¿qué? ü')
)
check(
  'shell en segundo plano: uno lento pasa a «en curso» y shell_wait entrega SOLO lo que faltaba',
  {
    steps: [() => bg('echo uno; sleep 3; echo dos'), (m) => ({ name: 'shell_wait', args: { shell_id: shellOf(m), yield_ms: 8000 } })]
  },
  (r) =>
    r.toolParts.length === 2 &&
    /uno/.test(r.toolParts[0].output) &&
    /Comando en curso \(shell_id=sh_/.test(r.toolParts[0].output) &&
    /dos/.test(r.toolParts[1].output) &&
    !/uno/.test(r.toolParts[1].output.replace(/shell_id=\S+/g, '')) &&
    /terminó con código 0/.test(r.toolParts[1].output) &&
    (r.toolsOffered ?? []).includes('shell_wait')
)
check(
  'shell en segundo plano: terminate mata de verdad el proceso (sin huérfanos)',
  { steps: [() => bg('sleep 297'), (m) => ({ name: 'shell_wait', args: { shell_id: shellOf(m), terminate: true } })], settleMs: 500 },
  (r) => r.toolParts.length === 2 && /terminado por ti/.test(r.toolParts[1].output) && !stillRunning('sleep 297')
)
check(
  'shell en segundo plano: tope de 3 vivos por sesión (el cuarto se rechaza con un mensaje claro)',
  { steps: [() => bg('sleep 61'), () => bg('sleep 62'), () => bg('sleep 63'), () => bg('sleep 64')], settleMs: 500 },
  (r) => r.toolParts.length === 4 && r.toolParts[3].status !== 'completed' && /Ya hay 3 shells/.test(r.toolParts[3].output)
)
check(
  'shell en segundo plano: shell_wait de un id que no existe falla sin revelar nada',
  { steps: [() => ({ name: 'shell_wait', args: { shell_id: 'sh_inexistente' } })] },
  (r) => r.toolParts.length === 1 && /No existe el shell/.test(r.toolParts[0].output)
)
check(
  'shell en segundo plano: con LAZUNOX_SHELL_BG_MAX_MS el tope de vida lo termina',
  {
    env: { LAZUNOX_SHELL_BG_MAX_MS: '2000' },
    steps: [() => bg('sleep 298'), (m) => ({ name: 'shell_wait', args: { shell_id: shellOf(m), yield_ms: 8000 } })],
    settleMs: 500
  },
  (r) => r.toolParts.length === 2 && /tope de vida/.test(r.toolParts[1].output) && !stillRunning('sleep 298')
)

// ── Despertar la conversación al terminar un trabajo en segundo plano (motor propio) ───────────────────────────────
const textos = (r) => (r.userTexts ?? []).join('\n---\n')
check(
  'despertar: un shell en segundo plano que termina solo avisa a la conversación UNA vez, marcado como dato',
  { steps: [() => bg('sleep 2; echo FIN-SOLO', 1000)], settleMs: 7000 },
  (r) => {
    const t = textos(r)
    return (t.match(/<shell_aviso /g) ?? []).length === 1 && /FIN-SOLO/.test(t) && /no instrucciones/i.test(t) && r.requests >= 2
  }
)
check(
  'despertar: si el modelo ya esperó el resultado con shell_wait, NO hay aviso',
  {
    steps: [() => bg('sleep 2; echo YA-LEIDO', 1000), (m) => ({ name: 'shell_wait', args: { shell_id: shellOf(m), yield_ms: 8000 } })],
    settleMs: 4000
  },
  (r) => !/<shell_aviso /.test(textos(r)) && r.toolParts.length === 2 && /YA-LEIDO/.test(r.toolParts[1].output)
)
check(
  'despertar: una celda de Code Mode que termina sola avisa UNA vez',
  {
    env: CODE_MODE,
    mcpServers: ['x'],
    inline: { permission: { 'x_*': 'allow' } },
    steps: [() => ({ name: 'execute', args: { code: slowCode(2500), yield_ms: 1000 } })],
    settleMs: 7000
  },
  (r) => (textos(r).match(/<execute_aviso /g) ?? []).length === 1 && /LENTO-LISTO/.test(textos(r))
)
check(
  'despertar: LAZUNOX_WAKE_ON_FINISH=0 lo apaga',
  { env: { LAZUNOX_WAKE_ON_FINISH: '0' }, steps: [() => bg('sleep 2; echo APAGADO', 1000)], settleMs: 5000 },
  (r) => !/<shell_aviso /.test(textos(r))
)

// ── Celda viva de Code Mode (motor propio): rechazo de permiso y resumen al pausar ──────────────────────────────────
const REVOCADA = 'El usuario rechazó un permiso dentro de este programa'
check(
  'celda viva: un rechazo de permiso detiene el resto del script aunque atrape el error (antes de ceder)',
  {
    env: CODE_MODE,
    mcpServers: ['x'],
    inline: { permission: { x_start: 'ask', x_secret: 'allow' } },
    reply: 'reject',
    call: {
      name: 'execute',
      args: {
        code: "try { await tools.x.start({ command: 'a' }) } catch (e) {} try { await tools.x.secret({ command: 'b' }) } catch (e) {} return 'seguí'"
      }
    }
  },
  (r) => {
    const o = r.toolParts[0]?.output ?? ''
    return o.includes(REVOCADA) && !o.includes('seguí')
  }
)
check(
  'celda viva: el rechazo después de ceder el control también detiene el script y execute_wait lo explica',
  {
    env: CODE_MODE,
    mcpServers: ['x'],
    inline: { permission: { x_start: 'ask', x_secret: 'allow' } },
    reply: 'reject',
    steps: [
      () => ({
        name: 'execute',
        args: {
          code: "await tools.x.slow({ ms: 2500 }); try { await tools.x.start({ command: 'a' }) } catch (e) {} try { await tools.x.secret({ command: 'b' }) } catch (e) {} return 'seguí'",
          yield_ms: 1000
        }
      }),
      (m) => ({ name: 'execute_wait', args: { cell_id: cellOf(m), yield_ms: 8000 } })
    ]
  },
  (r) => {
    const o1 = r.toolParts[0]?.output ?? ''
    const o2 = r.toolParts[1]?.output ?? ''
    return /Script en curso/.test(o1) && o2.includes(REVOCADA) && !o2.includes('seguí')
  }
)
check(
  'celda viva: al pausar, el texto trae un resumen acotado (llamadas completadas y últimas 3)',
  {
    env: CODE_MODE,
    mcpServers: ['x'],
    inline: { permission: { 'x_*': 'allow' } },
    call: {
      name: 'execute',
      args: {
        code: 'for (const i of [1, 2, 3, 4]) await tools.x.slow({ ms: 50 }); return await tools.x.slow({ ms: 6000 })',
        yield_ms: 1500
      }
    }
  },
  (r) => {
    const o = r.toolParts[0]?.output ?? ''
    return (
      /Script en curso/.test(o) && /Resumen:/.test(o) && /llamada\(s\) completada\(s\)/.test(o) && (o.match(/^- /gm) ?? []).length === 3
    )
  }
)

// ── Rutas HTTP de trabajos del motor propio (lo que usa el panel de la app) ────────────────────────────────────────
const getJson = async (res) => ({ status: res.status, body: await res.json().catch(() => null) })
check(
  'rutas de trabajos: una sesión nueva devuelve la lista vacía y terminar un id inexistente da ok:false',
  {
    steps: [() => ({ name: 'shell_wait', args: { shell_id: 'sh_x' } })],
    http: async ({ q, post }) => {
      const nueva = await (await q('/session', post({}))).json()
      const lista = await getJson(await q(`/experimental/session/${nueva.id}/trabajos`))
      const term = await getJson(await q(`/experimental/session/${nueva.id}/trabajos/sh_noexiste/terminar`, post({})))
      return { lista, term }
    }
  },
  (r) =>
    r.http?.lista?.status === 200 &&
    Array.isArray(r.http.lista.body?.trabajos) &&
    r.http.lista.body.trabajos.length === 0 &&
    r.http.term?.body?.ok === false
)
check(
  'rutas de trabajos: un shell en segundo plano aparece solo en SU sesión; otra sesión no lo ve ni lo puede terminar; el dueño sí',
  {
    steps: [() => bg('sleep 296', 1000)],
    settleMs: 500,
    http: async ({ q, post, sessionID }) => {
      const otra = await (await q('/session', post({}))).json()
      const mia = await getJson(await q(`/experimental/session/${sessionID}/trabajos`))
      const id = mia.body?.trabajos?.[0]?.id
      const deOtra = await getJson(await q(`/experimental/session/${otra.id}/trabajos`))
      const ajena = await getJson(await q(`/experimental/session/${otra.id}/trabajos/${id}/terminar`, post({})))
      const vivoTrasAjena = stillRunning('sleep 296')
      const propia = await getJson(await q(`/experimental/session/${sessionID}/trabajos/${id}/terminar`, post({})))
      const segunda = await getJson(await q(`/experimental/session/${sessionID}/trabajos/${id}/terminar`, post({})))
      await new Promise((res) => setTimeout(res, 800))
      const final = await getJson(await q(`/experimental/session/${sessionID}/trabajos`))
      return { mia, deOtra, ajena, vivoTrasAjena, propia, segunda, final }
    }
  },
  (r) => {
    const h = r.http ?? {}
    const t = h.mia?.body?.trabajos?.[0]
    return (
      t?.tipo === 'shell' &&
      /^sh_/.test(t.id) &&
      t.estado === 'en_curso' &&
      t.codigo === null &&
      h.deOtra?.body?.trabajos?.length === 0 &&
      h.ajena?.body?.ok === false &&
      h.vivoTrasAjena === true &&
      h.propia?.body?.ok === true &&
      h.segunda?.body?.ok === false &&
      h.final?.body?.trabajos?.[0]?.estado === 'terminado_por_ti' &&
      !stillRunning('sleep 296')
    )
  }
)

// ── Plugin lazunox-session (F8-B205): texto REAL de `sessionPluginSource()` ───────────────────────────────────────
const src = readFileSync(join(repo, 'src', 'main', 'tasks', 'opencode-config.ts'), 'utf8')
const m = /export function sessionPluginSource\(\): string \{\n  return `([\s\S]*?)`\n\}/.exec(src)
if (!m || m[1].includes('${')) throw new Error('no se pudo extraer el texto del plugin lazunox-session')
const sessionPlugin = { 'lazunox-session.js': m[1] }
const injected = (r) => {
  const p = r.toolParts[0]
  return !!p && p.status === 'completed' && p.output.includes(`"lazunox_session":"${r.sessionID}"`) && !p.output.includes('FALSA')
}
check(
  'plugin: bgshell_* directa recibe la sesión que llama y el modelo no puede fijarla',
  {
    plugins: sessionPlugin,
    mcpServers: ['bgshell'],
    inline: { permission: { 'bgshell_*': 'allow' } },
    call: direct('bgshell_start', { command: 'ls', lazunox_session: 'FALSA' })
  },
  injected
)
check(
  'plugin: Code Mode (execute → tools.bgshell.start) también la recibe',
  {
    plugins: sessionPlugin,
    env: CODE_MODE,
    mcpServers: ['bgshell'],
    inline: { permission: { 'bgshell_*': 'allow' } },
    call: viaExecute('bgshell', 'start', { command: 'ls', lazunox_session: 'FALSA' })
  },
  injected
)
check(
  'plugin: browser_* sigue igual',
  {
    plugins: sessionPlugin,
    mcpServers: ['browser'],
    inline: { permission: { 'browser_*': 'allow' } },
    call: direct('browser_start', { lazunox_session: 'FALSA' })
  },
  injected
)

// ── bgshell REAL (opcional): el aviso de fin lleva la sesión dueña ──────────────────────────────────────────────
if (shellBgCjs) {
  const sb = mkdtempSync(join(tmpdir(), 'lz-engine-probe-sb-'))
  const events = join(sb, 'events.jsonl')
  const block = {
    type: 'local',
    command: [process.execPath, shellBgCjs],
    environment: { LAZUNOX_SHELL_BG_DIR: join(sb, 'work'), LAZUNOX_SHELL_BG_EVENTS: events },
    enabled: true,
    timeout: 15000
  }
  for (const [mode, env, call] of [
    ['directa', {}, direct('bgshell_start', { command: 'echo hola' })],
    ['Code Mode', CODE_MODE, viaExecute('bgshell', 'start', { command: 'echo hola' })]
  ]) {
    check(
      `bgshell real (${mode}): el aviso «exit» del JSONL lleva el sessionID de la sesión que lo lanzó`,
      { plugins: sessionPlugin, env, inline: { mcp: { bgshell: block }, permission: { 'bgshell_*': 'allow' } }, call, settleMs: 2500 },
      (r) => {
        const lines = existsSync(events)
          ? readFileSync(events, 'utf8')
              .trim()
              .split('\n')
              .filter(Boolean)
              .map((l) => JSON.parse(l))
          : []
        return lines.some((e) => e.type === 'exit' && e.sessionID === r.sessionID)
      }
    )
  }
  process.on('exit', () => rmSync(sb, { recursive: true, force: true }))
}

// ── Subagentes en el Chat (F8-B206): config inline REAL (buildInlineConfig) y guardián REAL (subagentGuardPluginSource) ────
const work = mkdtempSync(join(tmpdir(), 'lz-engine-probe-ts-'))
process.on('exit', () => rmSync(work, { recursive: true, force: true }))
/** Importa un módulo TS del repo (empaquetado con esbuild, alias `@shared`). */
async function tsModule(rel) {
  const out = join(work, rel.replace(/[\\/]/g, '_') + '.mjs')
  await build({
    entryPoints: [join(repo, rel)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    alias: { '@shared': join(repo, 'src', 'shared') },
    external: ['electron'],
    logLevel: 'silent'
  })
  return import(pathToFileURL(out).href)
}
const { buildInlineConfig } = await tsModule('src/main/opencode/config.ts')
const { subagentGuardPluginSource } = await tsModule('src/main/opencode/subagent-guard.ts')
const agentsDir = join(repo, 'resources', 'opencode', 'agents')
const guard = { 'lazunox-subagent-guard.js': subagentGuardPluginSource() }
const chatInline = (chatSubagents) => {
  const { agent } = buildInlineConfig({ chatSubagents })
  return { agent }
}
const task = (subagent_type, extra = {}) => ({
  name: 'task',
  args: { subagent_type, description: 'buscar', prompt: 'busca algo', ...extra }
})
const taskPart = (r) => r.toolParts.find((p) => p.tool === 'task')
for (const [label, env, extra] of [
  ['primer plano', {}, {}],
  ['segundo plano', { OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: 'true' }, { background: true }]
]) {
  check(
    `Chat (${label}): con la función encendida lanza lazunox-chat-helper y el guardián lo deja pasar`,
    { agent: 'chat', agentsDir, plugins: guard, env, inline: chatInline(true), call: task('lazunox-chat-helper', extra) },
    (r) => taskPart(r)?.status === 'completed' && r.asked.length === 0
  )
  for (const other of ['general', 'explore', 'lazunox-helper']) {
    check(
      `Chat (${label}): ${other} queda denegado`,
      { agent: 'chat', agentsDir, plugins: guard, env, inline: chatInline(true), call: task(other, extra) },
      (r) => !taskPart(r) || taskPart(r).status === 'error'
    )
  }
}
check(
  'Chat: con la función apagada no se le ofrece `task`',
  { agent: 'chat', agentsDir, plugins: guard, inline: chatInline(false), call: task('lazunox-chat-helper') },
  (r) => Array.isArray(r.toolsOffered) && !r.toolsOffered.includes('task') && !taskPart(r)
)

// ── Permisos «siempre» guardados en disco (solo si la app los enciende) ───────────────────────────────────────
for (const [persist, nombre, espera] of [
  ['1', 'con LAZUNOX_PERMISSION_PERSIST=1 un «siempre» sobrevive al reinicio del motor (no vuelve a preguntar)', false],
  [undefined, 'sin esa variable el «siempre» NO sobrevive al reinicio (vuelve a preguntar)', true]
]) {
  checkRun(`permisos siempre: ${nombre}`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'lz-engine-persist-'))
    try {
      const base = { root, env: { ...(persist ? { LAZUNOX_PERMISSION_PERSIST: persist } : {}) }, mcpServers: ['x'], inline: { permission: { 'x_*': 'ask' } }, call: direct('x_start') }
      const a = await runEngine(bin, { ...base, reply: 'always' })
      if (!a.asked.some((p) => p.permission === 'x_start')) throw new Error('la primera corrida no preguntó')
      const b = await runEngine(bin, { ...base, reply: 'reject' })
      return espera ? b.asked.some((p) => p.permission === 'x_start') : b.asked.length === 0 && outcome(b) === 'ejecutada'
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}

// `PROBE_ONLY=texto` corre solo las comprobaciones cuyo nombre lo contiene (para probar una pieza en un equipo lento o ajeno).
const only = process.env.PROBE_ONLY
let failed = 0
for (const c of only ? checks.filter((x) => x.name.includes(only)) : checks) {
  if (c.run) {
    let ok = false
    let why = ''
    try {
      ok = (await c.run()) === true
    } catch (e) {
      why = String(e?.message ?? e)
    }
    if (!ok) failed++
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${c.name}${ok ? '' : `\n      → ${why || 'no se cumplió'}`}`)
    continue
  }
  const r = await runEngine(bin, c.sc)
  const ok = !r.error && c.expect(r)
  if (!ok) failed++
  console.log(
    `${ok ? 'OK  ' : 'FALLA'} ${c.name}${ok ? '' : `\n      → ${r.error ?? JSON.stringify({ outcome: outcome(r), asked: r.asked, parts: r.toolParts })}`}`
  )
}
console.log(failed ? `\n${failed} comprobación(es) fallaron.` : `\nTodo OK (${checks.length}).`)
process.exit(failed ? 1 : 0)
