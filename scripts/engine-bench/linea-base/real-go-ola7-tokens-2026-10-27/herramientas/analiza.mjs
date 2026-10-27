// Mide el tamaño (bytes) de cada parte de una petición capturada: sistema, cada herramienta, mensajes.
import { readFileSync, readdirSync } from 'node:fs'
const [dir, filtro] = process.argv.slice(2)
for (const f of readdirSync(dir).sort().filter((x) => x.includes(filtro))) {
  const { ruta, cuerpo: c } = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))
  const tam = (x) => Buffer.byteLength(typeof x === 'string' ? x : JSON.stringify(x))
  const msgs = c.messages ?? c.input ?? []
  const sis = msgs.filter((m) => m.role === 'system' || m.role === 'developer')
  const resto = msgs.filter((m) => !(m.role === 'system' || m.role === 'developer'))
  const tools = c.tools ?? []
  const nombre = (t) => t.function?.name ?? t.name
  const totT = tools.reduce((s, t) => s + tam(t), 0)
  console.log(`\n== ${f} ${ruta} total=${tam(c)}B  sistema=${sis.reduce((s, m) => s + tam(m.content ?? m), 0)}B (${sis.length} msj)  mensajes=${resto.reduce((s, m) => s + tam(m), 0)}B (${resto.length})  tools=${totT}B (${tools.length}) otros=${tam(c) - totT - msgs.reduce((s, m) => s + tam(m), 0)}B`)
  if (tools.length > 0 && !process.env.RESUMEN) for (const t of tools.map((t) => [nombre(t), tam(t), tam(t.function?.description ?? t.description ?? ''), tam(t.function?.parameters ?? t.parameters ?? '')]).sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.N ?? 60))) console.log(`  ${t[0].padEnd(34)} ${String(t[1]).padStart(6)}B  desc=${t[2]} params=${t[3]}`)
}
