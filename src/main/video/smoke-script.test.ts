import { afterEach, expect, it, vi } from 'vitest'
import { smokeEnvironment } from './fixtures/smoke-env'
afterEach(() => vi.unstubAllEnvs())
it.each(['darwin', 'win32'] as const)('el smoke incluye ffprobe explícito y los ejecutables propios sin heredar PATH (%s)', (platform) => {
  vi.stubEnv('PATH', '/untrusted/project/bin')
  const base = platform === 'win32' ? String.raw`C:\video` : '/video'
  const slash = platform === 'win32' ? '\\' : '/'
  const paths = {
    chrome: `${base}${slash}chrome${slash}chrome`,
    ffmpeg: `${base}${slash}ffmpeg${slash}ffmpeg`,
    ffprobe: `${base}${slash}probe${slash}ffprobe`,
    hyperframes: base
  }
  const env = smokeEnvironment(base, `${base}${slash}node${slash}node`, paths, platform)
  expect(env.HYPERFRAMES_FFMPEG_PATH).toBe(paths.ffmpeg)
  expect(env.HYPERFRAMES_FFPROBE_PATH).toBe(paths.ffprobe)
  expect(env.PATH).toContain(`${base}${slash}probe`)
  expect(env.PATH).toContain(`${base}${slash}ffmpeg`)
  expect(env.PATH).not.toContain('/untrusted')
})
