// Sonda D2 (1.8.13): «planear con un modelo y ejecutar con otro». Con el motor REAL y dos proveedores falsos (pa = fuerte, pb = barato),
// comprueba a qué proveedor/modelo llega la petición según el agente (plan / build) que manda la app en cada mensaje, y que un
// ayudante (`lazunox-helper`, `model: inherit`) hereda el modelo del mensaje que lo lanzó.
// Uso: node scripts/engine-probe/probe-planear-ejecutar.mjs <ruta-al-motor>   (manual: no lo corre `npm test`)
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runEngine } from './harness.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const bin = process.argv[2]
if (!bin) {
  console.error('Uso: node probe-planear-ejecutar.mjs <ruta-al-motor>')
  process.exit(2)
}
const modelo = (id) => ({ name: id, tool_call: true, cost: { input: 0, output: 0 } })
const prov = (pport, id, modelos) => ({
  npm: '@ai-sdk/openai-compatible',
  name: id,
  options: { baseURL: `http://127.0.0.1:${pport}/${id}/v1`, apiKey: 'no-usado' },
  models: modelos
})
const llamadas = []
const r = await runEngine(bin, {
  git: true,
  agentsDir: join(repo, 'resources', 'opencode', 'agents'),
  providers: (p) => ({ pa: prov(p, 'pa', { a1: modelo('a1') }), pb: prov(p, 'pb', { b1: modelo('b1') }) }),
  model: 'pa/a1',
  smallModel: 'pa/a1',
  skipFirst: true,
  reply: 'once',
  call: { name: 'read', args: {} },
  decide: (ctx) => {
    const quien = `${/^\/(\w+)\//.exec(ctx.url)?.[1]}/${ctx.model}`
    if (!(ctx.tools ?? []).length) return { text: 'titulo' } // petición de título
    const texto = JSON.stringify(ctx.userTexts.at(-1) ?? '')
    llamadas.push({ quien, texto })
    if (
      /LANZA_AYUDANTE/.test(texto) &&
      (ctx.tools ?? []).includes('task') &&
      !ctx.toolTexts.length &&
      !/HIJA/.test(JSON.stringify(ctx.messages).slice(0, 4000))
    )
      return { name: 'task', args: { subagent_type: 'lazunox-helper', description: 'trabajo', prompt: 'HIJA: hola' } }
    return { text: `OK ${quien}` }
  },
  http: async (h) => {
    const enviar = async (agent, m, texto) => {
      const [providerID, modelID] = m.split('/')
      const x = await h.q(
        `/session/${h.sessionID}/message`,
        h.post({ agent, model: { providerID, modelID }, parts: [{ type: 'text', text: texto }] })
      )
      return x.status
    }
    const estados = []
    estados.push(await enviar('plan', 'pa/a1', 'PLAN_UNO'))
    estados.push(await enviar('build', 'pb/b1', 'EJECUTA_UNO'))
    estados.push(await enviar('plan', 'pb/b1', 'PLAN_DOS')) // cambiar el modelo de planear en la conversación
    estados.push(await enviar('build', 'pb/b1', 'LANZA_AYUDANTE'))
    return { estados }
  }
})
if (r.error) {
  console.error('El escenario falló:', r.error, r.log ?? '')
  process.exit(1)
}
console.log('estados HTTP:', JSON.stringify(r.http?.estados))
for (const l of llamadas) console.log(`  petición con herramientas -> ${l.quien}   (mensaje: ${l.texto.slice(0, 40)})`)
const esperado = [
  ['PLAN_UNO', 'pa/a1'],
  ['EJECUTA_UNO', 'pb/b1'],
  ['PLAN_DOS', 'pb/b1'],
  ['LANZA_AYUDANTE', 'pb/b1']
]
let ok = true
for (const [texto, quien] of esperado) {
  const l = llamadas.find((x) => x.texto.includes(texto))
  const pasa = l?.quien === quien
  ok &&= pasa
  console.log(`${pasa ? 'OK ' : 'FALLA'} ${texto}: esperado ${quien}, salió ${l?.quien ?? 'nada'}`)
}
const hija = llamadas.filter((x) => x.texto.includes('HIJA'))
const hijaOk = hija.length > 0 && hija.every((x) => x.quien === 'pb/b1')
console.log(
  `${hijaOk ? 'OK ' : 'FALLA'} ayudante (model: inherit) hereda el modelo del mensaje: ${JSON.stringify(hija.map((x) => x.quien))}`
)
process.exit(ok && hijaOk ? 0 : 1)
