#!/usr/bin/env node
// test:transform — smoke SIN Electron: pasa cada archivo del renderer por la cadena de transformación
// del dev server de Vite (plugin de React/Babel, Tailwind, esbuild, alias) y falla si alguno no compila.
// Atrapa errores que typecheck/tests/build no ven (p. ej. `export { x }` antes del `import` de x:
// Babel dev dice "Export 'x' is not defined").
//
// Config: `loadConfigFromFile` de electron-vite (mismo mecanismo que `electron-vite dev`), se toma
// `.renderer` con sus plugins y alias reales. Se crea un servidor Vite en middlewareMode (sin puerto)
// y se llama a `server.transformRequest(url)` por archivo / `transformIndexHtml` por HTML.
//
// NOTA: hmr debe quedar activo (no hmr:false): sin él el plugin de React no pasa por Babel/refresh y el fallo no se ve.

// PRUEBA DE REGRESIÓN (hecha, no commitear): en features/code/impl/ProjectPicker.tsx se puso
// `export { baseName }` (moviéndolo) ANTES de `import { baseName, tildify } from '../../../lib/paths'`;
// `npm run test:transform` debe salir con código 1 señalando ese archivo; al revertir, pasa.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfigFromFile } from 'electron-vite'
import { createServer } from 'vite' // el createServer de electron-vite arranca la app entera; este es el de Vite

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rendererRoot = join(root, 'src/renderer')
const t0 = Date.now()

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const files = walk(rendererRoot)
const isTest = (f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f)
const sources = files.filter((f) => /\.(ts|tsx|css)$/.test(f) && !f.endsWith('.d.ts') && !isTest(f))
const htmls = files.filter((f) => f.endsWith('.html'))

const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, undefined, root)
if (!loaded?.config?.renderer) {
  console.error('No se pudo obtener la config del renderer de electron.vite.config.ts')
  process.exit(1)
}
const renderer = loaded.config.renderer

const errors = []
let server
try {
  server = await createServer({
    ...renderer,
    configFile: false,
    root: rendererRoot,
    server: { ...(renderer.server ?? {}), middlewareMode: true },
    appType: 'custom',
    logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] }
  })
  const vite = server

  const rel = (f) => relative(root, f)
  const record = (f, e) => errors.push({ file: rel(f), msg: String(e?.message ?? e).split('\n').slice(0, 4).join('\n    ') })

  await Promise.all(
    sources.map(async (f) => {
      try {
        const r = await vite.transformRequest('/' + relative(rendererRoot, f).split('\\').join('/'))
        if (!r) throw new Error('transformRequest devolvió null')
      } catch (e) {
        record(f, e)
      }
    })
  )
  for (const f of htmls) {
    try {
      const url = '/' + relative(rendererRoot, f).split('\\').join('/')
      await vite.transformIndexHtml(url, readFileSync(f, 'utf8'))
    } catch (e) {
      record(f, e)
    }
  }
} catch (e) {
  errors.push({ file: '(setup)', msg: String(e?.stack ?? e) })
} finally {
  await server?.close()
}

const secs = ((Date.now() - t0) / 1000).toFixed(1)
const total = sources.length + htmls.length
if (errors.length) {
  console.error(`\ntest:transform: ${errors.length} error(es) de transformación\n`)
  for (const e of errors.sort((a, b) => a.file.localeCompare(b.file))) console.error(`  ✗ ${e.file}\n    ${e.msg}\n`)
  console.error(`FALLÓ: ${errors.length}/${total} archivos (${secs}s)`)
  process.exit(1)
}
console.log(`test:transform OK: ${total} archivos (${sources.length} ts/tsx/css + ${htmls.length} html) en ${secs}s`)
process.exit(0)
