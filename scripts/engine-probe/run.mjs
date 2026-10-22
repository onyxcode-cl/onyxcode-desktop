#!/usr/bin/env node
// Comprobaciones MANUALES contra el motor OpenCode real (sin modelo, sin red, aislado): ver `harness.mjs`.
// Uso: node scripts/engine-probe/run.mjs [ruta/al/opencode]   (por defecto resources/opencode-bin/bin/opencode)
// Reverificar al subir de versión del motor (docs/ACTUALIZAR-OPENCODE.md). Sale con código 1 si algo no se cumple.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runEngine } from './harness.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const bin = process.argv[2] ?? join(repo, 'resources', 'opencode-bin', 'bin', 'opencode')
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
