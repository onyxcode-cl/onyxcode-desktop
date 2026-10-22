#!/usr/bin/env node
// Arma `resources/opencode-bin/Lazunox Motor.app`: el binario OpenCode fijado (pin.json) como ejecutable principal de una
// mini-app con id propio (`<appId>.motor`). Así macOS (TCC) atribuye los avisos de carpetas al «Lazunox Motor» y se puede
// restablecer por id; el lanzador `lazunox-disclaim` se conserva (la mini-app no hereda los permisos de Lazunox).
// Diseño y pruebas: docs/DISENO-LAZUNOX-MOTOR.md. Solo macOS; en otras plataformas no hace nada.
//   node scripts/stage-motor-app.mjs [--if-missing]
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Info.plist mínimo de la mini-app (puro: lo prueba stage-motor-app.test.mjs). */
export function motorInfoPlist({ id, version, buildVersion = version }) {
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const doc = esc('Lazunox Motor necesita acceder a esta carpeta para trabajar con tus archivos cuando se lo pides.')
  const entries = [
    ['CFBundleIdentifier', id],
    ['CFBundleExecutable', 'opencode'],
    ['CFBundleName', 'Lazunox Motor'],
    ['CFBundleDisplayName', 'Lazunox Motor'],
    ['CFBundlePackageType', 'APPL'],
    ['CFBundleShortVersionString', version],
    ['CFBundleVersion', buildVersion],
    ['LSMinimumSystemVersion', '12.0'],
    ['NSDocumentsFolderUsageDescription', doc],
    ['NSDesktopFolderUsageDescription', doc],
    ['NSDownloadsFolderUsageDescription', doc],
    ['NSRemovableVolumesUsageDescription', doc],
    ['NSNetworkVolumesUsageDescription', doc]
  ]
  const body = entries.map(([k, v]) => `  <key>${k}</key>\n  <string>${esc(v)}</string>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}
  <key>LSUIElement</key>
  <true/>
  <key>LSBackgroundOnly</key>
  <true/>
</dict>
</plist>
`
}

/** Id del motor derivado del alias de brand.ts (igual que `disclaimId`). */
export function motorIdFromBrand(src) {
  const alias = /export const AUTHOR_ALIAS = '([^']*)'/.exec(src)?.[1]
  if (!alias) throw new Error('No se encontró AUTHOR_ALIAS en src/shared/brand.ts')
  return `cl.${alias}.lazunox.motor`
}

export function stageMotorApp({ rootDir = root, ifMissing = false } = {}) {
  const outApp = join(rootDir, 'resources/opencode-bin/Lazunox Motor.app')
  const src = join(rootDir, 'resources/opencode-bin/bin/opencode')
  if (!existsSync(src)) throw new Error(`Falta ${src}: ejecuta antes scripts/fetch-opencode.mjs`)
  const pin = JSON.parse(readFileSync(join(rootDir, 'resources/opencode-bin/pin.json'), 'utf8'))
  const id = motorIdFromBrand(readFileSync(join(rootDir, 'src/shared/brand.ts'), 'utf8'))
  const exe = join(outApp, 'Contents/MacOS/opencode')
  const plist = join(outApp, 'Contents/Info.plist')
  const want = motorInfoPlist({ id, version: pin.version })
  if (ifMissing && existsSync(exe) && existsSync(plist) && readFileSync(plist, 'utf8') === want && readFileSync(exe).equals(readFileSync(src))) {
    return { outApp, reused: true }
  }
  rmSync(outApp, { recursive: true, force: true })
  mkdirSync(join(outApp, 'Contents/MacOS'), { recursive: true })
  copyFileSync(src, exe)
  chmodSync(exe, 0o755)
  writeFileSync(plist, want)
  return { outApp, reused: false }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'darwin') {
    console.log('stage-motor-app: solo macOS; nada que hacer.')
  } else {
    const r = stageMotorApp({ ifMissing: process.argv.includes('--if-missing') })
    console.log(`stage-motor-app: ${r.reused ? 'ya estaba' : 'listo'} → ${r.outApp}`)
  }
}
