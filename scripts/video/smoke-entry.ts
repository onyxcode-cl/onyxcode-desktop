import { app } from 'electron'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { videoService } from '../../src/main/video/service'
import { runtimesService } from '../../src/main/runtimes/service'
import { runSmoke } from './smoke-run'
async function main(): Promise<void> {
  const arg = (key: string): string | undefined => {
    const i = process.argv.indexOf(key)
    return i >= 0 ? process.argv[i + 1] : undefined
  }
  const project = arg('--project')
  if (!project || !process.argv.includes('--install')) throw new Error('--install y --project son obligatorios')
  const work = await mkdtemp(join(tmpdir(), 'lzx-video-real-'))
  app.setPath('userData', join(work, 'userData'))
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(join(app.getPath('userData'), 'settings.json'), '{}')
  await app.whenReady()
  await runSmoke(videoService(), () => runtimesService().bins().node, app.getPath('userData'), work, project, arg('--report'))
  app.exit(0)
}
void main().catch((e) => {
  console.error(e)
  app.exit(1)
})
