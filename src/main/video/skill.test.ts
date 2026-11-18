import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

it('la skill exige composición legible, transiciones con contenido y verificaciones reales sin prometer audio', () => {
  const skill = readFileSync(join(__dirname, '../../../resources/opencode/skills/video/SKILL.md'), 'utf8')
  expect(skill).toContain('cada escena debe tener un elemento visual')
  expect(skill).toContain('48/80 px; horizontal 1920×1080, 40/72 px')
  expect(skill).toContain('Nunca dejes un cuadro vacío entre escenas')
  expect(skill).toContain('no renderices')
  expect(skill).toContain('no inventes comandos ni comprobaciones')
  expect(skill).toContain('no ofrezcas ni prometas incorporarlo en otra versión')
  expect(skill).not.toContain('ofrece trabajar con audio')
})
