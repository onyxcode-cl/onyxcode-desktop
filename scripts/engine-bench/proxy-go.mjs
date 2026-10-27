#!/usr/bin/env node
// Proxy mínimo para el comparativo 7.19: los motores de terceros (OpenCode 2.x, Codex) NO reciben la clave real; hablan con este proxy
// con una clave FALSA que solo sirve de etiqueta de la corrida (`Authorization: Bearer <id-de-corrida>`). El proxy reenvía a OpenCode Go
// añadiendo la clave real, que lee de un archivo montado de solo lectura (auth.json, campo `opencode-go.key`), y mide cada petición.
//
// Registro (JSON por línea, `--log`): hora, etiqueta de corrida, ruta, estado, tokens (entrada, caché leída, salida) según el `usage` de la
// respuesta, tiempo, tamaño de la petición, nº de mensajes/herramientas. NUNCA se registran cabeceras ni cuerpos.
// Tope de gasto (`--tope`): al pasar ese total de tokens enviados responde 503 y deja de reenviar. Un 429 del origen se registra y se reenvía.
//
//   node proxy-go.mjs --auth /clave/auth.json --log /out/proxy.jsonl --puerto 8080 --tope 12000000
import { createServer, request as httpReq } from 'node:http'
import { request as httpsReq } from 'node:https'
import { appendFileSync, readFileSync } from 'node:fs'

const arg = (n, d) => {
  const i = process.argv.indexOf(n)
  return i >= 0 ? process.argv[i + 1] : d
}
const ORIGEN = new URL(arg('--origen', 'https://opencode.ai/inference/go/openai/v1'))
const LOG = arg('--log', '/out/proxy.jsonl')
const PUERTO = Number(arg('--puerto', '8080'))
const TOPE = Number(arg('--tope', '12000000'))
const CLAVE = JSON.parse(readFileSync(arg('--auth'), 'utf8'))['opencode-go']?.key
if (!CLAVE) throw new Error('no hay clave opencode-go en el auth.json')

// Límites POR CORRIDA solo para los motores de terceros (etiquetas `oc2-…` y `cx-…`), que no traen --max-steps ni --presupuesto-tokens:
// 60 peticiones al modelo y 400 000 tokens (entrada + salida), como las banderas con que corre Lazunox en el banco.
const LIMITADOS = /^(oc2|cx)-/
const MAX_PET = Number(arg('--max-peticiones', '60'))
const MAX_TOK = Number(arg('--presupuesto', '400000'))
const porCorrida = new Map()
let enviados = 0
try {
  // El tope sobrevive a un reinicio del proxy: se reconstruye con el registro.
  for (const l of readFileSync(LOG, 'utf8').split('\n')) if (l) enviados += JSON.parse(l).entrada ?? 0
} catch {
  /* sin registro previo */
}
let hay429 = 0
const anota = (o) => appendFileSync(LOG, JSON.stringify(o) + '\n')

