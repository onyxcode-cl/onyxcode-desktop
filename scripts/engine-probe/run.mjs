#!/usr/bin/env node
// Comprobaciones MANUALES contra el motor OpenCode real (sin modelo, sin red, aislado): ver `harness.mjs`.
// Uso: node scripts/engine-probe/run.mjs [ruta/al/opencode] [--shell-bg ruta/al/shell-bg-mcp.cjs]
//   (motor por defecto: resources/opencode-bin/bin/opencode; el .cjs se genera con `node scripts/build-shell-bg.mjs --out <ruta>`)
//   PROBE_ONLY=<texto>  corre solo las comprobaciones cuyo nombre lo contiene (p. ej. `PROBE_ONLY=tool-search`: solo la búsqueda diferida).
//   PROBE_ONLY=agentes | task-wait | rebobinar | compactar   Ola 2 y plan «rebobinar y compactación» (checks-ola2.mjs): subagentes de usuario (2A),
//     task_wait/reanudar (2B), R-1..R-11 y C-1..C-7. Necesitan un motor con esas funciones (el integrado de la Ola 2); en equipos sin ripgrep ni
//     red el arnés pone un `rg` mínimo (`rgShim`) para la herramienta `skill`. Correrlas en el VPS dentro de un contenedor, nunca en el Mac.
//   PROBE_ONLY=plan | todo-verificar | presupuesto | ganchos2 | monitor | objetivo | revisor | skills | lsp | lote | reglas   Olas 3 y 4 del motor
//     lazunox.10 (checks-ola3.mjs): una familia por vez (se eligen por familia exacta, no por texto). Mac: carpeta temporal sin enlaces
//     simbólicos (`TMPDIR=/private/var/tmp/... nice -n 19 node …`); Linux: contenedor sin red en el VPS.
//   PROBE_ONLY=umbral | minimos | resumen | todo-deps | ganchos3 | cambios | respaldo | heredado | sugerencia | unicode | paralelo | bifurcar   Ola 6 del motor
//     lazunox.12 (checks-ola6.mjs), una familia por vez; `PROBE_ONLY=no-verificable` lista lo que no se puede comprobar sin modelo real.
//   PROBE_MCP_MANY=<n>  herramientas extra del conector de las comprobaciones `tool-search` (defecto 40).
//   PROBE_FORCE_TOOL_SEARCH=1  corre las `tool-search` aunque el motor no traiga `LAZUNOX_TOOL_SEARCH` (para ver POR QUÉ fallan).
// Reverificar al subir de versión del motor (docs/ACTUALIZAR-OPENCODE.md). Sale con código 1 si algo no se cumple.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { registrarOla2 } from './checks-ola2.mjs'
import { registrarOla3 } from './checks-ola3.mjs'
import { NO_VERIFICABLE, registrarOla6 } from './checks-ola6.mjs'
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
const checkRun = (name, run, familia, gate) => checks.push({ name, run, familia, gate })

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
          [
            '-NoProfile',
            '-Command',
            `@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${needle}*' -and $_.ProcessId -ne $PID }).Count`
          ],
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

// ── Ganchos de usuario (LAZUNOX_HOOKS_FILE; solo el archivo que fija la app) ───────────────────────────────────
const hooksDir = mkdtempSync(join(tmpdir(), 'lz-hooks-'))
const hooksFile = join(hooksDir, 'hooks.json')
writeFileSync(
  hooksFile,
  JSON.stringify({
    hooks: {
      PreToolUse: [{ matcher: 'write', command: `"${process.execPath}" -e "console.error('prohibido por el gancho');process.exit(2)"` }],
      Stop: [
        { command: `"${process.execPath}" -e "require('fs').writeFileSync('${join(hooksDir, 'stop.txt').replaceAll('\\', '/')}', 'ok')"` }
      ],
      PostToolUse: [{ matcher: 'read', command: `"${process.execPath}" -e "console.error('aviso post');process.exit(2)"` }]
    }
  })
)
process.on('exit', () => rmSync(hooksDir, { recursive: true, force: true }))
const conGanchos = { OPENCODE_DISABLE_DEFAULT_PLUGINS: '0', LAZUNOX_HOOKS_FILE: hooksFile }
check(
  'ganchos de usuario: PreToolUse con código 2 bloquea la herramienta y el modelo recibe el motivo',
  { env: conGanchos, call: { name: 'write', args: { filePath: 'a.txt', content: 'x' } } },
  (r) => r.toolParts[0]?.status === 'error' && /prohibido por el gancho/.test(r.toolParts[0].output)
)
check(
  'ganchos de usuario: PostToolUse con código 2 añade su aviso al resultado',
  { env: conGanchos, call: { name: 'read', args: { filePath: '.' } } },
  (r) => /aviso post/.test(r.toolParts[0]?.output ?? '')
)
check(
  'ganchos de usuario: Stop se ejecuta cuando la sesión queda ociosa',
  { env: conGanchos, settleMs: 2500, call: { name: 'read', args: { filePath: '.' } } },
  () => existsSync(join(hooksDir, 'stop.txt'))
)
check(
  'ganchos de usuario: sin LAZUNOX_HOOKS_FILE no se ejecuta ningún gancho',
  { env: { OPENCODE_DISABLE_DEFAULT_PLUGINS: '0' }, call: { name: 'write', args: { filePath: 'a.txt', content: 'x' } } },
  (r) => r.toolParts[0]?.status === 'completed'
)

