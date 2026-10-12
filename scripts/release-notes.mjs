#!/usr/bin/env node
// Extrae de CHANGELOG.md (formato «Keep a Changelog») las notas de UNA versión, para usarlas como cuerpo de la release de GitHub
// (`gh release create --notes-file`). No usa la red.
//
//   node scripts/release-notes.mjs 0.4.0 [--file CHANGELOG.md] [--out notas.md] [--no-install]
//
// Al final agrega el bloque «Cómo instalar» (Mac y Windows, docs/release-instalar.md) para que cada release lo lleve; `--no-install` lo omite.
//
// Falla si la versión no tiene sección o está vacía (así no se publica una release sin notas). Acepta `0.4.0` o `v0.4.0`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Devuelve el texto de la sección `## [version]` (sin el encabezado), recortado; lanza si no existe o está vacía. */
export function extractNotes(changelog, rawVersion) {
  const version = String(rawVersion).replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Versión no válida: «${rawVersion}» (se espera X.Y.Z).`)
  const lines = changelog.replace(/\r\n/g, '\n').split('\n')
  const head = new RegExp(`^##\\s+\\[?${esc(version)}\\]?(?:\\s+-\\s+.*|\\s*)$`)
  const start = lines.findIndex((l) => head.test(l))
  if (start < 0) throw new Error(`CHANGELOG.md no tiene una sección «## [${version}]».`)
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    // Siguiente versión (## ...) o el bloque de enlaces del final ([x]: url).
    if (/^##\s/.test(lines[i]) || /^\[[^\]]+\]:\s+\S+/.test(lines[i])) {
      end = i
      break
    }
  }
  const body = lines
    .slice(start + 1, end)
    .join('\n')
    .trim()
  if (!body) throw new Error(`La sección «## [${version}]» de CHANGELOG.md está vacía.`)
  return body + '\n'
}

/** Bloque «Cómo instalar» (Mac y Windows) que va al final de cada release: viene de docs/release-instalar.md. */
export function installBlock(root = defaultRoot) {
  const file = resolve(root, 'docs', 'release-instalar.md')
  if (!existsSync(file)) throw new Error('Falta docs/release-instalar.md (el bloque «Cómo instalar» de cada release).')
  const text = readFileSync(file, 'utf8').trim()
  if (!text) throw new Error('docs/release-instalar.md está vacío.')
  return text + '\n'
}

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = process.argv[2]
  if (!version || version.startsWith('--')) {
    console.error('Uso: node scripts/release-notes.mjs <versión> [--file CHANGELOG.md] [--out notas.md] [--no-install]')
    process.exit(2)
  }
  try {
    let notes = extractNotes(readFileSync(resolve(arg('--file') ?? `${defaultRoot}/CHANGELOG.md`), 'utf8'), version)
    if (!process.argv.includes('--no-install')) notes = `${notes}\n---\n\n${installBlock()}`
    if (arg('--out')) writeFileSync(resolve(arg('--out')), notes)
    else process.stdout.write(notes)
  } catch (e) {
    console.error(`release-notes FALLÓ: ${e.message}`)
    process.exit(1)
  }
}
