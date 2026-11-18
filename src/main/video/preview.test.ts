import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { videoPreview } from './preview'
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function mp4(version = 0): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'video-preview-')))
  dirs.push(dir)
  const ftyp = Buffer.alloc(24)
  ftyp.writeUInt32BE(24)
  ftyp.write('ftypisom', 4)
  const mvhd = Buffer.alloc(48)
  mvhd.writeUInt32BE(48)
  mvhd.write('mvhd', 4)
  mvhd[8] = version
  const offset = version === 1 ? 28 : 20
  mvhd.writeUInt32BE(1000, offset)
  if (version === 1) mvhd.writeBigUInt64BE(15000n, offset + 4)
  else mvhd.writeUInt32BE(15000, offset + 4)
  const moov = Buffer.alloc(8)
  moov.writeUInt32BE(56)
  moov.write('moov', 4)
  const path = join(dir, 'clip.mp4')
  writeFileSync(path, Buffer.concat([ftyp, moov, mvhd]))
  return path
}
describe('videoPreview', () => {
  it.each([0, 1])('lee duración mvhd v%i sin cargar el video completo ni necesitar piezas', async (v) => {
    expect(await videoPreview(mp4(v), realpathSync)).toEqual({ duration: 15 })
  })
  it('no consulta archivos fuera del ámbito', async () => {
    expect(
      await videoPreview(mp4(), () => {
        throw new Error('fuera')
      })
    ).toBeUndefined()
  })
  it('rechaza contenido falso o cajas truncadas', async () => {
    const file = mp4()
    writeFileSync(file, 'no es mp4')
    expect(await videoPreview(file, realpathSync)).toBeUndefined()
    const truncated = mp4()
    writeFileSync(truncated, Buffer.from([0, 0, 0, 24, 102, 116, 121, 112]))
    expect(await videoPreview(truncated, realpathSync)).toBeUndefined()
  })
  it('un decodificador ausente conserva la duración y cierra el descriptor', async () => {
    expect(await videoPreview(mp4(), realpathSync, '/inexistente/ffmpeg')).toEqual({ duration: 15 })
  })
})
