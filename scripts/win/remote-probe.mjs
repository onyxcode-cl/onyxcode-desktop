// Sonda del control remoto en Windows (solo lectura): arranca la app SIN empaquetar (out/main/index.js) con LAZUNOX_REMOTE_WIN=1 y un userData temporal,
// y lee las banderas que llegan a la interfaz. No activa el remoto, no abre puertos, no toca la app instalada.
// Uso (en el PC, desde C:\onyx\wt): C:\onyx\node22\node.exe scripts\win\remote-probe.mjs
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { _electron } = require('playwright-core')
const electronPath = require('electron')
const ud = mkdtempSync(join(tmpdir(), 'lzx-probe-'))
const env = { ...process.env, LAZUNOX_REMOTE_WIN: '1', LAZUNOX_E2E_HEADLESS: '1' }
delete env.ELECTRON_RUN_AS_NODE
let app
try {
  app = await _electron.launch({ executablePath: electronPath, args: ['out/main/index.js', `--user-data-dir=${ud}`], env, timeout: 30000 })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(3000)
  const info = await page.evaluate(() => ({ platform: window.api?.platform, capsFlags: window.api?.capsFlags ?? null }))
  const packaged = await app.evaluate(({ app: a }) => a.isPackaged)
  console.log(JSON.stringify({ isPackaged: packaged, ...info }))
} finally {
  await app?.close().catch(() => {})
  rmSync(ud, { recursive: true, force: true })
}
