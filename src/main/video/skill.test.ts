import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const dir = join(__dirname, '../../../resources/opencode/skills/video')
const skill = readFileSync(join(dir, 'SKILL.md'), 'utf8')

it('la skill enseña el ciclo con las herramientas reales y reglas de calidad', () => {
  expect(skill).toMatch(/^---\nname: video\n/)
  expect(skill).toContain('video_cuadros')
  expect(skill).toContain('video_render')
  expect(skill).toContain('no inventes comandos')
  expect(skill).toContain('Nunca un cuadro vacío')
  expect(skill).toContain('Cada escena lleva un elemento visual')
  expect(skill).toContain('No entregues con avisos pendientes sin corregirlos o explicarlos')
  expect(skill).toContain('El audio de la persona tiene prioridad')
  expect(skill).toContain('video_musica_buscar')
  expect(skill).toContain('Una promo lleva música por defecto')
  expect(skill).toContain('URL HTTPS pública')
  expect(skill).toContain('No pongas créditos ni pies de foto')
})

it('la skill no manda a la CLI, Studio, servicios en línea ni telemetría', () => {
  const all = [
    skill,
    ...['movimiento', 'estilo', 'historia', 'especificacion', 'cine', 'formato', 'revision', 'sonido', 'overlays'].map((f) =>
      readFileSync(join(dir, 'references', `${f}.md`), 'utf8')
    )
  ].join('\n')
  for (const banned of ['npx hyperframes', 'HeyGen', 'Framey', 'hyperframes-registry', 'telemetr']) expect(all).not.toContain(banned)
})

it('las guías citadas existen y hay aviso de licencia', () => {
  for (const ref of skill.matchAll(/references\/([a-z/]+\.md)/g)) expect(existsSync(join(dir, 'references', ref[1]!))).toBe(true)
  expect(readFileSync(join(dir, 'NOTICE.md'), 'utf8')).toContain('Apache')
})

it('incluye reglas breves para cualquier modelo: música, datos, idioma, personas y movimiento', () => {
  for (const rule of [
    'no descartes una pista por licencia',
    'licenciaFrase',
    'Días, precios, horarios y cifras: solo los que dio la persona',
    'español neutro',
    'Fotos sin personas reconocibles en primer plano',
    'Receta obligatoria por escena',
    'movimiento continuo durante toda la escena',
    'entrada y salida con causa',
    'nueva_version: true',
    'Ejemplo mínimo de la receta'
  ])
    expect(skill).toContain(rule)
})

it('fotos genéricas de producto válidas, tú por defecto y producto que cambia de estado', () => {
  expect(skill).toContain('busca 2–3 fotos del sujeto antes de componer')
  expect(skill).toContain('es justo lo que se quiere')
  expect(skill).toContain('No descartes los avisos de texto tapado o escena vacía')
  expect(skill).toContain('español neutro con «tú»')
  expect(skill).toContain('se arma, se dora, se llena o se sirve')
  expect(skill).toContain('su corteza crece hasta convertirse en el fondo')
  const reference = readFileSync(join(dir, 'references/formato.md'), 'utf8')
  for (const value of [
    'todos los días',
    '8:00',
    '20:00',
    'Calle Lira',
    'DESDE 2014',
    'cada lunes',
    'VENTAS 2026',
    'de crecimiento en el año'
  ])
    expect(reference).not.toContain(value)
})
