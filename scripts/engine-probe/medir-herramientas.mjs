#!/usr/bin/env node
// Mide cuánto pesa la lista de herramientas que el motor manda al modelo en cada petición, con 0, 1 y 3 conectores
// (fase A0 de docs/PLAN-HERRAMIENTAS-DIFERIDAS-Y-FORMULARIOS-MCP.md). No cambia nada: solo arranca el motor aislado,
// con el proveedor falso del arnés, y lee `JSON.stringify(tools)` de la primera petición que lleva herramientas.
// Uso: node scripts/engine-probe/medir-herramientas.mjs <motor> [--many <n>] [--env CLAVE=valor ...] [--json]
//   --many n   herramientas realistas extra por conector (defecto 30; 0 = solo las 3 mínimas de `probe-mcp.mjs`)
//   --env K=V  variables extra del motor (p. ej. `--env LAZUNOX_TOOL_SEARCH=on` para medir DESPUÉS de la búsqueda diferida)
// Tokens ≈ caracteres / 4 (la misma regla del plan). «Conectores» = N copias del conector de prueba (a, b, c), no servidores reales.
import { existsSync } from 'node:fs'
import { runEngine } from './harness.mjs'

const argv = process.argv.slice(2)
const take = (flag) => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv.splice(i, 2)[1] : null
}
const takeAll = (flag) => {
  const out = []
  for (let i = argv.indexOf(flag); i >= 0; i = argv.indexOf(flag)) out.push(argv.splice(i, 2)[1])
  return out
}
const json = argv.includes('--json') && argv.splice(argv.indexOf('--json'), 1).length === 1
const many = Number(take('--many') ?? 30)
const env = Object.fromEntries(
  takeAll('--env').map((kv) => {
    const i = kv.indexOf('=')
    return [kv.slice(0, i), kv.slice(i + 1)]
  })
)
const bin = argv[0]
if (!bin || !existsSync(bin)) {
  console.error('Uso: node scripts/engine-probe/medir-herramientas.mjs <motor> [--many n] [--env K=V] [--json]')
  process.exit(2)
}

const NOMBRES = ['a', 'b', 'c']
const filas = []
for (const n of [0, 1, 3]) {
  const r = await runEngine(bin, {
    mcpServers: NOMBRES.slice(0, n),
    mcpMany: many || undefined,
    env,
    call: { name: '__ninguna__', args: {} } // no se ofrece: el modelo falso responde «listo» tras UNA petición
  })
  if (r.error || !r.toolsBytesFirst) {
    console.error(`Medición con ${n} conector(es) fallida: ${r.error ?? 'la petición no llevó herramientas'}`)
    process.exit(1)
  }
  filas.push({ conectores: n, herramientas: (r.toolsOffered ?? []).length, bytes: r.toolsBytesFirst, nombres: r.toolsOffered ?? [] })
}
const base = filas[0]
for (const f of filas) {
  f.tokens = Math.round(f.bytes / 4)
  f.masQueSin = f.bytes - base.bytes // lo que añaden los conectores
  f.tokensMasQueSin = Math.round(f.masQueSin / 4)
  f.porHerramienta = f.herramientas > base.herramientas ? Math.round(f.masQueSin / (f.herramientas - base.herramientas)) : 0
}
if (json) {
  console.log(JSON.stringify({ motor: bin, many, env, filas: filas.map(({ nombres, ...x }) => x) }, null, 2))
} else {
  console.log(`Motor: ${bin}`)
  console.log(`Conector de prueba: 3 herramientas mínimas${many ? ` + ${many} realistas` : ''}; variables extra: ${JSON.stringify(env)}`)
  console.log('')
  console.log(
    'conectores | herramientas | caracteres | tokens (≈ car/4) | + vs 0 conectores (car / tokens) | car por herramienta de conector'
  )
  for (const f of filas)
    console.log(
      `${String(f.conectores).padStart(10)} | ${String(f.herramientas).padStart(12)} | ${String(f.bytes).padStart(10)} | ${String(f.tokens).padStart(16)} | ${`${f.masQueSin} / ${f.tokensMasQueSin}`.padStart(32)} | ${f.porHerramienta || '-'}`
    )
  console.log('')
  console.log(`Herramientas con 0 conectores: ${base.nombres.length ? base.nombres.join(', ') : '(ninguna)'}`)
  const dif = filas[2].nombres.filter((x) => !base.nombres.includes(x))
  console.log(`Con 3 conectores se añaden ${dif.length}: ${dif.slice(0, 6).join(', ')}${dif.length > 6 ? ', …' : ''}`)
}
process.exit(0)
