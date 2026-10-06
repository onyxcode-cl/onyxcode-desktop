#!/usr/bin/env node
// Firma el sitio del control remoto (`pwa/dist-site`) con la clave Ed25519 del DUEÑO y deja todo listo para publicar a mano.
// NO despliega, NO hace peticiones de red y NO se ejecuta en CI: la clave privada vive solo en el Mac del dueño.
//
//   LAZUNOX_SITE_KEY_FILE=~/.lazunox-keys/site.pem node scripts/site-release.mjs [--build]
//
//   --build   compila antes la PWA y arma `pwa/dist-site` (`npm run build:pwa` + `scripts/build-site.mjs`)
//
// Qué hace: (1) archiva los `app/assets` de esta versión en `site-archive/` y vuelve a poner en el sitio los de las 10 últimas, para
// que un Mac con una versión anterior de la app siga encontrando los archivos de SU interfaz (los nombres llevan huella: no chocan);
// (2) calcula el sha256 de todo lo que se sirve y escribe `site-manifest.json`; (3) lo firma (`site-manifest.sig`); (4) comprueba la
// firma con `SITE_PUBLIC_KEY` de `src/shared/brand.ts`; (5) imprime el comando exacto para publicar.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePublicKey, publicKeyOf, readPrivateKey, signBytes, spkiBase64, verifyBytes } from './update-lib.mjs'
import { CSP, MANIFEST_NAME, SIGNATURE_NAME, buildSiteManifest, siteManifestBytes, startupPaths } from './site-lib.mjs'

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const KEEP_VERSIONS = 10
/** Los estáticos de Cloudflare admiten unos 20 000 archivos (por verificar en el plan gratuito): se avisa antes de acercarse. */
const FILE_WARN = 15000

const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

function readSiteBrand(root) {
  const src = readFileSync(join(root, 'src', 'shared', 'brand.ts'), 'utf8')
  return {
    publicKey: /export const SITE_PUBLIC_KEY = '([^']*)'/.exec(src)?.[1] ?? '',
    keyId: /export const SITE_KEY_ID = '([^']*)'/.exec(src)?.[1] ?? ''
  }
}

/** `root` = raíz del repositorio; solo las pruebas lo cambian. Devuelve lo que hizo (sin imprimir nada). */
export function release({ root = defaultRoot, keyFile, now = () => new Date() }) {
  const site = join(root, 'pwa', 'dist-site')
  if (!existsSync(join(site, 'index.html')) || !existsSync(join(site, 'sw.js')))
    throw new Error('Falta pwa/dist-site: ejecuta `node scripts/build-site.mjs` (o usa --build).')
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const brand = readSiteBrand(root)
  if (!brand.keyId) throw new Error('SITE_KEY_ID está vacío en src/shared/brand.ts.')
  const priv = readPrivateKey(keyFile?.replace(/^~(?=\/)/, process.env.HOME ?? '~'), root)
  const derived = spkiBase64(publicKeyOf(priv))
  let keyWarning = null
  if (!brand.publicKey)
    keyWarning =
      'SITE_PUBLIC_KEY está vacía en brand.ts: la app no verificará el sitio hasta que la pongas (la clave pública es esta: ver abajo).'
  else {
    const pub = decodePublicKey(brand.publicKey)
    if (!pub) throw new Error('SITE_PUBLIC_KEY de brand.ts no es una clave Ed25519 válida.')
    if (spkiBase64(pub) !== derived)
      throw new Error('La clave privada NO corresponde a SITE_PUBLIC_KEY de brand.ts: la app rechazaría este sitio.')
  }

  const when = now()
  const seq = Math.floor(when.getTime() / 1000)
  const sw = readFileSync(join(site, 'sw.js'), 'utf8')
  const build = /const BUILD = '([a-f0-9]{12})'/.exec(sw)?.[1]
  if (!build) throw new Error('sw.js sin huella de publicación (ejecuta scripts/build-site.mjs).')

  // (1) Archivo de las últimas versiones de la interfaz completa (unión de `app/assets`).
  const assets = join(site, 'app', 'assets')
  const archive = join(root, 'site-archive')
  mkdirSync(archive, { recursive: true })
  const mine = join(archive, `${String(seq).padStart(10, '0')}-${build}`)
  if (!readdirSync(archive).some((n) => n.endsWith(`-${build}`))) cpSync(assets, mine, { recursive: true })
  const versions = readdirSync(archive)
    .filter((n) => /^\d{10}-[a-f0-9]{12}$/.test(n))
    .sort()
  for (const old of versions.slice(0, Math.max(0, versions.length - KEEP_VERSIONS)))
    rmSync(join(archive, old), { recursive: true, force: true })
  for (const v of versions.slice(-KEEP_VERSIONS))
    for (const f of walk(join(archive, v))) {
      const dest = join(assets, relative(join(archive, v), f))
      if (!existsSync(dest)) cpSync(f, dest)
    }

  // (2) Manifiesto: todo lo que se sirve (sin `_headers`, que Cloudflare consume y no sirve, ni el propio manifiesto/firma).
  const skip = new Set(['_headers', MANIFEST_NAME, SIGNATURE_NAME])
  const files = walk(site)
    .map((p) => ({ p: relative(site, p).split('\\').join('/'), sha256: sha(p) }))
    .filter((f) => !skip.has(f.p))
  const startup = startupPaths(readFileSync(join(site, 'index.html'), 'utf8'))
  for (const p of startup) if (!files.some((f) => f.p === p)) throw new Error(`El arranque necesita ${p} y no está en el sitio.`)
  const manifest = buildSiteManifest({
    files,
    startup,
    build,
    version: pkg.version,
    keyId: brand.keyId,
    seq,
    csp: CSP,
    publishedAt: when.toISOString()
  })
  const bytes = siteManifestBytes(manifest)
  const sig = signBytes(bytes, priv)
  if (!verifyBytes(bytes, sig, publicKeyOf(priv))) throw new Error('La firma no verifica con la clave pública derivada (no debería pasar).')
  writeFileSync(join(site, MANIFEST_NAME), bytes)
  writeFileSync(join(site, SIGNATURE_NAME), sig + '\n')
  return {
    build,
    seq,
    files: files.length,
    startup,
    publicKey: derived,
    keyWarning,
    warnFiles: files.length > FILE_WARN,
    versions: Math.min(versions.length, KEEP_VERSIONS)
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    if (process.argv.includes('--build')) {
      for (const script of ['build-pwa.mjs', 'build-site.mjs']) {
        const r = spawnSync(process.execPath, [join(defaultRoot, 'scripts', script)], { cwd: defaultRoot, stdio: 'inherit' })
        if (r.status !== 0) process.exit(r.status ?? 1)
      }
    }
    const r = release({ keyFile: process.env.LAZUNOX_SITE_KEY_FILE })
    console.log(
      `[site-release] publicación ${r.build}: ${r.files} archivos, ${r.startup.length} de arranque vigilados, ${r.versions} versiones de la interfaz.`
    )
    console.log(`[site-release] clave pública (no es secreta): ${r.publicKey}`)
    if (r.keyWarning) console.warn(`[site-release] AVISO: ${r.keyWarning}`)
    if (r.warnFiles) console.warn('[site-release] AVISO: muchos archivos; Cloudflare admite unos 20 000 en los estáticos.')
    console.log('[site-release] Esto NO publica nada. Para publicar, desde tu Mac:')
    console.log('  cd cloud/remoto-worker && npx wrangler@4 deploy')
  } catch (e) {
    console.error(`[site-release] ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
}
