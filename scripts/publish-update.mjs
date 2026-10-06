#!/usr/bin/env node
// Prepara los archivos de una actualización para subir a la release de GitHub: el ZIP de la .app ya empaquetada
// (con `ditto`, NO con electron-builder: rompería los symlinks de Electron Framework.framework), el manifiesto
// update.json y su firma Ed25519 update.json.sig. NO sube nada y NO hace peticiones de red.
//
//   LAZUNOX_UPDATE_KEY_FILE=~/.lazunox-keys/update.pem node scripts/publish-update.mjs [--app dist/mac-arm64/Lazunox.app] [--out dist/update]
//   node scripts/publish-update.mjs --platform win32-x64 [--app dist/win-unpacked] [--out dist/update-win]
//
// `--platform win32-x64`: el ZIP de la carpeta win-unpacked (raíz `Lazunox/`) se arma en JS puro (orden y fecha fijos), así que
// corre también en el Mac; genera update-win32-x64.json (+ .sig) y Lazunox-X.Y.Z-win32-x64.zip. El manifiesto lleva
// `platform` dentro de lo firmado: un manifiesto de Windows no sirve en el Mac ni al revés.
//
// La clave privada se lee del archivo indicado (fuera del repo, permisos 0600) y nunca se imprime.
//
// Dos pasos (la clave privada NUNCA va al CI): `--manifest-only` genera el ZIP y `update.json` SIN firmar y no necesita
// ninguna clave (es lo que corre el CI); la firma se hace después en el Mac del dueño con `scripts/sign-update.mjs`.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ZIP_MAX_BYTES,
  buildManifest,
  buildWinZip,
  checkBundle,
  checkWinApp,
  checkWinZip,
  decodePublicKey,
  listZip,
  manifestBytes,
  platformSpec,
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
export async function publish({
  appPath,
  outDir,
  keyFile,
  manifestOnly = false,
  platform = 'darwin-arm64',
  root = defaultRoot,
  now = () => new Date()
}) {
  const spec = platformSpec(platform)
  const isWin = platform === 'win32-x64'
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const brand = readBrand(root)
  if (!brand.publicKey) throw new Error('UPDATE_PUBLIC_KEY está vacía en src/shared/brand.ts: pon la clave pública y vuelve a empaquetar.')
  const pub = decodePublicKey(brand.publicKey)
  if (!pub) throw new Error('UPDATE_PUBLIC_KEY de brand.ts no es una clave Ed25519 válida.')

  const priv = manifestOnly ? null : readPrivateKey(keyFile, root)
  // Que la privada corresponda a la pública que lleva la app: si no, nadie podría verificar la actualización.
  if (priv && spkiBase64(publicKeyOf(priv)) !== spkiBase64(pub))
    throw new Error('La clave privada NO corresponde a UPDATE_PUBLIC_KEY de brand.ts.')

  if (!existsSync(appPath))
    throw new Error(
      `No existe ${appPath}: ejecuta antes ${isWin ? '`npm run package:win` (genera dist/win-unpacked)' : '`npm run package`'}.`
    )
  const version = pkg.version
  const tag = `v${version}`
  const info = isWin ? checkWinApp(appPath, { version }) : checkBundle(appPath, { appId: brand.appId, version })

  mkdirSync(outDir, { recursive: true })
  const zipName = spec.zipName(version)
  const zipPath = join(outDir, zipName)
  const mPath = join(outDir, spec.manifestName)
  for (const f of [zipPath, mPath, join(outDir, spec.manifestSigName)]) rmSync(f, { force: true })
  // --sequesterRsrc: macOS marca con com.apple.provenance (no se puede quitar) los archivos que crea y ditto los guarda como
  // entradas AppleDouble bajo __MACOSX/Lazunox.app/…; el cliente las admite (ditto -x las aplica como metadatos, no crea nada fuera).
  if (isWin) {
    buildWinZip(appPath, zipPath)
    info.push(...checkWinZip(zipPath, { version }))
  } else {
    const z = run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zipPath])
    if (z.status !== 0) throw new Error(`ditto -c -k falló: ${(z.stderr || '').trim()}`)
    listZip(zipPath)
  }
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
    publishedAt: now().toISOString(),
    platform
  })
  const bytes = manifestBytes(manifest)
  writeFileSync(mPath, bytes)
  if (priv) {
    const sig = signBytes(bytes, priv)
    if (!verifyBytes(bytes, sig, pub)) throw new Error('La firma generada no verifica con UPDATE_PUBLIC_KEY (error interno).')
    writeFileSync(join(outDir, spec.manifestSigName), sig + '\n')
  }
  return {
    tag,
    version,
    zipPath,
    size,
    sha256,
    outDir,
    info,
    signed: Boolean(priv),
    platform,
    manifestName: spec.manifestName,
    sigName: spec.manifestSigName
  }
}

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const platform = arg('--platform') ?? 'darwin-arm64'
  const win = platform === 'win32-x64'
  publish({
    platform,
    appPath: resolve(arg('--app') ?? join(defaultRoot, win ? 'dist/win-unpacked' : 'dist/mac-arm64/Lazunox.app')),
    outDir: resolve(arg('--out') ?? join(defaultRoot, win ? 'dist/update-win' : 'dist/update')),
    keyFile: process.env.LAZUNOX_UPDATE_KEY_FILE,
    manifestOnly: process.argv.includes('--manifest-only')
  })
    .then((r) => {
      console.log(`publish-update OK — ${r.tag}`)
      console.log(`  ZIP:      ${r.zipPath} (${r.size} bytes, sha256 ${r.sha256})`)
      console.log(`  Manifest: ${join(r.outDir, r.manifestName)}${r.signed ? ` + ${r.sigName}` : ' (SIN firmar)'}`)
      for (const l of r.info) console.log(`  ${l}`)
      if (!r.signed) {
        console.log(
          `Falta la firma: en tu Mac, con la clave privada, ejecuta \`node scripts/sign-update.mjs --platform ${r.platform} --dir <carpeta con ${r.manifestName} y el ZIP>\` y sube ${r.sigName} a la release.`
        )
        return
      }
      console.log(
        `Sube los TRES archivos como assets de la release ${r.tag} (más ${r.platform === 'win32-x64' ? 'el instalador .exe' : 'el .dmg'}) y comprueba con: node scripts/verify-update.mjs --platform ${r.platform} --dir ${r.outDir}`
      )
    })
    .catch((e) => {
      console.error(`publish-update FALLÓ: ${e.message}`)
      process.exit(1)
    })
}
