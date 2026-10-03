// Genera build/icon.ico (16-256 px, entradas PNG) a partir de PNG ya escalados. Uso: node build/make-ico.mjs <dir con 16.png..256.png>
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const dir = process.argv[2]
const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = sizes.map((s) => readFileSync(join(dir, `${s}.png`)))
const head = Buffer.alloc(6)
head.writeUInt16LE(1, 2)
head.writeUInt16LE(sizes.length, 4)
let offset = 6 + 16 * sizes.length
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16)
  e[0] = s === 256 ? 0 : s
  e[1] = s === 256 ? 0 : s
  e.writeUInt16LE(1, 4)
  e.writeUInt16LE(32, 6)
  e.writeUInt32LE(pngs[i].length, 8)
  e.writeUInt32LE(offset, 12)
  offset += pngs[i].length
  return e
})
writeFileSync(join(process.cwd(), 'build', 'icon.ico'), Buffer.concat([head, ...entries, ...pngs]))
