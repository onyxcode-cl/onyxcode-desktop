#!/usr/bin/env node
// Copia los recursos de PDF.js que no son módulos JS (mapas de caracteres, fuentes estándar,
// wasm de los decodificadores de imagen, perfiles de color) a `out/viewer/pdfjs/`: el visor los
// pide por URL relativa a su propio origen (`lazunox-viewer://viewer/…`), nunca de un CDN.
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('.', import.meta.url)))
const src = join(root, 'node_modules/pdfjs-dist')
const dest = join(root, 'out/viewer/pdfjs')

mkdirSync(dest, { recursive: true })
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs', 'image_decoders']) {
  cpSync(join(src, dir), join(dest, dir), { recursive: true })
}
console.log('[copy-pdfjs-assets] listo:', dest)
