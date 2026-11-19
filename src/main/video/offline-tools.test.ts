import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
// Ejecuta los helpers exactos enviados al worker; no necesita piezas instaladas ni red.
const source = readFileSync(join(__dirname, '../../../resources/video/offline-tools.mjs'), 'utf8').replace(/export /g, '')
const { FONT_NAMES, embeddedFonts, groupWarnings, audioFilter } = new Function(
  source + ';return {FONT_NAMES,embeddedFonts,groupWarnings,audioFilter}'
)() as {
  FONT_NAMES: string[]
  embeddedFonts: (data: Map<string, string>, base: string) => { files: Map<string, Buffer>; css: string }
  groupWarnings: (items: { time?: number; message: string; selector?: string; code?: string }[]) => string[]
  audioFilter: (tracks: Record<string, number>[], seconds: number) => string
}
it('agrupa por elemento, problema y rango sin repetir cada segundo; recorta datos externos', () => {
  expect(
    groupWarnings([
      { time: 1, selector: '#titulo', message: 'texto fuera' },
      { time: 8, selector: '#titulo', message: 'texto fuera' },
      { time: 4, selector: '#otro', message: 'texto fuera' }
    ])
  ).toEqual(['1–8 s: texto fuera [#titulo]', '4 s: texto fuera [#otro]'])
  expect(
    groupWarnings([
      { time: 1, message: 'el contenido ocupa solo el 2 %' },
      { time: 8, message: 'el contenido ocupa solo el 9 %' }
    ])
  ).toHaveLength(1)
  expect(groupWarnings(Array.from({ length: 200 }, (_, i) => ({ message: String(i) + 'x'.repeat(1000) })))).toHaveLength(80)
  expect(groupWarnings([{ message: 'a\0b' }])[0]).toBe('a b')
})
it('42 fuentes embebidas: las 18 familias se sirven por nombre desde un origen local', () => {
  const data = new Map<string, string>()
  const weights = [3, 3, 3, 3, 2, 1, 1, 2, 2, 2, 2, 3, 2, 2, 3, 2, 3, 3]
  FONT_NAMES.forEach((family, i) => {
    for (let j = 0; j < weights[i]; j++)
      data.set(`@fontsource/${family.toLowerCase().replaceAll(' ', '-')}:${400 + j * 100}:normal`, 'data:font/woff2;base64,d09GMg==')
  })
  const out = embeddedFonts(data, '/token/_lzx/fonts/')
  expect(out.files.size).toBe(42)
  for (const name of FONT_NAMES) expect(out.css).toContain(`font-family:"${name}"`)
  expect(out.css).toContain('url("/token/_lzx/fonts/inter-400.woff2")')
  expect(out.css).not.toMatch(/https?:|local\(/)
  expect(() => embeddedFonts(new Map(), '/')).toThrow('42')
})
it('el filtro recorta, retrasa, cambia volumen y fundidos, mezcla y rellena hasta la duración', () => {
  const filter = audioFilter([{ inicio: 1, desde: 2, duration: 6, volumen: 0.4, fundidoEntrada: 0.2, fundidoSalida: 0.5 }], 9)
  expect(filter).toContain('atrim=start=2:duration=6,asetpts=PTS-STARTPTS,volume=0.4')
  expect(filter).toContain('afade=t=in:st=0:d=0.2,afade=t=out:st=5.5:d=0.5,adelay=1000:all=1')
  expect(filter).toContain('amix=inputs=1:duration=longest:normalize=0')
  expect(filter).toContain('apad,atrim=duration=9[mix]')
})

it('los avisos de MP4 y texto tapado preceden al lint aunque haya más de 80 hallazgos', () => {
  const warnings = groupWarnings([
    ...Array.from({ length: 100 }, (_, i) => ({ message: `Revisión oficial: estructura ${i}` })),
    { time: 5.3, message: 'MP4 final: cuadro casi vacío' },
    { time: 5.4, message: 'el texto queda tapado' }
  ])
  expect(warnings.slice(0, 2)).toEqual(['5.3 s: MP4 final: cuadro casi vacío', '5.4 s: el texto queda tapado'])
})
