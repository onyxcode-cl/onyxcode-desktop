#!/usr/bin/env node
// Copia las tipografías sustitutas (D9 del plan del visor) a `out/viewer/fonts/`: el visor las pide
// por URL relativa a su propio origen, igual que `copy-pdfjs-assets.mjs`. Son compatibles en
// métricas con las que usa Word/PowerPoint, no las tipografías originales de Microsoft (ver
// THIRD_PARTY_NOTICES.md): Carlito↔Calibri, Caladea↔Cambria, Liberation Sans↔Arial,
// Liberation Serif↔Times New Roman.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('.', import.meta.url)))
// Los `url()` de `styles.css` se resuelven relativos al propio CSS compilado, que Vite siempre deja
// en `out/viewer/assets/` (assetsDir por defecto) — no relativos a `index.html` como el caso de
// `cMapUrl` de pdf.js, que es una ruta en tiempo de ejecución (ver `copy-pdfjs-assets.mjs`).
const dest = join(root, 'out/viewer/assets/fonts')
mkdirSync(dest, { recursive: true })

const FILES = [
  ['node_modules/@fontsource/carlito/files/carlito-latin-400-normal.woff2', 'carlito-regular.woff2'],
  ['node_modules/@fontsource/carlito/files/carlito-latin-700-normal.woff2', 'carlito-bold.woff2'],
  ['node_modules/@fontsource/carlito/files/carlito-latin-400-italic.woff2', 'carlito-italic.woff2'],
  ['node_modules/@fontsource/carlito/files/carlito-latin-700-italic.woff2', 'carlito-bolditalic.woff2'],
  ['node_modules/@fontsource/caladea/files/caladea-latin-400-normal.woff2', 'caladea-regular.woff2'],
  ['node_modules/@fontsource/caladea/files/caladea-latin-700-normal.woff2', 'caladea-bold.woff2'],
  ['node_modules/@fontsource/caladea/files/caladea-latin-400-italic.woff2', 'caladea-italic.woff2'],
  ['node_modules/@fontsource/caladea/files/caladea-latin-700-italic.woff2', 'caladea-bolditalic.woff2'],
  ['node_modules/@typopro/web-liberation/TypoPRO-LiberationSans-Regular.woff', 'liberation-sans-regular.woff'],
  ['node_modules/@typopro/web-liberation/TypoPRO-LiberationSans-Bold.woff', 'liberation-sans-bold.woff'],
  ['node_modules/@typopro/web-liberation/TypoPRO-LiberationSans-Italic.woff', 'liberation-sans-italic.woff'],
  ['node_modules/@typopro/web-liberation/TypoPRO-LiberationSans-BoldItalic.woff', 'liberation-sans-bolditalic.woff'],
  ['node_modules/@typopro/web-liberation/TypoPRO-LiberationSerif-Regular.woff', 'liberation-serif-regular.woff'],
  ['node_modules/@typopro/web-liberation/TypoPRO-LiberationSerif-Bold.woff', 'liberation-serif-bold.woff'],
  ['node_modules/@typopro/web-liberation/TypoPRO-LiberationSerif-Italic.woff', 'liberation-serif-italic.woff'],
  ['node_modules/@typopro/web-liberation/TypoPRO-LiberationSerif-BoldItalic.woff', 'liberation-serif-bolditalic.woff']
]

for (const [from, to] of FILES) copyFileSync(join(root, from), join(dest, to))
console.log('[copy-docx-fonts] listo:', dest, `(${FILES.length} archivos)`)
