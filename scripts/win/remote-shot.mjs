// Captura de la sección «Celular» de Ajustes en Windows (solo lectura, desarrollo con LAZUNOX_REMOTE_WIN=1, userData temporal).
// Uso (en el PC, desde C:\onyx\wt): C:\onyx\node22\node.exe scripts\win\remote-shot.mjs [salida.png]
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const { _electron } = require('playwright-core')
const electronPath = require('electron')
const outFile = process.argv[2] ?? 'C:\\onyx\\shots\\celular-win.png'
const navLabel = process.argv[3] ?? 'Celular'
mkdirSync(dirname(outFile), { recursive: true })
const ud = mkdtempSync(join(tmpdir(), 'lzx-shot-'))
const env = { ...process.env, LAZUNOX_REMOTE_WIN: '1', LAZUNOX_E2E_HEADLESS: '1' }
delete env.ELECTRON_RUN_AS_NODE
let app
try {
  app = await _electron.launch({
    cwd: process.cwd(),
    executablePath: electronPath,
    args: ['.', `--user-data-dir=${ud}`],
    env,
    timeout: 30000
  })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(2500)
  await page
    .getByRole('button', { name: /^Ajustes/ })
    .first()
    .click()
  await page.waitForTimeout(800)
  const nav = page.getByRole('button', { name: new RegExp(`^${navLabel}$`) }).first()
  const hay = (await nav.count()) > 0
  console.log(JSON.stringify({ seccionEnAjustes: hay }))
  if (hay) {
    await nav.click()
    await page.waitForTimeout(1500)
  }
  await page.screenshot({ path: outFile })
  console.log('captura: ' + outFile)
} catch (e) {
  console.log('fatal: ' + String(e?.message ?? e).slice(0, 300))
} finally {
  await app?.close().catch(() => {})
  rmSync(ud, { recursive: true, force: true })
}
