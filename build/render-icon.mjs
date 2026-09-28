// Rasteriza build/icon.svg → build/icon.png (1024) + build/icon.icns usando el Chromium de Electron.
// Uso: npx electron build/render-icon.mjs
import { app, BrowserWindow } from 'electron'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const svg = readFileSync(join(dir, 'icon.svg'), 'utf8')
const SIZES = [16, 32, 64, 128, 256, 512, 1024]

app.dock?.hide()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html,<html><body></body></html>')
  const b64 = Buffer.from(svg).toString('base64')
  const out = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image()
    img.src = 'data:image/svg+xml;base64,${b64}'
    await img.decode()
    const res = {}
    for (const s of ${JSON.stringify(SIZES)}) {
      const c = document.createElement('canvas'); c.width = s; c.height = s
      const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, s, s)
      res[s] = c.toDataURL('image/png').split(',')[1]
    }
    return res
  })()`)
  const png = (s) => Buffer.from(out[s], 'base64')
  writeFileSync(join(dir, 'icon.png'), png(1024))
  const set = join(dir, 'icon.iconset')
  rmSync(set, { recursive: true, force: true })
  mkdirSync(set)
  for (const s of [16, 32, 128, 256, 512]) {
    writeFileSync(join(set, `icon_${s}x${s}.png`), png(s))
    writeFileSync(join(set, `icon_${s}x${s}@2x.png`), png(s * 2))
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', join(dir, 'icon.icns')])
  rmSync(set, { recursive: true, force: true })
  console.log('OK icon.png + icon.icns')
  app.quit()
})
