#!/usr/bin/env node
// Comprobación MANUAL (con red) del catálogo MCP curado: `npm run check:mcp-catalog`. Fuera de `verify`.
//
// Para cada ficha de src/shared/mcp-catalog.ts:
//   - la URL responde como servidor MCP a un `initialize`: 200 (abierto), 401 (pide credencial) o 405 (solo SSE/GET);
//   - la página de documentación responde 200.
// Salida: 0 todo bien · 1 alguna ficha falla (URL cambiada, caída o documentación movida) · 3 sin red para ninguna.
// Sin dependencias. No envía credenciales. Cada petición tiene 15 s de límite.
import { join, resolve } from 'node:path'
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

// Node ESM no resuelve `./i18n` (carpeta) ni imports sin extensión como lo hace Vite: este hook mínimo los completa
// (`./x` → `./x.ts` o `./x/index.ts`) solo para cargar el catálogo; la app y los tests no lo usan.
register(
  'data:text/javascript,' +
    encodeURIComponent(`
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
export async function resolve(specifier, context, next) {
  if (/^\\.{1,2}\\//.test(specifier) && context.parentURL?.startsWith('file:') && !/\\.[a-z]+$/i.test(specifier)) {
    const base = new URL(specifier, context.parentURL)
    const path = fileURLToPath(base)
    for (const cand of [path + '.ts', path + '/index.ts']) {
      if (existsSync(cand) && statSync(cand).isFile()) return next(pathToFileURL(cand).href, context)
    }
  }
  return next(specifier, context)
}`),
  import.meta.url
)

const root = resolve(import.meta.dirname, '..')
const { MCP_CATALOG } = await import(pathToFileURL(join(root, 'src/shared/mcp-catalog.ts')).href)

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'lazunox-catalog-check', version: '1' } }
}
const UA = 'Mozilla/5.0 (Lazunox catalog check)'

async function probeMcp(url) {
  const res = await fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': UA },
    body: JSON.stringify(INITIALIZE),
    signal: AbortSignal.timeout(15_000)
  })
  await res.body?.cancel().catch(() => undefined)
  return res.status
}

async function probeDocs(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15_000) })
  await res.body?.cancel().catch(() => undefined)
  return res.status
}

let failed = 0
let unreachable = 0
for (const item of MCP_CATALOG) {
  const problems = []
  try {
    const status = await probeMcp(item.url)
    if (![200, 401, 405].includes(status)) problems.push(`MCP ${item.url} respondió ${status} (se esperaba 200, 401 o 405)`)
  } catch (err) {
    unreachable++
    problems.push(`MCP ${item.url} sin respuesta: ${err instanceof Error ? err.message : err}`)
  }
  try {
    const status = await probeDocs(item.docsUrl)
    if (status !== 200) problems.push(`docs ${item.docsUrl} respondió ${status}`)
  } catch (err) {
    problems.push(`docs ${item.docsUrl} sin respuesta: ${err instanceof Error ? err.message : err}`)
  }
  console.log(`${problems.length ? 'FALLA' : 'ok   '} ${item.id}${problems.map((p) => `\n       ${p}`).join('')}`)
  if (problems.length) failed++
}

console.log(`\n${MCP_CATALOG.length - failed}/${MCP_CATALOG.length} fichas correctas.`)
if (unreachable === MCP_CATALOG.length) process.exit(3)
process.exit(failed ? 1 : 0)
