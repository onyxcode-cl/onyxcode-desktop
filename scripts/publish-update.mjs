#!/usr/bin/env node
// Prepara los archivos de una actualización para subir a la release de GitHub: el ZIP de la .app ya empaquetada
// (con `ditto`, NO con electron-builder: rompería los symlinks de Electron Framework.framework), el manifiesto
// update.json y su firma Ed25519 update.json.sig. NO sube nada y NO hace peticiones de red.
//
//   ONYXCODE_UPDATE_KEY_FILE=~/.onyxcode-keys/update.pem node scripts/publish-update.mjs [--app dist/mac-arm64/OnyxCode.app] [--out dist/update]
//
// La clave privada se lee del archivo indicado (fuera del repo, permisos 0600) y nunca se imprime.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ZIP_MAX_BYTES,
  buildManifest,
  checkBundle,
  decodePublicKey,
  listZip,
  manifestBytes,
  publicKeyOf,
  readBrand,
  readPrivateKey,
  run,
  sha256File,
  signBytes,
  spkiBase64,
  verifyBytes
} from './update-lib.mjs'

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** `root` = raíz del repositorio (package.json y src/shared/brand.ts); solo las pruebas lo cambian. */
export async function publish({ appPath, outDir, keyFile, root = defaultRoot, now = () => new Date() }) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const brand = readBrand(root)
  if (!brand.publicKey) throw new Error('UPDATE_PUBLIC_KEY está vacía en src/shared/brand.ts: pon la clave pública y vuelve a empaquetar.')
  const pub = decodePublicKey(brand.publicKey)
  if (!pub) throw new Error('UPDATE_PUBLIC_KEY de brand.ts no es una clave Ed25519 válida.')

  const priv = readPrivateKey(keyFile, root)
  // Que la privada corresponda a la pública que lleva la app: si no, nadie podría verificar la actualización.
  if (spkiBase64(publicKeyOf(priv)) !== spkiBase64(pub)) throw new Error('La clave privada NO corresponde a UPDATE_PUBLIC_KEY de brand.ts.')

  if (!existsSync(appPath)) throw new Error(`No existe ${appPath}: ejecuta antes \`npm run package\`.`)
  const version = pkg.version
  const tag = `v${version}`
  const info = checkBundle(appPath, { appId: brand.appId, version })

  mkdirSync(outDir, { recursive: true })
  const zipName = `OnyxCode-${version}-arm64.zip`
  const zipPath = join(outDir, zipName)
  for (const f of [zipPath, join(outDir, 'update.json'), join(outDir, 'update.json.sig')]) rmSync(f, { force: true })
  // --sequesterRsrc: macOS marca con com.apple.provenance (no se puede quitar) los archivos que crea y ditto los guarda como
  // entradas AppleDouble bajo __MACOSX/OnyxCode.app/…; el cliente las admite (ditto -x las aplica como metadatos, no crea nada fuera).
  const z = run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zipPath])
  if (z.status !== 0) throw new Error(`ditto -c -k falló: ${(z.stderr || '').trim()}`)
  listZip(zipPath)
  const size = statSync(zipPath).size
  if (size > ZIP_MAX_BYTES) throw new Error(`El ZIP pesa ${size} bytes: supera el tope de ${ZIP_MAX_BYTES}.`)
  const sha256 = await sha256File(zipPath)

  const manifest = buildManifest({
    appId: brand.appId,
    version,
    tag,
    keyId: brand.keyId,
    zipName,
    size,
    sha256,
    publishedAt: now().toISOString()
  })
  const bytes = manifestBytes(manifest)
  const sig = signBytes(bytes, priv)
  if (!verifyBytes(bytes, sig, pub)) throw new Error('La firma generada no verifica con UPDATE_PUBLIC_KEY (error interno).')
  writeFileSync(join(outDir, 'update.json'), bytes)
  writeFileSync(join(outDir, 'update.json.sig'), sig + '\n')
  return { tag, version, zipPath, size, sha256, outDir, info }
}

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publish({
    appPath: resolve(arg('--app') ?? join(defaultRoot, 'dist/mac-arm64/OnyxCode.app')),
    outDir: resolve(arg('--out') ?? join(defaultRoot, 'dist/update')),
    keyFile: process.env.ONYXCODE_UPDATE_KEY_FILE
  })
    .then((r) => {
      console.log(`publish-update OK — ${r.tag}`)
      console.log(`  ZIP:      ${r.zipPath} (${r.size} bytes, sha256 ${r.sha256})`)
      console.log(`  Manifest: ${join(r.outDir, 'update.json')} + update.json.sig`)
      for (const l of r.info) console.log(`  ${l}`)
      console.log(
        `Sube los TRES archivos como assets de la release ${r.tag} (más el .dmg) y comprueba con: node scripts/verify-update.mjs --dir ${r.outDir}`
      )
    })
    .catch((e) => {
      console.error(`publish-update FALLÓ: ${e.message}`)
      process.exit(1)
    })
}
