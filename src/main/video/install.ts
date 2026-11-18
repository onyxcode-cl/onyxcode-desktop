/** Descarga verificada, extracción acotada y publicación atómica. Las pruebas inyectan red/procesos falsos. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, mkdtemp, readdir, rename, rm, statfs, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { VideoEnsureResult, VideoPaths, VideoSnapshot } from '@shared/video'
import { ArchiveError, extractArchive } from '../runtimes/archive'
import { cleanStaleTemp, RuntimeError, scopedEnv, toRuntimeError } from '../runtimes/runtime-install'
import { pinnedDownload, PinnedDownloadError, type PinnedDownloadOptions } from '../tasks/backends/pinned-download'
import type { FetchLike } from '../remote/tunnel/binary'
import { VIDEO_BINARY_IDS, videoHosts, videoPlatform, type VideoBinaryId, type VideoPin } from './video-pin'

export interface VideoNode {
  bin: string
  npmCli: string
}
export type VideoRun = (
  file: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; signal?: AbortSignal }
) => Promise<string>
export interface VideoDeps {
  videoDir: string
  resourcesDir: string
  pin: VideoPin | null
  platform?: NodeJS.Platform
  arch?: string
  fetch?: FetchLike
  download?: (url: string, dest: string, o: PinnedDownloadOptions) => Promise<{ cached: boolean }>
  run?: VideoRun
  node: () => { paths: VideoNode | null; missingBytes: number; version: string }
  ensureNode: (progress: (done: number, total: number) => void, signal?: AbortSignal) => Promise<VideoNode>
  freeBytes?: () => Promise<number>
}

export const realVideoRun: VideoRun = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { ...options, timeout: 300_000, maxBuffer: 2 << 20, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new RuntimeError(options.signal?.aborted ? 'cancelled' : 'broken', `${stdout}${stderr}`.slice(-200)))
      else resolve(`${stdout}${stderr}`)
    })
  })

const MARKER = '.lazunox-video.json'
const hash = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex')
const keyOf = (d: VideoDeps) => videoPlatform(d.platform, d.arch)
const dirOf = (d: VideoDeps, id: VideoBinaryId | 'hyperframes'): string => join(d.videoDir, `${id}-${d.pin![id].version}`)
const abort = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new RuntimeError('cancelled')
}

function binaryFiles(d: VideoDeps, id: VideoBinaryId): string[] {
  const a = d.pin![id].assets[keyOf(d)!]!
  if (id === 'chrome') return [a.bin, 'LICENSE.headless_shell']
  return [
    a.bin,
    ...(id === 'ffmpeg' && keyOf(d) === 'win32-x64' ? ['bin/ffprobe.exe'] : []),
    'LICENSE.GPL-3.0.txt',
    'BUILD-CONFIG.txt',
    'LICENSE-OUTPUT.txt',
    'SOURCE.txt'
  ]
}
const HF_FILES = [
  'package.json',
  'package-lock.json',
  'node_modules/hyperframes/bin/hyperframes.mjs',
  'node_modules/hyperframes/package.json',
  'node_modules/gsap/package.json'
]

/** Ningún padre ni archivo esencial puede ser un enlace hacia fuera de la instalación. */
function regularSize(root: string, relative: string): number {
  let p = root
  const top = lstatSync(root)
  if (!top.isDirectory() || top.isSymbolicLink()) throw new Error('directory')
  for (const segment of relative.split('/')) {
    p = join(p, segment)
    if (lstatSync(p).isSymbolicLink()) throw new Error('link')
  }
  const st = lstatSync(p)
  if (!st.isFile() || st.size === 0) throw new Error('file')
  return st.size
}

function fingerprint(d: VideoDeps, id: VideoBinaryId | 'hyperframes'): string {
  return hash(
    JSON.stringify(id === 'hyperframes' ? d.pin!.hyperframes : { ...d.pin![id], assets: { [keyOf(d)!]: d.pin![id].assets[keyOf(d)!] } })
  )
}

function inspect(d: VideoDeps, id: VideoBinaryId | 'hyperframes'): 'installed' | 'missing' | 'broken' {
  const dir = dirOf(d, id)
  try {
    lstatSync(dir)
  } catch {
    return 'missing'
  }
  try {
    regularSize(dir, MARKER)
    const marker = JSON.parse(readFileSync(join(dir, MARKER), 'utf8')) as { fingerprint: string; files: Record<string, number> }
    if (marker.fingerprint !== fingerprint(d, id)) return 'broken'
    const files = id === 'hyperframes' ? HF_FILES : binaryFiles(d, id)
    for (const file of files) if (regularSize(dir, file) !== marker.files[file]) return 'broken'
    if (
      id === 'hyperframes' &&
      (hash(readFileSync(join(dir, 'package-lock.json'))) !== d.pin!.hyperframes.lockSha256 ||
        hash(readFileSync(join(dir, 'package.json'))) !== d.pin!.hyperframes.packageSha256)
    )
      return 'broken'
    return 'installed'
  } catch {
    return 'broken'
  }
}