createServer((req, res) => {
  const t0 = Date.now()
  const etiqueta = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').slice(0, 80) || 'sin-etiqueta'
  const trozos = []
  req.on('data', (d) => trozos.push(d))
  req.on('end', () => {
    let cuerpo = Buffer.concat(trozos)
    const ruta = req.url.replace(/^\/v1/, '')
    if (req.url === '/salud') {
      res.end(JSON.stringify({ enviados, hay429 }))
      return
    }
    if (enviados >= TOPE) {
      anota({ t: new Date().toISOString(), etiqueta, ruta, estado: 503, nota: 'tope de gasto' })
      res.writeHead(503, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'tope de gasto del comparativo alcanzado' } }))
      return
    }
    const c = porCorrida.get(etiqueta) ?? { pet: 0, tok: 0 }
    const esModelo = /^\/(chat\/completions|responses)/.test(ruta)
    if (LIMITADOS.test(etiqueta) && esModelo && (c.pet >= MAX_PET || c.tok >= MAX_TOK)) {
      anota({ t: new Date().toISOString(), etiqueta, ruta, estado: 400, nota: c.pet >= MAX_PET ? 'tope de pasos de la corrida' : 'tope de tokens de la corrida' })
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'limite de la corrida del banco alcanzado (pasos o tokens)' } }))
      return
    }
    if (esModelo) {
      c.pet++
      porCorrida.set(etiqueta, c)
    }
    let meta = {}
    let esFlujo = false
    try {
      const j = JSON.parse(cuerpo.toString('utf8'))
      esFlujo = !!j.stream
      meta = { modelo: j.model, mensajes: j.messages?.length ?? j.input?.length, herramientas: j.tools?.length, flujo: esFlujo, razonamiento: j.reasoning_effort ?? j.reasoning?.effort ?? null }
      // El `usage` del flujo solo llega si se pide; los motores de terceros pueden no pedirlo. Se añade (no cambia el contenido).
      if (esFlujo && ruta.startsWith('/chat/completions') && !j.stream_options?.include_usage) {
        j.stream_options = { ...(j.stream_options ?? {}), include_usage: true }
        cuerpo = Buffer.from(JSON.stringify(j))
        meta.include_usage_anadido = true
      }
    } catch {
      /* cuerpo no JSON */
    }
    const destino = new URL(ORIGEN.pathname.replace(/\/$/, '') + ruta, ORIGEN)
    // OpenCode Go exige `x-opencode-session` (enrutado). Se reenvían las cabeceras `x-opencode-*` del motor; si no manda sesión (p. ej. Codex),
    // el proxy usa la etiqueta de la corrida, igual para todos los motores que no la envíen.
    const extra = Object.fromEntries(Object.entries(req.headers).filter(([k]) => k.startsWith('x-opencode-')))
    extra['x-opencode-session'] ??= etiqueta
    meta.sesion_propia = !req.headers['x-opencode-session']
    const cab = { ...extra, 'content-type': req.headers['content-type'] ?? 'application/json', accept: req.headers.accept ?? '*/*', authorization: `Bearer ${CLAVE}`, 'content-length': cuerpo.length, 'user-agent': 'lazunox-bench-proxy' }
    const lib = destino.protocol === 'https:' ? httpsReq : httpReq
    const up = lib(destino, { method: req.method, headers: cab }, (r) => {
      res.writeHead(r.statusCode ?? 502, { 'content-type': r.headers['content-type'] ?? 'application/json' })
      // Flujo SSE: se procesa línea por línea (la línea `response.completed` de Codex puede pesar >100 KB porque repite las herramientas).
      let resto = ''
      let completo = ''
      let usageFlujo = null
      const lee = (l) => {
        if (!l.startsWith('data: {') || !l.includes('"usage"')) return
        try {
          const o = JSON.parse(l.slice(6))
          const u = o.usage ?? o.response?.usage
          if (u && (u.prompt_tokens !== undefined || u.input_tokens !== undefined)) usageFlujo = u
        } catch {
          /* línea no JSON */
        }
      }
      r.on('data', (d) => {
        res.write(d)
        const s = d.toString('utf8')
        if (esFlujo) {
          resto += s
          const ls = resto.split('\n')
          resto = ls.pop() ?? ''
          ls.forEach(lee)
        } else completo += s
      })
      r.on('end', () => {
        res.end()
        let usage = null
        if (esFlujo) {
          lee(resto)
          usage = usageFlujo
        } else {
          try {
            usage = JSON.parse(completo).usage ?? null
          } catch {
            /* sin usage legible */
          }
        }
        const entrada = usage?.prompt_tokens ?? usage?.input_tokens ?? 0
        const cache = usage?.prompt_tokens_details?.cached_tokens ?? usage?.input_tokens_details?.cached_tokens ?? usage?.prompt_cache_hit_tokens ?? 0
        const salida = usage?.completion_tokens ?? usage?.output_tokens ?? 0
        enviados += entrada
        c.tok += entrada + salida
        if (r.statusCode === 429) hay429++
        anota({ t: new Date().toISOString(), etiqueta, ruta, estado: r.statusCode, entrada, cache_leida: cache, salida, costo_lista: usage?.opencode?.list_cost, ms: Date.now() - t0, bytes_peticion: cuerpo.length, ...meta, sin_usage: usage ? undefined : true })
      })
    })
    up.on('error', (e) => {
      anota({ t: new Date().toISOString(), etiqueta, ruta, estado: 502, error: String(e.code ?? e.message).slice(0, 80) })
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    up.end(cuerpo)
  })
}).listen(PUERTO, '0.0.0.0', () => console.log(`proxy en :${PUERTO} (origen ${ORIGEN.origin}${ORIGEN.pathname}, tope ${TOPE})`))
