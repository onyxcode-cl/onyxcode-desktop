#!/usr/bin/env node
// SIMULACIÓN de un cambio de nombre/alias de la app: lista TODO lo que cambiaría y NO aplica nada (no escribe ningún archivo).
// Sirve para que el dueño decida con datos (docs/RELEASE.md §13). Solo funciona con --dry-run; sin él, se niega.
//
//   node scripts/rename-app.mjs --dry-run [--name NuevoNombre] [--alias nuevoalias] [--json] [--details]
//
// Qué mira: nombre visible (`OnyxCode`), slug en minúsculas (`onyxcode`: ids, rutas, protocolo, comandos), variables de entorno
// (`ONYXCODE_*`), alias del autor (`bentec`) y dominio (`onyxcode.cl`). Los nombres históricos de migración (`Lapis`, `OpenDesk`) NO se
// tocan: sirven para mover datos de versiones antiguas. No usa la red.
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', '.git', '.vite', 'coverage', 'test-results'])
const SKIP_PATHS = ['pwa/dist', 'resources/opencode-bin/bin', 'e2e/.cache']
const SKIP_EXT = new Set([
  '.png',
  '.icns',
  '.ico',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.woff',
  '.woff2',
  '.ttf',
  '.zip',
  '.dmg',
  '.pdf',
  '.node',
  '.wasm',
  '.tsbuildinfo'
])
const MAX_BYTES = 2 * 1024 * 1024

export const NAME_RE = /^[A-Z][A-Za-z0-9]{1,29}$/
export const ALIAS_RE = /^[a-z][a-z0-9]{2,19}$/

/** Lee la identidad vigente (sin importar TS). */
export function readIdentity(root) {
  const brand = readFileSync(join(root, 'src/shared/brand.ts'), 'utf8')
  const pick = (re) => re.exec(brand)?.[1]
  const alias = pick(/export const AUTHOR_ALIAS = '([^']*)'/)
  const name = pick(/export const APP_NAME = '([^']*)'/)
  const slug = pick(/export const APP_SLUG = '([^']*)'/)
  if (!alias || !name || !slug) throw new Error('No se encontró APP_NAME, AUTHOR_ALIAS o APP_SLUG en src/shared/brand.ts')
  return {
    name,
    slug,
    alias,
    appId: `cl.${alias}.${slug}`,
    helperId: `cl.${alias}.opendesk.cu-helper`,
    disclaimId: `cl.${alias}.${slug}.disclaim`
  }
}

/** Valores propuestos. Los literales que `brand.ts` no deriva se listan aparte (ver `manualLiterals`). */
export function proposedIdentity(current, { name, alias }) {
  const newName = name ?? current.name
  const newAlias = alias ?? current.alias
  if (!NAME_RE.test(newName))
    throw new Error(`--name «${newName}» no es válido: una palabra, empieza en mayúscula, solo letras y números (2 a 30).`)
  if (!ALIAS_RE.test(newAlias)) throw new Error(`--alias «${newAlias}» no es válido: minúsculas y números, empieza en letra (3 a 20).`)
  const slug = newName.toLowerCase()
  return {
    name: newName,
    slug,
    alias: newAlias,
    appId: `cl.${newAlias}.${slug}`,
    helperId: `cl.${newAlias}.opendesk.cu-helper`,
    disclaimId: `cl.${newAlias}.${slug}.disclaim`
  }
}

function category(rel) {
  if (
    [
      'src/shared/brand.ts',
      'package.json',
      'electron-builder.js',
      'resources/computer-use/build.sh',
      'resources/launcher/build.sh'
    ].includes(rel)
  )
    return 'identidad'
  if (rel.startsWith('src/shared/i18n/')) return 'i18n'
  if (/\.test\.[cm]?[jt]sx?$/.test(rel) || rel.startsWith('src/test/') || rel.startsWith('e2e/')) return 'pruebas'
  if (rel.startsWith('src/main/')) return 'código (main)'
  if (rel.startsWith('src/renderer/') || rel.startsWith('src/shared/')) return 'código (renderer/compartido)'
  if (rel.startsWith('src/preload/')) return 'código (preload)'
  if (rel.startsWith('pwa/')) return 'PWA'
  if (rel.startsWith('docs/') || rel.endsWith('.md')) return 'documentación'
  if (rel.startsWith('scripts/') || rel.startsWith('build/') || rel.startsWith('.github/')) return 'scripts, build y CI'
  if (rel.startsWith('resources/')) return 'recursos'
  return 'otros'
}