export function videoStatus(d: VideoDeps): VideoSnapshot {
  const key = keyOf(d)
  if (!key || !d.pin) return { offered: false, ready: false, installing: false, missingBytes: 0, items: [] }
  const ids = VIDEO_BINARY_IDS.filter((id) => d.pin![id].assets[key])
  const items: VideoSnapshot['items'] = [...ids, 'hyperframes' as const].map((id) => ({
    id,
    version: d.pin![id].version,
    state: inspect(d, id)
  }))
  const node = d.node()
  items.push({ id: 'node', version: node.version, state: node.paths ? 'installed' : 'missing' })
  let missingBytes = node.paths ? 0 : node.missingBytes
  for (const item of items) {
    if (item.state === 'installed' || item.id === 'node') continue
    missingBytes += item.id === 'hyperframes' ? d.pin.hyperframes.downloadBytes[key] : d.pin[item.id].assets[key]!.size
  }
  return { offered: true, ready: items.every((i) => i.state === 'installed'), installing: false, missingBytes, items }
}

export function videoPaths(d: VideoDeps): VideoPaths | null {
  if (!videoStatus(d).ready) return null
  const win = keyOf(d) === 'win32-x64'
  return {
    chrome: join(dirOf(d, 'chrome'), d.pin!.chrome.assets[keyOf(d)!]!.bin),
    ffmpeg: join(dirOf(d, 'ffmpeg'), d.pin!.ffmpeg.assets[keyOf(d)!]!.bin),
    ffprobe: win ? join(dirOf(d, 'ffmpeg'), 'bin', 'ffprobe.exe') : join(dirOf(d, 'ffprobe'), 'ffprobe'),
    hyperframes: dirOf(d, 'hyperframes')
  }
}

/** Solo inspección. El paso 2 debe pedir consentimiento si devuelve missing. */
export function asegurarPiezasVideo(d: VideoDeps): VideoEnsureResult {
  const status = videoStatus(d)
  if (!status.offered) return { state: 'unsupported' }
  const paths = videoPaths(d)
  return paths ? { state: 'ready', paths } : { state: 'missing', missingBytes: status.missingBytes }
}

async function publish(d: VideoDeps, id: VideoBinaryId | 'hyperframes', stage: string, signal?: AbortSignal): Promise<void> {
  abort(signal)
  const files: Record<string, number> = {}
  for (const file of id === 'hyperframes' ? HF_FILES : binaryFiles(d, id)) files[file] = regularSize(stage, file)
  await writeFile(join(stage, MARKER), JSON.stringify({ fingerprint: fingerprint(d, id), files }), { mode: 0o600 })
  abort(signal)
  await rm(dirOf(d, id), { force: true, recursive: true })
  await rename(stage, dirOf(d, id))
}

