// Proveedor falso para el banco (`--proveedor-falso`): servidor local compatible con OpenAI (127.0.0.1, puerto libre) y DETERMINISTA.
// Sigue el patrón del de `scripts/engine-probe/harness.mjs` (que no exporta el suyo: vive dentro de `runEngine`, así que aquí hay
// uno propio): contesta por SSE con una llamada a herramienta o con texto final, y además informa `usage` (tokens) para que el
// banco pueda medirlos sin modelo real.
//
// Un «guion» es una lista de TURNOS (uno por pedido de la persona); cada turno, una lista de PASOS: `{ name, args }` = llamada a
// herramienta (las reales del motor: read, edit, write, bash, grep, glob, todowrite…). Cuando el turno se queda sin pasos, el modelo
// falso responde con el texto final (`guion.final`, por defecto «Listo.»). Sin guion para la tarea → responde que no sabe resolverla,
// y el verificador de la tarea falla (así se ve que el banco distingue éxito de fracaso).
//
// Pasos especiales (ola 7, paquete 7.1; el motor real ve exactamente lo que enviaría un modelo con ese defecto):
//   { paralelo: [paso, paso, …] }   varias llamadas en UNA misma respuesta (T30: dos escrituras al mismo archivo en el mismo paso).
//   { …paso, truncar: true }        la respuesta se corta a la mitad de los argumentos con `finish_reason: "length"` (T25). Solo se envía una
//                                   vez por posición: si el motor descarta la llamada cortada y vuelve a preguntar, se sirve el paso siguiente.
//   { …paso, crudo: <texto|objeto> } lo que viaja por el cable en `arguments` en lugar de `args` (T27: tipos equivocados). `args` sigue siendo
//                                   lo que el paso HARÍA con los tipos correctos; la autoprueba aplica `args`.
//   { …paso, sinEfecto: true }      la autoprueba no lo aplica (p. ej. la llamada cortada: no debe dejar nada escrito).
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
  const cortadas = new Map() // turno → paso en el que se sirvió una llamada cortada
  const desplazamiento = new Map() // turno → posiciones que hay que saltar porque el motor descartó una llamada cortada
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
        const llamadas = llamada ? (llamada.paralelo ?? [llamada]) : []
        const argumentos = (l) => (l.crudo === undefined ? JSON.stringify(l.args) : typeof l.crudo === 'string' ? l.crudo : JSON.stringify(l.crudo))
        const salida = llamadas.length ? llamadas.map((l) => argumentos(l)).join('') : contenido
        const truncar = llamada?.truncar === true
        const usage = { prompt_tokens: prompt, completion_tokens: tokens(salida) + 4, total_tokens: prompt + tokens(salida) + 4 }
        if (llamadas.length) {
          const tcs = llamadas.map((l, i) => {
            const todo = argumentos(l)
            return {
              index: i,
              id: `call_${peticiones}_${i}`,
              type: 'function',
              function: { name: l.name, arguments: truncar ? todo.slice(0, Math.floor(todo.length / 2)) : todo }
            }
          })
          return sse(res, [trozo({ role: 'assistant', tool_calls: tcs }), trozo({}, truncar ? 'length' : 'tool_calls', usage)])
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
      // Cada entrada del guion ocupa tantas posiciones como llamadas trae (1, o N si es `paralelo`).
      let objetivo = paso + (desplazamiento.get(turno) ?? 0)
      if (cortadas.has(turno)) {
        if (cortadas.get(turno) === paso) {
          // El motor descartó la llamada cortada (no dejó resultado): se salta esa posición.
          desplazamiento.set(turno, (desplazamiento.get(turno) ?? 0) + 1)
          objetivo += 1
        }
        cortadas.delete(turno)
      }
      let siguiente = null
      let inicio = 0
      for (const e of lista ?? []) {
        const ancho = e.paralelo?.length ?? 1
        if (objetivo === inicio) {
          siguiente = e
          break
        }
        inicio += ancho
      }
      // La herramienta solo se pide si el motor la ofrece en esta petición.
      const ofrecidas = new Set((j.tools ?? []).map((t) => t.function?.name))
      const nombres = siguiente ? (siguiente.paralelo ?? [siguiente]).map((l) => l.name) : []
      if (siguiente && nombres.every((n) => ofrecidas.has(n))) {
        if (siguiente.truncar) cortadas.set(turno, paso)
        return responder('', siguiente)
      }
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