function* walk(root, dir = root) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name)
    const rel = relative(root, abs).split('\\').join('/')
    if (e.isSymbolicLink()) continue
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || SKIP_PATHS.includes(rel)) continue
      yield* walk(root, abs)
    } else if (e.isFile()) {
      const dot = e.name.lastIndexOf('.')
      if (dot >= 0 && SKIP_EXT.has(e.name.slice(dot).toLowerCase())) continue
      yield { abs, rel }
    }
  }
}

/** Patrones por tipo de coincidencia. `domain` se separa de `slug` para contarlos por aparte. */
function patterns(current) {
  return {
    name: new RegExp(current.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
    slug: new RegExp(`${current.slug}(?!\\.cl)`, 'g'),
    env: new RegExp(current.slug.toUpperCase(), 'g'),
    alias: new RegExp(current.alias, 'g'),
    domain: new RegExp(`${current.slug}\\.cl`, 'g')
  }
}
export const KINDS = {
  name: 'nombre visible',
  slug: 'slug (ids, rutas, protocolo)',
  env: 'variables de entorno',
  alias: 'alias del autor',
  domain: 'dominio'
}

/** Recorre el repositorio y cuenta coincidencias por archivo y tipo. No modifica nada. */
export function scanRepo(root, current) {
  const pats = patterns(current)
  const files = []
  for (const { abs, rel } of walk(root)) {
    const st = lstatSync(abs)
    if (st.size === 0 || st.size > MAX_BYTES) continue
    const buf = readFileSync(abs)
    if (buf.includes(0)) continue
    const text = buf.toString('utf8')
    const counts = {}
    const lines = []
    let total = 0
    for (const [kind, re] of Object.entries(pats)) {
      const n = (text.match(re) ?? []).length
      if (n) {
        counts[kind] = n
        total += n
      }
    }
    if (!total) continue
    const cat = category(rel)
    if (cat === 'identidad' || cat === 'scripts, build y CI') {
      text.split('\n').forEach((l, i) => {
        if (Object.values(pats).some((re) => ((re.lastIndex = 0), re.test(l)))) lines.push({ line: i + 1, text: l.trim().slice(0, 160) })
      })
    }
    files.push({ file: rel, category: cat, counts, total, lines })
  }
  files.sort((a, b) => a.category.localeCompare(b.category) || b.total - a.total || a.file.localeCompare(b.file))
  return files
}

/** Cosas que no son «buscar y reemplazar» y el dueño debe saber. */
export function manualNotes(current, next) {
  return [
    `appId: ${current.appId} → ${next.appId}. Se comprueba en CADA actualización: si cambia DESPUÉS de publicar, las copias instaladas no pueden actualizarse solas a la nueva (hay que reinstalar a mano). Decidirlo antes de la primera versión pública.`,
    `Datos del usuario: la carpeta de datos (~/Library/Application Support/${current.name}) y el llavero «${current.name} Safe Storage» salen del nombre: con otro nombre la app NO ve los datos cifrados de la anterior (vínculos del celular…; haría falta migración, como migrateLegacyUserData con Lapis/OpenDesk).`,
    `Permisos de macOS (Accesibilidad, Grabación de pantalla, Micrófono): se asocian al identificador; cambiarlo los vuelve a pedir una vez.`,
    `Helpers nativos: ${current.helperId} → ${next.helperId} y ${current.disclaimId} → ${next.disclaimId}. Se compilan con resources/computer-use/build.sh y resources/launcher/build.sh (literales que brand.ts no puede importar; los vigila src/test/brand-consistency.test.ts).`,
    `Protocolo de la app ${current.slug}://app (CSP y esquema propio): cambia con el slug; la zona de seguridad de src/main/security/app-protocol.ts es INTOCABLE sin decisión explícita del dueño.`,
    `Dominio del servicio de conexión del celular: remoto.${current.slug}.cl (Cloudflare Worker). Un dominio nuevo hay que comprarlo y configurarlo aparte; este script no toca servidores.`,
    `Repositorio de releases (RELEASES_REPO), nombre del repositorio y de los assets (OnyxCode-<versión>-arm64.zip: el patrón está en src/shared/update-install.ts y scripts/update-lib.mjs, y lo valida el cliente).`,
    `Certificado y Team ID: no cambian por el nombre, pero el certificado Developer ID muestra el nombre legal, no el alias.`,
    `Nombres históricos «Lapis» y «OpenDesk» (migración de datos antiguos) y «opendesk» dentro de helperId: NO se tocan.`,
    `Marca registrada: comprueba antes el nombre nuevo en Google, GitHub, App Store, USPTO (tmsearch.uspto.gov) e INAPI (inapi.cl).`
  ]
}

export function buildPlan(root, args) {
  const current = readIdentity(root)
  const next = proposedIdentity(current, args)
  const files = scanRepo(root, current)
  const byCategory = {}
  for (const f of files) {
    const c = (byCategory[f.category] ??= { files: 0, total: 0 })
    c.files++
    c.total += f.total
  }
  return {
    current,
    next,
    byCategory,
    files,
    notes: manualNotes(current, next),
    totalFiles: files.length,
    totalMatches: files.reduce((n, f) => n + f.total, 0)
  }
}

function print(plan, { details, log }) {
  const { current: c, next: n } = plan
  log('SIMULACIÓN: no se ha modificado ningún archivo.\n')
  log('Identidad (de → a)')
  for (const [k, label] of [
    ['name', 'productName / APP_NAME'],
    ['slug', 'APP_SLUG'],
    ['alias', 'AUTHOR_ALIAS'],
    ['appId', 'appId / APP_ID'],
    ['helperId', 'HELPER_ID'],
    ['disclaimId', 'DISCLAIM_ID']
  ])
    log(`  ${label.padEnd(24)} ${c[k]} → ${n[k]}${c[k] === n[k] ? '  (sin cambio)' : ''}`)
  log(`\nCoincidencias: ${plan.totalMatches} en ${plan.totalFiles} archivos`)
  for (const [cat, v] of Object.entries(plan.byCategory))
    log(`  ${cat.padEnd(32)} ${String(v.files).padStart(4)} archivos  ${String(v.total).padStart(6)} coincidencias`)
  let last = ''
  for (const f of plan.files) {
    if (!details && f.category !== 'identidad' && f.category !== 'scripts, build y CI') continue
    if (f.category !== last) log(`\n[${f.category}]`)
    last = f.category
    log(
      `  ${f.file}  (${Object.entries(f.counts)
        .map(([k, v]) => `${KINDS[k]}: ${v}`)
        .join(', ')})`
    )
    for (const l of f.lines.slice(0, details ? 50 : 6)) log(`      ${String(l.line).padStart(4)}: ${l.text}`)
  }
  if (!details) log('\n(Con --details se listan todos los archivos, incluidos i18n, docs, código y pruebas.)')
  log('\nQué NO es buscar y reemplazar')
  for (const x of plan.notes) log(`  - ${x}`)
}

function arg(argv, name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

export function main(argv = process.argv.slice(2), { root = defaultRoot, log = console.log, err = console.error } = {}) {
  if (!argv.includes('--dry-run')) {
    err(
      'rename-app solo funciona en modo simulación: añade --dry-run. Este script NO aplica el cambio (decisión del dueño, docs/RELEASE.md §13).'
    )
    return 2
  }
  try {
    if (!existsSync(join(root, 'src/shared/brand.ts')))
      throw new Error('No encuentro src/shared/brand.ts: ejecuta el script desde el repositorio.')
    const plan = buildPlan(root, { name: arg(argv, '--name'), alias: arg(argv, '--alias') })
    if (argv.includes('--json')) log(JSON.stringify(plan, null, 2))
    else print(plan, { details: argv.includes('--details'), log })
    return 0
  } catch (e) {
    err(`rename-app FALLÓ: ${e.message}`)
    return 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main())