type Progress = (p: NonNullable<VideoSnapshot['progress']>) => void
async function installBinary(
  d: VideoDeps,
  id: VideoBinaryId,
  before: number,
  total: number,
  progress: Progress,
  signal?: AbortSignal
): Promise<number> {
  const a = d.pin![id].assets[keyOf(d)!]!
  const work = await mkdtemp(join(d.videoDir, '.tmp-'))
  const stage = join(work, 'stage')
  try {
    abort(signal)
    progress({ phase: 'download', done: before, total })
    await (d.download ?? pinnedDownload)(a.url, join(work, 'archive'), {
      fetch: d.fetch ?? ((u, i) => fetch(u, { ...i, redirect: 'manual' })),
      size: a.size,
      sha256: a.sha256,
      hosts: videoHosts(id, keyOf(d)!),
      signal,
      onBytes: (n) => progress({ phase: 'download', done: before + n, total })
    })
    progress({ phase: 'extract', done: before + a.size, total })
    await extractArchive(join(work, 'archive'), a.format, stage, a, signal)
    abort(signal)
    const bin = join(stage, a.bin)
    regularSize(stage, a.bin)
    if (d.platform !== 'win32') await chmod(bin, 0o755)
    progress({ phase: 'verify', done: before + a.size, total })
    const env = scopedEnv(d.platform ?? process.platform, [dirname(bin)])
    const run = (args: string[], file = bin) => (d.run ?? realVideoRun)(file, args, { cwd: stage, env, signal })
    const output = await run([id === 'chrome' ? '--version' : '-version'])
    const expected = d.pin![id].version.replace(/\./g, '\\.')
    const re =
      id === 'chrome' ? new RegExp(`(?:Chrome|Chromium).*?\\b${expected}(?:\\s|$)`) : new RegExp(`^${id} version ${expected}(?:[-\\s]|$)`)
    if (!re.test(output)) throw new RuntimeError('broken', 'version')
    if (id !== 'chrome') {
      if (!output.includes('--enable-gpl') || output.includes('--enable-nonfree') || !output.includes('--enable-libx264'))
        throw new RuntimeError('unsafe', 'ffmpeg build')
      await copyFile(join(d.resourcesDir, 'GPL-3.0.txt'), join(stage, 'LICENSE.GPL-3.0.txt'))
      await writeFile(join(stage, 'LICENSE-OUTPUT.txt'), await run(['-L']))
      await writeFile(join(stage, 'BUILD-CONFIG.txt'), await run(['-buildconf']))
      await writeFile(
        join(stage, 'SOURCE.txt'),
        `FFmpeg ${d.pin![id].version}\n${d.pin![id].source}\nBuild: ${a.url}\nGPL-3.0-or-later\nhttps://ffmpeg.org/legal.html\n`
      )
      if (keyOf(d) === 'win32-x64') {
        const probe = join(stage, 'bin', 'ffprobe.exe')
        regularSize(stage, 'bin/ffprobe.exe')
        if (!new RegExp(`^ffprobe version ${expected}(?:[-\\s]|$)`).test(await run(['-version'], probe)))
          throw new RuntimeError('broken', 'ffprobe version')
      }
    }
    await publish(d, id, stage, signal)
    return a.size
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

/** Comprueba el lock firmado ANTES de que npm lea una sola URL. */
export function validateVideoLock(d: VideoDeps): { packageJson: Buffer; lock: Buffer } {
  const packageJson = readFileSync(join(d.resourcesDir, 'hyperframes', 'package.json'))
  const lock = readFileSync(join(d.resourcesDir, 'hyperframes', 'package-lock.json'))
  if (hash(packageJson) !== d.pin!.hyperframes.packageSha256 || hash(lock) !== d.pin!.hyperframes.lockSha256)
    throw new RuntimeError('hash', 'lockfile')
  const parsed = JSON.parse(lock.toString()) as {
    lockfileVersion: number
    packages: Record<string, { resolved?: string; integrity?: string; link?: boolean }>
  }
  if (parsed.lockfileVersion !== 3 || !parsed.packages) throw new RuntimeError('unsafe', 'lockfile')
  for (const [name, value] of Object.entries(parsed.packages)) {
    if (!name) continue
    if (
      value.link ||
      !value.resolved?.startsWith('https://registry.npmjs.org/') ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(value.integrity ?? '')
    )
      throw new RuntimeError('unsafe', 'npm source')
  }
  return { packageJson, lock }
}

async function treeLimits(root: string, maxBytes: number, maxEntries: number): Promise<void> {
  let bytes = 0,
    entries = 0
  async function visit(dir: string): Promise<void> {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (++entries > maxEntries) throw new RuntimeError('unsafe', 'npm entries')
      const path = join(dir, e.name)
      if (e.isDirectory()) await visit(path)
      else if (e.isFile()) bytes += (await lstat(path)).size
      else if (!e.isSymbolicLink()) throw new RuntimeError('unsafe', 'npm file')
      if (bytes > maxBytes) throw new RuntimeError('unsafe', 'npm bytes')
    }
  }
  await visit(root)
}

async function installHyperframes(
  d: VideoDeps,
  node: VideoNode,
  before: number,
  total: number,
  progress: Progress,
  signal?: AbortSignal
): Promise<void> {
  const { packageJson, lock } = validateVideoLock(d)
  const work = await mkdtemp(join(d.videoDir, '.tmp-'))
  const stage = join(work, 'stage')
  try {
    await mkdir(stage)
    await writeFile(join(stage, 'package.json'), packageJson)
    await writeFile(join(stage, 'package-lock.json'), lock)
    // Aísla configuración, caché y logs. Nunca lee .npmrc del usuario ni del proyecto de la composición.
    const config = join(work, 'npmrc')
    await writeFile(config, '')
    const env = {
      ...scopedEnv(d.platform ?? process.platform, [dirname(node.bin)]),
      HOME: work,
      USERPROFILE: work,
      TMPDIR: work,
      TEMP: work,
      TMP: work,
      HYPERFRAMES_NO_TELEMETRY: '1',
      HYPERFRAMES_NO_UPDATE_CHECK: '1',
      DO_NOT_TRACK: '1'
    }
    progress({ phase: 'npm' })
    abort(signal)
    const run = (args: string[]) => (d.run ?? realVideoRun)(node.bin, args, { cwd: stage, env, signal })
    await run([
      node.npmCli,
      'ci',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--registry=https://registry.npmjs.org',
      `--cache=${join(work, 'npm-cache')}`,
      `--userconfig=${config}`,
      `--globalconfig=${join(work, 'global-npmrc')}`,
      '--update-notifier=false'
    ])
    abort(signal)
    await treeLimits(stage, d.pin!.hyperframes.unpackedMax, d.pin!.hyperframes.maxEntries)
    progress({ phase: 'verify', done: before + d.pin!.hyperframes.downloadBytes[keyOf(d)!], total })
    // esbuild funciona con su dependencia opcional nativa; no necesita ejecutar postinstall.
    const out = await run([
      '-e',
      "const e=require('esbuild');e.transformSync('let x=1');require('sharp');console.log(require('hyperframes/package.json').version+' '+require('gsap/package.json').version)"
    ])
    if (out.trim() !== `${d.pin!.hyperframes.version} ${d.pin!.hyperframes.gsap}`) throw new RuntimeError('broken', 'hyperframes version')
    await publish(d, 'hyperframes', stage, signal)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

/** Solo llamar tras consentimiento: instala Node primero y conserva piezas completas si se cancela. */
export async function installVideo(d: VideoDeps, progress: Progress = () => undefined, signal?: AbortSignal): Promise<void> {
  if (!videoStatus(d).offered) throw new RuntimeError('unsupported')
  try {
    abort(signal)
    validateVideoLock(d)
    await mkdir(d.videoDir, { recursive: true, mode: 0o700 })
    const top = await lstat(d.videoDir)
    if (!top.isDirectory() || top.isSymbolicLink()) throw new RuntimeError('unsafe', 'video directory')
    const st = videoStatus(d)
    const free = await (
      d.freeBytes ??
      (async () => {
        const s = await statfs(d.videoDir)
        return s.bavail * s.bsize
      })
    )()
    if (free < st.missingBytes * 8) throw new RuntimeError('disk')
    let done = 0
    const total = st.missingBytes
    const node = d.node()
    let paths = node.paths
    if (!paths) {
      progress({ phase: 'node', done, total })
      paths = await d.ensureNode((n) => progress({ phase: 'node', done: n, total }), signal)
      done += node.missingBytes
    }
    abort(signal)
    for (const id of VIDEO_BINARY_IDS) {
      if (d.pin![id].assets[keyOf(d)!] && inspect(d, id) !== 'installed') done += await installBinary(d, id, done, total, progress, signal)
    }
    if (inspect(d, 'hyperframes') !== 'installed') await installHyperframes(d, paths, done, total, progress, signal)
    if (!videoStatus(d).ready) throw new RuntimeError('broken', 'missing after install')
    progress({ phase: 'done', done: total, total })
  } catch (e) {
    if (e instanceof ArchiveError) throw new RuntimeError(e.code === 'aborted' ? 'cancelled' : 'unsafe', e.code)
    if (e instanceof PinnedDownloadError) {
      const code =
        e.code === 'aborted'
          ? 'cancelled'
          : ['bad-hash', 'bad-size', 'too-big'].includes(e.code)
            ? 'hash'
            : ['bad-url', 'bad-host', 'too-many-redirects'].includes(e.code)
              ? 'unsafe'
              : e.code === 'offline' || e.code === 'permission' || e.code === 'disk'
                ? e.code
                : 'download'
      throw new RuntimeError(code, e.code)
    }
    if (signal?.aborted) throw new RuntimeError('cancelled')
    throw toRuntimeError(e)
  }
}

export async function cleanupVideo(dir: string): Promise<void> {
  const top = await lstat(dir).catch(() => null)
  if (top?.isDirectory() && !top.isSymbolicLink()) await cleanStaleTemp(dir)
}
export async function removeVideo(d: VideoDeps): Promise<void> {
  await rm(d.videoDir, { recursive: true, force: true })
}
