#!/usr/bin/env node
// Comprobaciones MANUALES contra el motor OpenCode real (sin modelo, sin red, aislado): ver `harness.mjs`.
// Uso: node scripts/engine-probe/run.mjs [ruta/al/opencode] [--shell-bg ruta/al/shell-bg-mcp.cjs]
//   (motor por defecto: resources/opencode-bin/bin/opencode; el .cjs se genera con `node scripts/build-shell-bg.mjs --out <ruta>`)
// Reverificar al subir de versión del motor (docs/ACTUALIZAR-OPENCODE.md). Sale con código 1 si algo no se cumple.
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

let failed = 0
for (const c of checks) {
  const r = await runEngine(bin, c.sc)
  const ok = !r.error && c.expect(r)
  if (!ok) failed++
  console.log(
    `${ok ? 'OK  ' : 'FALLA'} ${c.name}${ok ? '' : `\n      → ${r.error ?? JSON.stringify({ outcome: outcome(r), asked: r.asked, parts: r.toolParts })}`}`
  )
}
console.log(failed ? `\n${failed} comprobación(es) fallaron.` : `\nTodo OK (${checks.length}).`)
process.exit(failed ? 1 : 0)
