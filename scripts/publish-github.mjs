#!/usr/bin/env node
// Prepara una release de GitHub (el canal de actualizaciones de la app) con los archivos de una versión y escribe el SHA256SUMS.
//
//   node scripts/publish-github.mjs --tag v0.5.9 --out dist/github  dist/update/* dist/update-win/* dist/lazunox-0.5.9-arm64.dmg dist/Lazunox-Setup-0.5.9-x64.exe
//
// NO sube nada y NO hace peticiones de red: copia los archivos a una carpeta, escribe el SHA256SUMS (lo usan install.sh e install.ps1) y al
// final IMPRIME el comando `gh release create` para que lo ejecutes TÚ. Sale como BORRADOR: lo revisas en GitHub y lo publicas tú
// (una release nueva es la que hace que las apps ofrezcan la actualización; los borradores y las prereleases no se ofrecen).
// La app verifica la firma Ed25519 de cada manifiesto antes de instalar, así que GitHub no necesita ser de confianza.
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

/** Lee `RELEASES_REPO` de src/shared/brand.ts (sin importarlo: es TypeScript). */
export function readReleasesRepo(root = defaultRoot) {
  const src = readFileSync(join(root, 'src', 'shared', 'brand.ts'), 'utf8')
  const repo = /export const RELEASES_REPO = '([^']+)'/.exec(src)?.[1]
  if (!repo || !/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(repo))
    throw new Error('RELEASES_REPO de src/shared/brand.ts no es «dueño/repositorio»')
  return repo
}

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

/**
 * @param {{ tag: string, outDir: string, files: string[], prerelease?: boolean, root?: string }} o
 * @returns {{ stage: string, names: string[], command: string }}
 */
export function publishGithub({ tag, outDir, files, prerelease = false, root = defaultRoot }) {
  if (!TAG_RE.test(tag)) throw new Error(`--tag debe ser vX.Y.Z (recibí «${tag}»)`)
  if (!files.length) throw new Error('Faltan archivos que publicar')
  const repo = readReleasesRepo(root)
  const stage = resolve(outDir)
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })
  const names = []
  for (const f of files) {
    if (!existsSync(f) || !statSync(f).isFile()) throw new Error(`No existe el archivo ${f}`)
    const name = basename(f)
    if (!SAFE_NAME.test(name)) throw new Error(`Nombre de archivo no permitido: ${name}`)
    if (name === 'SHA256SUMS') throw new Error('SHA256SUMS lo genera este script: no lo pases como archivo')
    if (names.includes(name)) throw new Error(`Archivo repetido: ${name}`)
    copyFileSync(f, join(stage, name))
    names.push(name)
  }
  const sumFiles = names.filter((n) => /\.(dmg|exe|zip)$/i.test(n))
  writeFileSync(join(stage, 'SHA256SUMS'), sumFiles.map((n) => `${sha256(join(stage, n))}  ${n}`).join('\n') + '\n')
  names.push('SHA256SUMS')
  const assets = names.map((n) => `"${join(stage, n)}"`).join(' ')
  const command = `gh release create ${tag} ${assets} --repo ${repo} --draft --title "Lazunox ${tag.slice(1)}" --notes-file CHANGELOG.md${prerelease ? ' --prerelease' : ''}`
  return { stage, names, command }
}

function main() {
  const args = process.argv.slice(2)
  let tag = ''
  let out = 'dist/github'
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
  const { stage, names, command } = publishGithub({ tag, outDir: out, files, prerelease })
  console.log(`Carpeta lista: ${stage}`)
  console.log(`Archivos: ${names.join(', ')}`)
  console.log('\nNO se ha subido nada. Para crear el BORRADOR de la release, ejecuta TÚ:\n')
  console.log(`  ${command}\n`)
  console.log(
    'Revísalo en GitHub (Releases) y pulsa «Publish release» cuando esté todo bien. Antes de publicar: que no haya claves ni datos propios en los archivos.'
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (e) {
    console.error(`ERROR: ${e instanceof Error ? e.message : e}`)
    process.exit(1)
  }
}
