import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { checkVideoBundle } from './check-video-bundle.mjs'
const require = createRequire(import.meta.url)
const config = require('../electron-builder.js')

for (const platform of ['darwin', 'win32']) {
  test(`${platform}: mapeo real de extraResources conserva el lock, pin y verificación del armado`, async () => {
    const res = mkdtempSync(join(tmpdir(), 'video-bundle-'))
    try {
      const context = { electronPlatformName: platform, appOutDir: res, packager: { appInfo: { productFilename: 'Lazunox' } } }
      const resources = platform === 'darwin' ? join(res, 'Lazunox.app/Contents/Resources') : join(res, 'resources')
      const entry = config.extraResources.find((e) => e.from === 'resources/video')
      assert.ok(entry)
      const { FileMatcher, copyFiles } = require('app-builder-lib/out/fileMatcher.js')
      await copyFiles(
        [new FileMatcher(join(process.cwd(), entry.from), join(resources, entry.to), (s) => s, entry.filter)],
        undefined,
        false
      )
      checkVideoBundle(resources, platform)
      await config.afterPack(context)
      const dir = join(resources, entry.to)
      const lock = join(dir, 'hyperframes/package-lock.json')
      writeFileSync(lock, 'alterado')
      assert.throws(() => checkVideoBundle(resources, platform), /package-lock.json/)
      rmSync(lock)
      assert.throws(() => checkVideoBundle(resources, platform), /ENOENT/)
      cpSync('resources/video/hyperframes/package-lock.json', lock)
      rmSync(join(dir, 'pin.json'))
      assert.throws(() => checkVideoBundle(resources, platform), /ENOENT/)
      await assert.rejects(config.afterPack(context), /ENOENT/)
      assert.ok(readFileSync('electron-builder.js', 'utf8').includes('checkVideoBundle(res, context.electronPlatformName)'))
    } finally {
      rmSync(res, { recursive: true, force: true })
    }
  })
}