// ── Rutas protegidas: editar .git/.claude/.opencode/.mcp.json siempre pregunta (salvo deny) ─────────────────────
const editCall = (file) => ({ name: 'write', args: { filePath: file, content: 'x' } })
check(
  'rutas protegidas: editar un archivo normal con `edit: allow` NO pregunta',
  { inline: { permission: { edit: 'allow' } }, call: editCall('nota.txt') },
  (r) => r.asked.length === 0 && r.toolParts[0]?.status === 'completed'
)
check(
  'rutas protegidas: con `edit: allow`, escribir en .git/hooks SÍ pregunta (y rechazado no se escribe)',
  { inline: { permission: { edit: 'allow' } }, call: editCall('.git/hooks/pre-commit'), reply: 'reject' },
  (r) => r.asked.some((a) => a.permission === 'edit') && r.toolParts[0]?.status === 'error'
)
check(
  'rutas protegidas: .mcp.json y .claude/ también preguntan aunque todo esté permitido',
  { inline: { permission: { '*': 'allow' } }, steps: [() => editCall('.mcp.json')], call: editCall('.claude/x.json'), reply: 'reject' },
  (r) => r.asked.length >= 1 && r.asked.every((a) => a.permission === 'edit')
)

// ── Permisos «siempre» guardados en disco (solo si la app los enciende) ───────────────────────────────────────
for (const [persist, nombre, espera] of [
  ['1', 'con LAZUNOX_PERMISSION_PERSIST=1 un «siempre» sobrevive al reinicio del motor (no vuelve a preguntar)', false],
  [undefined, 'sin esa variable el «siempre» NO sobrevive al reinicio (vuelve a preguntar)', true]
]) {
  checkRun(`permisos siempre: ${nombre}`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'lz-engine-persist-'))
    try {
      const base = {
        root,
        env: { ...(persist ? { LAZUNOX_PERMISSION_PERSIST: persist } : {}) },
        mcpServers: ['x'],
        inline: { permission: { 'x_*': 'ask' } },
        call: direct('x_start')
      }
      const a = await runEngine(bin, { ...base, reply: 'always' })
      if (!a.asked.some((p) => p.permission === 'x_start')) throw new Error('la primera corrida no preguntó')
      const b = await runEngine(bin, { ...base, reply: 'reject' })
      return espera ? b.asked.some((p) => p.permission === 'x_start') : b.asked.length === 0 && outcome(b) === 'ejecutada'
    } finally {
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) // Windows tarda en soltar los .node del motor
      } catch {
        /* temporal */
      }
    }
  })
}

// ── Búsqueda diferida de herramientas (docs/PLAN-HERRAMIENTAS-DIFERIDAS-Y-FORMULARIOS-MCP.md, fase A2: A-1..A-9) ─────────
// Contrato del motor: `tool_search` + `mcp_call` en lugar de las herramientas del conector, con `LAZUNOX_TOOL_SEARCH=on|auto|off`
// (+ `_MIN_TOKENS`, `_KEEP`). Con un motor sin esa variable se SALTAN (mensaje claro); `PROBE_FORCE_TOOL_SEARCH=1` las corre igual.
const MANY = Number(process.env.PROBE_MCP_MANY ?? 40) || 40
const TS_ON = { LAZUNOX_TOOL_SEARCH: 'on' }
const tsCheck = (id, text, sc, expect) =>
  checks.push({
    name: `tool-search ${id}: ${text}`,
    sc: { mcpMany: MANY, ...sc, env: { ...TS_ON, ...(sc.env ?? {}) } },
    expect,
    gate: 'tool-search'
  })
