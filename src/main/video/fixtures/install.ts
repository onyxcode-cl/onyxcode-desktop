/** Dobles de archivos/procesos: ninguna prueba unitaria descarga piezas reales. */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { vi } from 'vitest'
import type { VideoDeps } from '../install'
import { parseVideoPin, VIDEO_BINARY_IDS } from '../video-pin'

export async function videoFixture(root: string, platform: 'darwin' | 'win32' = 'darwin'): Promise<VideoDeps> {
  const resourcesDir = join(__dirname, '../../../../resources/video')
  const pin = parseVideoPin(JSON.parse(readFileSync(join(resourcesDir, 'pin.json'), 'utf8')))!
  const key = platform === 'win32' ? 'win32-x64' : 'darwin-arm64'
  const archives = new Map<string, Buffer>()
  for (const id of VIDEO_BINARY_IDS) {
    const asset = pin[id].assets[key]
    if (!asset) continue
    const top = asset.strip ? 'top/' : ''
    const zip = new JSZip().file(top + asset.bin, `fake ${id}`)
    if (id === 'chrome') zip.file(top + 'LICENSE.headless_shell', 'license')
    if (id === 'ffmpeg' && platform === 'win32') zip.file(top + 'bin/ffprobe.exe', 'fake ffprobe')
    const buf = await zip.generateAsync({ type: 'nodebuffer' })
    asset.size = buf.length
    asset.sha256 = createHash('sha256').update(buf).digest('hex')
    archives.set(asset.url, buf)
  }
  const node = { bin: join(root, 'node', platform === 'win32' ? 'node.exe' : 'bin/node'), npmCli: join(root, 'node/npm-cli.js') }
  return {
    videoDir: join(root, 'video'),
    resourcesDir,
    pin,
    platform,
    arch: platform === 'win32' ? 'x64' : 'arm64',
    freeBytes: async () => 1e12,
    node: () => ({ paths: node, missingBytes: 0, version: '24.22.0' }),
    ensureNode: vi.fn(async () => node),
    fetch: vi.fn(async (url) => new Response(new Uint8Array(archives.get(url)!))),
    run: vi.fn(async (file, args, options) => {
      if (file === node.bin) {
        if (args.includes('ci')) {
          for (const [name, content] of [
            ['node_modules/hyperframes/bin/hyperframes.mjs', 'fake cli'],
            ['node_modules/hyperframes/package.json', '{"version":"0.9.64"}'],
            ['node_modules/gsap/package.json', '{"version":"3.15.0"}']
          ]) {
            await mkdir(join(options.cwd, name, '..'), { recursive: true })
            await writeFile(join(options.cwd, name), content)
          }
          return ''
        }
        return '0.9.64 3.15.0\n'
      }
      if (file.includes('chrome-headless-shell')) return 'Google Chrome for Testing 158.0.8127.36\n'
      if (args[0] === '-L') return 'GNU General Public License version 3 or later'
      const id = file.includes('ffprobe') ? 'ffprobe' : 'ffmpeg'
      return `${id} version 9.0.2-build\nconfiguration: --enable-gpl --enable-version3 --enable-libx264\n`
    })
  }
}
