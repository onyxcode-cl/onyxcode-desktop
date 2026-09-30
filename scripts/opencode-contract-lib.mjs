// Lógica PURA del test de contrato con la API de OpenCode (sin red ni procesos).
// La usan `scripts/check-opencode.mjs` (contra el binario real) y `src/test/opencode-contract.test.ts`
// (contra el SDK fijado). Node ESM sin dependencias.
//
// - `sdkRoutes(sdkSource)`: todas las rutas `(MÉTODO, ruta)` que declara el SDK v2 y el árbol de
//   namespaces (`client.session.messages` → GET /session/{sessionID}/message).
// - `usedRoutes(...)`: las rutas que la app usa de verdad, derivadas del código fuente (llamadas al SDK
//   y `fetch` directos al sidecar).
// - `routesFromOpenApi(doc)`, `schemaDigests(doc, routes)`: lo mismo pero desde el `/doc` del binario.
// - `compareContract(...)`: decide el código de salida (1 falta ruta usada, 2 cambió un esquema usado, 0 resto).
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const SDK_GEN = join(ROOT, 'node_modules', '@opencode-ai', 'sdk', 'dist', 'v2', 'gen', 'sdk.gen.js')
export const SNAPSHOT_PATH = join(ROOT, 'resources', 'opencode-bin', 'api-routes.json')
export const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']

/** Clave canónica de una ruta: `GET /session/{sessionID}`. */
export const routeKey = (method, path) => `${method.toUpperCase()} ${path}`

/** Normaliza los parámetros de ruta (`{id}` y `${expr}` → `{}`) para comparar. */
const shape = (path) => path.replace(/\{[^}]*\}/g, '{}')

// ---------------------------------------------------------------------------------------------
// SDK
// ---------------------------------------------------------------------------------------------

/**
 * Parsea `sdk.gen.js`. Devuelve `{ routes: Set<string>, tree }` donde `tree` es el árbol de
 * namespaces desde `OpencodeClient`: `{ methods: {nombre: 'GET /x'}, children: {nombre: nodo} }`.
 */
export function parseSdk(source) {
  const classes = new Map()
  const parts = source.split(/^export class /m).slice(1)
  for (const part of parts) {
    const name = /^(\w+)/.exec(part)?.[1]
    if (!name) continue
    const methods = {}
    const getters = {}
    const body = part.split(/^\}/m)[0]
    for (const m of body.matchAll(/^ {4}get (\w+)\(\) \{\s*return \(this\.\w+ \?\?= new (\w+)\(/gm)) getters[m[1]] = m[2]
    for (const m of body.matchAll(/^ {4}(\w+)\((?:parameters, )?options\) \{([\s\S]*?)^ {4}\}/gm)) {
      const call = /\)\.(?:sse\.)?(get|put|post|delete|options|head|patch)\(\{\s*url: "([^"]+)"/.exec(m[2])
      if (call) methods[m[1]] = routeKey(call[1], call[2])
    }
    classes.set(name, { methods, getters })
  }
  const routes = new Set()
  const build = (cls, seen) => {
    const c = classes.get(cls)
    const node = { methods: { ...c.methods }, children: {} }
    for (const r of Object.values(c.methods)) routes.add(r)
    for (const [prop, target] of Object.entries(c.getters)) {
      if (classes.has(target) && !seen.has(target)) node.children[prop] = build(target, new Set([...seen, target]))
    }
    return node
  }
  if (!classes.has('OpencodeClient')) throw new Error('sdk.gen.js: no se encontró la clase OpencodeClient')
  const tree = build('OpencodeClient', new Set(['OpencodeClient']))
  return { routes, tree }
}

export function sdkRoutes(file = SDK_GEN) {
  return parseSdk(readFileSync(file, 'utf8'))
}

// ---------------------------------------------------------------------------------------------
// Rutas que la app usa
// ---------------------------------------------------------------------------------------------

function* walkSources(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== 'out' && e.name !== 'dist') yield* walkSources(p)
    } else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) yield p
  }
}

/** Quita comentarios (conserva los saltos de línea) para no contar rutas que solo aparecen en la documentación. */
export function stripComments(src) {
  let out = ''
  let i = 0
  let str = null
  while (i < src.length) {
    const ch = src[i]
    const nx = src[i + 1]
    if (str) {
      out += ch
      if (ch === '\\') {
        out += nx ?? ''
        i += 2
        continue
      }
      if (ch === str) str = null
      i++
    } else if (ch === '/' && nx === '/') {
      while (i < src.length && src[i] !== '\n') i++
    } else if (ch === '/' && nx === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n'
        i++
      }
      i += 2
    } else {
      if (ch === "'" || ch === '"' || ch === '`') str = ch
      out += ch
      i++
    }
  }
  return out
}

