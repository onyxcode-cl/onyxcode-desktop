// Pruebas (node:test) de scripts/stage-motor-app.mjs: Info.plist de la mini-app «Lazunox Motor» y armado del bundle.
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { motorIdFromBrand, motorInfoPlist, stageMotorApp } from './stage-motor-app.mjs'

test('motorInfoPlist: id, ejecutable, sin Dock y textos de privacidad de carpetas', () => {
  const x = motorInfoPlist({ id: 'cl.t.lazunox.motor', version: '1.19.0' })
  for (const k of ['CFBundleIdentifier', 'CFBundleExecutable', 'NSDocumentsFolderUsageDescription', 'NSDesktopFolderUsageDescription', 'NSDownloadsFolderUsageDescription', 'NSRemovableVolumesUsageDescription', 'NSNetworkVolumesUsageDescription'])
    assert.match(x, new RegExp(`<key>${k}</key>`))
  assert.match(x, /<key>CFBundleIdentifier<\/key>\s*<string>cl\.t\.lazunox\.motor<\/string>/)
  assert.match(x, /<key>CFBundleExecutable<\/key>\s*<string>opencode<\/string>/)
  assert.match(x, /<key>LSUIElement<\/key>\s*<true\/>/)
  assert.match(x, /<key>CFBundleShortVersionString<\/key>\s*<string>1\.19\.0<\/string>/)
})

test('motorIdFromBrand: deriva del alias y falla sin AUTHOR_ALIAS', () => {
  assert.equal(motorIdFromBrand("export const AUTHOR_ALIAS = 'zaf'"), 'cl.zaf.lazunox.motor')
  assert.throws(() => motorIdFromBrand('nada'), /AUTHOR_ALIAS/)
})

test('stageMotorApp: arma el bundle con el mismo binario, es idempotente y rehace si cambia el binario', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'stage-motor-'))
  try {
    mkdirSync(join(tmp, 'resources/opencode-bin/bin'), { recursive: true })
    mkdirSync(join(tmp, 'src/shared'), { recursive: true })
    writeFileSync(join(tmp, 'resources/opencode-bin/pin.json'), JSON.stringify({ version: '1.19.0' }))
    writeFileSync(join(tmp, 'src/shared/brand.ts'), "export const AUTHOR_ALIAS = 'bentec'\n")
    const src = join(tmp, 'resources/opencode-bin/bin/opencode')
    writeFileSync(src, 'binario-v1')
    chmodSync(src, 0o755)
    const a = stageMotorApp({ rootDir: tmp })
    const exe = join(a.outApp, 'Contents/MacOS/opencode')
    assert.equal(readFileSync(exe, 'utf8'), 'binario-v1')
    assert.ok((statSync(exe).mode & 0o111) !== 0)
    assert.match(readFileSync(join(a.outApp, 'Contents/Info.plist'), 'utf8'), /cl\.bentec\.lazunox\.motor/)
    assert.equal(stageMotorApp({ rootDir: tmp, ifMissing: true }).reused, true)
    writeFileSync(src, 'binario-v2')
    assert.equal(stageMotorApp({ rootDir: tmp, ifMissing: true }).reused, false)
    assert.equal(readFileSync(exe, 'utf8'), 'binario-v2')
    rmSync(src)
    assert.throws(() => stageMotorApp({ rootDir: tmp }), /fetch-opencode/)
    assert.ok(existsSync(a.outApp))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