const tsRun = (id, text, run) => checks.push({ name: `tool-search ${id}: ${text}`, run, gate: 'tool-search' })
const mcpCall = (tool, args = { command: 'a' }, force = true) => ({ name: 'mcp_call', args: { tool, arguments: args }, force })
const offered = (r) => r.toolsOffered ?? []
/** La parte de la sesión es `mcp_call` (no se ejecutó por otro camino). */
const viaMcpCall = (r, i = 0) => r.toolParts[i]?.tool === 'mcp_call'
const ran = (r, i, echo) => r.toolParts[i]?.status === 'completed' && (r.toolParts[i].output ?? '').includes(echo)
/** Devuelve true o el motivo (texto) del fallo: el corredor lo imprime en vez de un volcado. */
const veredicto = (cond, msg) => (cond ? true : msg)
const seesTS = (r) =>
  veredicto(
    offered(r).includes('tool_search') && offered(r).includes('mcp_call'),
    `el motor no ofreció tool_search/mcp_call (herramientas ofrecidas: ${offered(r).length}, entre ellas ${offered(r).filter((n) => n.startsWith('x_')).length} x_*)`
  )

tsCheck(
  'A-1',
  `la lista ofrecida tiene tool_search y mcp_call y NINGUNA x_* (conector con ${MANY + 3} herramientas)`,
  { mcpServers: ['x'], call: { name: 'tool_search', args: { query: 'ticket' } } },
  (r) => {
    const t = seesTS(r)
    if (t !== true) return t
    const sueltas = offered(r).filter((n) => n.startsWith('x_'))
    return veredicto(sueltas.length === 0, `siguen sueltas ${sueltas.length} herramientas x_* (p. ej. ${sueltas.slice(0, 3).join(', ')})`)
  }
)
tsRun(
  'A-2',
  'el peso de las herramientas DEL CONECTOR baja ≥ 85 % con LAZUNOX_TOOL_SEARCH=on (las integradas del motor no cuentan)',
  async () => {
    const base = { mcpServers: ['x'], mcpMany: MANY, call: { name: 'tool_search', args: { query: 'ticket' } } }
    const off = await runEngine(bin, { ...base, env: { LAZUNOX_TOOL_SEARCH: 'off' } })
    const on = await runEngine(bin, { ...base, env: TS_ON })
    const none = await runEngine(bin, { call: { name: 'read', args: { filePath: '.' } }, env: { LAZUNOX_TOOL_SEARCH: 'off' } })
    if (off.error || on.error || none.error) throw new Error(off.error ?? on.error ?? none.error)
    const conectorOff = off.toolsBytesFirst - none.toolsBytesFirst
    const conectorOn = on.toolsBytesFirst - none.toolsBytesFirst
    const baja = 1 - conectorOn / conectorOff
    console.log(
      `      · lista completa: off=${off.toolsBytesFirst} on=${on.toolsBytesFirst} (≈ ${Math.round(off.toolsBytesFirst / 4)} → ${Math.round(on.toolsBytesFirst / 4)} tokens); solo el conector: ${Math.round(conectorOff / 4)} → ${Math.round(conectorOn / 4)} tokens (baja ${(baja * 100).toFixed(1)} %)`
    )
    if (!offered(on).includes('tool_search')) throw new Error('con LAZUNOX_TOOL_SEARCH=on el motor no ofreció tool_search')
    if (baja < 0.85) throw new Error(`lo del conector solo bajó ${(baja * 100).toFixed(1)} % (se pide ≥ 85 %)`)
    return true
  }
)
tsCheck(
  'A-3',
  'x_*: ask → mcp_call x_start pregunta por «x_start» (no por mcp_call) y, rechazado, no se ejecuta',
  { mcpServers: ['x'], inline: { permission: { 'x_*': 'ask' } }, call: mcpCall('x_start', { command: 'a' }, false), reply: 'reject' },
  (r) => {
    const t = seesTS(r)
    if (t !== true) return t
    return veredicto(
      viaMcpCall(r) && r.asked.length >= 1 && r.asked.every((a) => a.permission === 'x_start') && r.toolParts[0].status !== 'completed',
      `asked=${JSON.stringify(r.asked.map((a) => a.permission))} partes=${JSON.stringify(r.toolParts.map((p) => [p.tool, p.status]))}`
    )
  }
)
tsCheck(
  'A-3b',
  'x_*: ask y la persona aprueba → mcp_call ejecuta x_start y el servidor recibe los argumentos',
  { mcpServers: ['x'], inline: { permission: { 'x_*': 'ask' } }, call: mcpCall('x_start', { command: 'hola' }, false), reply: 'once' },
  (r) => {
    const t = seesTS(r)
    if (t !== true) return t
    return veredicto(
      viaMcpCall(r) && r.asked.some((a) => a.permission === 'x_start') && ran(r, 0, 'ECHO:start:{"command":"hola"}'),
      JSON.stringify({ asked: r.asked, parts: r.toolParts })
    )
  }
)
tsCheck(
  'A-4',
  'x_*: deny (con otro conector «y» permitido para que mcp_call exista) → mcp_call x_start ni se ejecuta ni pregunta',
  { mcpServers: ['x', 'y'], inline: { permission: { 'x_*': 'deny', 'y_*': 'allow' } }, call: mcpCall('x_start') },
  (r) => {
    const t = seesTS(r)
    if (t !== true) return t
    return veredicto(
      r.asked.length === 0 && viaMcpCall(r) && r.toolParts[0].status !== 'completed' && !(r.toolParts[0].output ?? '').includes('ECHO:'),
      JSON.stringify({ asked: r.asked, parts: r.toolParts })
    )
  }
)
tsCheck(
  'A-5',
  'x_secret: deny con x_*: allow → x_start se ejecuta y x_secret no',
  {
    mcpServers: ['x'],
    inline: { permission: { 'x_*': 'allow', x_secret: 'deny' } },
    steps: [() => mcpCall('x_start'), () => mcpCall('x_secret')],
    call: { name: 'mcp_call', args: {} }
  },
  (r) => {
    const t = seesTS(r)
    if (t !== true) return t
    return veredicto(
      r.toolParts.length === 2 &&
        ran(r, 0, 'ECHO:start:') &&
        r.toolParts[1].status !== 'completed' &&
        !(r.toolParts[1].output ?? '').includes('ECHO:secret'),
      JSON.stringify({ asked: r.asked, parts: r.toolParts })
    )
  }
)
// Agente primario con "*": deny y solo x_start permitido: el catálogo diferido respeta las reglas del AGENTE.
tsCheck(
  'A-6',
  'agente con "*": deny y "x_start": allow → x_start sí, x_secret no',
  {
    mcpServers: ['x'],
    agent: 'solo-start',
    inline: { agent: { 'solo-start': { mode: 'primary', description: 'prueba', permission: { '*': 'deny', x_start: 'allow' } } } },
    steps: [() => mcpCall('x_start'), () => mcpCall('x_secret')],
    call: { name: 'mcp_call', args: {} }
  },
  (r) => {
    const t = seesTS(r)
    if (t !== true) return t
    return veredicto(
      r.toolParts.length === 2 &&
        ran(r, 0, 'ECHO:start:') &&
        r.toolParts[1].status !== 'completed' &&
        !(r.toolParts[1].output ?? '').includes('ECHO:secret'),
      JSON.stringify({ asked: r.asked, parts: r.toolParts })
    )
  }
)
// Ganchos de plugin: reciben el nombre REAL (x_start), nunca mcp_call, y lo que mutan llega al servidor.
const hookLog = join(work, 'tool-search-hook.log')
const hookPlugin = (mutate) => ({
  'ts-hook.js': `import { appendFileSync } from 'node:fs'
export default {
  id: 'ts-hook',
  server: async () => ({
    'tool.execute.before': async (input, output) => {
      appendFileSync(process.env.PROBE_HOOK_LOG, 'before:' + input.tool + ':' + JSON.stringify(output.args) + '\\n')
      ${mutate ? "if (input.tool === 'x_start') output.args.command = 'MUTADO'" : ''}
    },
    'tool.execute.after': async (input) => {
      appendFileSync(process.env.PROBE_HOOK_LOG, 'after:' + input.tool + '\\n')
    }
  })
}
`
})
const hookLines = () => (existsSync(hookLog) ? readFileSync(hookLog, 'utf8').trim().split('\n').filter(Boolean) : [])
tsRun('A-7', 'un plugin en tool.execute.before recibe «x_start» (no «mcp_call») y también el after', async () => {
  rmSync(hookLog, { force: true })
  const r = await runEngine(bin, {
    mcpServers: ['x'],
    mcpMany: MANY,
    plugins: hookPlugin(false),
    env: { ...TS_ON, PROBE_HOOK_LOG: hookLog },
    inline: { permission: { 'x_*': 'allow' } },
    call: mcpCall('x_start', { command: 'a' }, false)
  })
  if (r.error) throw new Error(r.error)
  const t = seesTS(r)
  if (t !== true) throw new Error(t)
  const l = hookLines()
  if (!l.some((x) => x.startsWith('before:x_start:'))) throw new Error(`el gancho no recibió x_start; vio: ${JSON.stringify(l)}`)
  if (l.some((x) => x.startsWith('before:mcp_call') || x.startsWith('after:mcp_call')))
    throw new Error(`el gancho vio mcp_call: ${JSON.stringify(l)}`)
  if (!l.some((x) => x === 'after:x_start')) throw new Error(`falta el after de x_start: ${JSON.stringify(l)}`)
  return true
})
tsRun('A-8', 'el plugin muta args en before y el eco del servidor lo refleja', async () => {
  rmSync(hookLog, { force: true })
  const r = await runEngine(bin, {
    mcpServers: ['x'],
    mcpMany: MANY,
    plugins: hookPlugin(true),
    env: { ...TS_ON, PROBE_HOOK_LOG: hookLog },
    inline: { permission: { 'x_*': 'allow' } },
    call: mcpCall('x_start', { command: 'ORIGINAL' }, false)
  })
  if (r.error) throw new Error(r.error)
  const t = seesTS(r)
  if (t !== true) throw new Error(t)
  if (!ran(r, 0, 'ECHO:start:{"command":"MUTADO"}'))
    throw new Error(`el servidor no recibió el argumento mutado: ${JSON.stringify(r.toolParts)}`)
  return true
})
// Subagente con x_*: deny: lo lanza el padre (que sí ve x_*); la hija busca en tool_search y no debe encontrar ni ver nada de x.
tsCheck(
  'A-9',
  'un subagente con x_*: deny no ve x_* (ni suelto ni en tool_search) aunque el padre sí',
  {
    mcpServers: ['x', 'y'],
    inline: {
      permission: { 'x_*': 'allow', 'y_*': 'allow' },
      agent: { 'sin-x': { mode: 'subagent', description: 'ayudante sin el conector x', permission: { 'x_*': 'deny', 'y_*': 'allow' } } }
    },
    decide: ({ tools, toolTexts, userTexts }) => {
      if (toolTexts.length) return null
      if (userTexts.some((t) => t.includes('busca algo')))
        return tools.includes('tool_search') ? { name: 'tool_search', args: { query: 'ticket start secret' } } : null
      return { name: 'task', args: { subagent_type: 'sin-x', description: 'buscar', prompt: 'busca algo' } }
    }
  },
  (r) => {
    const t = seesTS(r)
    if (t !== true) return t
    // La petición de la hija: la que ofrece herramientas pero no `task` (la hija no lanza más ayudantes).
    const hija = (r.requestTools ?? []).find((ts, i) => i > 0 && ts.length && !ts.includes('task'))
    if (!hija)
      return `no se vio la petición de la hija (herramientas por petición: ${JSON.stringify((r.requestTools ?? []).map((x) => x.length))})`
    const sueltas = hija.filter((n) => n.startsWith('x_'))
    if (sueltas.length) return `la hija ve herramientas x_* sueltas: ${sueltas.slice(0, 3).join(', ')}`
    // El padre no busca: cualquier resultado con nombres de x es lo que vio la hija.
    const fuga = (r.toolMessages ?? []).filter((m) => /x_start|x_secret|x_create_ticket/.test(m))
    return veredicto(
      fuga.length === 0,
      `la búsqueda de la hija devolvió herramientas de x: ${fuga.map((m) => m.slice(0, 200)).join(' | ')}`
    )
  }
)

