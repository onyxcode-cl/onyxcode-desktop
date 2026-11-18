import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { realVideoRun } from './install'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))

describe('verificación de piezas: cierre de procesos', () => {
  it.each([false, true])('espera close después de exit y del callback (fallo: %s)', async (fails) => {
    const child = new EventEmitter()
    let finish: (error: Error | null, stdout: string, stderr: string) => void = () => undefined
    vi.mocked(execFile).mockImplementation(((_file, _args, _options, callback) => {
      finish = callback as typeof finish
      return child
    }) as typeof execFile)
    let settled = false
    const promise = realVideoRun('ffmpeg.exe', ['-version'], { cwd: '/test', env: {} })
    const result = promise.then(
      (output) => {
        settled = true
        return output
      },
      (error: unknown) => {
        settled = true
        return error
      }
    )
    child.emit('exit', fails ? 1 : 0)
    finish(fails ? Object.assign(new Error('blocked'), { code: 'EPERM' }) : null, 'ffmpeg version 9.0.2', '')
    await Promise.resolve()
    expect(settled).toBe(false)
    child.emit('close', fails ? 1 : 0)
    if (fails) expect(await result).toMatchObject({ code: 'broken', detail: expect.stringContaining('EPERM') })
    else expect(await result).toBe('ffmpeg version 9.0.2')
  })
})
