#!/usr/bin/env node
// Arma la carpeta que se sube al servidor propio de releases (lazunox.onyxcode.cl) con la MISMA estructura que usa GitHub:
//
//   repos/<repo>/releases/latest                      JSON con la última versión (lo lee la app: tag_name, html_url, draft, prerelease)
//   <repo>/releases/download/<tag>/<archivos…>        manifiestos firmados, ZIP, .dmg, instalador de Windows y SHA256SUMS
//   <repo>/releases/latest/download/<archivos…>       copia de lo anterior (la usan install.sh e install.ps1)
//
// NO sube nada y NO hace peticiones de red: solo copia archivos y escribe JSON. Al final imprime el comando rsync para que lo
// ejecutes TÚ. El servidor no necesita ser de confianza: la app verifica la firma Ed25519 de cada manifiesto antes de instalar.
//
//   node scripts/publish-vps.mjs --tag v0.5.9 --out dist/vps  dist/update/* dist/update-win/* dist/lazunox-0.5.9-arm64.dmg dist/Lazunox-Setup-0.5.9-x64.exe
//
// Los archivos son lo que producen `scripts/publish-update.mjs` (manifiesto + .sig + ZIP, ya firmados con scripts/sign-update.mjs)
// y `npm run package` / `npm run package:win` (el .dmg y el instalador .exe).
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TAG_RE = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const SAFE_NAME = /^[A-Za-z0-9._-]{1,200}$/

/** Lee `RELEASES_ORIGIN` y `RELEASES_REPO` de src/shared/brand.ts (sin importarlo: es TypeScript). */
export function readReleasesBrand(root = defaultRoot) {
  const src = readFileSync(join(root, 'src', 'shared', 'brand.ts'), 'utf8')
  const origin = /export const RELEASES_ORIGIN = '([^']+)'/.exec(src)?.[1]
  const repo = /export const RELEASES_REPO = '([^']+)'/.exec(src)?.[1]
  if (!origin || !repo) throw new Error('No encuentro RELEASES_ORIGIN y RELEASES_REPO en src/shared/brand.ts')
  return { origin: origin.replace(/\/+$/, ''), repo }
}

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

/**
 * @param {{ tag: string, outDir: string, files: string[], prerelease?: boolean, root?: string }} o
 * @returns {{ stage: string, names: string[], latestJson: string }}
 */
export function publishVps({ tag, outDir, files, prerelease = false, root = defaultRoot }) {
  if (!TAG_RE.test(tag)) throw new Error(`--tag debe ser vX.Y.Z (recibí «${tag}»)`)
  if (!files.length) throw new Error('Faltan archivos que publicar')
  const { origin, repo } = readReleasesBrand(root)
  const stage = resolve(outDir)
  rmSync(stage, { recursive: true, force: true })
  const dl = join(stage, repo, 'releases', 'download', tag)
  const latestDl = join(stage, repo, 'releases', 'latest', 'download')
  mkdirSync(dl, { recursive: true })
  mkdirSync(latestDl, { recursive: true })
  const names = []
  for (const f of files) {
    if (!existsSync(f) || !statSync(f).isFile()) throw new Error(`No existe el archivo ${f}`)
    const name = basename(f)
    if (!SAFE_NAME.test(name)) throw new Error(`Nombre de archivo no permitido: ${name}`)
    if (names.includes(name)) throw new Error(`Archivo repetido: ${name}`)
    copyFileSync(f, join(dl, name))
    names.push(name)
  }
  // SHA256SUMS de lo que se instala a mano (instaladores y ZIP): lo usan install.sh e install.ps1.
  const sumFiles = names.filter((n) => /\.(dmg|exe|zip)$/i.test(n))
  const sums = sumFiles.map((n) => `${sha256(join(dl, n))}  ${n}`).join('\n') + '\n'
  writeFileSync(join(dl, 'SHA256SUMS'), sums)
  names.push('SHA256SUMS')
  for (const n of names) copyFileSync(join(dl, n), join(latestDl, n))
  // JSON de «última versión», con la forma de GitHub (solo lo que lee la app).
  const apiDir = join(stage, 'repos', repo, 'releases')
  mkdirSync(apiDir, { recursive: true })
  const downloadBase = `${origin}/${repo}/releases/download/${tag}`
  const latest = {
    tag_name: tag,
    html_url: `${origin}/${repo}/releases/tag/${tag}`,
    draft: false,
    prerelease,
    assets: names.map((n) => ({ name: n, size: statSync(join(dl, n)).size, browser_download_url: `${downloadBase}/${n}` }))
  }
  const latestJson = JSON.stringify(latest, null, 2) + '\n'
  writeFileSync(join(apiDir, 'latest'), latestJson)
  return { stage, names, latestJson }
}

function main() {
  const args = process.argv.slice(2)
  let tag = ''
  let out = 'dist/vps'
  let prerelease = false
  const files = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--tag') tag = args[++i] ?? ''
    else if (a === '--out') out = args[++i] ?? out
    else if (a === '--prerelease') prerelease = true
    else if (a.startsWith('--')) throw new Error(`Opción desconocida: ${a}`)
    else files.push(a)
  }
  const { stage, names } = publishVps({ tag, outDir: out, files, prerelease })
  const { origin } = readReleasesBrand()
  console.log(`Carpeta lista: ${stage}`)
  console.log(`Archivos: ${names.join(', ')}`)
  console.log('\nNO se ha subido nada. Para publicar, ejecuta TÚ (cambia usuario y ruta del servidor):')
  console.log(`  rsync -av --delete-after ${stage}/ USUARIO@SERVIDOR:/var/www/lazunox/`)
  console.log(`\nDespués comprueba: curl -s ${origin}/repos/${readReleasesBrand().repo}/releases/latest`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (e) {
    console.error(`ERROR: ${e instanceof Error ? e.message : e}`)
    process.exit(1)
  }
}