/** Expresiones que, justo antes de `.<namespace>`, indican un cliente del SDK (y no, p. ej., `api.pty` del preload). */
const CLIENT_SEG = /^(?:oc|\w*[Cc]lient(?:\(\))?)$/

/**
 * Llamadas `<cliente>.<ns>(.<ns>)*.<método>(` de un fuente, resueltas contra el árbol del SDK.
 * Devuelve `[{ call: 'session.messages', route: 'GET /session/{sessionID}/message' }]`.
 */
export function sdkCallsInSource(src, tree) {
  const clean = stripComments(src)
  const found = []
  // `<base>.<a>.<b>...(`, admitiendo saltos de línea y `?.`/`!.` entre tramos.
  const re = /([\w$)\]]+(?:\(\))?)\s*\??!?\.\s*((?:[A-Za-z_$][\w$]*\s*\??!?\.\s*)*[A-Za-z_$][\w$]*)\s*\(/g
  for (const m of clean.matchAll(re)) {
    const full = [m[1], ...m[2].replace(/\s*\??!?\.\s*/g, '.').split('.')]
    for (let i = 1; i < full.length; i++) {
      if (!CLIENT_SEG.test(full[i - 1])) continue
      const chain = full.slice(i)
      let node = tree
      for (const seg of chain.slice(0, -1)) {
        node = node?.children[seg]
        if (!node) break
      }
      const last = chain[chain.length - 1]
      const route = node?.methods[last]
      if (route) {
        found.push({ call: chain.join('.'), route })
        break
      }
    }
  }
  return found
}

