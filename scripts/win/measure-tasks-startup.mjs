#!/usr/bin/env node
/**
 * Medición manual V23C contra una copia de Lazunox ya abierta con userData TEMPORAL y CDP loopback.
 * No aprueba carpetas, no envía mensajes/modelos, no instala/repara WSL y no imprime conexiones/credenciales.
 * Mide tasks:start -> conexión lista (frontera IPC del clic «Nueva tarea», sin el render posterior).
 * Una carpeta nueva por argumento permite medir arranques; repetir la misma mide reutilización.
 * Ejemplo: node scripts/win/measure-tasks-startup.mjs --cdp=http://127.0.0.1:9731 --samples=5 --folder=C:\lzx\prueba
 */
import { chromium } from 'playwright-core'
import { mainWindow } from './main-window.mjs'

const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log(
    'Uso: node scripts/win/measure-tasks-startup.mjs --cdp=http://127.0.0.1:9731 --samples=5 --folder=C:\\lzx\\prueba [--folder=otra]'
  )
  process.exit(0)
}
const value = (key, fallback) => args.find((a) => a.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback
const endpoint = new URL(value('cdp', 'http://127.0.0.1:9731'))
if (
  endpoint.protocol !== 'http:' ||
  endpoint.hostname !== '127.0.0.1' ||
  endpoint.pathname !== '/' ||
  endpoint.search ||
  endpoint.hash ||
  endpoint.username ||
  endpoint.password
) {
  throw new Error('CDP debe ser http://127.0.0.1:puerto (sin ruta ni credenciales)')
}
const samples = Number(value('samples', '5'))
if (!Number.isInteger(samples) || samples < 1 || samples > 20) throw new Error('samples debe ser 1–20')
const folders = args.filter((a) => a.startsWith('--folder=')).map((a) => a.slice(9))
if (!folders.length || folders.some((f) => !/^[A-Za-z]:\\/.test(f)))
  throw new Error('Indica al menos una carpeta Windows de prueba ya autorizada')
const watchdog = setTimeout(() => {
  console.error('Medición excedió 180 s')
  process.exit(1)
}, 180_000)
let status = 0
try {
  const browser = await chromium.connectOverCDP(endpoint.origin, { timeout: 10_000 })
  const pages = browser.contexts().flatMap((c) => c.pages())
  const page = await mainWindow(pages)
  if (!page) throw new Error('No se encontró la ventana principal de la copia de prueba')
  const rows = []
  for (const [folderIndex, folder] of folders.entries()) {
    for (let sample = 1; sample <= samples; sample++) {
      const result = await page.evaluate(async (folder) => {
        const started = performance.now()
        const reply = await window.api.tasks.invoke('tasks:start', { folder, fullAccess: false })
        // Nunca devolver reply.data: contiene authorization.
        return { ms: Math.round(performance.now() - started), ok: reply.ok, code: reply.ok ? undefined : reply.code }
      }, folder)
      const row = { folder: folderIndex + 1, sample, ...result }
      rows.push(row)
      console.log(JSON.stringify(row))
      if (!result.ok) throw new Error('tasks:start fue rechazado; revisa la carpeta/pin/estado en la copia temporal')
    }
  }
  for (let folder = 1; folder <= folders.length; folder++) {
    const sorted = rows
      .filter((r) => r.folder === folder)
      .map((r) => r.ms)
      .sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
    console.log(JSON.stringify({ summary: true, folder, samples: sorted.length, minMs: sorted[0], medianMs: median, maxMs: sorted.at(-1) }))
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falló la medición')
  status = 1
} finally {
  clearTimeout(watchdog)
  // Salir desconecta CDP; no mandamos Browser.close a la app de prueba.
  process.exit(status)
}
