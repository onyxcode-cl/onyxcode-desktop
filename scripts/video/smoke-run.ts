import { cp, mkdir, readdir, lstat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { VideoService } from '../../src/main/video/service'
import { realVideoRun } from '../../src/main/video/install'
import { scopedEnv } from '../../src/main/runtimes/runtime-install'
export async function runSmoke(
  service: Pick<VideoService, 'asegurarPiezasVideo' | 'instalar' | 'estado' | 'rutas'>,
  getNode: () => string | null,
  userData: string,
  work: string,
  project: string,
  reportPath?: string
): Promise<void> {
  console.log('userData temporal:', userData)
  console.log('Antes:', service.asegurarPiezasVideo())
  const timer = setInterval(() => console.log('Progreso:', service.estado().progress), 3000)
  let installed
  try {
    installed = await service.instalar()
  } finally {
    clearInterval(timer)
  }
  if (!installed.ok) throw new Error(`instalación: ${installed.error}`)
  const paths = service.rutas()
  const node = getNode()
  if (!paths || !node) throw new Error('faltan rutas')
  // Copia solo la composición; GSAP procede de la instalación nueva, no del node_modules de la prueba anterior.
  const renderProject = join(work, 'composition')
  await mkdir(join(renderProject, '15-vertical'), { recursive: true })
  await cp(resolve(project, 'hyperframes/15-vertical/index.html'), join(renderProject, '15-vertical/index.html'))
  await cp(join(paths.hyperframes, 'node_modules/gsap'), join(renderProject, 'node_modules/gsap'), { recursive: true })
  const env = {
    ...scopedEnv(process.platform, [resolve(node, '..')]),
    HOME: work,
    USERPROFILE: work,
    TMPDIR: work,
    TEMP: work,
    TMP: work,
    HYPERFRAMES_BROWSER_PATH: paths.chrome,
    HYPERFRAMES_FFMPEG_PATH: paths.ffmpeg,
    HYPERFRAMES_CACHE_DIR: join(work, 'hf-cache'),
    HYPERFRAMES_CONFIG_DIR: join(work, 'hf-config'),
    HYPERFRAMES_NO_TELEMETRY: '1',
    HYPERFRAMES_NO_UPDATE_CHECK: '1',
    DO_NOT_TRACK: '1',
    ...(process.env.CODEX_SANDBOX ? { CODEX_SANDBOX: process.env.CODEX_SANDBOX } : {})
  }
  const output = join(work, '15-vertical.mp4')
  console.log(
    await realVideoRun(
      node,
      [
        join(paths.hyperframes, 'node_modules/hyperframes/bin/hyperframes.mjs'),
        'render',
        renderProject,
        '--composition',
        '15-vertical/index.html',
        '--fps',
        '30',
        '--workers',
        '4',
        '--crf',
        '18',
        '--quality',
        'standard',
        '--output',
        output
      ],
      { cwd: renderProject, env }
    )
  )
  const probe = await realVideoRun(
    paths.ffprobe,
    [
      '-v',
      'error',
      '-count_frames',
      '-show_entries',
      'stream=codec_name,width,height,nb_read_frames:format=duration',
      '-of',
      'json',
      output
    ],
    { cwd: work, env }
  )
  const info = JSON.parse(probe)
  if (
    Number(info.format.duration) !== 15 ||
    info.streams[0].nb_read_frames !== '450' ||
    info.streams[0].width !== 1080 ||
    info.streams[0].height !== 1920 ||
    info.streams[0].codec_name !== 'h264'
  )
    throw new Error(`MP4 incorrecto: ${probe}`)
  await realVideoRun(paths.ffmpeg, ['-v', 'error', '-i', output, '-f', 'null', '-'], { cwd: work, env })
  async function size(dir: string): Promise<{ bytes: number; allocatedBytes: number }> {
    let bytes = 0,
      allocatedBytes = 0
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        const s = await size(path)
        bytes += s.bytes
        allocatedBytes += s.allocatedBytes
      } else if (entry.isFile()) {
        const s = await lstat(path)
        bytes += s.size
        allocatedBytes += s.blocks * 512
      }
    }
    return { bytes, allocatedBytes }
  }
  const pieces = {}
  for (const name of await readdir(join(userData, 'video'))) pieces[name] = await size(join(userData, 'video', name))
  const report = {
    platform: process.platform,
    work,
    output,
    paths,
    info,
    pieces,
    node: await size(join(userData, 'runtimes')),
    mp4Bytes: (await lstat(output)).size
  }
  await writeFile(reportPath ?? join(work, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