const DIRECT_METHOD = /['"](GET|POST|PUT|PATCH|DELETE)['"]/

/**
 * `fetch`/peticiones directas al sidecar: literales de cadena (o plantillas) que empiezan por `/segmento`
 * (tras un `${...baseUrl...}` opcional) en ficheros que manejan `baseUrl`. Se emparejan con las rutas del SDK
 * por forma (segmentos estáticos). Devuelve `{ routes: [{ literal, route }], unmatched: [literal] }`.
 */
export function directCallsInSource(src, sdkRouteSet) {
  const clean = stripComments(src)
  if (!/baseUrl/.test(clean)) return { routes: [], unmatched: [] }
  const roots = new Set([...sdkRouteSet].map((r) => r.split(' ')[1].split('/')[1]))
  const routes = []
  const unmatched = []
  for (const m of clean.matchAll(/([`'"])((?:\$\{[^}]*\}|\\.|(?!\1)[^\\])*)\1/g)) {
    let content = m[2].replace(/^\$\{[^}]*baseUrl[^}]*\}/, '')
    if (!content.startsWith('/')) continue
    const first = /^\/([A-Za-z_-]+)/.exec(content)?.[1]
    if (!first || !roots.has(first)) continue
    content = content.split('?')[0].replace(/\$\{[^}]*\}/g, '{}')
    if (/\s|\$\{/.test(content) || content.includes('http')) continue
    const around = clean.slice(Math.max(0, m.index - 80), m.index)
    const after = clean.slice(m.index + m[0].length, m.index + m[0].length + 240)
    const method = (
      /method:\s*['"](\w+)['"]/.exec(after)?.[1] ??
      DIRECT_METHOD.exec(around.slice(-40))?.[1] ??
      'GET'
    ).toUpperCase()
    const hit = [...sdkRouteSet].find((r) => {
      const [rm, rp] = r.split(' ')
      return rm === method && shape(rp) === content
    })
    if (hit) routes.push({ literal: `${method} ${m[2]}`, route: hit })
    else unmatched.push(`${method} ${m[2]}`)
  }
  return { routes, unmatched }
}

/**
 * Rutas que la app usa: SDK (renderer y main) + `fetch` directos. Función pura sobre el árbol de fuentes.
 * Devuelve `{ routes: string[] (ordenadas), sdk: string[], direct: string[], unmatched: string[] }`.
 */
export function usedRoutes({ root = ROOT, sdk = sdkRoutes() } = {}) {
  const sdkSet = new Set()
  const directSet = new Set()
  const unmatched = []
  for (const file of walkSources(join(root, 'src'))) {
    const src = readFileSync(file, 'utf8')
    for (const c of sdkCallsInSource(src, sdk.tree)) sdkSet.add(c.route)
    const d = directCallsInSource(src, sdk.routes)
    for (const r of d.routes) directSet.add(r.route)
    for (const u of d.unmatched) unmatched.push(`${relative(root, file)}: ${u}`)
  }
  const routes = [...new Set([...sdkSet, ...directSet])].sort()
  return { routes, sdk: [...sdkSet].sort(), direct: [...directSet].sort(), unmatched }
}

// ---------------------------------------------------------------------------------------------
// OpenAPI del binario
// ---------------------------------------------------------------------------------------------

export function routesFromOpenApi(doc) {
  const out = new Set()
  for (const [path, item] of Object.entries(doc?.paths ?? {})) {
    for (const method of HTTP_METHODS) if (item?.[method]) out.add(routeKey(method, path))
  }
  return out
}

const NOISE_KEYS = new Set(['description', 'summary', 'title', 'example', 'examples', 'operationId', 'externalDocs', 'deprecated'])

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    const out = {}
    for (const k of Object.keys(value).sort()) out[k] = stable(value[k])
    return out
  }
  return value
}

/** Resuelve `$ref` (a `#/components/...`) recursivamente, quitando texto descriptivo; los ciclos se cortan. */
export function resolveSchema(node, doc, stack = []) {
  if (Array.isArray(node)) return node.map((n) => resolveSchema(n, doc, stack))
  if (!node || typeof node !== 'object') return node
  if (typeof node.$ref === 'string') {
    const ref = node.$ref
    if (stack.includes(ref)) return { $cycle: ref }
    const target = ref
      .replace(/^#\//, '')
      .split('/')
      .reduce((acc, k) => acc?.[k.replace(/~1/g, '/').replace(/~0/g, '~')], doc)
    if (target === undefined) return { $unresolved: ref }
    return resolveSchema(target, doc, [...stack, ref])
  }
  const out = {}
  for (const [k, v] of Object.entries(node)) {
    if (NOISE_KEYS.has(k) && typeof v !== 'object') continue
    out[k] = resolveSchema(v, doc, stack)
  }
  return out
}

/** Forma de request/response de una operación (parámetros, cuerpo y respuestas), con `$ref` resueltos. */
export function operationShape(doc, key) {
  const [method, path] = [key.split(' ')[0].toLowerCase(), key.slice(key.indexOf(' ') + 1)]
  const item = doc?.paths?.[path]
  const op = item?.[method]
  if (!op) return null
  const params = [...(item.parameters ?? []), ...(op.parameters ?? [])]
  return resolveSchema(
    {
      parameters: params.map((p) => ({ name: p.name, in: p.in, required: !!p.required, schema: p.schema })),
      requestBody: op.requestBody,
      responses: Object.fromEntries(
        Object.entries(op.responses ?? {}).map(([status, r]) => [status, { content: r?.content, hasBody: !!r?.content }])
      )
    },
    doc
  )
}

/** Hash estable (16 hex de SHA-256) de la forma de cada ruta pedida. `null` si la ruta no existe. */
export function schemaDigests(doc, keys) {
  const out = {}
  for (const key of keys) {
    const shapeOf = operationShape(doc, key)
    out[key] = shapeOf ? createHash('sha256').update(JSON.stringify(stable(shapeOf))).digest('hex').slice(0, 16) : null
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Comparador
// ---------------------------------------------------------------------------------------------

/**
 * @param {{ used: string[], actual: Iterable<string>, snapshot: Iterable<string>,
 *           actualSchemas: Record<string,string|null>, snapshotSchemas: Record<string,string> }} input
 * @returns {{ code: 0|1|2, missing: string[], added: string[], removed: string[], changed: string[], unbaselined: string[] }}
 */
export function compareContract({ used, actual, snapshot, actualSchemas, snapshotSchemas }) {
  const act = new Set(actual)
  const snap = new Set(snapshot)
  const missing = used.filter((r) => !act.has(r)).sort()
  const added = [...act].filter((r) => !snap.has(r)).sort()
  const removed = [...snap].filter((r) => !act.has(r)).sort()
  const changed = []
  const unbaselined = []
  for (const r of used) {
    if (!act.has(r)) continue
    const before = snapshotSchemas?.[r]
    if (before === undefined) unbaselined.push(r)
    else if (before !== actualSchemas?.[r]) changed.push(r)
  }
  changed.sort()
  const code = missing.length ? 1 : changed.length ? 2 : 0
  return { code, missing, added, removed, changed, unbaselined: unbaselined.sort() }
}
