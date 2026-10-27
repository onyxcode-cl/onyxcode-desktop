#!/usr/bin/env node
// Servidor de CAPTURA para el diagnóstico de tokens (Ola 7, 7.2): hace de proveedor del modelo, guarda el cuerpo COMPLETO de cada
// petición en un archivo (sin cabeceras) y contesta con un texto fijo para que el motor termine el turno. No sale a la red ni usa claves.
//   node captura.mjs <carpeta-salida> <puerto>
import { createServer } from 'node:http'
import { writeFileSync, mkdirSync } from 'node:fs'
const [dir, puerto] = [process.argv[2], Number(process.argv[3] ?? 8099)]
mkdirSync(dir, { recursive: true })
let n = 0
createServer((req, res) => {
  const t = []
  req.on('data', (d) => t.push(d))
  req.on('end', () => {
    const cuerpo = Buffer.concat(t).toString('utf8')
    const ruta = req.url.replace(/^\/v1/, '')
    const etiqueta = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').slice(0, 40) || 'sin'
    const id = String(++n).padStart(3, '0')
    writeFileSync(`${dir}/${id}-${etiqueta.split('-').slice(0, 2).join('-')}.json`, JSON.stringify({ ruta, cuerpo: (() => { try { return JSON.parse(cuerpo) } catch { return cuerpo } })() }))
    if (/\/responses/.test(ruta)) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const o = { id: 'r1', object: 'response', status: 'completed', model: 'x', output: [{ type: 'message', id: 'm1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ok', annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }
      const ev = (e, d) => res.write(`event: ${e}\ndata: ${JSON.stringify({ type: e, ...d })}\n\n`)
      ev('response.created', { response: { ...o, status: 'in_progress', output: [] } })
      ev('response.output_item.added', { output_index: 0, item: { type: 'message', id: 'm1', role: 'assistant', status: 'in_progress', content: [] } })
      ev('response.content_part.added', { item_id: 'm1', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } })
      ev('response.output_text.delta', { item_id: 'm1', output_index: 0, content_index: 0, delta: 'ok' })
      ev('response.output_text.done', { item_id: 'm1', output_index: 0, content_index: 0, text: 'ok' })
      ev('response.content_part.done', { item_id: 'm1', output_index: 0, content_index: 0, part: { type: 'output_text', text: 'ok', annotations: [] } })
      ev('response.output_item.done', { output_index: 0, item: o.output[0] })
      ev('response.completed', { response: o })
      res.end()
      return
    }
    const j = (() => { try { return JSON.parse(cuerpo) } catch { return {} } })()
    const ch = (delta, fin) => `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'x', choices: [{ index: 0, delta, finish_reason: fin ?? null }], ...(fin ? { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } : {}) })}\n\n`
    if (j.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(ch({ role: 'assistant', content: '' }))
      res.write(ch({ content: 'ok' }))
      res.write(ch({}, 'stop'))
      res.write('data: [DONE]\n\n')
      res.end()
    } else {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'c1', object: 'chat.completion', created: 1, model: 'x', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
    }
  })
}).listen(puerto, '127.0.0.1')
