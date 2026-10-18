#!/usr/bin/env node
/**
 * Manual, con red, sin cuentas ni claves (F8-B184): repite las comprobaciones de `docs/conectores-cotidianos.md` para saber si la
 * conclusión sigue vigente (por ejemplo tras subir la versión de OpenCode o si Google/Dropbox cambian sus servidores).
 * No forma parte de `verify` ni de `npm test`. No envía ningún dato personal: solo pide metadatos públicos y herramientas.
 *
 *   node scripts/check-conectores-cotidianos.mjs
 *
 * Qué mira:
 *   1. Servidores MCP oficiales de Google (Gmail, Calendar, Drive): ¿responden `initialize` y `tools/list` SIN iniciar sesión?
 *      Si responden, el motor de la app (OpenCode) nunca llega a «falta entrar» y no puede abrir el inicio de sesión.
 *   2. ¿Qué permisos (scopes) anuncia cada servidor? El motor pide todos los anunciados, no los que quisiéramos.
 *   3. ¿Qué herramientas escriben (`readOnlyHint` distinto de true)?
 *   4. Dropbox y Box: ¿aceptan el registro dinámico de clientes que usa el motor?
 */
const TIMEOUT = 20_000
const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check', version: '0' } }
}
const HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }

async function rpc(url, body) {
  const res = await fetch(url, { method: 'POST', headers: HEADERS, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT) })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    const line = text.split('\n').find((l) => l.startsWith('data:'))
    if (line) json = JSON.parse(line.slice(5))
  }
  return { status: res.status, json, www: res.headers.get('www-authenticate') }
}

async function getJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

const GOOGLE = [
  ['Gmail', 'https://gmailmcp.googleapis.com/mcp/v1'],
  ['Google Calendar', 'https://calendarmcp.googleapis.com/mcp/v1'],
  ['Google Drive', 'https://drivemcp.googleapis.com/mcp/v1']
]

let openWithoutLogin = 0
for (const [name, url] of GOOGLE) {
  console.log(`\n== ${name}  ${url}`)
  try {
    const init = await rpc(url, INIT)
    const anon = init.status === 200
    if (anon) openWithoutLogin++
    console.log(
      `initialize sin sesión: HTTP ${init.status} ${anon ? '(responde sin pedir inicio de sesión: el motor lo da por «conectado»)' : '(pide sesión: el motor sí podría iniciarla)'}`
    )
    const list = await rpc(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const tools = list.json?.result?.tools ?? []
    const writes = tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name)
    console.log(`herramientas: ${tools.length} · solo lectura: ${tools.length - writes.length} · escriben/cambian: ${writes.length}`)
    if (writes.length) console.log(`  escriben: ${writes.join(', ')}`)
    const u = new URL(url)
    const prm = await getJson(`${u.origin}/.well-known/oauth-protected-resource${u.pathname}`)
    console.log(`permisos que anuncia (${prm?.scopes_supported?.length ?? '?'}):`)
    for (const s of prm?.scopes_supported ?? []) console.log(`  ${s.replace('https://www.googleapis.com/auth/', '')}`)
  } catch (e) {
    console.log(`  no se pudo comprobar: ${e.message}`)
  }
}

console.log('\n== Registro dinámico de clientes (lo que usa el motor cuando no hay app propia)')
const dbx = await getJson('https://www.dropbox.com/.well-known/oauth-authorization-server')
console.log(`Dropbox anuncia registro: ${dbx?.registration_endpoint ?? 'no'}`)
if (dbx?.registration_endpoint) {
  try {
    const r = await fetch(dbx.registration_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: ['http://127.0.0.1:19876/mcp/oauth/callback'],
        client_name: 'OpenCode',
        token_endpoint_auth_method: 'none'
      }),
      signal: AbortSignal.timeout(TIMEOUT)
    })
    console.log(`  intento de registro como OpenCode: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`)
  } catch (e) {
    console.log(`  no se pudo comprobar: ${e.message}`)
  }
}
const box = await getJson('https://api.box.com/.well-known/oauth-authorization-server')
console.log(`Box anuncia registro: ${box?.registration_endpoint ?? 'no (hace falta una app propia y que un administrador la habilite)'}`)

console.log(
  openWithoutLogin === GOOGLE.length
    ? '\nConclusión vigente: los servidores de Google responden sin sesión; con OpenCode 1.19 no se puede iniciar el acceso desde la app. Ver docs/conectores-cotidianos.md.'
    : '\nCAMBIÓ: algún servidor de Google ya pide sesión al conectar. Vuelve a evaluar docs/conectores-cotidianos.md (puede ser viable una ficha).'
)
