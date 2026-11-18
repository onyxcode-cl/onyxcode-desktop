import { afterEach, expect, it } from 'vitest'
import { mkdtemp, realpath, mkdir, writeFile, rm, symlink, link } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  textFiles,
  photoInputs,
  audioInputs,
  readMedia,
  validatePhoto,
  MAX_TEXT_FILE,
  MAX_MEDIA_FILE,
  FONT_FAMILIES
} from './project-input'
import { posixOnly } from '../../test/platform'
const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})
const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000020000000200806000000', 'hex')
it.each(['../a.html', '/a.html', 'C:/a.html', '~/.x.html', 'a/../b.html', 'a\\b.html', 'a//b.html', './x.html', 'x/./b.html', 'con.html'])(
  'archivos rechaza ruta %s',
  (path) => {
    expect(() => textFiles({ [path]: 'texto' })).toThrow()
  }
)
it('archivos conserva HTML y escenas; solo extensiones de texto y topes contados en bytes', () => {
  expect(
    textFiles({ 'index.html': '<div>ñ</div>', 'compositions/uno.html': '<template></template>', 'assets/a.svg': '<svg/>' })
  ).toHaveLength(3)
  for (const raw of [
    [],
    null,
    {},
    { 'a.png': 'imagen' },
    { 'a.html': 1 },
    { 'a.js': '\0' },
    { 'a.js': 'a'.repeat(MAX_TEXT_FILE + 1) },
    { 'a.js': 'ñ'.repeat(MAX_TEXT_FILE) },
    { 'A.js': '', 'a.js': '' },
    Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`${i}.css`, '']))
  ])
    expect(() => textFiles(raw)).toThrow()
  expect(() => textFiles(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`${i}.js`, 'a'.repeat(MAX_TEXT_FILE)])))).toThrow()
})
it('fotos requiere destino único en assets y no acepta enlaces remotos como destino', () => {
  expect(photoInputs([{ origen: 'imagen:id', destino: 'assets/foto.jpg' }])).toHaveLength(1)
  for (const p of [
    { origen: 'id', destino: '../a.jpg' },
    { origen: 'id', destino: '/a.jpg' },
    { origen: 'id', destino: 'assets/x.svg' },
    { origen: 'id', destino: 'a.jpg' },
    { origen: 'id', destino: 'assets/x.jpg', otro: 1 }
  ])
    expect(() => photoInputs([p])).toThrow()
  expect(() => photoInputs(Array(25).fill({ origen: 'id', destino: 'assets/x.jpg' }))).toThrow()
  expect(() =>
    photoInputs([
      { origen: 'id', destino: 'assets/x.jpg' },
      { origen: 'id', destino: 'assets/X.jpg' }
    ])
  ).toThrow()
  expect(() => validatePhoto(png)).not.toThrow()
  expect(() => validatePhoto(Buffer.from('un jpg falso'))).toThrow()
  const huge = Buffer.from(png)
  huge.writeUInt32BE(50000, 16)
  huge.writeUInt32BE(50000, 20)
  expect(() => validatePhoto(huge)).toThrow()
})
it('audio valida números, recortes, fundidos, cantidades y volumen; no interpreta expresiones', () => {
  expect(audioInputs([{ origen: 'persona.wav' }])[0]).toMatchObject({ inicio: 0, desde: 0, volumen: 1 })
  expect(audioInputs([{ origen: 'persona.wav', desde: 2, hasta: 8, inicio: 1, fundidoEntrada: 0.5 }])[0].hasta).toBe(8)
  for (const p of [
    { inicio: -1 },
    { desde: Infinity },
    { hasta: 0 },
    { desde: 5, hasta: 4 },
    { volumen: 4 },
    { volumen: '1;foo' },
    { fundidoSalida: NaN },
    { fundidoEntrada: 121 },
    { desconocido: true }
  ])
    expect(() => audioInputs([{ origen: 'x.wav', ...p }])).toThrow()
  expect(() => audioInputs(Array(17).fill({ origen: 'x.wav' }))).toThrow()
})
it('lee medios solo dentro del ámbito, con firma de foto, tamaños y cancelación', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lzx-video-input-'))
  dirs.push(dir)
  await mkdir(join(dir, 'assets'))
  await writeFile(join(dir, 'assets/foto.png'), png)
  await writeFile(join(dir, 'tono.wav'), 'audio se valida por ffprobe en el worker')
  expect(await readMedia(dir, 'assets/foto.png', 'photo', new AbortController().signal)).toEqual(png)
  expect(await readMedia(dir, join(dir, 'assets/foto.png'), 'photo', new AbortController().signal)).toEqual(png)
  for (const path of ['../fuera.png', '/etc/x.png', 'assets/foto.svg', 'https://example.com/a.jpg'])
    await expect(readMedia(dir, path, 'photo', new AbortController().signal)).rejects.toThrow()
  await expect(readMedia(dir, 'tono.wav', 'audio', AbortSignal.abort())).rejects.toThrow()
  await writeFile(join(dir, 'falso.jpg'), 'no es foto')
  await expect(readMedia(dir, 'falso.jpg', 'photo', new AbortController().signal)).rejects.toThrow()
  await writeFile(join(dir, 'grande.wav'), Buffer.alloc(MAX_MEDIA_FILE + 1))
  await expect(readMedia(dir, 'grande.wav', 'audio', new AbortController().signal)).rejects.toThrow()
})
it.skipIf(!posixOnly)('rechaza enlaces simbólicos y duros de fotos/audio y padres', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lzx-video-links-'))
  dirs.push(dir)
  await mkdir(join(dir, 'real'))
  await writeFile(join(dir, 'real/foto.png'), png)
  await symlink(join(dir, 'real'), join(dir, 'link'))
  await link(join(dir, 'real/foto.png'), join(dir, 'hard.png'))
  for (const path of ['link/foto.png', 'hard.png'])
    await expect(readMedia(dir, path, 'photo', new AbortController().signal)).rejects.toThrow()
})
it('la descripción ofrece exactamente las 18 familias locales', () => {
  expect(FONT_FAMILIES.split(', ')).toHaveLength(18)
})
it('los cambios incrementales cuentan el texto ya guardado, sin crecer ilimitadamente', async () => {
  const { checkProjectUpdate } = await import('./project-input')
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'lzx-video-budget-')))
  dirs.push(dir)
  for (let i = 0; i < 8; i++) await writeFile(join(dir, `${i}.js`), 'x'.repeat(MAX_TEXT_FILE))
  await expect(checkProjectUpdate(dir, [{ path: '0.js', size: 10 }], new AbortController().signal)).resolves.toBeUndefined()
  await expect(checkProjectUpdate(dir, [{ path: 'otro.js', size: 10 }], new AbortController().signal)).rejects.toThrow('4 MiB')
})
