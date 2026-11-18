import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
type FakeChild = EventEmitter & { stdin: PassThrough; stdout: PassThrough; kill: ReturnType<typeof vi.fn> }
const state = vi.hoisted(() => ({ child: null as FakeChild | null, args: [] as string[] }))
vi.mock('node:child_process', () => ({
  spawn: (_bin: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      kill: vi.fn((signal: string) => {
        if (signal === 'SIGKILL') queueMicrotask(() => child.emit('close', null))
        return true
      })
    })
    state.child = child
    state.args = args
    return child
  }
}))
import { videoPreview } from './preview'
let dir: string | undefined
afterEach(() => {
  vi.useRealTimers()
  if (dir) rmSync(dir, { recursive: true, force: true })
})
it('mata con SIGKILL al decodificador atascado y libera el cupo', async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'video-preview-process-')))
  const ftyp = Buffer.alloc(24)
  ftyp.writeUInt32BE(24)
  ftyp.write('ftypisom', 4)
  const moov = Buffer.alloc(56)
  moov.writeUInt32BE(56)
  moov.write('moov', 4)
  moov.writeUInt32BE(48, 8)
  moov.write('mvhd', 12)
  moov.writeUInt32BE(1000, 28)
  moov.writeUInt32BE(15000, 32)
  const path = join(dir, 'clip.mp4')
  writeFileSync(path, Buffer.concat([ftyp, moov]))
  vi.useFakeTimers()
  const pending = videoPreview(path, realpathSync, '/piezas/ffmpeg')
  await vi.waitFor(() => expect(state.child).not.toBeNull())
  expect(state.args.slice(0, state.args.indexOf('-i'))).toContain('-threads')
  expect(state.args).toContain('pipe')
  expect(state.args).not.toContain(path)
  await vi.advanceTimersByTimeAsync(8000)
  await expect(pending).resolves.toEqual({ duration: 15 })
  expect(state.child!.kill).toHaveBeenCalledWith('SIGKILL')
  await expect(videoPreview(path, realpathSync)).resolves.toEqual({ duration: 15 })
})
