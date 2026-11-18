import { dirname, join, win32 } from 'node:path'
import type { VideoPaths } from '@shared/video'
import { scopedEnv } from '../../runtimes/runtime-install'

/** El smoke usa solo binarios propios, incluso con PATH vacío o distinto en Windows. */
export function smokeEnvironment(work: string, node: string, paths: VideoPaths, platform = process.platform): Record<string, string> {
  const dir = platform === 'win32' ? win32.dirname : dirname
  return {
    ...scopedEnv(platform, [dir(node), dir(paths.ffmpeg), dir(paths.ffprobe)]),
    HOME: work,
    USERPROFILE: work,
    TMPDIR: work,
    TEMP: work,
    TMP: work,
    HYPERFRAMES_BROWSER_PATH: paths.chrome,
    HYPERFRAMES_FFMPEG_PATH: paths.ffmpeg,
    HYPERFRAMES_FFPROBE_PATH: paths.ffprobe,
    HYPERFRAMES_CACHE_DIR: join(work, 'hf-cache'),
    HYPERFRAMES_CONFIG_DIR: join(work, 'hf-config'),
    HYPERFRAMES_NO_TELEMETRY: '1',
    HYPERFRAMES_NO_UPDATE_CHECK: '1',
    DO_NOT_TRACK: '1',
    ...(process.env.CODEX_SANDBOX ? { CODEX_SANDBOX: process.env.CODEX_SANDBOX } : {})
  }
}