// ── Formularios MCP (elicitation/create): B-1..B-6 ──────────────────────────────────────────────────────────────
// Necesitan un motor con formularios (LAZUNOX_MCP_ELICITATION, rutas /mcp/elicitation). Con un motor sin la función:
// `PROBE_SKIP_FORMULARIOS=1` las salta. Ejecutables solas con `PROBE_ONLY=formularios`.
// El servidor de prueba (`probe-mcp.mjs`) anota en un archivo lo que le llega del cliente; aquí se lee con `fmEngine`.
if (!process.env.PROBE_SKIP_FORMULARIOS) {
  const FM = { LAZUNOX_MCP_ELICITATION: '1' }
  const VALORES = { nombre: 'Ana', edad: 30, peso: 61.5, activo: true, color: 'verde' }
  /** Corre el motor con el conector `x` y devuelve { r, srv: líneas que anotó el servidor MCP }. */
  const fmEngine = async (sc) => {
    const dir = mkdtempSync(join(tmpdir(), 'lz-fm-'))
    const archivo = join(dir, 'servidor.jsonl')
    try {
      const r = await runEngine(bin, { mcpServers: ['x'], settleMs: 1500, ...sc, mcpEnv: { ...(sc.mcpEnv ?? {}), PROBE_MCP_OUT: archivo } })
      if (r.error) throw new Error(r.error)
      const srv = existsSync(archivo)
        ? readFileSync(archivo, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((l) => JSON.parse(l))
        : []
      return { r, srv }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  const tipos = (r, t) => r.elicitation.filter((e) => e.type === t)
  const resumen = (r, srv) =>
    JSON.stringify({
      out: r.toolParts[0]?.output?.slice(0, 200),
      eventos: r.elicitation.map((e) => `${e.type}${e.reason ? ':' + e.reason : ''}${e.action ? ':' + e.action : ''}`),
      replies: r.elicitReplies,
      srv
    })
  const eco = (r) => {
    const m = /FORM:(\{.*\})/s.exec(r.toolParts[0]?.output ?? '')
    return m ? JSON.parse(m[1]) : null
  }
  const aviso = (cond, msg, r, srv) => {
    if (!cond) throw new Error(`${msg} → ${resumen(r, srv)}`)
  }

  checkRun('formularios B-1: sin LAZUNOX_MCP_ELICITATION el servidor no ve la capacidad (y con ella sí)', async () => {
    const sin = await fmEngine({ call: direct('x_caps', {}) })
    const o1 = sin.r.toolParts[0]?.output ?? ''
    aviso(outcome(sin.r) === 'ejecutada' && o1.startsWith('CAPS:'), 'sin variable: la herramienta caps no corrió', sin.r, sin.srv)
    aviso(!/elicitation/i.test(o1), 'sin variable el servidor ve la capacidad elicitation: ' + o1, sin.r, sin.srv)
    const con = await fmEngine({ env: FM, call: direct('x_caps', {}) })
    const o2 = con.r.toolParts[0]?.output ?? ''
    aviso(/"elicitation":\{[^}]*"form"/.test(o2), 'con variable el servidor NO ve elicitation.form: ' + o2, con.r, con.srv)
    return true
  })

  checkRun(
    'formularios B-2: con la variable, aceptar → el eco trae los valores (texto, número, boolean, enum) y los eventos no los llevan',
    async () => {
      const { r, srv } = await fmEngine({ env: FM, call: direct('x_form', {}), elicit: { action: 'accept', content: VALORES } })
      aviso(outcome(r) === 'ejecutada', 'la llamada no terminó bien', r, srv)
      const e = eco(r)
      aviso(e?.action === 'accept', 'el eco no trae action=accept', r, srv)
      aviso(
        JSON.stringify(e.content) === JSON.stringify(VALORES) || Object.entries(VALORES).every(([k, v]) => e.content?.[k] === v),
        'el eco no trae los valores (con sus tipos)',
        r,
        srv
      )
      const asked = tipos(r, 'asked')
      aviso(
        asked.length === 1 &&
          asked[0].server === 'x' &&
          ['nombre', 'edad', 'peso', 'activo', 'color'].every((n) => asked[0].fields?.some((f) => f.name === n)),
        'evento asked ausente o sin los 5 campos',
        r,
        srv
      )
      aviso(r.elicitList?.[0]?.ids?.includes(asked[0].id), 'GET /mcp/elicitation no listaba el formulario abierto', r, srv)
      aviso(r.elicitReplies[0]?.status === 200, 'la respuesta HTTP no fue 200', r, srv)
      const rep = tipos(r, 'replied')
      aviso(rep.length === 1 && rep[0].action === 'accept' && rep[0].id === asked[0].id, 'evento replied ausente o distinto', r, srv)
      aviso(!/Ana|61\.5/.test(JSON.stringify(r.elicitation)), 'un evento lleva los valores', r, srv)
      return true
    }
  )

  checkRun('formularios B-3: campo password → decline sin evento asked (y sí rejected/secret)', async () => {
    const { r, srv } = await fmEngine({
      env: FM,
      call: direct('x_form_password', {}),
      elicit: { action: 'accept', content: { usuario: 'a' } }
    })
    aviso(outcome(r) === 'ejecutada', 'la llamada no terminó bien', r, srv)
    aviso(eco(r)?.action === 'decline', 'el eco no es decline', r, srv)
    aviso(tipos(r, 'asked').length === 0 && r.elicitReplies.length === 0, 'hubo evento asked / respuesta', r, srv)
    const rej = tipos(r, 'rejected')
    aviso(rej.length === 1 && rej[0].reason === 'secret', 'falta rejected con reason=secret', r, srv)
    return true
  })

  checkRun('formularios B-4: solicitud sin llamada viva (el servidor la manda por su cuenta) → decline', async () => {
    const { r, srv } = await fmEngine({
      env: FM,
      call: direct('x_late', {}),
      settleMs: 2500,
      elicit: { action: 'accept', content: VALORES }
    })
    aviso(outcome(r) === 'ejecutada' && /LATE-OK/.test(r.toolParts[0]?.output ?? ''), 'la llamada late no terminó bien', r, srv)
    const resp = srv.filter((l) => l.evento === 'respuesta-formulario')
    aviso(resp.length === 1 && resp[0].action === 'decline', 'el servidor no recibió decline', r, srv)
    aviso(tipos(r, 'asked').length === 0 && r.elicitReplies.length === 0, 'hubo evento asked (se atribuyó a una sesión)', r, srv)
    return true
  })

  checkRun('formularios B-5: abortar la sesión con un formulario abierto → rejected con reason abort', async () => {
    const { r, srv } = await fmEngine({ env: FM, call: direct('x_form', {}), elicit: { action: 'abort' }, settleMs: 2500 })
    aviso(tipos(r, 'asked').length === 1, 'no llegó a abrirse el formulario', r, srv)
    aviso(r.elicitReplies[0]?.action === 'abort' && r.elicitReplies[0].status < 300, 'el aborto HTTP no se aceptó', r, srv)
    const rej = tipos(r, 'rejected')
    aviso(
      rej.length === 1 && rej[0].reason === 'abort' && rej[0].id === tipos(r, 'asked')[0].id,
      'falta rejected con reason=abort del mismo formulario',
      r,
      srv
    )
    aviso(tipos(r, 'replied').length === 0, 'hubo replied tras abortar', r, srv)
    // Dato informativo (no se exige): qué vio el servidor MCP del lado suyo (respuesta/cancelación).
    if (process.env.PROBE_VERBOSE) console.log('      servidor MCP vio:', JSON.stringify(srv), '| llamada:', r.toolParts[0]?.status)
    return true
  })

  checkRun(
    'formularios B-6: tiempo máximo corto (1,5 s) NO corta la llamada con el formulario abierto, pero sí si pasa sin formulario',
    async () => {
      const base = { env: { ...FM, LAZUNOX_ELICITATION_TIMEOUT_MS: '20000' }, mcpTimeout: 1500 }
      // Con formulario: la persona tarda 3,5 s (más del doble del tope) y la llamada sigue viva y recibe la respuesta.
      const a = await fmEngine({ ...base, call: direct('x_form', {}), elicit: { action: 'accept', content: VALORES, delayMs: 3500 } })
      aviso(
        outcome(a.r) === 'ejecutada' && eco(a.r)?.action === 'accept',
        'con formulario abierto la llamada se cortó o no recibió accept',
        a.r,
        a.srv
      )
      // Sin formulario: 3,5 s de espera con tope de 1,5 s → se corta.
      const b = await fmEngine({ ...base, call: direct('x_slow', { ms: 3500 }) })
      aviso(
        /time/i.test(b.r.toolParts[0]?.output ?? '') && b.r.toolParts[0]?.status === 'error',
        'sin formulario la llamada lenta NO se cortó',
        b.r,
        b.srv
      )
      aviso(tipos(b.r, 'asked').length === 0, 'hubo formulario en la llamada lenta', b.r, b.srv)
      return true
    }
  )

  checkRun(
    'formularios B-6b: formulario sin contestar con LAZUNOX_ELICITATION_TIMEOUT_MS=1000 → rejected/timeout y el servidor recibe cancel',
    async () => {
      const { r, srv } = await fmEngine({
        env: { ...FM, LAZUNOX_ELICITATION_TIMEOUT_MS: '1000' },
        call: direct('x_form', {}),
        elicit: { action: 'none' },
        mcpTimeout: 15000
      })
      const rej = tipos(r, 'rejected')
      aviso(tipos(r, 'asked').length === 1 && rej.length === 1 && rej[0].reason === 'timeout', 'falta rejected con reason=timeout', r, srv)
      aviso(eco(r)?.action === 'cancel', 'el servidor no recibió cancel', r, srv)
      return true
    }
  )
}

// Ola 2 y plan «rebobinar y compactación»: PROBE_ONLY=agentes | task-wait | rebobinar | compactar (ver checks-ola2.mjs).
registrarOla2({ bin, checkRun, runEngine })
// Olas 3 y 4 del motor lazunox.10: PROBE_ONLY=plan | todo-verificar | presupuesto | ganchos2 | monitor | objetivo | revisor | skills | lsp | lote | reglas (checks-ola3.mjs).
const FAMILIAS_OLA3 = registrarOla3({ bin, checkRun, runEngine })
// Ola 6 del motor lazunox.12: PROBE_ONLY=umbral | minimos | resumen | todo-deps | ganchos3 | cambios | respaldo | heredado | sugerencia | unicode | paralelo | bifurcar (checks-ola6.mjs).
// `PROBE_ONLY=no-verificable` imprime lo que este probe no puede comprobar sin modelo real.
const FAMILIAS_OLA6 = registrarOla6({ bin, checkRun, runEngine })

// `PROBE_ONLY=texto` corre solo las comprobaciones cuyo nombre lo contiene (para probar una pieza en un equipo lento o ajeno).
const only = process.env.PROBE_ONLY
let failed = 0
let skipped = 0
/** ¿El motor trae la búsqueda diferida? (busca la variable en el binario compilado; se calcula una sola vez). */
let tsSupport = null
const hasToolSearch = () => (tsSupport ??= process.env.PROBE_FORCE_TOOL_SEARCH === '1' || readFileSync(bin).includes('LAZUNOX_TOOL_SEARCH'))
// Las comprobaciones de las olas 3 y 4 llevan `familia` y se eligen por ella (el texto «plan» también está en «segundo plano»).
if (only === 'no-verificable') {
  for (const [que, porque] of NO_VERIFICABLE) console.log(`NO VERIFICABLE ${que}\n      → ${porque}`)
  process.exit(0)
}
const selected = only ? checks.filter((x) => (x.familia ? x.familia === only : x.name.includes(only) && !FAMILIAS_OLA3.includes(only) && !FAMILIAS_OLA6.includes(only))) : checks
for (const c of selected) {
  // `gate: 'motor-viejo'`: necesita un binario de un motor anterior (PROBE_MOTOR_VIEJO=/ruta/al/opencode, p. ej. el lazunox.10 publicado) para fabricar una base antigua.
  if (c.gate === 'motor-viejo' && !process.env.PROBE_MOTOR_VIEJO) {
    skipped++
    console.log(`SALTA ${c.name}\n      → falta PROBE_MOTOR_VIEJO=/ruta/al/opencode de un motor anterior (p. ej. lazunox.10)`)
    continue
  }
  if (c.gate === 'tool-search' && !hasToolSearch()) {
    skipped++
    console.log(
      `SALTA ${c.name}\n      → este motor no trae LAZUNOX_TOOL_SEARCH (aún no tiene la búsqueda diferida); PROBE_FORCE_TOOL_SEARCH=1 la corre igual`
    )
    continue
  }
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
  // `expect` devuelve boolean; las de tool-search pueden devolver un texto (el motivo del fallo).
  const res = r.error ? false : c.expect(r)
  const ok = !!res && typeof res !== 'string'
  if (!ok) failed++
  console.log(
    `${ok ? 'OK  ' : 'FALLA'} ${c.name}${ok ? '' : `\n      → ${r.error ?? (typeof res === 'string' ? res : JSON.stringify({ outcome: outcome(r), asked: r.asked, parts: r.toolParts }))}`}`
  )
}
if (skipped) console.log(`\n${skipped} comprobación(es) saltada(s) (motor sin LAZUNOX_TOOL_SEARCH, o falta PROBE_MOTOR_VIEJO).`)
console.log(
  failed ? `\n${failed} comprobación(es) fallaron.` : `\nTodo OK (${selected.length - skipped}${skipped ? ` + ${skipped} saltadas` : ''}).`
)
process.exit(failed ? 1 : 0)
