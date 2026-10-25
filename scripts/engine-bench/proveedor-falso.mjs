// Proveedor falso para el banco (`--proveedor-falso`): servidor local compatible con OpenAI (127.0.0.1, puerto libre) y DETERMINISTA.
// Sigue el patrón del de `scripts/engine-probe/harness.mjs` (que no exporta el suyo: vive dentro de `runEngine`, así que aquí hay
// uno propio): contesta por SSE con una llamada a herramienta o con texto final, y además informa `usage` (tokens) para que el
// banco pueda medirlos sin modelo real.
//
// Un «guion» es una lista de TURNOS (uno por pedido de la persona); cada turno, una lista de PASOS: `{ name, args }` = llamada a
// herramienta (las reales del motor: read, edit, write, bash, grep, glob, todowrite…). Cuando el turno se queda sin pasos, el modelo
// falso responde con el texto final (`guion.final`, por defecto «Listo.»). Sin guion para la tarea → responde que no sabe resolverla,
// y el verificador de la tarea falla (así se ve que el banco distingue éxito de fracaso).
import http from 'node:http'
import net from 'node:net'

const libre = () =>
  new Promise((res) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => res(p))
    })
  })

const tokens = (t) => Math.max(1, Math.ceil(t.length / 4))

/**
 * @param {{ turnos?: Array<Array<{name:string,args:object}>>, final?: string }|null} guion
 * @returns {Promise<{ url: string, peticiones: () => number, detener: () => Promise<void> }>}
 */
export async function iniciarProveedorFalso(guion) {
  let peticiones = 0
  const sse = (res, trozos) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const c of trozos) res.write('data: ' + JSON.stringify(c) + '\n\n')
    res.end('data: [DONE]\n\n')
  }
  const trozo = (delta, finish = null, usage) => ({
    id: 'bench',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'm',
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(usage ? { usage } : {})
  })
  const servidor = http.createServer((req, res) => {
    let cuerpo = ''
    req.on('data', (d) => (cuerpo += d))
    req.on('end', () => {
      peticiones += 1
      let j = {}
      try {
        j = JSON.parse(cuerpo)
      } catch {
        /* vacío */
      }
      const mensajes = j.messages ?? []
      const prompt = tokens(cuerpo)
      const responder = (contenido, llamada) => {
        const salida = llamada ? JSON.stringify(llamada.args) : contenido
        const usage = { prompt_tokens: prompt, completion_tokens: tokens(salida) + 4, total_tokens: prompt + tokens(salida) + 4 }
        if (llamada) {
          const tc = {
            index: 0,
            id: `call_${peticiones}`,
            type: 'function',
            function: { name: llamada.name, arguments: JSON.stringify(llamada.args) }
          }
          return sse(res, [trozo({ role: 'assistant', tool_calls: [tc] }), trozo({}, 'tool_calls', usage)])
        }
        return sse(res, [trozo({ role: 'assistant', content: contenido }), trozo({}, 'stop', usage)])
      }
      // Petición de título (modelo pequeño): texto corto y fuera de los turnos.
      if (cuerpo.includes('Generate a title for this conversation')) return responder('Tarea del banco')
      // Turno = número de mensajes de la persona; paso = resultados de herramienta desde el último de ellos.
      const ultimoUsuario = mensajes.map((m) => m.role).lastIndexOf('user')
      const turno = mensajes.filter((m) => m.role === 'user').length - 1
      const paso = mensajes.slice(ultimoUsuario + 1).filter((m) => m.role === 'tool').length
      const lista = guion?.turnos?.[turno]
      if (!guion) return responder('No sé resolver esta tarea con el proveedor falso.')
      const siguiente = lista?.[paso]
      // La herramienta solo se pide si el motor la ofrece en esta petición.
      const ofrecidas = new Set((j.tools ?? []).map((t) => t.function?.name))
      if (siguiente && ofrecidas.has(siguiente.name)) return responder('', siguiente)
      return responder(guion.final ?? 'Listo.')
    })
  })
  const puerto = await libre()
  await new Promise((r) => servidor.listen(puerto, '127.0.0.1', r))
  return {
    url: `http://127.0.0.1:${puerto}/v1`,
    peticiones: () => peticiones,
    detener: () => new Promise((r) => servidor.close(() => r()))
  }
}
