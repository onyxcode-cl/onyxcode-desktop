#!/usr/bin/env node
// Compara dos carpetas de capturas PNG píxel a píxel. Ver docs/CAPTURAS-ESCRITORIO.md («Comparar capturas»).
// Uso: node scripts/shot-diff.mjs <dirA> <dirB> [--max N] [--out dirDiff]
// Por cada PNG con el mismo nombre en ambas carpetas imprime los píxeles distintos y la caja que los contiene. Con --out escribe
// un PNG de diferencia (gris tenue + rojo en lo distinto). Código de salida 1 si algún archivo supera --max (por defecto 0),
// si falta alguno de los dos lados o si cambia el tamaño. `pngjs` viene ya en node_modules (dependencia transitiva); no se instala nada.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1].startsWith('--')))
const [dirA, dirB] = positional.map((p) => resolve(p))
if (!dirA || !dirB) {
  console.error('Uso: node scripts/shot-diff.mjs <dirA> <dirB> [--max N] [--out dirDiff]')
  process.exit(2)
}
const max = Number(arg('max') ?? 0)
const outDir = arg('out') ? resolve(arg('out')) : null
if (outDir) mkdirSync(outDir, { recursive: true })

const pngs = (d) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.png')) : [])
const a = new Set(pngs(dirA))
const b = new Set(pngs(dirB))
const names = [...new Set([...a, ...b])].sort()
let bad = 0
let identical = 0
let totalDiff = 0

for (const name of names) {
  if (!a.has(name) || !b.has(name)) {
    console.log(`FALTA   ${name} (solo en ${a.has(name) ? 'A' : 'B'})`)
    bad++
    continue
  }
  const pa = PNG.sync.read(readFileSync(join(dirA, name)))
  const pb = PNG.sync.read(readFileSync(join(dirB, name)))
  if (pa.width !== pb.width || pa.height !== pb.height) {
    console.log(`TAMAÑO  ${name} ${pa.width}x${pa.height} vs ${pb.width}x${pb.height}`)
    bad++
    continue
  }
  const diff = outDir ? new PNG({ width: pa.width, height: pa.height }) : null
  let n = 0
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < pa.height; y++) {
    for (let x = 0; x < pa.width; x++) {
      const i = (y * pa.width + x) * 4
      const same =
        pa.data[i] === pb.data[i] &&
        pa.data[i + 1] === pb.data[i + 1] &&
        pa.data[i + 2] === pb.data[i + 2] &&
        pa.data[i + 3] === pb.data[i + 3]
      if (!same) {
        n++
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
      }
      if (diff) {
        if (same) {
          const g = Math.round((pa.data[i] + pa.data[i + 1] + pa.data[i + 2]) / 3 / 4 + 190)
          diff.data[i] = diff.data[i + 1] = diff.data[i + 2] = g
        } else {
          diff.data[i] = 255
          diff.data[i + 1] = 0
          diff.data[i + 2] = 0
        }
        diff.data[i + 3] = 255
      }
    }
  }
  totalDiff += n
  if (n === 0) {
    identical++
    continue
  }
  if (diff) writeFileSync(join(outDir, name), PNG.sync.write(diff))
  const over = n > max
  if (over) bad++
  console.log(
    `${over ? 'DIFIERE' : 'ruido  '} ${name} ${n} px (${((100 * n) / (pa.width * pa.height)).toFixed(3)} %) caja ${x0},${y0}..${x1},${y1}`
  )
}
console.log(
  `${names.length} archivos: ${identical} idénticos, ${names.length - identical - bad} con diferencias dentro de --max ${max}, ${bad} fuera. Píxeles distintos en total: ${totalDiff}`
)
process.exit(bad ? 1 : 0)
