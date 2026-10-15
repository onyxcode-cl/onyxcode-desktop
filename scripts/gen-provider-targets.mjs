#!/usr/bin/env node
/**
 * Genera `src/shared/provider-targets.generated.ts`: {id de proveedor → origen + prefijo} de los destinos HTTPS a los que
 * el CredentialProxy del sandbox de Overdrive puede enviar la clave REAL de un proveedor.
 *
 * Uso: node scripts/gen-provider-targets.mjs [ruta/models.json]   (por defecto ~/.cache/opencode/models.json, el catálogo de models.dev)
 *
 * La app NUNCA lee el catálogo en tiempo de ejecución (es editable por el usuario/sandbox): la tabla va versionada en el repo
 * y se revisa en el diff. Reglas:
 *  - Solo proveedores cuyo `api` es una URL https FIJA (sin `${...}`, sin credenciales, puerto, IP ni localhost/.local/.internal).
 *  - Más la lista MANUAL de proveedores cuyo SDK trae la URL por defecto (el catálogo no trae `api`).
 *  - Excluidos (ver EXCLUDED): `opencode` (gratis, clave «public»), OAuth/inicio de sesión (GitHub Copilot, ChatGPT/Codex,
 *    xAI OAuth, GitLab, SAP), nube con IAM/URL por recurso (Bedrock, Azure, Vertex, Cloudflare, Databricks, Snowflake…).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const input = process.argv[2] ?? join(homedir(), '.cache', 'opencode', 'models.json')
const output = join(root, 'src', 'shared', 'provider-targets.generated.ts')

/** Verificados a mano: el catálogo no trae `api` porque el SDK pone la URL por defecto. */
const MANUAL = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  xai: 'https://api.x.ai/v1',
  mistral: 'https://api.mistral.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  deepinfra: 'https://api.deepinfra.com/v1/openai',
  cerebras: 'https://api.cerebras.ai/v1',
  cohere: 'https://api.cohere.com/v2',
  togetherai: 'https://api.together.xyz/v1',
  perplexity: 'https://api.perplexity.ai',
  vercel: 'https://ai-gateway.vercel.sh/v3/ai'
}

/** Nunca van al sandbox con clave: gratis, OAuth/inicio de sesión, nube con IAM o URL por recurso. */
const EXCLUDED = new Set([
  'opencode',
  'github-copilot',
  'gitlab',
  'sap-ai-core',
  'amazon-bedrock',
  'azure',
  'azure-cognitive-services',
  'google-vertex',
  'google-vertex-anthropic',
  'cloudflare-workers-ai',
  'cloudflare-ai-gateway',
  'databricks',
  'snowflake-cortex',
  'watsonx'
])

function normalize(api) {
  if (typeof api !== 'string' || api.includes('${') || /\s/.test(api)) return null
  let u
  try {
    u = new URL(api)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return null
  const h = u.hostname.toLowerCase()
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) return null // IPs (v4/v6) y nombres sin TLD fuera
  if (/(^|\.)(localhost|local|internal|lan|home|test|invalid|example)$/.test(h)) return null
  const pathPrefix = u.pathname.replace(/\/+$/, '')
  return { origin: `https://${h}`, pathPrefix }
}

const catalog = JSON.parse(readFileSync(input, 'utf8'))
const targets = {}
for (const [id, p] of Object.entries(catalog)) {
  if (EXCLUDED.has(id) || id in MANUAL || !/^[a-z0-9][a-z0-9._-]*$/.test(id)) continue
  const n = normalize(p?.api)
  if (n) targets[id] = n
}
for (const [id, api] of Object.entries(MANUAL)) {
  const n = normalize(api)
  if (!n) throw new Error(`destino manual inválido: ${id}`)
  targets[id] = n
}

const ids = Object.keys(targets).sort()
const lines = ids.map(
  (id) =>
    `  ${JSON.stringify(id)}: { origin: ${JSON.stringify(targets[id].origin)}, pathPrefix: ${JSON.stringify(targets[id].pathPrefix)} }`
)
const body = `/**
 * GENERADO por scripts/gen-provider-targets.mjs desde el catálogo de models.dev + una lista manual. NO editar a mano:
 * vuelve a ejecutar el script y revisa el diff. Destinos HTTPS fijos a los que el sandbox de Overdrive puede enviar la clave
 * real de un proveedor (vía CredentialProxy). Excluidos: opencode (gratis), OAuth/inicio de sesión, SigV4/IAM y nube con URL por recurso.
 */
export interface GeneratedProviderTarget {
  origin: string
  pathPrefix: string
}

export const GENERATED_PROVIDER_TARGETS: Readonly<Record<string, GeneratedProviderTarget>> = {
${lines.join(',\n')}
}
`
writeFileSync(output, body)
console.log(`${ids.length} proveedores → ${output}`)
